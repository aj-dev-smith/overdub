// Boot the studio: devices, the song (store), the engine, the shell, then every panel. window.overdub is the app.
//
// Panels and features are modules that export default function (app) { app.ui.panel({...}); ... }. They load in
// MODULES order; one failing never stops the rest (the error is shown in its place and logged).

import { createStore } from './core/store.js';
import { createProject, summarize, cleanProject } from './core/project.js';
import * as music from './core/music.js';
import { demoProject, demoById, DEMOS } from './core/demo.js';
import * as devices from './devices/registry.js';
import { createTrust, heldIn, kernelHash, TRUST_KEY } from './devices/trust.js';
import { createShell } from './ui/shell.js';
import { decideView, WORKSPACE_KEY } from './ui/workspace-view.js';
import { installWorkspace } from './ui/workspace.js';

const SAVE_KEY = 'overdub:project',
  PREV_KEY = 'overdub:previous';
const params = new URLSearchParams(location.search);

// Device libraries (each registers its devices on import). Missing ones are skipped so the studio still opens.
const DEVICE_MODULES = ['./devices/builtin/index.js', './devices/guitar/index.js', './devices/library/index.js'];
// The studio's panels and features, in load order.
const MODULES = [
  './ui/transport.js',
  './ui/arranger.js',
  './ui/round.js', // ?view=round only (a prototype): the section as a circle, a ring per track, over the simple view
  './ui/pianoroll.js',
  './ui/drumgrid.js',
  './ui/rack.js',
  './ui/mixer.js',
  './ui/browser.js',
  './ui/inspector.js',
  './ui/export.js',
  './ui/sketch.js',
  './input/index.js',
  './agent/transforms-tool.js', // the `transform` tool (core/transforms.js); before the bridges so MCP clients list it
  './agent/arrange-tool.js', // "Build a band around it" (core/arrange.js): Sketch's Band button, Shift+B, the arrange_around tool
  './agent/arrangement-tool.js', // the arrange_song tool (core/arrangement.js: duplicate sections, insert/delete bars, repeat, split)
  './input/importers.js', // MIDI and audio files dropped in (or Song menu → Import MIDI… / Import audio…)
  './ui/reference.js', // the Reference tab and the compare_to_reference tool; before the bridges so MCP clients list it
  './ui/plugin.js', // device windows (a device opened big: app.plugin) and the show_device tool; before the bridges too
  './ui/sounds.js', // the sound card (app.sounds: trying an instrument by ear, Keep and Back); after plugin.js and input/index.js
  './ui/grooves.js', // the Grooves tab (core/grooves.js) and the find_grooves, use_groove and drum_track tools; before the bridges too
  './ui/jam.js', // the Jam room beside Arrange, and its tools (get_jam, make_jam_track, set_tone, show_on_fretboard)
  './ui/community.js', // the community shelf (From the community, in the Browser) and find_community_device; off unless on a local host
  './agent/sounds-tool.js', // suggest_sounds (sounds on the card, app.sounds.suggest); before the panel and the bridges
  './agent/panel.js',
  './agent/history.js',
  './agent/presence.js',
  './agent/bridge.js',
  './agent/remote.js',
  './ui/devices-io.js', // export / import device files; ?device=<id> opens the song with that device on a track
  './ui/share.js', // share links (#s=…): the listening banner, Make it yours, the share_link tool
  './ui/onboard.js', // "Take one": the first-run coach (never under navigator.webdriver unless forced)
  './ui/start.js', // Start a song: the blank song's door and its stage (app.start); after onboard.js, whose first minute and Hum over it it hands on to
  './ui/preview.js', // the Preview ribbon, on next.overdubstudio.com only (app/site-config.json says which site this is)
  './analytics.js', // last: anonymous counts on the live site only (see the file); nothing anywhere else
];

async function tryImport(path) {
  try {
    return await import(path);
  } catch (e) {
    console.warn(`overdub: ${path} did not load (${e.message})`);
    return null;
  }
}

// Which song devices run here (devices/trust.js): a kernel this browser trusts. Set up in boot().
let trust = null;

