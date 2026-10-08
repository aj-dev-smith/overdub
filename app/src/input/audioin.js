// The audio input: a mic, or a guitar/bass/keys through an interface. It opens with the browser's voice processing off
// (no echo cancellation, noise suppression or AGC: they wreck an instrument), picks a channel of the interface, meters
// it, tunes it, monitors it live through an armed audio track's inserts (engine.inputNode: a guitar plays through the
// ported pedals and amps as you play: the Guitar Studio, inside a DAW), and records it to that track through the
// recorder (input/recorder.js: count-in, loop passes as takes). Ported from clawd-o-matic's plug in (plugin.js).
//
// Which input: the track's own (the Inspector's Input: device and channel 1-8, track.input), else Sketch's picker (the
// last one opened; localStorage overdub:input). An interface is opened with all its channels (a 4- or 8-input one
// included) and the chosen one split off. A device plugged in or out shows up without a reload ('devices').
//
//   audio.devices() -> Promise<[{ id, label }]>        audio.open({ device, channel, monitor }) / close() / ensureOpen()
//   audio.openFor(track) -> state                       the track's input (or Sketch's picker), opened if it isn't
//   audio.inputOf(track) -> { device, channel, from: 'track' | 'picker' }
//   audio.state  { open, deviceId, label, channel ('1'…'32' | 'both' | 'stereo'), channels (the device's), settings,
//                  inputKind ('interface' | 'mic' | 'virtual' | ''), monitoring, monitorAuto (it started by itself),
//                  monitorOff ('' | 'mic' | 'feedback': why it's off), monitorLine (the sentence that says why, or ''),
//                  monitorTrack (the id it plays through), monitorWaiting, recording, countIn, error, sr }
//
// Monitoring is decided for each input as it opens (open's monitor: 'auto', the default): an instrument interface or
// line input the person picked (now, or last time) turns it on by itself, ramped in over 150 ms (a guitar through an
// interface can't feed back); a microphone (built in, a webcam's, AirPods', a phone's, the browser's one-channel
// default) leaves it off, with MIC_LINE in state.monitorLine; the browser's own pick never starts it. Reopening the same
// input keeps it as it was; turned on or off by hand (monitor(on)) it stays that way. While it plays, the feedback guard
// (createFeedbackGuard) listens to any input but an interface: a tone that rings up on its own turns monitoring off
// with a fast fade and one toast (FEEDBACK_LINE). inputKind(label) and createFeedbackGuard() are pure: tools/input-test.js checks both.
//   audio.level() -> { peak, db, clip }   (read it in a frame)
//   audio.tune({ lo, hi }?) -> { hz, midi, p, cents, stable, conf } | null   lo/hi: the instrument's range in Hz (default
//                  38-1400); cents only once the note has settled (stable), else null
//   audio.listen(fn({ f, d: [Float32Array] })) -> off    raw blocks with their audio-clock frame (hum, beatbox, latency)
//   audio.monitor(on?)   live through the armed audio track's inserts; with no audio track it stays on and waits
//   audio.monitorTrack() -> the track it plays through now | null (off, closed, or waiting: state.monitorWaiting)
//   audio.record({ track?, countIn? }) ; audio.stopRecord() ; audio.toggleRecord()   (through the recorder)
//   audio.recordTrack()  the track a take would go to       audio.latency  (latency.js)
//   events (app.input.on): 'audio' (state changed), 'take' (an audio take landed: { track, clip, asset, seconds }),
//   'devices' (the inputs changed: [{ id, label }]), 'monitor' ({ track, waiting }: what it plays through changed;
//   waiting: on, with no audio track to play through)

import { createLatency } from './latency.js';
import { createTuner, fft } from './pitch.js';

// The input recorder's processor ('ew-cap'): its module, a file on this origin (input/cap-worklet.js)
const CAP_WORKLET = new URL('./cap-worklet.js', import.meta.url).href;

const SAVE = 'overdub:input';
const dB = (d) => Math.pow(10, d / 20);

// What monitoring says when it's off for a reason (state.monitorLine; the feedback one is a toast too)
export const MIC_LINE =
  'Monitoring is off: this is a microphone, and through speakers it would howl. Use headphones, then turn it on.';
export const FEEDBACK_LINE = 'Feedback: monitoring is off. Headphones stop it.';

