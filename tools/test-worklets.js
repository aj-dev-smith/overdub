// Processors the browser checks load into the studio's own audio context, as a module file served from the studio's
// origin: the studio's policy refuses data: and blob: scripts (app/index.html), so a check can't make a worklet from a
// string there either. Each runs until its port gets a message, then says 'end' and stops.
//   'stop-pk'  tools/stopping-test.js: the peak of every render quantum, with its audio time: [currentTime, peak]
//   'cap-sil'  tools/silence-test.js: every render quantum, both channels, with its audio time: [L, R, currentTime]
registerProcessor(
  'stop-pk',
  class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.on = true;
      this.port.onmessage = () => {
        this.on = false;
        this.port.postMessage('end');
      };
    }
    process(i) {
      const x = i[0];
      if (this.on && x && x[0]) {
        let p = 0;
        for (const ch of x)
          for (let k = 0; k < ch.length; k++) {
            const v = ch[k] < 0 ? -ch[k] : ch[k];
            if (v > p) p = v;
          }
        this.port.postMessage([currentTime, p]);
      }
      return this.on;
    }
  },
);
registerProcessor(
  'cap-sil',
  class extends AudioWorkletProcessor {
    constructor() {
      super();
      this.on = true;
      this.port.onmessage = () => {
        this.on = false;
        this.port.postMessage('end');
      };
    }
    process(i) {
      const x = i[0];
      if (this.on && x && x[0]) this.port.postMessage([x[0].slice(), (x[1] || x[0]).slice(), currentTime]);
      return this.on;
    }
  },
);
