// @ts-check
// claude.biscuit-tin: Biscuit Tin. A struck bar or a plucked tine, modelled as a few resonant modes: a rosewood
// marimba bar (partials near 1 : 4 : 9.2, the high ones dying first) or a steel kalimba tine (a cantilever: 1 : 6.27 :
// 17.55). A raised-cosine mallet pulse excites them: a short pulse is a hard mallet (bright), a long one a yarn mallet
// (round). Low notes ring longer, like real bars; DAMP is how quickly a note stops when you let go.
export default {
  id: 'claude.biscuit-tin', name: 'Biscuit Tin', kind: 'instrument', cat: 'keys', by: 'claude', version: 1,
  blurb: 'A warm wooden marimba, or a kalimba thumb piano',
  nod: 'a marimba bar and a kalimba tine, as resonant modes',
  request: 'I need a little kalimba or marimba thing for the hook, warm and woody.',
  params: [
    { key: 'sound', label: 'SOUND', opts: ['WOOD', 'TINE'], def: 0, role: 'shape', desc: 'a marimba bar or a kalimba tine' },
    { key: 'mallet', label: 'MALLET', min: 0, max: 1, def: 0.45, role: 'tone', desc: 'soft yarn (round) to hard rubber (bright, clicky)' },
    { key: 'decay', label: 'RING', min: 0.2, max: 6, def: 2.2, curve: 'log', unit: 's', role: 'decay', desc: 'how long a note rings' },
    { key: 'damp', label: 'DAMP', min: 0, max: 1, def: 0.35, role: 'release', desc: 'how quickly a note stops when you let go' },
    { key: 'width', label: 'WIDTH', min: 0, max: 1, def: 0.5, role: 'width', desc: 'low notes left, high notes right, like standing at the instrument' },
  ],
  look: { color: '#7a4a25', ink: '#fff1dc', shape: 'box', finish: 'brushed', knob: 'cream', label: 'script', led: '#ffc56b' },
  tail: 6,
  kernel: `({
  poly: 12,
  create({ sr, seed, dsp }) {
    const WOOD = { r: [1, 3.93, 9.2], d: [1, 0.3, 0.09], g: [1, 0.3, 0.1] };    // a rosewood bar over its tube
    const TINE = { r: [1, 6.27, 17.55], d: [1, 0.22, 0.06], g: [1, 0.26, 0.1] }; // a steel tine on a wooden box
    const G = 0.55;
    const knee = (x) => { const a = x < 0 ? -x : x; if (a <= 0.5) return x; const y = 0.5 + 0.3 * dsp.tanh((a - 0.5) / 0.3); return x < 0 ? -y : y; };
    return {
      voice(i) {
        const wood = dsp.modal(WOOD.r.map((x) => 440 * x), WOOD.d, WOOD.g);
        const tine = dsp.modal(TINE.r.map((x) => 440 * x), TINE.d, TINE.g);
        let len = 32, hit = 0, amp = 0, k = 1, gl = 1, gr = 1, isTine = false;
        return {
          start(pitch, v, p) {
            isTine = p.sound >= 0.5;
            const ratio = dsp.mtof(pitch) / 440;
            wood.tune(ratio); tine.tune(ratio);
            k = p.decay * dsp.clamp(Math.pow(2, -(pitch - 60) / 24), 0.35, 2.2);   // low bars ring longer
            wood.damp(k); tine.damp(k * 1.3);
            len = Math.max(3, Math.round(sr * (0.0035 - 0.0031 * p.mallet)));    // yarn 3.5 ms .. rubber 0.4 ms
            hit = 0; amp = (2 * v * (0.5 + 0.5 * v)) / len;                       // the pulse's area follows velocity
            const pan = dsp.clamp((pitch - 64) / 30, -0.5, 0.5) * p.width;
            gl = Math.cos((pan + 0.5) * Math.PI / 2) * 1.41; gr = Math.sin((pan + 0.5) * Math.PI / 2) * 1.41;
          },
          release(p) { const kk = k * (1 - 0.9 * p.damp); wood.damp(kk); tine.damp(kk * 1.3); },
          render(L, R, n) {
            for (let j = 0; j < n; j++) {
              let x = 0;
              if (hit < len) { x = (0.5 - 0.5 * Math.cos((dsp.TAU * hit) / len)) * amp; hit++; }
              const y = G * (isTine ? wood.tick(0) + tine.tick(x) : wood.tick(x) + tine.tick(0));
              L[j] += y * gl; R[j] += y * gr;
            }
            return hit < len || wood.active() || tine.active();
          },
        };
      },
      process(L, R, n) {
        for (let j = 0; j < n; j++) { L[j] = knee(L[j]); R[j] = knee(R[j]); }
      },
    };
  },
})`,
};