// What an input is, by its name. An instrument interface or a line input ('interface': a guitar through one can't feed
// back, so monitoring starts by itself when one is picked); a microphone ('mic': built in, a webcam's, AirPods', a
// phone's, a headset's, and the browser's own one-channel default: through speakers it hears itself); a virtual or
// loopback device ('virtual': it hears the speakers' own signal); '' (can't tell). The browser's default is named
// "Default - <device>": the device's name decides, but the browser's pick never starts monitoring by itself.
const IFACE_RE =
  /scarlett|focusrite|clarett|\bumc ?\d|behringer|usb audio codec|audient|\bid ?\d{1,2}\b|\bevo ?\d|apogee|\bboss\b|katana|\bgt-?\d|\bhx\b|helix|line ?6|\bpod\b|irig|ik multimedia|\bmotu\b|presonus|audiobox|steinberg|\bur ?\d{2}|universal audio|\bvolt ?\d|apollo|\bssl ?\d|arturia|minifuse|komplete audio|native instruments|tascam|\bus-?\d|rubix|roland|mackie|onyx|\brme\b|babyface|fireface|m-audio|m-track|antelope|kemper|fractal|axe-?fx|quad cortex|neural dsp|fender|mustang|blackstar|\bvox\b|\bnux\b|mooer|line[ -]?in\b|instrument|guitar/i;
const MIC_RE = /built-?in|macbook|internal|default|webcam|camera|airpods|iphone|headset/i;
const VIRTUAL_RE =
  /blackhole|loopback|soundflower|virtual|vb-?audio|voicemeeter|teams audio|zoomaudio|aggregate|multi-output|cable output/i;
export function inputKind(label, { channels = 0, isDefault = false } = {}) {
  const s = String(label || '').trim();
  if (VIRTUAL_RE.test(s)) return 'virtual';
  const name = s.replace(/^(default|communications)\s*[-–:]\s*/i, '');
  if (MIC_RE.test(name)) return 'mic';
  if (IFACE_RE.test(name)) return 'interface';
  // (a brand wins over the word: Windows calls a Focusrite's input "Microphone (Focusrite USB Audio)")
  if (/micro?phone|\bmic\b/i.test(name)) return 'mic';
  if ((isDefault || name !== s || !name) && channels <= 1) return 'mic';
  return '';
}

// The feedback guard: a tone at one frequency, the loudest thing in the input, whose own level grows frame on frame for
// `span` seconds (by `rise` dB in all) while the places its harmonics would be (an octave under it, two and three times
// it) don't grow with it: a microphone hearing its own monitor through the speakers rings up as a sine. A held note
// decays; a strum is many notes and starts again; a bend moves; a volume swell or a crescendo lifts a note's harmonics
// with it. None of them trips it. One 4096-point FFT a push (every 50 ms or so while monitoring).
//   createFeedbackGuard({ span, rise, share, floor }) -> { push(buf (its last 4096 samples are read), sr, t (s)) -> true
//       when it trips, reset() }
export function createFeedbackGuard({
  span = 0.3,
  rise = 4,
  share = 0.4,
  floor = -50,
  N = 4096,
  follow = 0.5,
  alone = 20,
} = {}) {
  const re = new Float32Array(N),
    im = new Float32Array(N),
    win = new Float32Array(N),
    pw = new Float32Array(N >> 1);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const full = ((N / 4) * (N / 4) * 1.5) / 2,
    H = N >> 1; // (a full-scale sine reads -3: its RMS level)
  const level = (p) => 10 * Math.log10(p / full + 1e-20);
  // the power within a bin of x, unless x is inside the tone's own skirt (kf: the tone; an octave under a low one is)
  let kf = 0;
  const around = (x) => {
    if (Math.abs(x - kf) < 4) return 0;
    const c = Math.round(x);
    let s = 0;
    for (let j = Math.max(2, c - 1); j <= Math.min(H - 1, c + 1); j++) s += pw[j];
    return s;
  };
  let run = null; // the frames so far where one tone leads and doesn't fall: { k, t0, db0, h0, top, db, h }
  return {
    reset() {
      run = null;
    },
    push(buf, sr, t) {
      const o = buf.length - N;
      if (o < 0) return false;
      for (let i = 0; i < N; i++) {
        re[i] = buf[o + i] * win[i];
        im[i] = 0;
      }
      fft(re, im);
      let tot = 0,
        pk = 0,
        k = 0;
      for (let j = 2; j < H; j++) {
        const p = re[j] * re[j] + im[j] * im[j];
        pw[j] = p;
        tot += p;
        if (p > pk) {
          pk = p;
          k = j;
        }
      }
      let near = 0;
      for (let j = Math.max(2, k - 2); j <= Math.min(H - 1, k + 2); j++) near += pw[j];
      // the peak between bins, and the level where its harmonics (and an octave under) would sit
      const a = pw[k - 1] || 0,
        c = pw[k + 1] || 0,
        den = a - 2 * pk + c;
      kf = k + (den < 0 ? (0.5 * (a - c)) / den : 0);
      const db = level(near),
        h = level(around(kf / 2) + around(2 * kf) + around(3 * kf));
      const leads = db > floor - 20 && tot > 0 && near / tot >= share;
      const same = run && Math.abs(k - run.k) <= Math.max(1.5, run.k * 0.015);
      if (leads && same && db >= run.db - 2 && db >= run.top - 3) {
        run.db = db;
        run.h = h;
        run.top = Math.max(run.top, db);
      } else run = leads ? { k, t0: t, db0: db, h0: h, top: db, db, h } : null;
      if (!run || t - run.t0 < span - 1e-3 || run.db < floor) return false;
      const up = run.db - run.db0;
      return up >= rise && run.h - run.h0 < up * follow && run.db - run.h >= alone;
    },
  };
}

