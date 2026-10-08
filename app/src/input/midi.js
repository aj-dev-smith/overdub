// Web MIDI in: any keyboard or pad controller, hot-plugged. Notes play the selected (or armed) instrument track live
// through the engine, the sustain pedal holds them, velocity is kept, and everything goes to capture (retroactive: you
// never press record). Ported from clawd-o-matic's keys (plug/keys.js): note on with velocity 0 is an off, CC 64 is
// the pedal, CC 120/123 let everything go, a device unplugged lets its notes go so nothing sticks.
// Expression reaches the instrument as the channel's (kernel/expr.js, docs/DEVICES.md "Expression"): the pitch bend
// wheel (14 bits, times the bend range: 2 semitones unless set here or by the controller's RPN 0), the mod wheel
// (CC 1, with CC 33 for the fine bits) and the pedal, so a kernel knows it is down (t.sustain). CC 121 resets them.
//
//   midi.connect({ quiet }) -> Promise<bool>     asks for access (Chrome); quiet: no prompt if not granted before
//   midi.state  { supported, connected, inputs: [{ id, name }], device ('' = all), status, sustain, bend (semitones),
//                 mod (0..1), bendRange (semitones, 1..24), last }
//   midi.setDevice(id) ; midi.setBendRange(st) ; midi.message(bytes, src)   (tests and on-screen controllers feed this)
//   events (app.input.on): 'midi' (state), 'note' ({ src, p, v, on, track }), 'expr' ({ src, bend?, mod?, sustain?, track })

const SAVE = 'overdub:midi';

