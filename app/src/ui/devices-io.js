// Devices in and out of the studio: export any kernel device as a .overdub-device.json (its def and its kernel), and
// import one (file picker, a drop anywhere on the studio, or ⌘O on the file). An import runs the device check FIRST
// and refuses a failing device with the check's report; one that passes becomes a project device (device.define,
// signed by you), so it travels with the song like anything an agent wrote in it.
//
// Also: /app/?new&device=<id> (the library page's "Use in a new song") opens a new song with a track playing that
// device, and a few bars to hear it with.
//
//   app.devicesIO = { exportDevice(id), deviceFile(id) -> object, pick(), importFile(file), importText(text, name),
//                     importDevice(file object) -> Promise<{ ok, id, name, report } | { ok: false, refused, reason, report }> }
//
// Pure helpers (no app needed) are exported for the library page and the tests: FORMAT, FILE_EXT, toDeviceFile(def),
// parseDeviceFile(text | object), exportable(def).

import { HOUSE_NS, MAX_KERNEL_CHARS, isHouseId } from '../core/share.js';

export const FORMAT = 'overdub-device/0';
export const FILE_EXT = '.overdub-device.json';
const DEF_KEYS = [
  'id',
  'name',
  'kind',
  'cat',
  'blurb',
  'nod',
  'request',
  'by',
  'version',
  'look',
  'tail',
  'trails',
  'drone',
  'poly',
  'where',
  'demo',
  'presets',
];
const PARAM_KEYS = ['key', 'label', 'min', 'max', 'def', 'curve', 'unit', 'role', 'desc', 'opts', 'step'];

export const exportable = (def) => !!def && typeof def.kernel === 'string' && !def.build;

// The file for a def (a registry def or a project DeviceSource): only data, no functions.
export function toDeviceFile(def, { exportedBy } = {}) {
  if (!exportable(def))
    throw new Error(
      `${def?.name || def?.id || 'this device'} is built from Web Audio nodes, not a kernel, so it can't be exported as a file`,
    );
  const device = {};
  for (const k of DEF_KEYS)
    if (def[k] !== undefined && def[k] !== null && !(k === 'presets' && !def[k].length))
      device[k] = JSON.parse(JSON.stringify(def[k]));
  device.params = (def.params || []).map((p) => {
    if (Array.isArray(p)) return p.slice();
    const q = {};
    for (const k of PARAM_KEYS) if (p[k] !== undefined && p[k] !== null) q[k] = p[k];
    if (q.step === 0) delete q.step;
    if (q.curve === 'lin') delete q.curve;
    if (q.opts) {
      delete q.min;
      delete q.max;
      delete q.step;
    }
    return q;
  });
  device.kernel = def.kernel;
  return { format: FORMAT, exported: new Date().toISOString(), ...(exportedBy ? { exportedBy } : {}), device };
}

