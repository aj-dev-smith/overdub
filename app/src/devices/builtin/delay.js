// @ts-check
// core.delay: Echo Reel. A stereo delay that locks to the song (note divisions from the transport's tempo, or free
// milliseconds), straight stereo or ping-pong, with the repeats darkening (TONE) and thinning (LOW CUT) as they go,
// a soft saturation in the loop so high feedback blooms instead of exploding, and a touch of tape wander. Changing the
// time glides like tape rather than clicking.
import { defineDevice } from '../registry.js';
import { kernel, DIV_LABELS } from './lib.js';

export default defineDevice({
  id: 'core.delay', name: 'Echo Reel', kind: 'effect', cat: 'time', by: 'overdub',
  blurb: 'Tempo-synced stereo and ping-pong echoes',
  nod: 'a stereo tape / digital delay with ping-pong',
  params: [
    { key: 'div', label: 'TIME', opts: ['FREE', ...DIV_LABELS], def: 7, role: 'time', desc: 'echo time as a note length (FREE uses MS)' },
    { key: 'ms', label: 'MS', min: 1, max: 2000, def: 320, curve: 'log', unit: 'ms', role: 'time', desc: 'echo time in milliseconds when TIME is FREE' },
    { key: 'mode', label: 'MODE', opts: ['STEREO', 'PING-PONG'], def: 1, role: 'width', desc: 'side by side, or bouncing left and right' },
    { key: 'feedback', label: 'FEEDBACK', min: 0, max: 0.95, def: 0.35, role: 'feedback', desc: 'how many repeats' },
    { key: 'tone', label: 'TONE', min: 400, max: 16000, def: 4200, curve: 'log', unit: 'Hz', role: 'tone', desc: 'each repeat darker below this' },
    { key: 'lowcut', label: 'LOW CUT', min: 20, max: 2000, def: 150, curve: 'log', unit: 'Hz', role: 'tone', desc: 'each repeat thinner above this' },
    { key: 'wow', label: 'WOW', min: 0, max: 1, def: 0.1, role: 'depth', desc: 'tape wander in the repeats' },
    { key: 'mix', label: 'MIX', min: 0, max: 1, def: 0.25, role: 'mix', desc: 'dry to all echo' },
  ],
  look: { color: '#24463c', ink: '#d8f5e4', shape: 'wide', finish: 'hammer', knob: 'black', label: 'block', led: '#6ee0a8' },
  trails: true, tail: 8,
  kernel: kernel(String.raw`
return {
  create({ sr, seed }) {
    const MAXS = Math.ceil(5 * sr);
    const dl = delayLine(MAXS), dr = delayLine(MAXS);
    const lpL = svf(sr), lpR = svf(sr), hpL = svf(sr), hpR = svf(sr);
    const tS = glide(140, sr), mixS = glide(30, sr), fbS = glide(30, sr), ppS = glide(20, sr);
    const wr = rng(seed ^ 0xde1a);
    let wph = 0, wobT = 0, wob = 0, cnt = 0;
    return {
      process(L, R, n, P, t) {
        const di = P.div | 0, bpm = (t && t.bpm) || 120;
        let secs = di === 0 ? P.ms / 1000 : DIVS[di - 1][1] * 60 / bpm;
        const target = clamp(secs * sr, 2, MAXS - 8);
        lpL.set(P.tone, 0.6); lpR.set(P.tone, 0.6); hpL.set(P.lowcut, 0.6); hpR.set(P.lowcut, 0.6);
        const ppT = (P.mode | 0) === 1 ? 1 : 0, wd = P.wow * 0.0016 * sr;
        for (let i = 0; i < n; i++) {
          wph += 0.6 / sr; if (wph >= 1) wph -= 1;
          if ((cnt++ & 2047) === 0) wobT = wr();
          wob += (wobT - wob) * 0.0005;
          const d = Math.min(MAXS - 8, tS.next(target) + wd * (0.6 * sinT(wph) + 0.4 * wob) + wd);
          const xl = L[i], xr = R[i];
          const el = dl.cubic(d), er = dr.cubic(d);
          const fb = fbS.next(P.feedback);
          // the loop: darker and thinner each pass, gently saturated
          hpL.tick(lpL.tick(el)); hpR.tick(lpR.tick(er));
          const yl = sat(hpL.hp * fb * 1.1) / 1.1, yr = sat(hpR.hp * fb * 1.1) / 1.1;
          // stereo: each side feeds itself; ping-pong: the input enters left and the sides feed each other (MODE
          // crossfades between the two over 20 ms)
          const pp = ppS.next(ppT);
          dl.write((xl + yl) * (1 - pp) + ((xl + xr) * 0.5 + yr) * pp);
          dr.write((xr + yr) * (1 - pp) + yl * pp);
          const mx = mixS.next(P.mix), dry = Math.cos(mx * Math.PI / 2), wet = Math.sin(mx * Math.PI / 2) * 0.95;
          L[i] = xl * dry + el * wet; R[i] = xr * dry + er * wet;
        }
      },
    };
  },
};
`),
});