// Keep project-written devices (kernels in project.devices) registered, in step with the song: each one the song has is
// registered, and one the song no longer has (undo, another song loaded) leaves the registry. A song can define a
// device under a library or built-in id; when it goes, the original comes back (registry.removeDevice), so a share
// link's kernel never keeps playing in the next song under the library device's name. A device whose kernel this
// browser doesn't trust is held instead (registry.holdDevices): never registered, so nothing compiles, checks or
// renders it, and the engine plays it as silence (an instrument) or a pass-through (an effect) until the person lets it
// play. The held set is set first, so the engine's reconcile builds those stand-ins, not the fallback synth.
function syncProjectDevices(store) {
  const p = store.get(),
    have = p.devices || {};
  const held = trust ? heldIn(p, (h) => trust.has(h)) : [];
  const heldIds = new Set(held.map((d) => d.id));
  devices.holdDevices(held);
  for (const src of Object.values(have)) {
    if (heldIds.has(src.id)) continue;
    const cur = devices.getDevice(src.id);
    if (cur && cur.source === 'project' && cur.hash && cur.version === src.version && cur.kernel === src.kernel)
      continue;
    try {
      devices.defineDevice({ ...src, source: 'project' }, { replace: true });
    } catch (e) {
      console.error('project device', src.id, e.message);
    }
  }
  for (const d of devices.listDevices())
    if (d.source === 'project' && (!Object.hasOwn(have, d.id) || heldIds.has(d.id))) devices.removeDevice?.(d.id);
}

// The studio's own kernels, trusted without asking: the built-ins and the house shelf as they registered at boot, and
// the devices in every song the studio ships (built when first needed: devices/trust.js asks once).
function shippedKernels(boot) {
  return () => {
    const out = [...boot];
    for (const d of DEMOS) {
      try {
        for (const dev of Object.values(d.make().devices || {}))
          if (typeof dev?.kernel === 'string') out.push(dev.kernel);
      } catch {
        /* a demo that won't build ships nothing */
      }
    }
    return out;
  };
}
// A link this browser made itself opens as yours. One made before this browser's trusted set began (the link's moment
// is sealed into its mark, so it can't be moved) was made while every device ran here, so its devices are trusted the
// way the migration trusts the kept songs. A later own link gets no pass: a device held when its link was made stays
// held, or sharing a song to yourself would let held code play. -> how many kernels it trusted
function trustOwnLink(res) {
  if (!trust || !res?.ok || !res.own || !trust.since) return 0;
  const at = Date.parse(res.at || '');
  if (!(at < trust.since)) return 0;
  return trust.allow(
    Object.values(res.song?.devices || {})
      .map((d) => d?.kernel)
      .filter((k) => typeof k === 'string'),
  );
}
// The songs this browser kept before the trust set existed (the saved song, the previous one, the one before Make it
// yours, Recent songs). Their devices were already running here, so the first run of this version trusts them, once.
function keptSongs() {
  const out = [];
  const one = (k) => {
    try {
      const s = localStorage.getItem(k);
      if (s) out.push(JSON.parse(s));
    } catch {
      /* unreadable: nothing to keep */
    }
  };
  one(SAVE_KEY);
  one(PREV_KEY);
  one('overdub:before-fork');
  try {
    const r = JSON.parse(localStorage.getItem('overdub:recent') || '[]');
    if (Array.isArray(r)) for (const e of r) if (e && e.song) out.push(e.song);
  } catch {
    /* none */
  }
  return out;
}

// The studio was called Earworm for its first evening. Carry that browser's saved state (the song, layout, keys,
// settings) over to the new names once; the old keys are left in place. (IndexedDB recordings are not migrated.)
function migrateLegacyStorage() {
  try {
    const old = ['ear', 'worm', ':'].join('');
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(old)) continue;
      const nk = 'overdub:' + k.slice(old.length);
      if (localStorage.getItem(nk) == null) localStorage.setItem(nk, localStorage.getItem(k));
    }
  } catch {
    /* storage blocked: nothing to carry */
  }
}

