// @ts-check
// The module every graph-device worklet goes in behind: devices/kit.js loadWorklet loads it once per audio context,
// before the first processor module (each a file on the page's own origin, as every worklet module is). A processor
// whose node has been let go is sent { __pfxEnd } (kit.js endWorklet) and returns false from then on: one returning
// true would otherwise be processed every render quantum for ever. Same message as clawd-o-matic's PFX_END, so its
// pedals' own port handlers already ignore it.
if (!globalThis.__pfxEnd) { globalThis.__pfxEnd = true; const rp = globalThis.registerProcessor;
  globalThis.registerProcessor = (name, C) => rp(name, class extends C {
    constructor(o) { super(o); this.__end = false; this.port.addEventListener('message', (e) => { if (e.data && e.data.__pfxEnd) this.__end = true; }); this.port.start(); }
    process(i, o, p) { return this.__end ? false : super.process(i, o, p); } }); }
