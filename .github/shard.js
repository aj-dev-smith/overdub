// Which suites one CI shard runs: node .github/shard.js <shard> <shards> prints that shard's tools/*-test.js names, one
// a line. Every suite lands in exactly one shard. They are dealt longest first, each to the shard with the least time so
// far, by the seconds below (ubuntu-latest, one suite at a time); a suite not listed counts as a minute. The times only
// balance the shards, so a stale one costs minutes, never a suite: update them when a shard runs long.
import fs from 'node:fs';

const SECS = {
  'demos-test.js': 840, 'sounds-test.js': 470, 'sampler-test.js': 470, 'jam-test.js': 390, 'analytics-test.js': 380,
  'golden-test.js': 260, 'phone-test.js': 250, 'drumkit-test.js': 240, 'stuck-test.js': 210, 'stopping-test.js': 195,
  'record-test.js': 190, 'instruments2-test.js': 180, 'pick-sound-test.js': 170, 'compat-test.js': 155,
  'guitar-test.js': 140, 'sketch-rec-test.js': 135, 'bench-test.js': 120, 'wavetable-test.js': 110,
  'studioa-test.js': 100, 'engine-test.js': 90, 'input-test.js': 80, 'relay-test.js': 75, 'onboard-test.js': 70,
  'multiband-test.js': 65, 'imports-test.js': 60,
};

const [k, n] = process.argv.slice(2).map(Number);
if (!(n > 0 && k >= 0 && k < n)) throw new Error('usage: node .github/shard.js <shard> <shards>');
const suites = fs.readdirSync(new URL('../tools/', import.meta.url)).filter((f) => /-test\.js$/.test(f)).sort();
const secs = (f) => SECS[f] ?? 60;
const shards = Array.from({ length: n }, () => ({ secs: 0, suites: [] }));
for (const f of [...suites].sort((a, b) => secs(b) - secs(a) || (a < b ? -1 : 1))) {
  const s = shards.reduce((min, x) => (x.secs < min.secs ? x : min));
  s.secs += secs(f); s.suites.push(f);
}
console.log(shards[k].suites.sort().join('\n'));