let opened = 'demo'; // how the song was opened (app.opened): 'new' | 'demo' | 'saved'
// Which view this load opens in (ui/workspace-view.js): decided before the song, since a first visit in the simple
// view opens a blank song ("Take 1 is yours."), not the demo. Night Shift stays one click away.
let workspace = { view: 'full', persist: false, from: 'default' };
// ?new and ?demo=… (the landing page's links) open another song over the one saved here. That one is kept as the
// previous song (the key ui/export.js keepPrevious uses) and in Recent songs (app.exporter.putAside), and the studio
// says so, with an Undo, once it's up; then the parameter leaves the address. A blank song, or the same demo unedited,
// has nothing to lose and isn't kept.
let displaced = null;
function putAside(next) {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (!s) return next;
    const p = cleanProject(JSON.parse(s));
    const body = (x) => JSON.stringify([x.title, x.tempo, x.meter, x.key, x.tracks, x.sections, x.master, x.devices]);
    const blank =
      !p.tracks.length &&
      !p.sections.length &&
      !Object.keys(p.devices).length &&
      /^untitled$/i.test(p.title || 'Untitled');
    if (!blank && !(p.id === next.id && body(p) === body(cleanProject(next)))) {
      localStorage.setItem(PREV_KEY, s);
      displaced = p;
    }
  } catch {
    /* storage blocked, or a saved song that can't be read: nothing here to keep */
  }
  return next;
}
function loadSaved() {
  if (params.has('new')) {
    opened = 'new';
    return putAside(createProject());
  }
  if (params.has('demo')) return putAside(demoById(params.get('demo')));
  try {
    const s = localStorage.getItem(SAVE_KEY);
    if (s) {
      const p = cleanProject(JSON.parse(s));
      opened = 'saved';
      return p;
    }
  } catch (e) {
    console.warn('overdub: saved project unreadable, starting the demo', e);
  }
  if (workspace.view === 'simple') {
    opened = 'new';
    return createProject();
  }
  return demoProject();
}

// Safari can run a module before the page's stylesheets have applied; the canvases read the colour tokens once, so wait.
function stylesheetsLoaded() {
  const links = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((l) => !l.sheet);
  return Promise.race([
    Promise.all(
      links.map(
        (l) =>
          new Promise((r) => {
            l.addEventListener('load', r, { once: true });
            l.addEventListener('error', r, { once: true });
          }),
      ),
    ),
    new Promise((r) => setTimeout(r, 3000)),
  ]);
}

