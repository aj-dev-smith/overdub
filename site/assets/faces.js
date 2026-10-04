// Device faces for the landing page, drawn from metadata the way the studio draws them: colour, ink, LED, shape,
// finish, knob style and knob labels. The heritage pedals below are real ones from Claw'd-o-Matic's Guitar Studio
// (web/pedals/*.js), with their real names, colours and knobs.

export const HERITAGE = [
  { id: 'krakenhall', name: 'Kraken Hall', kind: 'Hall & cathedral', color: '#101a3a', ink: '#dfe6ff', led: '#8fa8ff', shape: 'wide', finish: 'sparkle', knob: 'chrome', knobs: ['SIZE', 'TONE', 'PREDELAY', 'MIX', 'SPACE'] },
  { id: 'jellypulse', name: 'Jelly Pulse', kind: 'Tremolo in time', color: '#7de6c4', ink: '#082019', led: '#ff4fd8', shape: 'round', finish: 'sparkle', knob: 'cream', knobs: ['RATE', 'DEPTH', 'SHAPE'] },
  { id: 'krillswarm', name: 'Krill Swarm', kind: 'Chorus × 6', color: '#ff7b6a', ink: '#2a0a07', led: '#ffe14d', shape: 'box', finish: 'hammer', knob: 'cream', knobs: ['RATE', 'DEPTH', 'SPREAD', 'MIX'] },
  { id: 'wub', name: 'Wub Leviathan', kind: 'Wobble in time', color: '#0d1020', ink: '#39ff88', led: '#39ff88', shape: 'wide', finish: 'stripe', knob: 'chicken', knobs: ['RATE', 'SHAPE', 'DEPTH', 'CUTOFF', 'RES', 'GROWL'] },
  { id: 'puffer', name: 'Puffer Blowout', kind: 'Blown speaker', color: '#f2cf3e', ink: '#3b1f0a', led: '#ff5b2e', shape: 'round', finish: 'check', knob: 'chicken', knobs: ['BLOW', 'RATTLE', 'VOLUME'] },
  { id: 'undertow', name: 'Undertow', kind: 'Reverse gate verb', color: '#1b1035', ink: '#ff8ad8', led: '#ff2bd6', shape: 'box', finish: 'hammer', knob: 'black', knobs: ['LENGTH', 'TONE', 'MIX', 'MODE'] },
  { id: 'stuckwah', name: 'Stuck Shrimp', kind: 'Fixed wah', color: '#ff8fb1', ink: '#3a0a1a', led: '#ffe45c', shape: 'mini', finish: 'check', knob: 'cream', knobs: ['PARK', 'PEAK'] },
  { id: 'mermaid', name: 'Mermaid Choir', kind: 'Choir, octave up', color: '#8fe3c8', ink: '#0d2b24', led: '#ffffff', shape: 'box', finish: 'sparkle', knob: 'chrome', knobs: ['CHOIR', 'VOWEL', 'AIR', 'SWELL'] },
  { id: 'tapecrab', name: 'Tape Crab', kind: 'Tape echo', color: '#4a5d3a', ink: '#f3e9c8', led: '#ff4d2e', shape: 'wide', finish: 'hammer', knob: 'chicken', knobs: ['RATE', 'INTENSITY', 'TAPE AGE', 'ECHO', 'HEADS', 'TAP'] },
  { id: 'pixelprawn', name: 'Pixel Prawn', kind: '8-bit arcade', color: '#e4003a', ink: '#fff6e0', led: '#00e5ff', shape: 'box', finish: 'check', knob: 'cream', knobs: ['ARP', 'CHORD', 'DUTY', 'MIX'] },
  { id: 'barnacle', name: 'Barnacle Boost', kind: 'Clean boost', color: '#c3cad3', ink: '#16181c', led: '#39ff88', shape: 'mini', finish: 'brushed', knob: 'small', knobs: ['BOOST', 'VOICE'] },
];

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }

export function faceEl(d, { on = true } = {}) {
  const el = document.createElement('figure');
  el.className = `face face--${d.shape} finish--${d.finish} knob--${d.knob}`;
  el.style.setProperty('--pc', d.color); el.style.setProperty('--pi', d.ink); el.style.setProperty('--led', d.led);
  el.dataset.on = String(on);
  let h = hash(d.id);
  const knobs = d.knobs.map((k) => { h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0; const turn = -120 + (h % 240); return `<span class="fk"><i style="--turn:${turn}deg"></i><b>${k}</b></span>`; }).join('');
  el.innerHTML = `<span class="face-led" aria-hidden="true"></span><div class="fk-row" data-n="${d.knobs.length}">${knobs}</div>
    <figcaption><span class="face-name">${d.name}</span><span class="face-kind">${d.kind}</span></figcaption>
    <button class="face-foot" type="button" aria-pressed="${on}" aria-label="${d.name} on or off"><span></span></button>`;
  const foot = el.querySelector('.face-foot');
  foot.addEventListener('click', () => { const v = foot.getAttribute('aria-pressed') !== 'true'; foot.setAttribute('aria-pressed', String(v)); el.dataset.on = String(v); });
  return el;
}

export function mountHeritage(root) {
  HERITAGE.forEach((d, i) => root.appendChild(faceEl(d, { on: i % 3 !== 2 })));
}
