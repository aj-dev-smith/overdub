// The input recorder's processor, 'ew-cap' (input/audioin.js loads it into the input's audio context, attachCap): the
// chosen input in blocks of up to 2048 frames per channel, each with the audio-clock frame it began on, posted to the
// page for audio.listen (the recorder, hum, tap, the latency check). A file on the page's own origin, as every worklet
// module the studio loads is (the pages' policy refuses data: and blob: scripts).
class EwCap extends AudioWorkletProcessor {
  constructor(o) { super(); this.ch = (o && o.processorOptions && o.processorOptions.channels) || 1; this.N = 2048; this.b = null; this.w = 0; this.f0 = 0; this.on = true;
    this.port.onmessage = (e) => { if (e.data === 'off') { this.flush(); this.on = false; } }; }
  flush() { if (!this.b || !this.w) return; const d = this.b.map((x) => x.slice(0, this.w)); this.port.postMessage({ f: this.f0, d }, d.map((x) => x.buffer)); this.b = null; this.w = 0; }
  process(ins) {
    if (!this.on) return false;
    const i = ins[0] || [], len = (i[0] || { length: 128 }).length;
    if (!this.b) { this.b = []; for (let c = 0; c < this.ch; c++) this.b.push(new Float32Array(this.N)); this.w = 0; this.f0 = currentFrame; }
    for (let c = 0; c < this.ch; c++) { const s = i[c] || i[0]; if (s) this.b[c].set(s, this.w); }
    this.w += len;
    if (this.w + 128 > this.N) this.flush();
    return true;
  }
}
registerProcessor('ew-cap', EwCap);
