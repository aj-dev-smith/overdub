// Which suites one CI shard runs: node .github/shard.js <shard> <shards> prints that shard's tools/*-test.js names, one
// a line. Every suite lands in exactly one shard. They are dealt longest first, each to the shard with the least time so
// far, by the seconds below (ubuntu-latest, one suite at a time); a suite not listed counts as half a minute. The times
// only balance the shards, so a stale one costs minutes, never a suite: update them when a shard runs long.
import fs from 'node:fs';

const SECS = {
  'demos-test.js': 1240, 'sampler-test.js': 530, 'golden-test.js': 520, 'analytics-test.js': 485, 'jam-test.js': 380,
  'sounds-test.js': 335, 'wavetable-test.js': 265, 'phone-test.js': 265, 'genre-demos-test.js': 265,
  'drumkit-test.js': 245, 'stuck-test.js': 225, 'stopping-test.js': 210, 'record-test.js': 190,
  'pick-sound-test.js': 170, 'instruments2-test.js': 165, 'sketch-rec-test.js': 145, 'compat-test.js': 140,
  'guitar-test.js': 135, 'multiband-test.js': 130, 'bench-test.js': 120, 'studioa-test.js': 115, 'engine-test.js': 95,
  'input-test.js': 85, 'stack-test.js': 80, 'share-test.js': 70, 'relay-test.js': 70, 'onboard-test.js': 70,
  'grooves-test.js': 70, 'clubkit-test.js': 60, 'brand-test.js': 60, 'imports-test.js': 55, 'wavetable-ui-test.js': 50,
  'transport-rec-test.js': 50, 'tabs-test.js': 50, 'shell-test.js': 50, 'arranger-rec-test.js': 50,
  'platform-test.js': 45, 'cloud-test.js': 45, 'bassrig-test.js': 45,
};

const [k, n] = process.argv.slice(2).map(Number);
if (!(n > 0 && k >= 0 && k < n)) throw new Error('usage: node .github/shard.js <shard> <shards>');
const suites = fs.readdirSync(new URL('../tools/', import.meta.url)).filter((f) => /-test\.js$/.test(f)).sort();
const secs = (f) => SECS[f] ?? 30;
const shards = Array.from({ length: n }, () => ({ secs: 0, suites: [] }));
for (const f of [...suites].sort((a, b) => secs(b) - secs(a) || (a < b ? -1 : 1))) {
  const s = shards.reduce((min, x) => (x.secs < min.secs ? x : min));
  s.secs += secs(f); s.suites.push(f);
}
console.log(shards[k].suites.sort().join('\n'));