// Parse a file's text (or an already-parsed object) into a def. Throws with a message a person can act on.
export function parseDeviceFile(input) {
  let o = input;
  if (typeof input === 'string') {
    try {
      o = JSON.parse(input);
    } catch (e) {
      throw new Error('the file isn’t JSON');
    }
  }
  if (!o || typeof o !== 'object') throw new Error('the file is empty');
  if (o.format && o.format !== FORMAT) {
    if (/^overdub\//.test(o.format) || Array.isArray(o.tracks))
      throw new Error('that’s a song, not a device: open it from the Song menu');
    throw new Error(`unknown format "${o.format}" (expected ${FORMAT})`);
  }
  const d = o.device || (o.kernel ? o : null);
  if (!d || typeof d !== 'object') throw new Error('there is no device in the file');
  if (typeof d.kernel !== 'string' || !d.kernel.trim()) throw new Error('the device has no kernel source');
  if (d.kernel.length > MAX_KERNEL_CHARS)
    throw new Error(
      `the kernel is too large (${Math.ceil(d.kernel.length / 1024)} KB; a device's source can be up to ${MAX_KERNEL_CHARS / 1024} KB)`,
    );
  if (!['instrument', 'effect'].includes(d.kind)) throw new Error('the device’s kind must be "instrument" or "effect"');
  if (!d.id || !/^[a-z0-9][a-z0-9._-]{1,63}$/.test(String(d.id))) throw new Error(`bad device id "${d.id}"`);
  const def = {};
  for (const k of DEF_KEYS) if (d[k] !== undefined) def[k] = d[k];
  def.params = Array.isArray(d.params) ? d.params : [];
  def.kernel = d.kernel;
  def.name = String(d.name || d.id).slice(0, 60);
  return def;
}

const slugOf = (s) =>
  String(s || 'device')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'device';

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// A few bars to hear a new song's device with (house content: signed 'overdub').
const CHORDS = 'A3@0:4 C4@0:4 E4@0:4 F3@4:4 A3@4:4 C4@4:4 C4@8:4 E4@8:4 G4@8:4 G3@12:4 B3@12:4 D4@12:4';
const ARP = [
  [57, 60, 64, 69],
  [53, 57, 60, 65],
  [48, 52, 55, 60],
  [55, 59, 62, 67],
]
  .flatMap((c, bar) =>
    [0, 1, 2, 3, 2, 1, 0, 2].map((k, i) => `${c[k]}@${bar * 4 + i * 0.5}:0.5*${i % 2 ? 0.65 : 0.85}`),
  )
  .join(' ');
const BASS =
  'A1@0:1.5 A1@1.5:0.5 A2@2:0.5 A1@2.5:1.5 F1@4:1.5 F1@5.5:0.5 F2@6:0.5 F1@6.5:1.5 C2@8:1.5 C2@9.5:0.5 C3@10:0.5 C2@10.5:1.5 G1@12:1.5 G1@13.5:0.5 G2@14:0.5 G1@14.5:1.5';
const GRID = {
  steps: 16,
  step: 0.25,
  rows: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
};
function starterClip(def) {
  if (def.kind === 'effect') return { notes: CHORDS };
  if (def.cat === 'drums') return { grid: GRID, length: 4 };
  if (def.cat === 'bass') return { notes: BASS };
  if (['keys', 'pluck'].includes(def.cat)) return { notes: ARP };
  return { notes: CHORDS };
}

export default function (app) {
  const { store, ui, devices } = app;

  function sourceOf(id) {
    const proj = store.get().devices?.[id];
    return proj ? { ...devices.getDevice(id), ...proj } : devices.getDevice(id);
  }
  function deviceFile(id) {
    const def = sourceOf(id);
    if (!def) throw new Error(`no device "${id}"`);
    return toDeviceFile(def, { exportedBy: 'you' });
  }
  function exportDevice(id) {
    let file;
    try {
      file = deviceFile(id);
    } catch (e) {
      ui.toast(`Couldn’t export: ${e.message}`, { kind: 'bad' });
      return null;
    }
    const name = slugOf(file.device.name) + FILE_EXT;
    download(name, JSON.stringify(file, null, 2));
    ui.toast(`Exported ${file.device.name} as ${name}`, { kind: 'ok' });
    return file;
  }

  // The import itself: parse, check, then one device.define by you. Returns what happened (and toasts it).
  async function importDevice(input, { name = 'the file', toast = true } = {}) {
    const say = (text, kind) => {
      if (toast) ui.toast(text, { kind, ms: kind === 'bad' ? 9000 : 5000 });
    };
    let def;
    try {
      def = parseDeviceFile(input);
    } catch (e) {
      say(`Couldn’t import ${name}: ${e.message}`, 'bad');
      return { ok: false, refused: true, reason: e.message };
    }
    // a built-in's or the house shelf's id can't be taken over by a file: the shelf's own file is already here, and
    // anything else comes in as your copy
    const shipped = (id) => {
      const d = devices.getDevice(id);
      return !!d && d.source !== 'project';
    };
    const shelf = devices.getDevice(def.id);
    if (shelf && shelf.source !== 'project' && shelf.kernel === def.kernel) {
      say(`${def.name} is already in the studio`, 'info');
      return { ok: true, already: true, id: def.id, name: def.name };
    }
    if (isHouseId(def.id, shipped)) def.id = 'you.' + def.id.replace(HOUSE_NS, '').replace(/\./g, '-');
    const have = devices.getDevice(def.id);
    if (have && have.kernel === def.kernel && (have.source !== 'project' || store.get().devices?.[def.id])) {
      say(`${def.name} is already in the studio`, 'info');
      return { ok: true, already: true, id: def.id, name: def.name };
    }
    let report;
    try {
      const { checkDevice, summarize } = await import('../kernel/check.js');
      report = await checkDevice(def);
      report.summary = summarize(report);
    } catch (e) {
      report = { ok: false, errors: [String((e && e.message) || e)], warnings: [] };
    }
    if (!report.ok) {
      const reason = report.errors[0] || 'the device check failed';
      say(`Refused ${def.name}: ${reason}`, 'bad');
      ui.emit('device:import', { ok: false, def, report });
      return { ok: false, refused: true, reason, report, id: def.id, name: def.name };
    }
    const device = { ...def, by: def.by || 'you' };
    delete device.version;
    // the person chose this file: its code is trusted in this browser from now on (devices/trust.js), in any song, before
    // the song takes it in (so it registers rather than being held)
    app.trust?.allow?.([def.kernel]);
    const r = store.dispatch({ type: 'device.define', device }, { by: 'you', label: `imported ${def.name}` });
    if (!r.ok) {
      say(`Couldn’t import ${def.name}: ${r.error}`, 'bad');
      return { ok: false, reason: r.error, report };
    }
    const lvl = report.level
      ? report.kind === 'effect'
        ? `${report.level.deltaLU >= 0 ? '+' : ''}${report.level.deltaLU} LU against bypass`
        : `${report.level.lufs} LUFS`
      : '';
    say(
      `Imported ${def.name}${lvl ? `: ${lvl}, ${report.truePeak} dBTP` : ''}. It’s under “Written in this song”.`,
      'ok',
    );
    ui.emit('device:import', { ok: true, def, report });
    return { ok: true, id: def.id, name: def.name, report };
  }
  async function importFile(file) {
    return importDevice(await file.text(), { name: file.name });
  }
  const importText = (text, name) => importDevice(text, { name });
  function pick() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = `${FILE_EXT},.json,application/json`;
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      const f = inp.files?.[0];
      inp.remove();
      if (f) importFile(f);
    });
    document.body.append(inp);
    inp.click();
  }

  // a .overdub-device.json dropped anywhere the studio doesn't already take the drop
  const isFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragover', (e) => {
    if (isFiles(e) && !e.defaultPrevented) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e) || e.defaultPrevented) return;
    const files = [...(e.dataTransfer.files || [])].filter((f) => /\.json$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    for (const f of files) {
      const text = await f.text();
      let o = null;
      try {
        o = JSON.parse(text);
      } catch (err) {
        /* reported below */
      }
      if (o && (o.format === FORMAT || (o.device && o.device.kernel))) await importDevice(o, { name: f.name });
      else if (o && Array.isArray(o.tracks) && app.exporter?.loadText) app.exporter.loadText(text, f.name);
      else ui.toast(`${f.name} isn’t a device file (${FILE_EXT})`, { kind: 'bad' });
    }
  });

  ui.keys.add({ key: 'KeyI', mod: 'mod+shift', run: pick, label: 'Import a device file', group: 'Devices' });
  ui.keys.add({
    key: 'KeyE',
    mod: 'mod+alt',
    label: 'Export the selected device',
    group: 'Devices',
    when: () => !!selectedDevice(),
    run: () => exportDevice(selectedDevice()),
  });
  function selectedDevice() {
    const sel = ui.state.selection || {};
    const t = sel.track && sel.track !== 'master' ? store.track(sel.track) : null;
    const list = sel.track === 'master' ? store.get().master.inserts : t?.inserts || [];
    const fx = sel.insert ? list.find((x) => x.id === sel.insert) : null;
    const id = fx ? fx.device : t?.instrument?.device;
    return id && exportable(devices.getDevice(id)) ? id : null;
  }

  // /app/?new&device=<id>: a track with that device, and a few bars to hear it with
  async function openWith(id) {
    let def = devices.getDevice(id);
    const ops = [];
    if (!def) {
      try {
        const { SHOWCASE } = await import('../devices/showcase.js');
        const src = SHOWCASE.find((d) => d.id === id);
        if (src) {
          ops.push({ type: 'device.define', device: { ...src } });
          def = src;
        }
      } catch (e) {
        /* no showcase: fall through */
      }
    }
    if (!def) {
      ui.toast(`No device "${id}" in this studio`, { kind: 'bad' });
      return null;
    }
    if (def.kind === 'instrument')
      ops.push({
        type: 'track.add',
        ref: 't',
        track: { name: def.name, kind: 'instrument', instrument: { device: id, params: {} } },
      });
    else
      ops.push({
        type: 'track.add',
        ref: 't',
        track: {
          name: def.name,
          kind: 'instrument',
          instrument: { device: 'core.keys', params: {} },
          inserts: [{ device: id }],
        },
      });
    const r = store.dispatch(ops, { by: 'you', label: `new song with ${def.name}` });
    if (!r.ok) {
      ui.toast(r.error, { kind: 'bad' });
      return null;
    }
    const tid = r.created.t;
    const clip = starterClip(def);
    store.dispatch(
      [
        { type: 'clip.add', track: tid, clip: { start: 0, length: clip.length || 16, name: 'To hear it', ...clip } },
        { type: 'project.set', patch: { loop: { on: true, start: 0, end: clip.length || 16 } } },
      ],
      { by: 'overdub', label: 'a few bars to hear it with' },
    );
    ui.select({ track: tid, clip: null, insert: null });
    try {
      ui.show('rack');
    } catch (e) {
      /* no rack panel */
    }
    ui.toast(
      `${def.name} is on a new track${def.kind === 'effect' ? `, after ${devices.getDevice('core.keys')?.name || 'the keys'}` : ''}, with a few bars to hear it. Press Space to play.`,
      { kind: 'ok', ms: 6000 },
    );
    return tid;
  }
  const q = new URLSearchParams(location.search);
  if (q.get('device')) {
    const id = q.get('device');
    ui.on('ready', () => {
      openWith(id).finally(() => {
        // don't redo it (or start another new song) on a reload: the song is saved now
        try {
          const u = new URL(location.href);
          u.searchParams.delete('device');
          u.searchParams.delete('new');
          history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
        } catch (e) {
          /* fine */
        }
      });
    });
  }

  app.devicesIO = {
    FORMAT,
    FILE_EXT,
    exportDevice,
    deviceFile,
    pick,
    importFile,
    importText,
    importDevice,
    openWith,
    exportable: (id) => exportable(devices.getDevice(id)),
  };
  return app.devicesIO;
}