async function boot() {
  migrateLegacyStorage();
  // the view, before anything writes overdub:layout (an existing user's sign) or the song
  {
    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      /* blocked */
    }
    workspace = decideView({ search: location.search, storage, webdriver: !!navigator.webdriver });
    if (workspace.persist) {
      try {
        const cur = JSON.parse(storage?.getItem(WORKSPACE_KEY) || 'null');
        storage?.setItem(
          WORKSPACE_KEY,
          JSON.stringify({ ...(cur && typeof cur === 'object' ? cur : {}), v: 1, view: workspace.view }),
        );
      } catch {
        /* private mode */
      }
    }
  }
  // Fetch every graph at once (an import runs nothing until default(app)); they start below, in order. One after
  // another, the panels' fetches took ~250 ms each and the studio ~12 s to finish booting.
  const loading = MODULES.map(tryImport);
  const engineLoading = tryImport('./engine/engine.js');
  await stylesheetsLoaded();
  const root = document.getElementById('studio');
  await Promise.all(DEVICE_MODULES.map(tryImport));

  // which song devices run here: the studio's own, and kernels this browser trusts (devices/trust.js). The first run of
  // this version trusts the devices of the songs it already kept, once, so nobody's own song goes quiet on update
  trust = createTrust({
    shipped: shippedKernels(
      devices
        .listDevices()
        .filter((d) => d.source !== 'project' && typeof d.kernel === 'string')
        .map((d) => d.kernel),
    ),
  });
  if (!trust.stored) trust.migrate(keptSongs());

  // a share link (#s=…) opens that song to listen to; your saved song is untouched until you make it yours (ui/share.js)
  const sm = /[#&]s=/.test(location.hash) ? await tryImport('./core/share.js') : null;
  const shared = sm ? await sm.openShared(location.hash).catch((e) => ({ ok: false, error: e.message })) : null;
  trustOwnLink(shared);
  const store = createStore(shared?.ok ? shared.song : loadSaved(), { getDevice: devices.getDevice });
  syncProjectDevices(store);
  store.on('change', (e) => {
    // A device this page writes into the song (an agent's define_device, a device file the person imports, the studio's
    // own) is code this browser chose: trusted from now on. Never a held one's: only the person's Play them lets that
    // run (ui/share.js), and an undo, a redo or a load only puts back what was there.
    if (e.kind === 'do') {
      for (const o of e.ops || []) {
        if (o?.type !== 'device.define' || typeof o.device?.kernel !== 'string') continue;
        const h = kernelHash(o.device.kernel);
        // (one the person allowed for this page load only, from the community shelf, stays that way: not stored)
        if (!devices.heldDevices().some((d) => d.hash === h) && !trust.forNow(h)) trust.allow(h);
      }
    }
    if (e.kind === 'load' || e.reverted || e.ops.some((o) => o.type?.startsWith('device.'))) syncProjectDevices(store);
  });
  // another tab let a device play (or this one's storage was cleared): read the set again
  window.addEventListener('storage', (e) => {
    if (e.key === TRUST_KEY || e.key == null) {
      trust.reload();
      syncProjectDevices(store);
    }
  });

  // the engine (a silent stand-in if it isn't there, so the UI still works)
  const em = await engineLoading;
  const engine = em ? em.createEngine(store) : silentEngine(store);

  const app = {
    store,
    engine,
    devices,
    music,
    summarize: (o) => summarize(store.get(), { ...o, devices: devices.getDevice, held: devices.heldDevice }),
    version: '0.1.0',
    agent: null,
    tools: null,
    input: null,
    opened,
    round: !!workspace.round,
  };
  if (shared) app.share = { incoming: shared, listening: !!shared.ok };
  // app.trust: what's held, and the person's way to let it play (ui/share.js and the rack call play; no agent tool does)
  app.trust = {
    key: TRUST_KEY,
    held: () => devices.heldDevices(),
    hash: kernelHash,
    trusts: (source) => trust.trusts(source),
    has: (hash) => trust.has(hash),
    size: () => trust.size,
    // Play them: trust the held devices' code (all of them, or these ids) and start them, no reload. -> { ok, played }
    play(ids = null) {
      const list = devices.heldDevices().filter((d) => !ids || ids.includes(d.id));
      if (!list.length) return { ok: false, played: [] };
      trust.allow(list.map((d) => d.hash));
      syncProjectDevices(store);
      app.ui?.emit?.('trust', { played: list });
      return { ok: true, played: list };
    },
    // kernels this browser takes in (an imported device file, an agent's define_device): trusted from now on
    allow(sources) {
      const n = trust.allow(sources);
      syncProjectDevices(store);
      return n;
    },
    // the community shelf's Try (ui/community.js): for this page load only (a reload holds it again), and taking a
    // hash back (a Try whose dispatch failed after its allow, or one taken off the shelf). -> n
    allowForNow(sources) {
      const n = trust.allowForNow(sources);
      syncProjectDevices(store);
      return n;
    },
    forget(sources) {
      const n = trust.forget(sources);
      syncProjectDevices(store);
      return n;
    },
    forNow: (source) => trust.forNow(kernelHash(source)),
    // a link opened in this tab (ui/share.js): one this browser made before its trusted set began opens as yours
    ownLink: (res) => trustOwnLink(res),
    since: () => trust.since,
  };
  window.overdub = app;
  app.ui = createShell(root, app);
  // the workspace (ui/workspace.js): which features are on screen, More, the view switch; before the panels register
  try {
    installWorkspace(app.ui, app, workspace);
  } catch (e) {
    console.error('overdub: the workspace failed to start', e);
  }

  // undo / redo (everyone's, newest first): before the panels, so ⌘Z works while they load
  const undo = () => {
    const r = store.undo();
    if (!r.ok) app.ui.toast(r.error);
    else app.ui.toast(`Undid "${r.txn.label}"${store.isAgent(r.txn.by) ? ` (by ${store.author(r.txn.by).name})` : ''}`);
  };
  const redo = () => {
    const r = store.redo();
    if (!r.ok) app.ui.toast(r.error);
  };
  app.ui.keys.add({ key: 'KeyZ', mod: 'mod', run: undo, label: 'Undo', group: 'Edit' });
  app.ui.keys.add({ key: 'KeyZ', mod: 'mod+shift', run: redo, label: 'Redo', group: 'Edit', feature: 'redo' });
  app.ui.keys.add({ key: 'KeyY', mod: 'mod', run: redo, label: 'Redo', group: 'Edit', feature: 'redo' });

  // the panels and features, started in MODULES order as each one's graph arrives
  for (let i = 0; i < MODULES.length; i++) {
    const mod = await loading[i];
    if (mod?.default) {
      try {
        await mod.default(app);
      } catch (e) {
        console.error(`overdub: ${MODULES[i]} failed to start`, e);
      }
    }
  }

  // autosave (the song only; audio lives in IndexedDB)
  let saveT = 0;
  const save = () => {
    saveT = 0;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(store.get()));
    } catch {
      app.ui.toast('Could not save the song in this browser (storage is full or blocked)', { kind: 'bad' });
    }
  };
  store.on('change', () => {
    clearTimeout(saveT);
    saveT = 0;
    if (app.share?.listening) return;
    saveT = setTimeout(save, 500);
  });
  // a page going away saves what's waiting (a sound on trial let go as the tab hides is the song's last change)
  const flush = () => {
    if (!saveT) return;
    clearTimeout(saveT);
    save();
  };
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
  });

  // audio starts on the first gesture (browsers require one)
  const wake = async () => {
    try {
      await engine.start();
    } catch (e) {
      console.error('engine start', e);
      app.ui.toast('Audio could not start: ' + e.message, { kind: 'bad' });
    }
  };
  window.addEventListener('pointerdown', wake, { once: true, capture: true });
  window.addEventListener('keydown', wake, { once: true, capture: true });
  if (params.has('autostart')) wake();

  if (displaced) {
    const kept = displaced,
      what = opened === 'new' ? 'New song.' : `Opened the demo, “${store.get().title}”.`;
    // in Recent songs (the Song menu), like a song any other way in replaced: not only in overdub:previous, which
    // nothing on screen reads
    if (app.exporter?.putAside)
      app.exporter.putAside(kept, `${what} “${kept.title}” is in Recent songs, and Undo brings it back.`);
    else
      app.ui.toast(`${what} “${kept.title}” is kept: Undo brings it back.`, {
        kind: 'ok',
        ms: 9000,
        action: {
          label: 'Undo',
          run: () => {
            store.load(kept, { by: 'you' });
            app.ui.toast(`Back to “${kept.title}”`);
          },
        },
      });
  }
  // ?new and ?demo= have done their job: off the address, so a reload (or a restored tab) opens the song saved here,
  // not the demo again over your edits to it (the modules that read the address have read it by now)
  if (params.has('new') || params.has('demo')) {
    try {
      const u = new URL(location.href);
      u.searchParams.delete('new');
      u.searchParams.delete('demo');
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch {
      /* fine */
    }
  }

  document.documentElement.dataset.ready = '1';
  app.ui.emit('ready', app);
  // The top bar settles at ready (the record target's name lands then). Its title fits itself to the bar when the
  // fonts are in, and with the fonts served from the site they are often in before this: say the layout moved once the
  // bar has (ui/transport.js fits its title again on 'resize'), so the title fits on a first visit and a cached one alike.
  requestAnimationFrame(() => app.ui.emit('resize'));
}