export function createMidi(app, input) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SAVE) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  const supported = typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  const range0 = Number.isFinite(saved.bendRange) ? Math.max(1, Math.min(24, Math.round(saved.bendRange))) : 2;
  const state = {
    supported,
    connected: false,
    inputs: [],
    device: saved.device || '',
    status: supported ? '' : 'No Web MIDI in this browser: use Chrome, Edge or Firefox (or play the computer keys).',
    sustain: false,
    bend: 0,
    mod: 0,
    bendRange: range0,
    last: null,
  };
  let bendRaw = 0,
    modHi = 0,
    modLo = 0,
    rpn = [127, 127]; // (bendRaw: -1..1; rpn: the selected [MSB, LSB])
  let access = null;
  let wired = new Set(); // the inputs listened to (ids)
  let ctlFrom = null; // the input whose pedal or wheels last moved (src)
  const held = new Map(); // src:p -> true (key down)
  const sustained = new Set(); // src:p released while the pedal was down
  const changed = () => input.emit('midi', state);
  const save = () => {
    try {
      localStorage.setItem(SAVE, JSON.stringify({ want: true, device: state.device, bendRange: state.bendRange }));
    } catch (e) {
      /* ok */
    }
  };
  const expr = (src, x) => {
    if (input.expr) input.expr(src, x, 'midi');
  };
  const bendTo = (src, raw) => {
    ctlFrom = src;
    bendRaw = raw;
    state.bend = Math.round(raw * state.bendRange * 1000) / 1000;
    expr(src, { bend: state.bend });
  };

  function on(src, p, v) {
    held.set(src + ':' + p, true);
    sustained.delete(src + ':' + p);
    input.noteOn(src, p, v, 'midi');
  }
  function off(src, p) {
    const k = src + ':' + p;
    held.delete(k);
    if (state.sustain) {
      sustained.add(k);
      return;
    }
    input.noteOff(src, p, 'midi');
  }
  function pedal(down, src = 'midi:x') {
    if (down) ctlFrom = src;
    if (state.sustain !== down) expr(src, { sustain: down }); // (first: the instrument lifts its pedal, then the held notes go)
    state.sustain = down;
    if (!down) {
      for (const k of sustained) {
        const i = k.lastIndexOf(':');
        input.noteOff(k.slice(0, i), +k.slice(i + 1), 'midi');
      }
      sustained.clear();
    }
    changed();
  }
  function allOff(src) {
    for (const k of [...held.keys(), ...sustained]) {
      if (src && !k.startsWith(src + ':')) continue;
      const i = k.lastIndexOf(':');
      input.noteOff(k.slice(0, i), +k.slice(i + 1), 'midi');
      held.delete(k);
      sustained.delete(k);
    }
  }

  const midi = {
    state,
    message(data, srcId = 'x') {
      if (!data || data.length < 1 || data[0] >= 0xf0) return;
      const st = data[0] & 0xf0,
        a = data[1] | 0,
        b = data[2] | 0,
        src = 'midi:' + srcId;
      if (st === 0x90 && b > 0) on(src, a, b / 127);
      else if (st === 0x80 || (st === 0x90 && b === 0)) off(src, a);
      else if (st === 0xe0) {
        const v = ((b << 7) | a) - 8192;
        bendTo(src, v >= 0 ? v / 8191 : v / 8192);
      } else if (st === 0xb0) {
        if (a === 64) pedal(b >= 64, src);
        else if (a === 1 || a === 33) {
          if (a === 1) {
            modHi = b;
            modLo = 0;
          } else modLo = b;
          ctlFrom = src;
          state.mod = Math.round((((modHi << 7) | modLo) / 16383) * 10000) / 10000;
          expr(src, { mod: state.mod });
        } else if (a === 101) rpn[0] = b;
        else if (a === 100) rpn[1] = b;
        else if (a === 6 && rpn[0] === 0 && rpn[1] === 0)
          midi.setBendRange(b, src); // RPN 0: pitch bend sensitivity
        else if (a === 121) reset(src);
        else if (a === 120 || a === 123) allOff(src);
      }
      state.last = { at: performance.now(), st, a, b };
    },
    async connect({ quiet = false } = {}) {
      if (!supported) {
        changed();
        return false;
      }
      try {
        access = access || (await navigator.requestMIDIAccess({ sysex: false }));
      } catch (e) {
        state.status = quiet
          ? ''
          : 'MIDI wasn’t allowed. Allow it for this site (the icon in the address bar), then connect again.';
        changed();
        return false;
      }
      state.connected = true;
      save();
      access.onstatechange = () => wire();
      wire();
      return true;
    },
    setDevice(id) {
      state.device = id || '';
      save();
      wire();
    },
    // the bend wheel's reach, in semitones either way (1..24); a bend already held moves with it
    setBendRange(st, src = 'midi:x') {
      const r = Math.max(1, Math.min(24, Math.round(+st || 2)));
      if (r === state.bendRange) return r;
      state.bendRange = r;
      save();
      if (bendRaw) bendTo(src, bendRaw);
      changed();
      return r;
    },
    allOff,
    reset,
  };
  // reset all controllers (CC 121, an unplug, a hidden page): the wheels back to centre, the pedal up
  function reset(src = 'midi:x') {
    bendRaw = 0;
    modHi = modLo = 0;
    rpn = [127, 127];
    const was = state.bend || state.mod;
    state.bend = 0;
    state.mod = 0;
    if (was) expr(src, { bend: 0, mod: 0 });
    pedal(false, src);
  }
  function wire() {
    if (!access) return;
    const list = [...access.inputs.values()];
    for (const old of state.inputs)
      if (!list.some((x) => x.id === old.id && x.state === 'connected')) {
        allOff('midi:' + old.id);
        reset('midi:' + old.id);
      }
    const live = list.filter((x) => x.state === 'connected');
    for (const i of list) i.onmidimessage = null;
    const now = new Set();
    for (const i of live)
      if (!state.device || state.device === i.id) {
        now.add(i.id);
        i.onmidimessage = (e) => midi.message(e.data, i.id);
      }
    // an input no longer listened to (another one chosen) can't send the offs for its keys or lift its pedal: they go now
    for (const id of wired) {
      if (now.has(id)) continue;
      allOff('midi:' + id);
      if (ctlFrom === 'midi:' + id) reset('midi:' + id);
    }
    wired = now;
    const had = state.inputs.length;
    state.inputs = live.map((i) => ({ id: i.id, name: i.name || 'MIDI input' }));
    state.status = live.length ? '' : 'No MIDI keyboard found. Plug one in (USB) and it shows up here.';
    if (live.length > had && had >= 0 && app.ui?.toast && access && wire.ran)
      app.ui.toast(`${live[live.length - 1].name || 'A MIDI keyboard'} is plugged in. Play: it’s captured.`, {
        kind: 'ok',
      });
    wire.ran = true;
    changed();
  }
  // a permission granted before: connect quietly, no prompt
  if (saved.want && supported && navigator.permissions) {
    navigator.permissions
      .query({ name: 'midi' })
      .then((p) => {
        if (p.state === 'granted') midi.connect({ quiet: true });
      })
      .catch(() => {
        /* ok */
      });
  }
  // nothing sticks when the page is hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      reset();
      allOff();
    }
  });
  return midi;
}