// A timer that keeps time in background tabs (a Worker's setInterval; main-thread timers are throttled there): the
// guard has to hear feedback with the studio behind another tab too.
function ticker(fn, ms) {
  let w = null,
    iv = null;
  try {
    const url = URL.createObjectURL(
      new Blob(
        [
          'let id = null; onmessage = (e) => { clearInterval(id); id = e.data > 0 ? setInterval(() => postMessage(0), e.data) : null; };',
        ],
        { type: 'text/javascript' },
      ),
    );
    w = new Worker(url);
    URL.revokeObjectURL(url);
    w.onmessage = () => fn();
    w.onerror = () => {
      try {
        w.terminate();
      } catch (e) {
        /* ok */
      }
      w = null;
      if (!iv) iv = setInterval(fn, ms);
    };
    w.postMessage(ms);
  } catch (e) {
    w = null;
    iv = setInterval(fn, ms);
  }
  return () => {
    if (w) {
      try {
        w.postMessage(0);
        w.terminate();
      } catch (e) {
        /* ok */
      }
    }
    if (iv) clearInterval(iv);
  };
}

export function createAudioIn(app, input) {
  const engine = app.engine,
    store = app.store;
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SAVE) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  const state = {
    open: false,
    deviceId: saved.deviceId || '',
    label: '',
    channel: saved.channel || '1',
    channels: 0,
    settings: {},
    inputKind: '',
    monitoring: false,
    monitorAuto: false,
    monitorOff: '',
    monitorLine: '',
    monitorTrack: null,
    monitorWaiting: false,
    recording: false,
    countIn: saved.countIn !== false,
    error: '',
    sr: 0,
    opening: false,
  };
  let ctx = null,
    ownCtx = null,
    rig = null,
    cap = null,
    capReady = null,
    mon = null,
    monDest = null,
    recording = false;
  let warned = false,
    syncT = 0; // (the monitor: said once that it waits for a track; a sync queued)
  // the input monitoring was decided for (null: none yet; PENDING: turned on or off by hand before one was open), the
  // one open now, and the feedback guard while the monitor is wired
  const PENDING = {};
  let monFor = null,
    openId = null,
    guard = null,
    stopGuard = null;
  const recorder = () => input.recorder;
  const listeners = new Set();
  const tuners = new Map(); // the tuner for each range asked for: `${lo}|${hi}` -> { at, last, tuner }
  const persist = () => {
    try {
      localStorage.setItem(
        SAVE,
        JSON.stringify({ deviceId: picker.deviceId, channel: picker.channel, countIn: state.countIn }),
      );
    } catch (e) {
      /* ok */
    }
  };
  // Sketch's picker: what was last opened from it (a track's own input doesn't change it)
  let picker = { deviceId: state.deviceId, channel: state.channel };
  const changed = () => {
    state.monitorLine =
      state.monitorOff === 'feedback'
        ? FEEDBACK_LINE
        : state.open && !state.monitoring && state.inputKind === 'mic'
          ? MIC_LINE
          : '';
    input.emit('audio', state);
  };

  async function ensureCtx() {
    try {
      await engine.start();
    } catch (e) {
      /* silent engine */
    }
    if (engine.ctx) {
      ctx = engine.ctx;
      return ctx;
    }
    // FALLBACK until the engine has a context: a private one (no monitoring through tracks then)
    if (!ownCtx) ownCtx = new AudioContext({ latencyHint: 'interactive' });
    if (ownCtx.state !== 'running') {
      try {
        await ownCtx.resume();
      } catch (e) {
        /* gesture */
      }
    }
    ctx = ownCtx;
    return ctx;
  }

  const audio = {
    state,
    get ctx() {
      return ctx;
    },
    get open() {
      return state.open;
    },
    async devices() {
      const md = navigator.mediaDevices;
      if (!md || !md.enumerateDevices) return [];
      const all = await md.enumerateDevices().catch(() => []);
      return all
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({
          id: d.deviceId,
          label: d.label || (d.deviceId === 'default' ? 'Default input' : `Input ${i + 1}`),
        }));
    },
    // monitor: 'auto' (decide for this input: see below), true or false (turn it on or off for it), 'keep'
    async open({ device = picker.deviceId, channel = picker.channel, forTrack = null, monitor = 'auto' } = {}) {
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) {
        state.error =
          'Can’t open an audio input here: the page needs https (or localhost) and a browser that allows audio input.';
        changed();
        throw new Error(state.error);
      }
      state.opening = true;
      changed();
      const c = await ensureCtx();
      // ask for at least the channel wanted (an 8-input interface offers 8); then all the device has (below)
      const chN = Math.max(2, Math.min(32, parseInt(channel, 10) || 2));
      const want = {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: { ideal: chN },
        latency: { ideal: 0 },
      };
      const plain = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      if (device) {
        want.deviceId = { exact: device };
        plain.deviceId = { exact: device };
      }
      let stream = null,
        err = null;
      for (const a of [want, plain, device ? { deviceId: device } : true]) {
        try {
          stream = await md.getUserMedia({ audio: a });
          break;
        } catch (e) {
          err = err || e;
          if (e && e.name === 'NotAllowedError') break;
        }
      }
      state.opening = false;
      if (!stream) {
        state.error =
          err && err.name === 'NotAllowedError'
            ? 'The browser wasn’t allowed to use the input. Allow the microphone for this site (the icon in the address bar), then try again.'
            : err && err.name === 'OverconstrainedError'
              ? 'That input isn’t there any more. Pick another.'
              : `Couldn’t open the input (${(err && (err.message || err.name)) || 'error'}).`;
        if (err && err.name === 'OverconstrainedError') state.deviceId = '';
        changed();
        throw new Error(state.error);
      }
      audio.close(true);
      const track = stream.getAudioTracks()[0];
      // the device's real channel count: open it with all of them, so input 3 of 8 is there to pick
      try {
        const caps = track && track.getCapabilities ? track.getCapabilities() : {},
          max = caps.channelCount && caps.channelCount.max;
        const now = track && track.getSettings ? track.getSettings().channelCount : 0;
        if (max && now && max > now && track.applyConstraints)
          await track.applyConstraints({ ...plain, channelCount: { ideal: Math.min(32, max) } }).catch(() => {});
      } catch (e) {
        /* the browser can't say: what it opened is what there is */
      }
      const st = (track && track.getSettings && track.getSettings()) || {};
      const src = c.createMediaStreamSource(stream);
      const n = Math.max(1, Math.min(32, st.channelCount || 1)),
        ch = parseInt(channel, 10);
      // one channel of the interface (a guitar is on one input; a stereo downmix would halve it), both summed, or a pair
      const pick = c.createGain();
      pick.channelCount = channel === 'stereo' ? 2 : 1;
      pick.channelCountMode = 'explicit';
      pick.channelInterpretation = 'speakers';
      if (channel === 'both' || channel === 'stereo' || !(ch >= 1) || (n < 2 && ch <= 1)) src.connect(pick);
      else {
        // (a splitter as wide as the channel asked for: a channel the device doesn't have is silence, not channel 1)
        const sp = c.createChannelSplitter(Math.max(2, n, ch));
        src.connect(sp);
        sp.connect(pick, ch - 1);
      }
      const an = c.createAnalyser();
      an.fftSize = 4096;
      pick.connect(an);
      rig = { stream, src, pick, an, track, buf: new Float32Array(an.fftSize), peak: 0, clipAt: 0 };
      if (track)
        track.addEventListener('ended', () => {
          audio.close();
          app.ui?.toast?.('The input went away (unplugged or switched off).', { kind: 'bad' });
        });
      Object.assign(state, {
        open: true,
        deviceId: device || st.deviceId || '',
        asked: device || '',
        forTrack,
        label: (track && track.label) || 'Input',
        channel: String(channel),
        channels: n,
        settings: st,
        error: '',
        sr: c.sampleRate,
      });
      if (!forTrack) {
        picker = { deviceId: device || '', channel: String(channel) };
        persist();
      }
      // Monitoring for this input, decided when it isn't the input it was decided for (the same one reopened, or another
      // of its channels, keeps it as it was). On by itself, ramped in, for an instrument interface the person picked
      // (now, or last time: the device remembered); off for a microphone, with the line that says why; off for anything
      // else, a guitar interface the browser chose by itself included. Turned on or off by hand, it stays that way.
      openId = st.deviceId || device || '';
      state.inputKind = inputKind(state.label, { channels: n, isDefault: !device || device === 'default' });
      if (monFor === PENDING) monFor = openId;
      if (monitor === true || monitor === false) decide(monitor, { id: openId });
      else if (monitor === 'auto' && monFor !== openId) {
        if (state.inputKind === 'interface' && device && device !== 'default') decide(true, { auto: true, id: openId });
        else decide(false, { off: state.inputKind === 'mic' ? 'mic' : '', id: openId });
      }
      if (listeners.size) await attachCap();
      syncMonitor();
      changed();
      return state;
    },
    async ensureOpen() {
      if (!state.open) await audio.open();
      return state;
    },
    // The input a track records from: the Inspector's (track.input) when it was set, else Sketch's picker
    inputOf(t) {
      const inp = t && t.input;
      const ch =
        inp && /^(both|stereo)$/.test(String(inp.channel)) ? String(inp.channel) : String(+(inp && inp.channel) || 1); // (Sketch's picker may set both or stereo)
      if (inp && ((inp.device && inp.device !== 'default') || ch !== '1'))
        return { device: inp.device && inp.device !== 'default' ? inp.device : '', channel: ch, from: 'track' };
      return { device: picker.deviceId || '', channel: String(picker.channel || '1'), from: 'picker' };
    },
    async openFor(t) {
      const want = audio.inputOf(t);
      if (state.open && want.device === (state.asked || '') && want.channel === String(state.channel)) return state;
      // (opened for a track's own input, Sketch's picker keeps its choice)
      return audio.open({ device: want.device, channel: want.channel, forTrack: want.from === 'track' ? t.id : null });
    },
    close(quiet) {
      if (recording) {
        try {
          recorder()?.stop({ keepPlaying: true });
        } catch (e) {
          /* ok */
        }
      }
      if (cap) {
        try {
          cap.port.postMessage('off');
          cap.disconnect();
        } catch (e) {
          /* ok */
        }
        cap = null;
        capReady = null;
      }
      unwireMonitor();
      if (rig) {
        for (const t of rig.stream.getTracks()) t.stop();
        try {
          rig.src.disconnect();
          rig.pick.disconnect();
        } catch (e) {
          /* ok */
        }
        rig = null;
      }
      const was = state.open;
      state.open = false;
      // (quiet: open() is about to reopen and wire the monitor again)
      if (!quiet) report(false);
      if (was && !quiet) changed();
    },
    setChannel(ch) {
      picker.channel = state.channel = String(ch);
      persist();
      if (state.open) return audio.open({ channel: picker.channel });
      changed();
      return null;
    },
    setDevice(id) {
      picker.deviceId = state.deviceId = id;
      persist();
      if (state.open) return audio.open({ device: id });
      changed();
      return null;
    },

    level() {
      if (!rig) return { peak: 0, db: -120, clip: false, lvl: 0 };
      rig.an.getFloatTimeDomainData(rig.buf);
      let pk = 0;
      for (let i = 0; i < rig.buf.length; i++) {
        const v = Math.abs(rig.buf[i]);
        if (v > pk) pk = v;
      }
      rig.peak = Math.max(pk, rig.peak * 0.9);
      const now = performance.now();
      if (pk > 0.89) rig.clipAt = now;
      const db = 20 * Math.log10(rig.peak + 1e-9);
      return { peak: rig.peak, db, clip: now - rig.clipAt < 1200, lvl: Math.max(0, Math.min(1, (db + 60) / 60)) };
    },
    // the tuner: YIN on the analyser at most 25 times a second (input/pitch.js createTuner). { lo, hi } in Hz is the
    // instrument's range (default 38-1400 Hz: down to a bass's low E): the Jam room passes its tuning's low string and
    // top fret, so a chord's common period (A1 under an A7) is never a note. One tuner (and its 40 ms) per range.
    tune({ lo = 38, hi = 1400 } = {}) {
      if (!rig) return null;
      lo = Number.isFinite(+lo) && +lo >= 20 ? +lo : 38;
      hi = Number.isFinite(+hi) && +hi > lo * 1.5 ? Math.min(+hi, 5000) : Math.max(1400, lo * 1.5);
      const k = `${lo.toFixed(2)}|${hi.toFixed(2)}`;
      let tu = tuners.get(k);
      if (!tu) {
        if (tuners.size >= 4) tuners.clear();
        tu = { at: 0, last: null, tuner: createTuner({ lo, hi }) };
        tuners.set(k, tu);
      }
      const now = performance.now();
      if (now - tu.at < 40) return tu.last;
      tu.at = now;
      rig.an.getFloatTimeDomainData(rig.buf);
      tu.last = tu.tuner.push(rig.buf, ctx.sampleRate, now / 1000);
      return tu.last;
    },

    listen(fn) {
      listeners.add(fn);
      if (state.open && !cap) attachCap();
      return () => {
        listeners.delete(fn);
        if (!listeners.size && cap && !recording) {
          try {
            cap.port.postMessage('off');
            cap.disconnect();
          } catch (e) {
            /* ok */
          }
          cap = null;
          capReady = null;
        }
      };
    },

    /* ---- monitoring: the input through the record track's inserts, as you play */
    // the track the monitor plays through now, or null: monitoring off, the input closed, or waiting for an audio track
    // (state.monitorWaiting)
    monitorTrack: () => (monDest ? store.track(monDest.track) : null),
    // by hand: for the input open now (or the next one opened)
    monitor(on = !state.monitoring) {
      decide(on, { id: state.open ? openId : PENDING });
      syncMonitor();
      changed();
      return state.monitoring;
    },
    get _monitorGain() {
      return mon ? mon.gain.value : null;
    }, // (checks: the ramp in)

    /* ---- recording: the recorder (input/recorder.js) records the mic onto the armed audio track */
    recordTrack: () => recordTrack(false),
    get recording() {
      return recording;
    },
    _recording(on) {
      recording = !!on;
      state.recording = recording;
      changed();
    },
    setCountIn(v) {
      state.countIn = !!v;
      persist();
      recorder()?.setCountIn(v ? 1 : 0);
      changed();
    },
    async toggleRecord(o) {
      return recorder()?.state !== 'idle' ? audio.stopRecord() : audio.record(o);
    },
    // R for audio: onto `track` (or the armed / selected audio track; one is made if there is none)
    async record({ track = null, countIn = state.countIn } = {}) {
      const rc = recorder();
      if (!rc) return null;
      if (rc.state !== 'idle') return rc.live();
      const t = track ? store.track(track) : recordTrack(true);
      if (!t) return null;
      const bars = countIn === true ? Math.max(1, rc.countIn) : +countIn || 0;
      return rc.record({ audio: t.id, countIn: bars });
    },
    // -> { track, clip, asset, seconds, startBeat, latency } of the take that plays (the last pass), or null
    async stopRecord({ keepPlaying = false } = {}) {
      const rc = recorder();
      if (!rc || rc.state === 'idle') return null;
      const res = await rc.stop({ keepPlaying });
      if (!res || !res.ok || !res.audio) return null;
      const part = res.parts.find((x) => x.kind === 'audio' || store.track(x.track)?.kind === 'audio');
      const t = part ? store.track(part.track) : null;
      const clip = t
        ? t.clips.filter((c) => c.kind === 'audio' && c.asset === res.audio.asset && !c.mute).pop() ||
          t.clips.filter((c) => c.asset === res.audio.asset).pop()
        : null;
      return clip
        ? {
            track: t.id,
            clip: clip.id,
            asset: res.audio.asset,
            seconds: res.audio.seconds,
            startBeat: clip.start,
            latency: audio.latency.get(),
          }
        : null;
    },
    latency: null,
  };
  audio.latency = createLatency(audio);

  // the output latency the engine's playhead uses (engine.beat is what is heard now)
  function outLat() {
    const c = engine.ctx || ctx;
    return c ? c.outputLatency || c.baseLatency || 0 : 0;
  }
  audio.outLatency = outLat;
  // The audio track a take goes to: the armed one, else the selected audio track, else the first; arm it if asked to.
  // With no audio track at all, make one (never a dead end).
  function recordTrack(make) {
    const p = store.get(),
      sel = app.ui?.state?.selection?.track;
    const audios = p.tracks.filter((t) => t.kind === 'audio');
    let t = audios.find((x) => x.arm) || audios.find((x) => x.id === sel) || audios[0] || null;
    if (!make) return t;
    if (!t) {
      const r = store.dispatch(
        { type: 'track.add', ref: 'rec', track: { name: 'Audio', kind: 'audio', arm: true } },
        { by: 'you', label: 'add an audio track to record on' },
      );
      return r.ok ? store.track(r.created.rec || r.created.track) : null;
    }
    if (!t.arm)
      store.dispatch({ type: 'track.set', track: t.id, patch: { arm: true } }, { by: 'you', label: `arm ${t.name}` });
    return store.track(t.id);
  }

  async function attachCap() {
    if (!rig) return null;
    if (cap) return cap;
    if (!capReady) {
      capReady = (async () => {
        const c = ctx;
        if (!c.__ewCap)
          c.__ewCap = c.audioWorklet.addModule(CAP_WORKLET).then(
            () => true,
            () => false,
          );
        if (!(await c.__ewCap)) throw new Error('This browser can’t capture audio (no AudioWorklet).');
        const node = new AudioWorkletNode(c, 'ew-cap', {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          channelCount: 1,
          channelCountMode: 'explicit',
          processorOptions: { channels: 1 },
        });
        node.port.onmessage = (e) => {
          for (const fn of [...listeners]) {
            try {
              fn(e.data);
            } catch (err) {
              console.error('input listener', err);
            }
          }
        };
        rig.pick.connect(node);
        cap = node;
        return node;
      })();
    }
    return capReady;
  }

  // Monitoring is on while the person has it on (state.monitoring), wired through the track a take would go to. With no
  // audio track it stays on and waits: state.monitorWaiting, monitorTrack() null and 'monitor' { track: null, waiting:
  // true } (the Jam room remakes its Live guitar then); it says so once, and wires itself as soon as there's one.
  // Wiring follows the track and its strip, never a mere change: a knob, a tone flip or a note leaves it alone. Started
  // by itself it comes in over 150 ms; by hand, at once. While it's wired the feedback guard listens to the input.
  function syncMonitor({ fast = false } = {}) {
    clearTimeout(syncT);
    syncT = 0;
    const want = state.monitoring && rig && ctx ? recordTrack(false) : null;
    const dest = want && engine.inputNode ? engine.inputNode(want.id) : null;
    const ok = !!dest && dest.context === ctx;
    if (!(ok && mon && monDest && monDest.node === dest && monDest.track === want.id)) {
      unwireMonitor(fast);
      if (ok) {
        mon = ctx.createGain();
        mon.gain.value = 0;
        rig.pick.connect(mon);
        mon.connect(dest);
        const now = ctx.currentTime;
        if (state.monitorAuto) {
          mon.gain.setValueAtTime(0, now);
          mon.gain.linearRampToValueAtTime(1, now + 0.15);
        } else mon.gain.setTargetAtTime(1, now, 0.015);
        monDest = { node: dest, track: want.id };
        listen();
      }
    }
    report(!!(state.monitoring && rig && !want));
  }
  // monitoring on or off for an input (id): by itself (auto) or by hand; off for a reason ('mic', 'feedback') or none
  function decide(on, { auto = false, off = '', id = monFor } = {}) {
    monFor = id;
    state.monitoring = !!on;
    state.monitorAuto = !!on && auto;
    state.monitorOff = on ? '' : off;
    if (!on) warned = false;
  }
  // the feedback guard: the input every 50 ms (a worker's clock: a tab in the background still hears it) while the
  // monitor is wired; a trip fades the monitor out fast, turns monitoring off and says so once. An interface is skipped:
  // a guitar into one can't hear the speakers, and a clean, compressed note under long delays reads as a tone ringing up
  function listen() {
    if (stopGuard) return;
    guard = guard || createFeedbackGuard();
    guard.reset();
    stopGuard = ticker(() => {
      if (!mon || !rig || !ctx) return;
      if (state.inputKind === 'interface') {
        guard.reset();
        return;
      }
      rig.an.getFloatTimeDomainData(rig.buf);
      if (!guard.push(rig.buf, ctx.sampleRate, ctx.currentTime)) return;
      decide(false, { off: 'feedback' });
      syncMonitor({ fast: true });
      changed();
      app.ui?.toast?.(FEEDBACK_LINE, { kind: 'bad' });
    }, 50);
  }
  // the monitor's state, told when it changes ('monitor', then 'audio'); with no track to play through, said once (until
  // it wires or monitoring goes off), unless a listener made one just now
  function report(waiting) {
    const track = monDest ? monDest.track : null;
    if (track) warned = false;
    if ((state.monitorTrack ?? null) === track && !!state.monitorWaiting === waiting) return;
    state.monitorTrack = track;
    state.monitorWaiting = waiting;
    input.emit('monitor', { track, waiting });
    changed();
    if (waiting && !warned && !recordTrack(false)) {
      warned = true;
      app.ui?.toast?.(
        'Monitoring waits for an audio track. Add one and you hear the input through its pedals and amp.',
      );
    }
  }
  function unwireMonitor(fast = false) {
    if (stopGuard) {
      stopGuard();
      stopGuard = null;
    }
    if (!mon) return;
    const m = mon;
    mon = null;
    monDest = null;
    // (from where it is: a ramp in still going is held there, not finished, then faded)
    try {
      const t = ctx.currentTime,
        v = m.gain.value;
      m.gain.cancelScheduledValues(t);
      m.gain.setValueAtTime(v, t);
      m.gain.setTargetAtTime(0, t, fast ? 0.004 : 0.01);
    } catch (e) {
      /* ok */
    }
    setTimeout(() => {
      try {
        m.disconnect();
      } catch (e) {
        /* ok */
      }
    }, 80);
  }
  // (after the engine has caught up with the change: one sync for a burst of them)
  const later = () => {
    if (!syncT) syncT = setTimeout(syncMonitor, 0);
  };
  // keep the monitor on the right track: another armed, one made or deleted, a new song, the engine rebuilding its strip
  store.on('change', () => {
    if (!state.monitoring || !rig) return;
    const t = recordTrack(false),
      id = t ? t.id : null;
    if (
      id !== (monDest ? monDest.track : null) ||
      (t && monDest && engine.inputNode && monDest.node !== engine.inputNode(t.id))
    )
      later();
  });
  try {
    engine.on('graph', (e) => {
      if (state.monitoring && rig && (!e || e.kind === 'track')) later();
    });
  } catch (e) {
    /* ok */
  }
  // an interface plugged in (or out) shows up without a reload
  try {
    const md = navigator.mediaDevices;
    if (md && md.addEventListener)
      md.addEventListener('devicechange', async () => {
        const list = await audio.devices();
        input.emit('devices', list);
        app.ui?.emit?.('input:devices', list);
        if (state.open && state.deviceId && !list.some((d) => d.id === state.deviceId)) {
          state.error = 'That input isn’t there any more. Pick another.';
          changed();
        }
      });
  } catch (e) {
    /* node */
  }
  return audio;
}
export { dB };