// A stand-in engine with the right shape and no sound.
function silentEngine(store) {
  const fns = new Map();
  let beat = 0,
    playing = false;
  return {
    ctx: null,
    silent: true,
    metronome: false,
    meters: { tracks: {}, master: { peak: -120, rms: -120 } },
    click: { on: false, whileRecording: false, level: 0 },
    recording: false,
    counting: null,
    gridBeat: null,
    beatAt() {
      return beat;
    },
    async start() {},
    play(b) {
      if (b != null) beat = b;
      playing = true;
    },
    stop() {
      playing = false;
    },
    seek(b) {
      beat = b;
    },
    toggle() {
      playing = !playing;
    },
    get playing() {
      return playing;
    },
    get beat() {
      return beat;
    },
    on(t, fn) {
      if (!fns.has(t)) fns.set(t, new Set());
      fns.get(t).add(fn);
      return () => fns.get(t).delete(fn);
    },
    liveNoteOn() {},
    liveNoteOff() {},
    audition() {},
    inputNode() {
      return null;
    },
    instance() {
      return null;
    },
    masterTap: null,
    clock: null,
    async render() {
      throw new Error('the audio engine is not loaded');
    },
    songEnd: () => 32,
    beatToSec: (b) => (b * 60) / store.get().tempo,
    secToBeat: (s) => (s * store.get().tempo) / 60,
    assets: {
      async put() {},
      async get() {
        return null;
      },
    },
  };
}

boot().catch((e) => {
  console.error('overdub: boot failed', e);
  document.body.insertAdjacentHTML(
    'beforeend',
    `<pre style="color:#ff6b81;padding:20px;white-space:pre-wrap">Overdub could not start: ${String((e && e.stack) || e).replace(/</g, '&lt;')}</pre>`,
  );
});
