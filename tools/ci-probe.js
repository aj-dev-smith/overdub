// What a test browser gets on this machine: frame rate, timer lateness, click round trip, the audio clock against the
// wall clock, the audio outputs and the GPU. CI prints it before the suite, so a slow or odd runner shows up as numbers.
//   node tools/ci-probe.js
import { open } from './pw.js';

const t = process.hrtime.bigint();
let x = 0; for (let i = 0; i < 2e8; i++) x = (x + i * 7) % 1000003;
console.log(`node: a 2e8-step loop in ${(Number(process.hrtime.bigint() - t) / 1e6).toFixed(0)} ms (${x})`);

const { page, close } = await open('/app/');
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const out = {};
  const frames = (ms) => new Promise((res) => { const t0 = performance.now(); let n = 0; const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(n); }; requestAnimationFrame(f); });
  out.rafIdle = await frames(1000);
  const late = [];
  for (let i = 0; i < 50; i++) { const t0 = performance.now(); await new Promise((res) => setTimeout(res, 10)); late.push(performance.now() - t0 - 10); }
  out.timeoutLate = { mean: +(late.reduce((a, b) => a + b, 0) / late.length).toFixed(2), max: +Math.max(...late).toFixed(2) };
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    out.webgl = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none';
  } catch (e) { out.webgl = 'error ' + e.message; }
  try { out.outputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput').map((d) => d.label || d.deviceId); } catch (e) { out.outputs = 'error ' + e.message; }
  const ctx = new AudioContext();
  await ctx.resume();
  await new Promise((res) => setTimeout(res, 300));
  out.audio = { state: ctx.state, sampleRate: ctx.sampleRate, baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency };
  // the audio clock against the wall clock, read every 5 ms for 3 s
  const s = [];
  const w0 = performance.now(), a0 = ctx.currentTime;
  while (performance.now() - w0 < 3000) { s.push([performance.now(), ctx.currentTime]); await new Promise((res) => setTimeout(res, 5)); }
  const steps = [], stalls = [];
  let lastChange = s[0][0];
  for (let i = 1; i < s.length; i++) if (s[i][1] !== s[i - 1][1]) { steps.push((s[i][1] - s[i - 1][1]) * 1000); stalls.push(s[i][0] - lastChange); lastChange = s[i][0]; }
  const q = (a, p) => { const b = a.slice().sort((m, n) => m - n); return +b[Math.min(b.length - 1, Math.floor(p * b.length))].toFixed(2); };
  out.audioClock = {
    ratio: +((ctx.currentTime - a0) / ((performance.now() - w0) / 1000)).toFixed(4),
    changes: steps.length,
    stepMs: { p50: q(steps, 0.5), p95: q(steps, 0.95), max: q(steps, 1) },
    wallBetweenChangesMs: { p50: q(stalls, 0.5), p95: q(stalls, 0.95), max: q(stalls, 1) },
  };
  // an AnalyserNode's view of a running oscillator, as the feedback guard reads it every 50 ms: how often it is stale
  const osc = ctx.createOscillator(), an = ctx.createAnalyser(); an.fftSize = 4096; osc.frequency.value = 997; osc.connect(an); osc.start();
  const buf = new Float32Array(4096); let same = 0, prev = null;
  for (let i = 0; i < 40; i++) { await new Promise((res) => setTimeout(res, 50)); an.getFloatTimeDomainData(buf); const k = buf.slice(0, 8).join(); if (k === prev) same++; prev = k; }
  out.analyserStale = `${same}/40`;
  osc.stop(); await ctx.close();
  out.rafAfter = await frames(1000);
  return out;
});
const clicks = [];
await page.evaluate(() => { const b = document.createElement('button'); b.id = '__probe'; b.textContent = 'probe'; b.style.cssText = 'position:fixed;left:10px;top:10px;z-index:99999'; document.body.append(b); });
for (let i = 0; i < 5; i++) { const t0 = Date.now(); await page.click('#__probe'); clicks.push(Date.now() - t0); }
r.clickMs = clicks;
try {
  await page.goto('chrome://gpu');
  await page.waitForTimeout(1000);
  const txt = await page.evaluate(() => {
    const walk = (n) => (n.shadowRoot ? walk(n.shadowRoot) : '') + Array.from(n.childNodes || []).map((c) => (c.nodeType === 3 ? c.textContent : walk(c))).join(' ');
    return walk(document.body).replace(/\s+/g, ' ');
  });
  const i = txt.indexOf('Graphics Feature Status');
  r.gpu = i >= 0 ? txt.slice(i, i + 700) : txt.slice(0, 300);
} catch (e) { r.gpu = 'chrome://gpu: ' + e.message.split('\n')[0]; }
console.log(JSON.stringify(r, null, 2));
await close();
