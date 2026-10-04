// vendored verbatim from clawd-o-matic/web/ampui.js @ cd36948 by tools/vendor-clawd.js: do not edit, re-run it
/* ================================================================ Claw'd-o-Matic: the amp's face (plug in) */
// Concatenated in the app's scope after pedals.js and before plugin.js. What the plug-in amp looks like: a big amp you
// turn the knobs on, a wall of little amps to pick from, and the amp's chip on the pedalboard. Pure CSS: no images.
// Each amp id has its own look (tolex, piping, panel, knobs, grille cloth, logo); an id without one borrows the look of
// its style (PLUG_AMPS[id].style), else a plain one. Only the looks live here; the sound is amps.js.

// A look: form (combo, or head on a cab), cones in the cab, tolex, piping, panel and its ink, knob style, grille cloth,
// logo (font, colour, plate), jewel colour.
const AMP_FONT = { script: '"Brush Script MT", "Snell Roundhand", "Segoe Script", cursive', dirt: FONTS.dirt, px: 'var(--f-px)', ui: 'var(--f-ui)' };
const AMP_GRAIN = 'radial-gradient(circle at 1px 1px, #ffffff10 0.6px, transparent 1.2px) 0 0/3px 3px, radial-gradient(circle at 2px 2px, #00000030 0.6px, transparent 1.2px) 0 0/4px 4px';
const AMP_LOOKS = {
  // blackface: black tolex, white piping, black panel, silver sparkle cloth, skirted knobs, chrome script
  clean: { form: 'combo', cones: 2, tx: `${AMP_GRAIN}, linear-gradient(#232226, #141316)`, pipe: '#d9d4c7', pn: 'linear-gradient(#18181b, #0c0c0e)', ink: '#ecebe6', pnEdge: '#8d9097',
    knob: 'skirt', gr: 'repeating-linear-gradient(90deg, #c9ccd2 0 1px, #8e929a 1px 2px, #b3b7be 2px 3px), repeating-linear-gradient(0deg, #00000026 0 1px, transparent 1px 3px), #a8acb3',
    grDark: false, logo: { f: 'script', size: 1.25, c: 'linear-gradient(#fff 0 45%, #b7bcc4 50%, #f2f4f7 58%, #8a9099)', tilt: -8 }, jewel: '#ff3b30' },
  // copper top: cream tolex, copper panel, diamond cloth, chicken heads
  jangle: { form: 'combo', cones: 2, tx: `${AMP_GRAIN}, linear-gradient(#efe4c8, #d8c9a3)`, pipe: '#6b4a2b', pn: 'linear-gradient(#d7955a, #a8612f 60%, #8a4b22)', ink: '#2a160a', pnEdge: '#f0c08c',
    knob: 'chicken', gr: 'repeating-linear-gradient(45deg, #b8a47c 0 1.5px, transparent 1.5px 8px), repeating-linear-gradient(-45deg, #b8a47c 0 1.5px, transparent 1.5px 8px), #4a3322',
    grDark: true, logo: { f: 'ui', w: 800, st: 125, size: 0.8, c: 'linear-gradient(#ffe2b0, #c98a4a)', track: 0.12, plate: 'linear-gradient(#2a1a10, #120a06)' }, jewel: '#ff4d2e' },
  // tweed: tweed tolex, oxblood cloth, chrome-and-cream panel, chicken heads, script logo
  crunch: { form: 'combo', cones: 1, tx: 'repeating-linear-gradient(45deg, #00000024 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, #fff3d626 0 1px, transparent 1px 4px), repeating-linear-gradient(45deg, #c8a869 0 2px, #9c7b43 2px 3px, #d9bf87 3px 5px)',
    pipe: '#3a2412', pn: 'linear-gradient(#e7e8ea, #b9bcc1 55%, #9ea2a8)', ink: '#2b1d10', pnEdge: '#ffffff',
    knob: 'chicken', gr: 'repeating-linear-gradient(90deg, #6d2e25 0 1px, #4d1d17 1px 2px), repeating-linear-gradient(0deg, #00000030 0 1px, transparent 1px 2px), #5b241d',
    grDark: true, logo: { f: 'script', size: 1.35, c: 'linear-gradient(#fff6e0, #e0c38f)', tilt: -6 }, jewel: '#ffb02e' },
  // gold panel, black tolex, basketweave, gold caps; a head on a 4x12
  plexi: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#1f1e21, #121114)`, pipe: '#efe9dc', pn: 'linear-gradient(#f6dc85, #d6ad45 45%, #b58a2a)', ink: '#20170a', pnEdge: '#fff4c2',
    knob: 'gold', gr: 'conic-gradient(from 90deg at 50% 50%, #3b352a 25%, #16130f 0 50%, #3b352a 0 75%, #16130f 0) 0 0/6px 6px, repeating-linear-gradient(0deg, #cbb98a22 0 1px, transparent 1px 3px)',
    grDark: true, logo: { f: 'ui', w: 800, st: 110, size: 1.05, c: 'linear-gradient(#ffffff, #e9e3d4)', tilt: -4, italic: true }, jewel: '#ff3b30' },
  // Clawd's own: coral tolex, black panel, black cloth, cream chicken heads, gaffer tape with the name on it
  punk: { form: 'combo', cones: 2, tx: `${AMP_GRAIN}, linear-gradient(#e2835f, #c2603f)`, pipe: '#17151a', pn: 'linear-gradient(#1e1c20, #111013)', ink: '#f3ead6', pnEdge: '#e2835f',
    knob: 'bone', gr: 'repeating-linear-gradient(90deg, #2a262c 0 1px, #171519 1px 2px), repeating-linear-gradient(0deg, #00000055 0 1px, transparent 1px 2px), #1d1a1f',
    grDark: true, logo: { f: 'dirt', size: 1.15, c: 'linear-gradient(#1b181d, #1b181d)', tilt: -3, plate: 'linear-gradient(175deg, #e9e4d8, #cdc6b6)', tape: true }, jewel: '#ff3b30', sticker: true },
  // hot rod: purple-black snake tolex, silver cloth, black chrome panel, purple jewel
  lead: { form: 'head', cones: 2, tx: 'radial-gradient(ellipse 6px 4px at 50% 50%, #ffffff0d 40%, transparent 60%) 0 0/8px 6px, radial-gradient(ellipse 6px 4px at 50% 50%, #ffffff0a 40%, transparent 60%) 4px 3px/8px 6px, linear-gradient(#2a1f33, #16101c)',
    pipe: '#b98cff', pn: 'linear-gradient(#2b2d33, #0f1013)', ink: '#e6e0f5', pnEdge: '#9c7ad8',
    knob: 'chicken', knobDark: true, gr: 'repeating-linear-gradient(90deg, #3a3542 0 1px, #221e28 1px 2px), repeating-linear-gradient(0deg, #00000044 0 1px, transparent 1px 2px), #2b2631',
    grDark: true, logo: { f: 'ui', w: 800, st: 125, size: 0.95, c: 'linear-gradient(#fff, #b98cff)', italic: true, track: 0.04, glow: '#a970ff' }, jewel: '#b36bff' },
  // modern high gain: diamond plate, black metal mesh, knurled domes
  recto: { form: 'head', cones: 4, tx: 'linear-gradient(135deg, transparent 44%, #ffffff33 50%, transparent 56%) 0 0/9px 9px, linear-gradient(45deg, transparent 44%, #0000004d 50%, transparent 56%) 4.5px 4.5px/9px 9px, linear-gradient(#a3a8b0, #62676f)',
    pipe: '#2a2c30', pn: 'linear-gradient(#26282c, #0d0e10)', ink: '#d9dde3', pnEdge: '#9aa0a8',
    knob: 'knurl', gr: 'radial-gradient(circle, #000 1.3px, transparent 1.8px) 0 0/5px 5px, radial-gradient(circle, #ffffff1a 1.3px, transparent 1.8px) 1px 1px/5px 5px, #2a2d32',
    grDark: true, logo: { f: 'ui', w: 800, st: 62, size: 1.3, c: 'linear-gradient(#fff 0 40%, #9aa1ab 50%, #e8ebef 62%, #6b717a)', track: 0.02 }, jewel: '#ff2a2a', plate: true },
  // a toy practice amp: candy plastic, holes for a grille, big gumball knobs
  tiny: { form: 'combo', cones: 1, small: true, tx: 'linear-gradient(150deg, #ffffff55, transparent 35%), linear-gradient(#ff8fc4, #f45c9e)', pipe: '#ffffff', pn: 'linear-gradient(#bff5e3, #7fe0c2)', ink: '#10302a', pnEdge: '#e9fff8',
    knob: 'toy', gr: 'radial-gradient(circle, #00000059 2.2px, transparent 2.8px) 0 0/9px 9px, linear-gradient(#ff9fcd, #f06aa8)', grDark: false, round: 18,
    logo: { f: 'px', size: 0.72, c: 'linear-gradient(#f45c9e, #f45c9e)', plate: 'linear-gradient(#fff, #f1f1f1)', track: 0.06, pill: true }, jewel: '#3ddc84' },
  // ---- round two
  // 80s solid state: black vinyl, a flat brushed-aluminium panel, flat black knobs, a badge for its chorus
  jc: { form: 'combo', cones: 2, tx: `${AMP_GRAIN}, linear-gradient(#1f1f22, #0f0f11)`, pipe: '#9a9ca2', pn: 'repeating-linear-gradient(90deg, #ffffff18 0 1px, transparent 1px 3px), linear-gradient(#d3d6db, #a3a7ad)', ink: '#141416', pnEdge: '#ffffff',
    knob: 'flat', gr: 'repeating-linear-gradient(90deg, #232326 0 1px, #0f0f11 1px 2px), repeating-linear-gradient(0deg, #00000040 0 1px, transparent 1px 2px), #161618',
    grDark: true, logo: { f: 'ui', w: 800, st: 125, size: 0.72, c: 'linear-gradient(#ffffff, #d2d6dc)', track: 0.32 }, jewel: '#ff3b30', badge: 'STEREO CHORUS' },
  // a loud British clean: black, a white enamel plate, chrome-capped knobs, grey basketweave; a head on a 4x12
  hiwatt: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#1f1e22, #111013)`, pipe: '#dcdcdc', pn: 'linear-gradient(#2a2a2e, #141416)', ink: '#f2f2f2', pnEdge: '#6b6b72',
    knob: 'chrome', gr: 'conic-gradient(from 90deg at 50% 50%, #34343a 25%, #1b1b1e 0 50%, #34343a 0 75%, #1b1b1e 0) 0 0/4px 4px',
    grDark: true, logo: { f: 'ui', w: 700, st: 100, size: 0.72, c: 'linear-gradient(#141414, #141414)', plate: 'linear-gradient(#f8f6f0, #d9d6cc)', track: 0.2 }, jewel: '#ff3b30' },
  // tweed bass amp: lacquered (amber) tweed, oxblood cloth with a gold stripe, four 10s, chicken heads
  bassman: { form: 'combo', cones: 4, tx: 'repeating-linear-gradient(45deg, #00000030 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, #fff0c826 0 1px, transparent 1px 4px), repeating-linear-gradient(45deg, #b8873f 0 2px, #875a22 2px 3px, #c99a52 3px 5px)',
    pipe: '#2a1a0c', pn: 'linear-gradient(#e7e8ea, #b9bcc1 55%, #9ea2a8)', ink: '#2b1d10', pnEdge: '#ffffff',
    knob: 'chicken', gr: 'repeating-linear-gradient(90deg, #7a2f24 0 2px, #561e17 2px 4px, #c9a35a 4px 5px, #561e17 5px 7px), repeating-linear-gradient(0deg, #00000030 0 1px, transparent 1px 2px), #5b241d',
    grDark: true, logo: { f: 'script', size: 1.3, c: 'linear-gradient(#fff6e0, #e0c38f)', tilt: -6 }, jewel: '#ffb02e' },
  // boutique two-tone: a black head on a cream cab, silver-shot brown cloth, black chicken heads, pearl script
  dumble: { form: 'head', cones: 2, tx: `${AMP_GRAIN}, linear-gradient(#1d1b1f, #0f0e11)`, tx2: `${AMP_GRAIN}, linear-gradient(#f1ebdd, #d4cbb6)`, pipe: '#b9a77e', pn: 'linear-gradient(#222125, #0e0d10)', ink: '#ece6d8', pnEdge: '#8a857a',
    knob: 'chicken', knobDark: true, gr: 'repeating-linear-gradient(90deg, #3a2e28 0 1px, #221a16 1px 2px, #9a948a 2px 2.6px, #221a16 2.6px 4px), repeating-linear-gradient(0deg, #00000033 0 1px, transparent 1px 2px), #2a211c',
    grDark: true, logo: { f: 'script', size: 1.2, c: 'linear-gradient(100deg, #ffffff 0%, #f3d9ff 30%, #d7fbff 55%, #fff5d6 80%)', tilt: -6, glow: '#d7c8ff66' }, jewel: '#4fb4ff' },
  // the brown sound: brown tolex, wheat cloth, a brass panel with gold caps, a plate for the name
  brown: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#70462a, #472a17)`, pipe: '#eadcc0', pn: 'linear-gradient(#e2c27a, #b88f3a 50%, #8a6624)', ink: '#21160a', pnEdge: '#fff0c4',
    knob: 'gold', gr: 'repeating-linear-gradient(90deg, #dcc893 0 1px, #b39a62 1px 2px), repeating-linear-gradient(0deg, #00000026 0 1px, transparent 1px 3px), #c9b27a',
    grDark: false, logo: { f: 'ui', w: 800, st: 110, size: 0.9, c: 'linear-gradient(#ffe7a8, #c9953f)', italic: true, plate: 'linear-gradient(#2a1a0e, #140c06)', track: 0.03 }, jewel: '#ff3b30' },
  // hand-built super lead: black, a chrome faceplate, black chicken heads, a blue jewel
  slo: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#19191b, #0c0c0d)`, pipe: '#c9ccd1', pn: 'linear-gradient(180deg, #f4f6f8 0%, #aeb3ba 35%, #e6e9ec 55%, #8e939a 100%)', ink: '#111214', pnEdge: '#ffffff',
    knob: 'chicken', knobDark: true, gr: 'repeating-linear-gradient(90deg, #34353a 0 1px, #141416 1px 2px), repeating-linear-gradient(0deg, #00000040 0 1px, transparent 1px 2px), #1c1c1f',
    grDark: true, logo: { f: 'ui', w: 800, st: 75, size: 1.2, c: 'linear-gradient(#fff 0 40%, #9aa1ab 50%, #eef0f3 62%, #6b717a)', italic: true, track: 0.02 }, jewel: '#2e7bff' },
  // modern British: black, salt-and-pepper cloth, gold ink on black, gold caps, an amber jewel
  friedman: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#1b1a1d, #0e0e10)`, pipe: '#b8963e', pn: 'linear-gradient(#1b1b1b, #0a0a0a)', ink: '#e9d08a', pnEdge: '#b8963e',
    knob: 'gold', gr: 'radial-gradient(circle at 1px 1px, #d8d4c8 0.7px, transparent 1.1px) 0 0/3px 3px, radial-gradient(circle at 2px 2px, #8d897f 0.6px, transparent 1px) 0 0/4px 3px, #242222',
    grDark: true, logo: { f: 'ui', w: 700, st: 100, size: 0.8, c: 'linear-gradient(#fff4c8, #d2a647 60%, #8a6a22)', plate: 'linear-gradient(#141414, #050505)', track: 0.12 }, jewel: '#ffb02e' },
  // stealth metal: black on black, knurled knobs, dim grey ink, a red jewel and a red glow on the badge
  metal: { form: 'head', cones: 4, tx: 'radial-gradient(circle at 1px 1px, #ffffff0a 0.6px, transparent 1.2px) 0 0/3px 3px, linear-gradient(#151516, #09090a)', pipe: '#2a2a2e', pn: 'linear-gradient(#141416, #060607)', ink: '#80838b', pnEdge: '#2e2e33',
    knob: 'knurl', gr: 'radial-gradient(circle, #000 1.2px, transparent 1.7px) 0 0/4px 4px, radial-gradient(circle, #ffffff0d 1.2px, transparent 1.7px) 1px 1px/4px 4px, #17171a',
    grDark: true, logo: { f: 'ui', w: 900, st: 62, size: 1.35, c: 'linear-gradient(#55575d 0 42%, #c4c8ce 50%, #3a3b40 58%, #1c1d20)', track: 0.04, glow: '#ff1a1a' }, jewel: '#ff1a1a' },
  // loud orange: orange tolex, beige basketweave, a cream panel with pictures for words
  orange: { form: 'head', cones: 4, tx: `${AMP_GRAIN}, linear-gradient(#ff8a1f, #e46800)`, pipe: '#f1e7cf', pn: 'linear-gradient(#f4eddd, #d9cfb9)', ink: '#1a1208', pnEdge: '#ffffff',
    knob: 'chicken', knobDark: true, picto: true, gr: 'conic-gradient(from 90deg at 50% 50%, #ddd0ab 25%, #a8966c 0 50%, #ddd0ab 0 75%, #a8966c 0) 0 0/6px 6px, repeating-linear-gradient(0deg, #0000001a 0 1px, transparent 1px 3px)',
    grDark: false, logo: { f: 'ui', w: 900, st: 110, size: 0.95, c: 'linear-gradient(#ff8a1f, #ff6a00)', plate: 'linear-gradient(#1b1512, #0b0806)', track: 0.02 }, jewel: '#ff3b30' },
  // a pocket transistor radio: turquoise bakelite, chrome slats, a tuning dial, cream ridged knobs
  radio: { form: 'combo', cones: 1, small: true, round: 22, face: 'radio', tx: 'linear-gradient(150deg, #ffffff55, transparent 35%), linear-gradient(#5cc9b9, #2b9687)', pipe: '#f4ecd8', pn: 'linear-gradient(#f6eed8, #e0d3b0)', ink: '#3a2a14', pnEdge: '#ffffff',
    knob: 'bakelite', gr: 'repeating-linear-gradient(0deg, #eef1f5 0 3px, #9aa2ab 3px 4px, #3b4148 4px 7px), #3b4148',
    grDark: false, logo: { f: 'script', size: 1.1, c: 'linear-gradient(#fffaf0, #eadcb8)', tilt: -8 }, jewel: '#ffb02e' },
  // a handheld console: grey plastic, slanted speaker slots, a green LCD with the name in pixels, square buttons
  bit: { form: 'combo', cones: 0, small: true, round: 12, face: 'lcd', tx: 'linear-gradient(150deg, #ffffff40, transparent 30%), linear-gradient(#d3cfda, #aca7b6)', pipe: '#8b86a0', pn: 'linear-gradient(#c5c1ce, #a9a4b4)', ink: '#2a2560', pnEdge: '#f2f0f6',
    knob: 'pixel', gr: 'repeating-linear-gradient(-60deg, transparent 0 7px, #5a556c 7px 10px), linear-gradient(#bfbac9, #a5a0b1)',
    grDark: false, logo: { f: 'px', size: 0.62, c: 'linear-gradient(#0f380f, #0f380f)', plate: 'linear-gradient(#9bbc0f, #8bac0f)', track: 0.04 }, jewel: '#ff2d55' },
  // a four-track in the red: brushed silver, black perforated speakers either side of a cassette with turning reels
  tape: { form: 'combo', cones: 2, face: 'tape', tx: 'repeating-linear-gradient(90deg, #ffffff18 0 1px, transparent 1px 3px), linear-gradient(#c3c8cf, #8b919a)', pipe: '#2b2d31', pn: 'linear-gradient(#26272b, #111215)', ink: '#e8e8e8', pnEdge: '#55575d',
    knob: 'flat', gr: 'radial-gradient(circle, #000 1.1px, transparent 1.6px) 0 0/5px 5px, #2a2c30',
    grDark: true, logo: { f: 'ui', w: 800, st: 110, size: 0.7, c: 'linear-gradient(#ff5f6d, #ffc371)', italic: true, track: 0.02 }, jewel: '#ff3b30' },
  // from the deep: abyssal navy with glowing specks, a dark glass panel in cyan ink, an anglerfish's lure over one big cone
  abyss: { form: 'combo', cones: 1, face: 'lure', tx: 'radial-gradient(circle at 30% 40%, #7df9ff22 0.8px, transparent 1.6px) 0 0/23px 19px, radial-gradient(circle at 70% 20%, #b48cff1c 0.8px, transparent 1.6px) 0 0/31px 27px, linear-gradient(#0d1a2e, #050a14)',
    pipe: '#1f4d63', pn: 'linear-gradient(#0c2230, #041018)', ink: '#7df9ff', pnEdge: '#1f6a80',
    knob: 'knurl', gr: 'radial-gradient(ellipse 70% 60% at 50% 110%, #0a4a5a66, transparent 70%), radial-gradient(circle, #000 1.1px, transparent 1.6px) 0 0/4px 4px, linear-gradient(#081624, #02060c)',
    grDark: true, logo: { f: 'dirt', size: 1.1, c: 'linear-gradient(#e9fdff, #7df9ff 55%, #2aa9c9)', glow: '#2de2ff', track: 0.06 }, jewel: '#2de2ff' },
  // a DI box (keys and synths): blue powder-coated steel, a black face with the jacks, flat knobs, a green power LED
  di: { form: 'combo', cones: 0, small: true, round: 6, face: 'di', tx: 'radial-gradient(circle at 1px 1px, #ffffff14 0.6px, transparent 1.1px) 0 0/3px 3px, linear-gradient(#2f5fb8, #1d3f86)', pipe: '#0d1a36', pn: 'linear-gradient(#1b1d22, #0d0e11)', ink: '#e8eefc', pnEdge: '#6f8fd6',
    knob: 'flat', gr: 'repeating-linear-gradient(90deg, #ffffff10 0 1px, transparent 1px 3px), linear-gradient(#2a55a6, #1b3a7c)', grDark: true,
    logo: { f: 'ui', w: 800, st: 100, size: 0.8, c: 'linear-gradient(#ffffff, #dfe7fb)', plate: 'linear-gradient(#111317, #050607)', track: 0.18 }, jewel: '#3ddc84' },
  // ---- the bass amps
  // the 8x10 fridge: black tolex, a brushed-aluminium panel with a blue stripe, skirted knobs, a blue jewel, eight cones
  whale: { form: 'head', cones: 8, tx: `${AMP_GRAIN}, linear-gradient(#1c1c20, #0d0d10)`, pipe: '#c9ced6',
    pn: 'linear-gradient(transparent 0 72%, #1d4fb8 72% 86%, transparent 86%), repeating-linear-gradient(90deg, #ffffff14 0 1px, transparent 1px 3px), linear-gradient(#dfe3e8, #9aa0a8)', ink: '#101216', pnEdge: '#ffffff',
    knob: 'skirt', gr: 'repeating-linear-gradient(90deg, #26262b 0 1px, #111114 1px 2px), repeating-linear-gradient(0deg, #00000055 0 1px, transparent 1px 2px), #19191c',
    grDark: true, logo: { f: 'ui', w: 800, st: 110, size: 1.05, c: 'linear-gradient(#ffffff 0 45%, #b9c8e8 52%, #f2f5fa 60%, #7f8ea8)', italic: true, track: 0.02 }, jewel: '#2e7bff' },
  // the flip-top: blue check tolex, a silver panel, chrome caps, a script badge over one 15
  walrus: { form: 'combo', cones: 1, tx: 'conic-gradient(from 90deg at 50% 50%, #2b4f9e 25%, #111a33 0 50%, #2b4f9e 0 75%, #111a33 0) 0 0/6px 6px', pipe: '#d8dde6',
    pn: 'linear-gradient(#e8ebef, #b5bac2 55%, #9ca1a9)', ink: '#141820', pnEdge: '#ffffff',
    knob: 'chrome', gr: 'repeating-linear-gradient(90deg, #2a2d34 0 1px, #15171b 1px 2px), repeating-linear-gradient(0deg, #00000040 0 1px, transparent 1px 2px), #1c1e23',
    grDark: true, logo: { f: 'script', size: 1.3, c: 'linear-gradient(#ffffff, #c8d4ec)', tilt: -7 }, jewel: '#ff3b30' },
  // modern class-D: a slim anodised head, a black face in mint ink, flat knobs, a perforated steel grille over two 12s
  narwhal: { form: 'head', cones: 2, tx: 'repeating-linear-gradient(90deg, #ffffff0a 0 1px, transparent 1px 3px), linear-gradient(#2b2e33, #15171a)', pipe: '#3a3f46',
    pn: 'linear-gradient(#141619, #07080a)', ink: '#8dffd9', pnEdge: '#2a3a36',
    knob: 'flat', gr: 'radial-gradient(circle, #000 1.3px, transparent 1.8px) 0 0/5px 5px, linear-gradient(#34383e, #1e2125)',
    grDark: true, logo: { f: 'ui', w: 900, st: 75, size: 1.1, c: 'linear-gradient(#e9fffa, #8dffd9)', track: 0.22, glow: '#3dffc4' }, jewel: '#3dffc4' },
  // the bassist's tweed: pale sand tweed, a chrome panel, brown wheat cloth, chicken heads, one 15
  sandbar: { form: 'combo', cones: 1, tx: 'repeating-linear-gradient(45deg, #0000001f 0 1px, transparent 1px 3px), repeating-linear-gradient(-45deg, #fff8e426 0 1px, transparent 1px 4px), repeating-linear-gradient(45deg, #dcc596 0 2px, #b39a66 2px 3px, #e8d6ae 3px 5px)',
    pipe: '#4a3218', pn: 'linear-gradient(#e7e8ea, #b9bcc1 55%, #9ea2a8)', ink: '#2b1d10', pnEdge: '#ffffff',
    knob: 'chicken', gr: 'repeating-linear-gradient(90deg, #7a5a34 0 1px, #5a4024 1px 2px), repeating-linear-gradient(0deg, #00000030 0 1px, transparent 1px 2px), #684a2a',
    grDark: true, logo: { f: 'script', size: 1.3, c: 'linear-gradient(#fff6e0, #e8d6ae)', tilt: -6 }, jewel: '#ffb02e' },
  // a fuzz box grown into an amp: deep purple with magenta specks, a black face in hot pink, a pink glow on four 10s
  urchin: { form: 'combo', cones: 4, tx: 'radial-gradient(circle at 30% 40%, #ff4fd822 0.9px, transparent 1.7px) 0 0/13px 11px, radial-gradient(circle at 70% 20%, #b36bff22 0.8px, transparent 1.6px) 0 0/17px 15px, linear-gradient(#2a1238, #12071a)',
    pipe: '#ff4fd8', pn: 'linear-gradient(#1a0f22, #0a050e)', ink: '#ff8be6', pnEdge: '#6b2a78',
    knob: 'knurl', gr: 'radial-gradient(ellipse 70% 60% at 50% 110%, #ff4fd833, transparent 70%), radial-gradient(circle, #000 1.1px, transparent 1.6px) 0 0/4px 4px, linear-gradient(#1c0c26, #09040d)',
    grDark: true, logo: { f: 'dirt', size: 1.1, c: 'linear-gradient(#ffe6fa, #ff8be6 55%, #c43ab0)', glow: '#ff4fd8', track: 0.04 }, jewel: '#ff4fd8' },
  generic: { form: 'combo', cones: 1, tx: `${AMP_GRAIN}, linear-gradient(#3a3740, #26232b)`, pipe: '#8a8392', pn: 'linear-gradient(#2e2b33, #1b191f)', ink: '#e6e0ea', pnEdge: '#6e6676',
    knob: 'skirt', gr: 'repeating-linear-gradient(90deg, #34303a 0 1px, #1f1c23 1px 2px), #29252e', grDark: true, logo: { f: 'ui', w: 800, st: 100, size: 0.9, c: 'linear-gradient(#fff, #cfc8d6)', track: 0.08 }, jewel: '#ff3b30' },
};
const AMP_STYLE_LOOK = { american: 'clean', british: 'plexi', boutique: 'crunch', modern: 'recto', tiny: 'tiny', solid: 'jc', weird: 'tiny' };
// The wall's filters (PLUG_AMPS[id].tone), in the order the wall runs.
const AMP_TONES = [['all', 'All'], ['clean', 'Clean'], ['crunch', 'Crunch'], ['high', 'High gain'], ['weird', 'Weird'], ['bass', 'Bass']];
// Orange-style pictures for the knobs' words (the words stay in the knobs' aria labels)
const AMP_PICTO = { gain: '◢', bass: '∿', mid: '∿', treble: '∿', presence: '✳', level: '◔' };
// Words for amps that don't bring their own yet.
const AMP_BLURBS = { clean: 'Glassy and wide open. Chords ring out.', jangle: 'Chimey, bright, a little hair on it.', crunch: 'Warm edge that breaks up when you dig in.',
  plexi: 'Classic British roar. Turn it up.', punk: 'Tight, loud, fast. Three chords and the truth.', lead: 'Singing sustain for the solo.',
  recto: 'Scooped, huge, modern. Chug.', tiny: 'A practice amp with a big attitude.' };
const ampLookOf = (id) => AMP_LOOKS[id] || AMP_LOOKS[AMP_STYLE_LOOK[(PLUG_AMPS[id] || {}).style]] || AMP_LOOKS.generic;
const ampInfo = (id) => { const a = PLUG_AMPS[id] || {}; return { id, name: a.name || id, blurb: a.blurb || AMP_BLURBS[id] || '', nod: a.nod || '', tone: a.tone || 'weird' }; };
const ampToneLabel = (t) => (AMP_TONES.find((x) => x[0] === t) || [, ''])[1];
const ampEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// The look as custom properties on an element (both the big amp and the little ones read them).
function ampPaint(el, id) {
  const L = ampLookOf(id), g = L.logo || {};
  const v = { '--tx': L.tx, '--pipe': L.pipe, '--pn': L.pn, '--pn-ink': L.ink, '--pn-edge': L.pnEdge, '--gr': L.gr, '--jw': L.jewel,
    '--lg-f': AMP_FONT[g.f] || AMP_FONT.ui, '--lg-w': g.w || 400, '--lg-st': (g.st || 100) + '%', '--lg-size': g.size || 1, '--lg-c': g.c || '#fff',
    '--lg-tilt': (g.tilt || 0) + 'deg', '--lg-style': g.italic ? 'italic' : 'normal', '--lg-track': (g.track || 0) + 'em', '--lg-plate': g.plate || 'none',
    '--lg-glow': g.glow || 'transparent', '--round': (L.round || 7) + 'px', '--tx2': L.tx2 || L.tx, '--badge': L.badge ? JSON.stringify(L.badge) : 'none' };
  for (const k in v) el.style.setProperty(k, v[k]);
  el.dataset.form = L.form; el.dataset.cones = L.cones != null ? L.cones : 1; el.dataset.knob = L.knob; el.dataset.face = L.face || ''; el.dataset.look = Object.keys(AMP_LOOKS).find((k) => AMP_LOOKS[k] === L);
  el.classList.toggle('gr-light', !L.grDark); el.classList.toggle('lg-plated', !!g.plate); el.classList.toggle('lg-tape', !!g.tape); el.classList.toggle('lg-pill', !!g.pill);
  el.classList.toggle('knob-dark', !!L.knobDark); el.classList.toggle('sticker', !!L.sticker); el.classList.toggle('small', !!L.small); el.classList.toggle('picto', !!L.picto);
}
// A little amp (the wall and the board's chip): the same look, no working parts.
function ampMini(id) {
  const m = document.createElement('span');
  m.className = 'am'; m.setAttribute('aria-hidden', 'true');
  m.innerHTML = `<i class="am-top"><i class="am-pn"><i></i><i></i><i></i><i></i><i class="am-jw"></i></i></i><i class="am-cab"><i class="am-gr"><i class="am-face"><i></i><i></i></i><i class="am-lgw"><b class="am-lg"></b></i></i></i>`;
  ampMini.set(m, id);
  return m;
}
ampMini.set = (m, id) => { ampPaint(m, id); m.querySelector('.am-lg').textContent = ampInfo(id).name; };

/* ---- the whole amp section: the big amp, prev/next, the backline (the wall of amps, with tone filters); plus the
   chip for the board. opts: { P (settings, changed in place), defaults, onChange(), onPower() } */
function plugAmpUI({ P, defaults, onChange, onPower }) {
  // the wall runs clean to weird (and in PLUG_AMPS' order within a tone); prev/next and the arrows follow it
  const order = AMP_TONES.map((t) => t[0]);
  const ids = () => Object.keys(PLUG_AMPS).map((id, i) => [id, i]).sort((a, b) => (order.indexOf(ampInfo(a[0]).tone) - order.indexOf(ampInfo(b[0]).tone)) || a[1] - b[1]).map((x) => x[0]);
  const KNOBS = [['gain', 'GAIN'], ['bass', 'BASS'], ['mid', 'MIDDLE'], ['treble', 'TREBLE'], ['presence', 'PRESENCE'], ['level', 'MASTER']];
  const FILTER_KEY = 'clawd-o-matic:amp-filter';
  let filter = store.get(FILTER_KEY);
  if (!AMP_TONES.some((t) => t[0] === filter)) filter = 'all';
  const root = document.createElement('section');
  root.className = 'amps'; root.setAttribute('aria-label', 'Amp');
  root.innerHTML = `
    <div class="amps-head">
      <h3 class="plug-h">The amp</h3>
      <p class="amps-now" aria-live="polite"><b class="amps-name"></b> <span class="amps-blurb"></span><small class="amps-nod"></small></p>
    </div>
    <div class="amps-stage">
      <button class="amps-nav" type="button" data-d="-1" aria-label="Previous amp"><i></i></button>
      <div class="amp-wrap" tabindex="-1">
        <div class="amp">
          <i class="amp-handle" aria-hidden="true"></i>
          <div class="amp-top">
            <div class="amp-strip" aria-hidden="true"><span class="amp-lgw"><span class="amp-lg"></span></span></div>
            <div class="amp-panel">
              <span class="amp-jacks" aria-hidden="true"><i></i><i></i><small>INPUT</small></span>
              <div class="amp-knobs" role="group"></div>
              <span class="amp-vu" aria-hidden="true"><span class="amp-vu-face"><i class="amp-vu-n"></i></span><small>DRIVE</small></span>
              <span class="amp-jewel" aria-hidden="true"></span>
              <button class="amp-pwr" type="button" aria-pressed="false" title="Power: plug in or unplug"><i></i><small>POWER</small></button>
            </div>
          </div>
          <div class="amp-cab" aria-hidden="true">
            <div class="amp-grille"><i class="amp-glow"></i><span class="amp-cones"><i></i><i></i><i></i><i></i></span><i class="amp-face"><i class="af-a"></i><i class="af-b"></i></i><span class="amp-lgw"><span class="amp-lg"></span></span><span class="amp-maker">CLAWD-O-TONE</span><i class="amp-stk"></i></div>
          </div>
          <i class="amp-feet" aria-hidden="true"></i>
        </div>
      </div>
      <button class="amps-nav next" type="button" data-d="1" aria-label="Next amp"><i></i></button>
    </div>
    <div class="amps-line">
      <div class="amps-tones" role="group" aria-label="Show amps"></div>
      <div class="amps-wall" role="radiogroup" aria-label="Pick an amp"></div>
    </div>`;
  const $ = (s) => root.querySelector(s);
  const amp = $('.amp'), wall = $('.amps-wall'), wrap = $('.amp-wrap'), jewel = $('.amp-jewel'), needle = $('.amp-vu-n'), grille = $('.amp-grille'), pwr = $('.amp-pwr');
  // the radio's tuning dial follows the gain
  const dial = () => amp.style.setProperty('--dial', (6 + 8.8 * (P.gain != null ? +P.gain : 5)).toFixed(1) + '%');
  // the knobs
  const knobs = {};
  for (const [k, label] of KNOBS) {
    const kn = plugKnob({ label, min: 0, max: 10, value: P[k] != null ? P[k] : 5, def: defaults[k] != null ? defaults[k] : 5, name: 'Amp', fmt: (v) => (+v).toFixed(1),
      onInput: (v) => { P[k] = v; if (k === 'gain') dial(); onChange(); } });
    kn.querySelector('.kn-l').dataset.picto = AMP_PICTO[k];
    knobs[k] = kn;
    $('.amp-knobs').appendChild(kn);
  }
  $('.amp-knobs').setAttribute('aria-label', 'Amp controls');
  // the tone filters
  const tones = {};
  for (const [t, label] of AMP_TONES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'amps-tone'; b.dataset.tone = t;
    b.innerHTML = `${ampEsc(label)} <small></small>`;
    b.addEventListener('click', () => setFilter(t));
    $('.amps-tones').appendChild(b); tones[t] = b;
  }
  const inFilter = (id) => filter === 'all' || ampInfo(id).tone === filter;
  const shownIds = () => ids().filter(inFilter);
  function setFilter(t) {
    filter = t; store.set(FILTER_KEY, t);
    paintWall();
    centre(true);
  }
  // the backline: every amp as a little one on the floor, its tone under its name
  const thumbs = {};
  const buildWall = () => {
    wall.textContent = '';
    for (const k in thumbs) delete thumbs[k];
    for (const id of ids()) {
      const a = ampInfo(id), b = document.createElement('button');
      b.type = 'button'; b.className = 'aw'; b.setAttribute('role', 'radio'); b.dataset.amp = id; b.dataset.tone = a.tone;
      b.setAttribute('aria-label', `${a.name}: ${a.blurb}`);
      if (a.nod) b.title = `In the spirit of ${a.nod}`;
      b.innerHTML = `<span class="aw-spot" aria-hidden="true"></span><span class="aw-n">${ampEsc(a.name)}</span><span class="aw-t" aria-hidden="true">${ampEsc(ampToneLabel(a.tone))}</span>`;
      b.insertBefore(ampMini(id), b.querySelector('.aw-n'));
      b.addEventListener('click', () => pick(id));
      wall.appendChild(b); thumbs[id] = b;
    }
    for (const [t] of AMP_TONES) tones[t].querySelector('small').textContent = t === 'all' ? ids().length : ids().filter((id) => ampInfo(id).tone === t).length;
  };
  // which are shown, which is checked, and which one Tab lands on (the picked one, else the first shown)
  function paintWall() {
    const list = ids(), shown = shownIds();
    for (const k of list) {
      const on = k === P.amp, t = thumbs[k];
      t.setAttribute('aria-checked', on); t.hidden = !inFilter(k);
      t.tabIndex = (shown.includes(P.amp) ? on : k === shown[0]) ? 0 : -1;
    }
    for (const [t] of AMP_TONES) tones[t].setAttribute('aria-pressed', t === filter);
    // (a phone's chips scroll sideways: keep the pressed one in view, Bass being last)
    const ts = $('.amps-tones'), tb = tones[filter];
    if (ts.scrollWidth > ts.clientWidth && tb) { const r = tb.getBoundingClientRect(), q = ts.getBoundingClientRect(); if (r.left < q.left || r.right > q.right) ts.scrollLeft += r.left - q.left - 8; }
    wall.classList.toggle('few', shown.length < 5);
  }
  wall.addEventListener('keydown', (e) => {
    // (from the picked amp; if the filter hides it, from the one that has focus)
    const list = shownIds(), f = e.target.closest('.aw'), i = list.includes(P.amp) ? list.indexOf(P.amp) : list.indexOf(f && f.dataset.amp);
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to == null || !list.length) return;
    e.preventDefault();
    const id = list[(to + list.length) % list.length];
    pick(id); thumbs[id].focus({ preventScroll: true });
  });
  // the board's chip: a little amp in the signal chain; a click goes to the big one
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'bd-amp';
  chip.innerHTML = '<small>AMP</small><b class="bd-amp-n"></b>';
  chip.insertBefore(ampMini(P.amp), chip.querySelector('.bd-amp-n'));
  chip.addEventListener('click', () => {
    wrap.scrollIntoView({ block: 'center', behavior: REDUCED ? 'auto' : 'smooth' });
    knobs.gain.querySelector('.kn-dial').focus({ preventScroll: true });
  });
  $('.amps-stage').addEventListener('click', (e) => { const b = e.target.closest('.amps-nav'); if (b) step(+b.dataset.d); });
  pwr.addEventListener('click', () => onPower());

  let shown = null;
  function draw(dir) {
    const id = P.amp, a = ampInfo(id), list = ids();
    ampPaint(amp, id);
    for (const el of root.querySelectorAll('.amp-lg')) el.textContent = a.name;
    $('.amps-name').textContent = a.name;
    $('.amps-blurb').textContent = a.blurb;
    $('.amps-nod').textContent = a.nod ? `In the spirit of ${a.nod}.` : '';
    if (list.length !== Object.keys(thumbs).length || list.some((k) => !thumbs[k])) buildWall();
    paintWall();
    ampMini.set(chip.querySelector('.am'), id);
    chip.querySelector('.bd-amp-n').textContent = a.name;
    chip.setAttribute('aria-label', `Amp: ${a.name}. Go to its controls`);
    for (const [k] of KNOBS) knobs[k].setValue(P[k] != null ? P[k] : 5);
    dial();
    if (dir && !REDUCED && shown !== id) {
      amp.classList.remove('swap-l', 'swap-r'); void amp.offsetWidth; amp.classList.add(dir > 0 ? 'swap-r' : 'swap-l');
    }
    if (shown !== id) centre(!!shown);
    shown = id;
    if (cab) cab.draw();
  }
  // keep the picked amp (else the start of what's shown) in view along the wall (scrolling the wall, not the page)
  function centre(smooth) {
    const w = wall, t = thumbs[P.amp] && !thumbs[P.amp].hidden ? thumbs[P.amp] : null;
    if (w.scrollWidth <= w.clientWidth) return;
    const left = t ? t.offsetLeft - (w.clientWidth - t.offsetWidth) / 2 : 0;
    w.scrollTo({ left, behavior: smooth && !REDUCED ? 'smooth' : 'auto' });
  }
  amp.addEventListener('animationend', () => amp.classList.remove('swap-l', 'swap-r'));
  function pick(id, dir) {
    if (!PLUG_AMPS[id]) return;
    const list = ids();
    if (dir == null) dir = Math.sign(list.indexOf(id) - list.indexOf(P.amp));
    if (id === P.amp) return draw();
    // a pick from outside the filter (a preset, prev/next) shows everything again, so the wall always shows the amp
    if (!inFilter(id)) { filter = 'all'; store.set(FILTER_KEY, filter); }
    P.amp = id; draw(dir); onChange();
  }
  // prev/next: along what's shown (when the amp is in it), else along them all
  function step(d) { const s = shownIds(), list = s.includes(P.amp) ? s : ids(), i = list.indexOf(P.amp); pick(list[(i + d + list.length) % list.length], d); }

  // liveness: the jewel and the chip's glow with the level, the VU needle, and the cones jump on big hits
  let on = false, lastNeedle = -1, kick = 0, env = 0;
  function power(x) {
    on = !!x;
    root.classList.toggle('on', on); chip.classList.toggle('on', on);
    pwr.setAttribute('aria-pressed', on); pwr.setAttribute('aria-label', on ? 'Power: on (unplug)' : 'Power: off (plug in)');
    if (!on) live(0, 0);
  }
  // lvl: 0-1 (the input's meter), pk: this frame's raw peak
  function live(lvl, pk) {
    jewel.style.setProperty('--lv', (on ? 0.35 + 0.65 * lvl : 0).toFixed(2));
    const a = Math.round((-48 + 96 * Math.min(1, lvl * 1.1)) * 2) / 2;
    if (a !== lastNeedle) { needle.style.transform = `rotate(${a}deg)`; lastNeedle = a; }
    if (REDUCED) return;
    if (pk > 0.04 && pk > env * 2.2) kick = 1;
    env = Math.max(pk, env * 0.9);
    const k = kick > 0.02 ? kick : 0;
    grille.style.setProperty('--kick', k.toFixed(3));
    kick *= 0.72;
  }
  // the cab and the mic (cabs.js), under the backline
  const cab = typeof plugCabUI === 'function' ? plugCabUI({ P, onChange }) : null;
  if (cab) root.appendChild(cab.root);
  draw();
  return { root, chip, draw, pick, step, power, live, knobs, cab, filter: setFilter, reveal: () => centre(false) };
}

const AMP_CSS = `
  .plug-h { margin: 0; font: 400 10px var(--f-px); letter-spacing: 0.08em; color: var(--faint); text-transform: uppercase; }
  .amps { display: grid; gap: 12px; min-width: 0; }
  .amps-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; }
  .amps-now { margin: 0; color: var(--dim); font-size: 14px; min-width: 0; }
  .amps-name { font: 400 22px/1 ${FONTS.dirt}; color: var(--paper); margin-right: 6px; }
  .amps-stage { display: grid; grid-template-columns: minmax(44px, 1fr) minmax(0, 760px) minmax(44px, 1fr); align-items: center; gap: 14px; }
  .amps-nav:first-child { justify-self: end; }
  .amps-nav { width: 44px; height: 88px; border: 1px solid var(--line2); background: var(--panel2); cursor: pointer; display: grid; place-items: center; padding: 0; }
  .amps-nav i { width: 12px; height: 12px; border: solid var(--paper); border-width: 0 0 3px 3px; transform: translateX(3px) rotate(45deg); }
  .amps-nav.next i { transform: translateX(-3px) rotate(-135deg); }
  .amps-nav:hover { border-color: var(--faint); background: var(--line); }
  .amps-nav:active i { transform: translateX(0) rotate(45deg); }
  .amps-nav.next:active i { transform: translateX(0) rotate(-135deg); }
  .amps-nav:focus-visible, .amp-wrap:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .amp-wrap { min-width: 0; display: grid; justify-items: center; outline: none; padding: 18px 0 4px;
    background: radial-gradient(ellipse 60% 22px at 50% calc(100% - 6px), #0009, transparent 70%); }

  /* the big amp */
  .amp { --kw: 46px; position: relative; width: 100%; display: grid; filter: drop-shadow(0 10px 14px #0008); }
  .amp.small { width: min(100%, 560px); }
  .amps-stage > .amps-nav.next { justify-self: start; }
  .amp-handle { position: absolute; left: 50%; top: -13px; width: 120px; height: 15px; margin-left: -60px; border-radius: 10px 10px 2px 2px;
    background: linear-gradient(#4a4550, #1d1b20 70%); box-shadow: inset 0 2px 0 #ffffff30, 0 0 0 1px #000a; }
  .amp-handle::before, .amp-handle::after { content: ''; position: absolute; bottom: -2px; width: 14px; height: 6px; border-radius: 2px; background: linear-gradient(#d8dce2, #7d828a); }
  .amp-handle::before { left: -8px; } .amp-handle::after { right: -8px; }
  .amp.small .amp-handle { width: 90px; margin-left: -45px; background: linear-gradient(#fff, #d9d9d9); }
  .amp-top, .amp-cab { position: relative; background: var(--tx); box-shadow: inset 0 0 0 1px #0007, inset 0 2px 0 #ffffff26, inset 0 -3px 0 #0005; }
  .amp-top { border-radius: var(--round) var(--round) 0 0; padding: 10px 12px 8px; }
  .amp-cab { border-radius: 0 0 var(--round) var(--round); padding: 8px 12px 12px; }
  .amp[data-form="head"] .amp-top { border-radius: var(--round); margin-bottom: 6px; padding: 10px 12px; }
  .amp[data-form="head"] .amp-cab { border-radius: var(--round); padding: 12px; }
  .amp-strip { display: none; }
  .amp[data-form="head"] .amp-strip { display: grid; place-items: center; height: 54px; margin-bottom: 8px; border-radius: 3px; background: var(--gr); box-shadow: 0 0 0 2px var(--pipe), inset 0 0 12px #000a; }
  /* the control panel */
  .amp-panel { position: relative; display: flex; align-items: center; gap: 10px 16px; padding: 12px 16px 10px; border-radius: 3px; color: var(--pn-ink);
    background: linear-gradient(90deg, #ffffff14, transparent 20% 80%, #ffffff10), var(--pn);
    box-shadow: inset 0 1px 0 var(--pn-edge), inset 0 -1px 0 #0006, 0 0 0 2px #0006; }
  .amp-knobs { flex: 1 1 auto; display: flex; justify-content: space-between; gap: 8px; min-width: 0; }
  .amp-jacks { display: grid; grid-template-columns: auto auto; gap: 4px 6px; justify-items: center; }
  .amp-jacks i { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle, #000 0 32%, #c9ccd2 36% 60%, #6b6f76 64%); box-shadow: 0 1px 0 #0008; }
  .amp-jacks small, .amp-vu small, .amp-pwr small { grid-column: span 2; font: 400 6px/1 var(--f-px); letter-spacing: 0.1em; }
  .amp-vu { display: grid; justify-items: center; gap: 3px; }
  .amp-vu-face { position: relative; width: 50px; height: 30px; overflow: hidden; border-radius: 3px 3px 2px 2px;
    background: radial-gradient(circle at 50% 110%, transparent 0 18px, #d8413566 18px 19px, transparent 19px) , repeating-conic-gradient(from -52deg at 50% 110%, #2a2014 0 1.2deg, transparent 1.2deg 10deg) , radial-gradient(circle at 50% 110%, transparent 0 22px, #f5ecd2 22px),
      linear-gradient(#fbf3dd, #e7d8ae);
    box-shadow: inset 0 0 0 2px #0008, inset 0 3px 6px #0006; }
  .amps.on .amp-vu-face { background-color: #fff3c9; box-shadow: inset 0 0 0 2px #0008, inset 0 3px 6px #0006, inset 0 0 14px #ffc85a66; }
  .amp-vu-n { position: absolute; left: 50%; bottom: -3px; width: 1.5px; height: 30px; margin-left: -0.75px; background: #1a1210; transform-origin: 50% 100%; transform: rotate(-48deg); transition: transform 0.06s linear; }
  .amp-jewel { --lv: 0; width: 22px; height: 22px; border-radius: 50%; flex: 0 0 auto;
    background: radial-gradient(circle at 38% 32%, #fff9 0 12%, transparent 30%), conic-gradient(from 0deg, #0000 0 12.5%, #fff2 0 25%, #0000 0 37.5%, #fff2 0 50%, #0000 0 62.5%, #fff2 0 75%, #0000 0 87.5%, #fff2 0), radial-gradient(circle, var(--jw), color-mix(in srgb, var(--jw) 40%, #000) 75%);
    box-shadow: 0 0 0 3px #b9bdc4, 0 0 0 4px #0008, 0 0 calc(4px + 18px * var(--lv)) calc(2px * var(--lv)) color-mix(in srgb, var(--jw) calc(100% * var(--lv)), transparent);
    filter: brightness(calc(0.45 + 0.75 * var(--lv))) saturate(calc(0.5 + 0.6 * var(--lv))); }
  .amp-pwr { display: grid; justify-items: center; gap: 4px; padding: 2px 4px; min-width: 36px; min-height: 44px; background: none; border: 0; color: inherit; cursor: pointer; }
  .amp-pwr i { position: relative; width: 16px; height: 26px; border-radius: 3px; background: linear-gradient(#0b0b0c, #26262a); box-shadow: 0 0 0 2px #0009, inset 0 0 0 1px #ffffff1a; }
  .amp-pwr i::after { content: ''; position: absolute; left: 3px; right: 3px; top: 3px; height: 11px; border-radius: 2px; background: linear-gradient(#dcdcdc, #7a7a80); transition: top 0.08s; }
  .amp-pwr[aria-pressed="true"] i::after { top: 12px; background: linear-gradient(#7a7a80, #dcdcdc); }
  .amp-pwr:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  /* the grille */
  .amp-grille { --kick: 0; position: relative; height: 220px; overflow: hidden; border-radius: 3px; background: var(--gr); box-shadow: 0 0 0 3px var(--pipe), 0 0 0 5px #0006, inset 0 0 26px #000c; }
  .amp.small .amp-grille { height: 170px; border-radius: 12px; box-shadow: 0 0 0 4px var(--pipe), inset 0 0 18px #0006; }
  .amp[data-form="head"] .amp-grille { height: 250px; }
  .amp-glow { position: absolute; inset: 0; background: radial-gradient(ellipse 60% 70% at 50% 60%, #ffb35a, transparent 70%); mix-blend-mode: soft-light; opacity: 0; transition: opacity 0.6s; }
  .amps.on .amp-glow { opacity: 0.3; }
  .amp-cones { position: absolute; inset: 14px 18px; display: grid; grid-template-columns: repeat(2, 1fr); grid-template-rows: 100%; place-items: center; pointer-events: none; }
  .amp-cones i { height: min(180px, 96%); max-width: 100%; aspect-ratio: 1; border-radius: 50%; mix-blend-mode: multiply; opacity: 0.55;
    background: radial-gradient(circle, #0009 0 9%, transparent 11% 30%, #0004 32%, transparent 45% 62%, #0006 66% 70%, transparent 72%);
    transform: scale(calc(1 + 0.045 * var(--kick))); }
  .gr-light .amp-cones i { opacity: 0.45; }
  .amp[data-cones="1"] .amp-cones { grid-template-columns: 1fr; }
  .amp[data-cones="1"] .amp-cones i:nth-child(n+2), .amp[data-cones="2"] .amp-cones i:nth-child(n+3) { display: none; }
  .amp[data-cones="4"] .amp-cones { grid-template-rows: repeat(2, 50%); }
  .amp[data-cones="4"] .amp-cones i { height: min(104px, 94%); }
  /* eight cones (the bass fridge): a grid of them as one background, four across and two high */
  .amp[data-cones="8"] .amp-cones { inset: 10px 14px; mix-blend-mode: multiply; opacity: 0.9; transform: scale(calc(1 + 0.03 * var(--kick)));
    background: radial-gradient(circle closest-side, #0009 0 9%, transparent 11% 30%, #0004 32%, transparent 45% 62%, #0006 66% 70%, transparent 72%) 0 0/25% 50%; }
  .amp[data-cones="8"] .amp-cones i { display: none; }
  .amp-lgw { display: inline-block; transform: rotate(var(--lg-tilt)); padding: 0.08em 0.3em 0.14em; font-size: 44px; }
  .amp-lg { display: block; font: var(--lg-style) var(--lg-w) calc(1em * var(--lg-size))/1.05 var(--lg-f); font-stretch: var(--lg-st); letter-spacing: var(--lg-track); white-space: nowrap;
    background: var(--lg-c); -webkit-background-clip: text; background-clip: text; color: transparent; padding: 0 0.06em; }
  .amp:not(.lg-plated) .amp-lgw { filter: drop-shadow(0 2px 0 #0009) drop-shadow(0 0 8px var(--lg-glow)); }
  .lg-plated .amp-lgw { background: var(--lg-plate); box-shadow: 0 2px 0 #0009, inset 0 1px 0 #ffffff33; border-radius: 3px; }
  .amp-grille > .amp-lgw { position: absolute; left: 22px; top: 18px; transform-origin: 0 50%; }
  .amp[data-form="head"] .amp-grille > .amp-lgw { display: none; }
  .amp[data-form="head"] .amp-strip .amp-lgw { font-size: 34px; }
  .amp-maker { position: absolute; right: 12px; bottom: 9px; font: 400 7px var(--f-px); letter-spacing: 0.14em; color: #fff9; mix-blend-mode: overlay; }
  .gr-light .amp-maker { color: #000a; }
  .lg-tape .amp-lgw { border-radius: 1px; clip-path: polygon(0 6%, 3% 0, 97% 4%, 100% 0, 99% 94%, 96% 100%, 4% 96%, 1% 100%); box-shadow: none; }
  .lg-pill .amp-lgw { border-radius: 999px; padding: 0.3em 0.8em; }
  .amp[data-look="plexi"] .amp-strip, .amp[data-look="recto"] .amp-strip { box-shadow: 0 0 0 2px var(--pipe), 0 0 0 4px #0005, inset 0 0 12px #000a; }
  .amp[data-look="recto"] .amp-cab { box-shadow: inset 0 0 0 1px #0007, inset 0 2px 0 #fff6, inset 0 -3px 0 #0005; }
  .amp[data-look="recto"] .amp-grille { box-shadow: 0 0 0 2px #1a1b1e, 0 0 0 4px #c3c8cf, inset 0 0 20px #000; }
  /* Clawd's amp gets a sticker */
  .amp-stk { display: none; }
  .sticker .amp-stk { display: grid; place-items: center; position: absolute; right: 26px; top: 22px; width: 58px; height: 58px; border-radius: 50%; transform: rotate(14deg);
    background: radial-gradient(circle, var(--r) 0 62%, #f3ead6 64%); box-shadow: 0 2px 3px #0008; }
  .sticker .amp-stk::before { content: 'NO'; font: 400 11px/1 var(--f-px); color: var(--ink); }
  .sticker .amp-stk::after { content: 'SLEEP'; position: absolute; top: 33px; font: 400 8px/1 var(--f-px); color: var(--ink); }
  .amp-feet { display: none; }
  .amp.small .amp-feet { display: block; height: 7px; margin: 0 16%; background: radial-gradient(ellipse at 10% 0, #333 0 38%, transparent 42%), radial-gradient(ellipse at 90% 0, #333 0 38%, transparent 42%); }
  /* a switch feels like rolling the next amp in */
  @keyframes amp-in-r { from { transform: translateX(34px) rotate(0.8deg); opacity: 0.2; } 70% { transform: translateX(-3px); opacity: 1; } to { transform: none; } }
  @keyframes amp-in-l { from { transform: translateX(-34px) rotate(-0.8deg); opacity: 0.2; } 70% { transform: translateX(3px); opacity: 1; } to { transform: none; } }
  .amp.swap-r { animation: amp-in-r 0.2s cubic-bezier(.2,.8,.3,1.2); }
  .amp.swap-l { animation: amp-in-l 0.2s cubic-bezier(.2,.8,.3,1.2); }

  /* the amp's knobs, by style (the pedals' knob, bigger and dressed up) */
  .amp .kn { --ks: var(--kw); width: calc(var(--kw) + 14px); gap: 5px; }
  .amp .kn-l { order: -1; font-size: 7px; color: var(--pn-ink); }
  .amp .kn-v { display: none; }
  .amp .kn-dial { position: relative; }
  .amp .kn-dial::before { content: ''; position: absolute; inset: -5px; border-radius: 50%; pointer-events: none;
    background: repeating-conic-gradient(from -135deg, currentColor 0 1.6deg, transparent 1.6deg 27deg);
    -webkit-mask: radial-gradient(circle, transparent 0 calc(50% - 3px), #000 calc(50% - 2.5px)), conic-gradient(from -137deg, #000 0 274deg, transparent 0);
    -webkit-mask-composite: source-in; mask-composite: intersect; opacity: 0.55; }
  .amp[data-knob="skirt"] .kn-dial { background: radial-gradient(circle at 50% 50%, #1c1c1f 0 50%, #5f636a 52%, #e2e5ea 58%, #a4a9b0 66%, #50545b 72%, #1b1b1d 74%); }
  .amp[data-knob="skirt"] .kn-cap i { top: 2px; height: 42%; width: 2px; margin-left: -1px; background: #fff; }
  .amp[data-knob="chicken"] .kn-dial, .amp[data-knob="bone"] .kn-dial { background: radial-gradient(circle, #19171b 0 42%, #0000 44%); box-shadow: none; }
  .amp[data-knob="chicken"] .kn-cap::before, .amp[data-knob="bone"] .kn-cap::before { content: ''; position: absolute; left: 30%; right: 30%; top: 0; bottom: 6%;
    clip-path: polygon(50% 0, 88% 58%, 100% 82%, 86% 100%, 14% 100%, 0 82%, 12% 58%); background: linear-gradient(90deg, #2c2a2e, #0e0d10 60%); filter: drop-shadow(0 2px 0 #000); }
  .amp[data-knob="bone"] .kn-cap::before { background: linear-gradient(90deg, #fbf4e2, #d4c9ae 70%); }
  .amp[data-knob="chicken"]:not(.knob-dark) .kn-cap::before { background: linear-gradient(90deg, #fff3de, #cbbd9d 70%); }
  .amp[data-knob="chicken"] .kn-cap i, .amp[data-knob="bone"] .kn-cap i { top: 4px; height: 36%; width: 2px; margin-left: -1px; background: #1a1210; }
  .amp.knob-dark[data-knob="chicken"] .kn-cap i { background: #fff; }
  .amp[data-knob="gold"] .kn-dial { background: radial-gradient(circle at 42% 34%, #fff6cf, #e3bd55 34%, #a57d1d 64%, #2b2008 70%, #0d0b07 76%); box-shadow: 0 2px 0 #0009; }
  .amp[data-knob="gold"] .kn-cap i { top: 3px; height: 34%; width: 3px; margin-left: -1.5px; background: #1a1206; }
  .amp[data-knob="knurl"] .kn-dial { background: radial-gradient(circle at 45% 35%, #4d5057, #1a1b1e 62%, #0000 64%), repeating-conic-gradient(#0a0a0b 0 5deg, #3a3c42 5deg 10deg); box-shadow: 0 2px 0 #000, 0 0 0 1px #000; }
  .amp[data-knob="knurl"] .kn-cap i { top: 7px; height: 26%; background: #ff3b3b; box-shadow: 0 0 4px #ff3b3b; }
  .amp[data-knob="toy"] .kn-dial { background: radial-gradient(circle at 40% 30%, #fff 0 8%, #ffe56b 30%, #f5b700 70%); box-shadow: 0 3px 0 #b38400, 0 0 0 2px #fff; }
  .amp[data-knob="toy"] .kn:nth-child(3n+2) .kn-dial { background: radial-gradient(circle at 40% 30%, #fff 0 8%, #7fd3ff 30%, #2b95e8 70%); box-shadow: 0 3px 0 #1b64a3, 0 0 0 2px #fff; }
  .amp[data-knob="toy"] .kn:nth-child(3n) .kn-dial { background: radial-gradient(circle at 40% 30%, #fff 0 8%, #c9a0ff 30%, #8a4ef0 70%); box-shadow: 0 3px 0 #5a2ba8, 0 0 0 2px #fff; }
  .amp[data-knob="toy"] .kn-cap i { top: 5px; width: 7px; height: 7px; margin-left: -3.5px; border-radius: 50%; background: #10302a; box-shadow: 0 0 0 2px #fff; }
  .amp[data-knob="toy"] .kn-dial::before { display: none; }

  /* the backline: tone filters, then every amp on a stage floor; the picked one lifts into a spotlight */
  .amps-line { display: grid; gap: 8px; min-width: 0; }
  .amps-tones { display: flex; flex-wrap: wrap; gap: 6px; }
  .amps-tone { min-height: 32px; padding: 0 12px; border: 1px solid var(--line2); border-radius: 999px; background: var(--panel2); color: var(--dim); cursor: pointer;
    font: 400 9px/1 var(--f-px); letter-spacing: 0.08em; text-transform: uppercase; display: inline-flex; align-items: center; gap: 6px; }
  .amps-tone small { font: inherit; color: var(--faint); }
  .amps-tone:hover { border-color: var(--faint); color: var(--paper); }
  .amps-tone[aria-pressed="true"] { background: var(--r); border-color: var(--r); color: var(--ink); }
  .amps-tone[aria-pressed="true"] small { color: #17151a99; }
  .amps-tone:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
  .amps-wall { position: relative; display: flex; align-items: flex-end; gap: 2px; overflow-x: auto; overscroll-behavior-x: contain; padding: 22px 14px 0; scroll-snap-type: x proximity; scroll-padding: 0 14px; scrollbar-width: thin;
    scrollbar-color: var(--line2) transparent; border: 1px solid var(--line); border-radius: 4px;
    background: linear-gradient(#0000 0 calc(100% - 26px), #2a2320 calc(100% - 26px), #1a1512 calc(100% - 2px), #0008 calc(100% - 2px)),
      repeating-linear-gradient(90deg, #0000 0 64px, #0000002e 64px 66px) 0 100%/100% 26px no-repeat,
      radial-gradient(ellipse 80% 60% at 50% 0, #ffffff08, transparent 70%), repeating-linear-gradient(90deg, #1b181f 0 38px, #17151b 38px 40px); }
  .amps-wall.few { justify-content: safe center; }
  .aw { position: relative; flex: 0 0 116px; scroll-snap-align: center; display: grid; justify-items: center; align-content: end; gap: 3px; padding: 0 4px 5px; min-height: 150px; text-align: center; cursor: pointer;
    background: none; border: 0; border-radius: 4px 4px 0 0; color: var(--paper); font: inherit; }
  .aw[hidden] { display: none; }
  .aw-spot { position: absolute; inset: -22px 0 0; pointer-events: none; opacity: 0; transition: opacity 0.2s;
    background: radial-gradient(ellipse 50% 14px at 50% calc(100% - 13px), #ffd9a066, transparent 70%), linear-gradient(#ffe7b800, #ffe7b81c 60%, #ffe7b800) 50% 0/64% 100% no-repeat;
    clip-path: polygon(34% 0, 66% 0, 100% 100%, 0 100%); }
  .aw[aria-checked="true"] .aw-spot { opacity: 1; }
  .aw .am { width: 88px; margin-bottom: 4px; transition: transform 0.16s cubic-bezier(.2,.8,.3,1.3), filter 0.16s; }
  .aw:hover .am { transform: translateY(-3px); }
  .aw[aria-checked="true"] .am { transform: translateY(-8px) scale(1.06); filter: drop-shadow(0 10px 6px #000a) brightness(1.08); }
  .aw[aria-checked="true"] .am-jw { background: var(--jw); box-shadow: 0 0 6px 2px var(--jw); }
  .aw:not([aria-checked="true"]) .am { filter: drop-shadow(0 3px 3px #0008) brightness(0.8) saturate(0.85); }
  .aw:not([aria-checked="true"]):hover .am { filter: drop-shadow(0 3px 3px #0008); }
  .aw-n { font: 400 14px/1.05 ${FONTS.dirt}; white-space: nowrap; }
  .aw[aria-checked="true"] .aw-n { color: var(--focus); }
  .aw-t { font: 400 7px/1 var(--f-px); letter-spacing: 0.1em; text-transform: uppercase; color: var(--faint); padding-bottom: 3px; }
  .aw[data-tone="clean"] .aw-t { color: #7fc9e8; } .aw[data-tone="crunch"] .aw-t { color: #f0a830; } .aw[data-tone="high"] .aw-t { color: #ff6b57; } .aw[data-tone="weird"] .aw-t { color: #c89bff; } .aw[data-tone="bass"] .aw-t { color: #6fa8ff; }
  .aw:focus-visible { outline: 3px solid var(--focus); outline-offset: -3px; }
  .amps-nod { display: block; margin-top: 3px; font-size: 12px; font-style: italic; color: var(--faint); }
  @media (prefers-reduced-motion: reduce) { .aw .am, .aw-spot { transition: none; } }
  /* a little amp */
  .am { position: relative; display: grid; container-type: inline-size; font-style: normal; filter: drop-shadow(0 3px 3px #0008); }
  .am i { display: block; font-style: normal; }
  .am-top { position: relative; background: var(--tx); border-radius: 4px 4px 0 0; padding: 3px 4px 2px; box-shadow: inset 0 0 0 1px #0007; }
  .am .am-pn { display: flex; justify-content: space-evenly; align-items: center; height: 11px; border-radius: 1px; background: var(--pn); box-shadow: inset 0 1px 0 var(--pn-edge); }
  .am .am-pn i { width: 5px; height: 5px; border-radius: 50%; background: #111; box-shadow: 0 0 0 1px #fff4; }
  .am[data-knob="gold"] .am-pn i { background: #e3bd55; }
  .am[data-knob="toy"] .am-pn i { background: #ffd23f; }
  .am[data-knob="bone"] .am-pn i, .am[data-knob="chicken"]:not(.knob-dark) .am-pn i { background: #efe6d0; }
  .am-pn .am-jw { width: 4px; height: 4px; background: color-mix(in srgb, var(--jw) 45%, #000); box-shadow: none; }
  .on .am-jw { background: var(--jw); box-shadow: 0 0 5px 1px var(--jw); }
  .am-cab { background: var(--tx); border-radius: 0 0 4px 4px; padding: 2px 4px 4px; box-shadow: inset 0 0 0 1px #0007; }
  .am-gr { position: relative; height: 48px; border-radius: 1px; background: var(--gr); box-shadow: 0 0 0 1.5px var(--pipe), inset 0 0 8px #000a; overflow: hidden; }
  .am .am-lgw { position: absolute; left: 4px; top: 5px; max-width: calc(100% - 6px); overflow: hidden; padding: 1px 3px; transform: rotate(var(--lg-tilt)); transform-origin: 0 50%; }
  .am.lg-plated .am-lgw { background: var(--lg-plate); border-radius: 2px; }
  .am.lg-pill .am-lgw { border-radius: 9px; padding: 2px 5px; }
  .am-lg { display: block; font: var(--lg-style) var(--lg-w) calc(10.5cqw * var(--lg-size))/1.05 var(--lg-f); font-stretch: var(--lg-st); white-space: nowrap;
    background: var(--lg-c); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .am[data-form="head"] .am-top { border-radius: 4px; margin-bottom: 2px; }
  .am[data-form="head"] .am-top::before { content: ''; display: block; height: 9px; margin-bottom: 2px; background: var(--gr); box-shadow: 0 0 0 1px var(--pipe); }
  .am[data-form="head"] .am-cab { border-radius: 4px; }
  .am.small { width: 76px !important; margin-top: 12px; }
  .am.small .am-top { border-radius: 9px 9px 0 0; }
  .am.small .am-cab { border-radius: 0 0 9px 9px; }
  .am.small .am-gr { height: 36px; border-radius: 6px; }

  /* round two's extras: a second tolex for the cab (two-tone), a badge, pictures for knob words, and whole faces */
  .amp .amp-cab { background: var(--tx2); }
  .amp[data-cones="0"] .amp-cones { display: none; }
  .amp-grille::after { content: var(--badge); position: absolute; left: 22px; bottom: 12px; padding: 3px 6px; border: 1px solid #ffffff55; border-radius: 2px; font: 400 7px/1 var(--f-px); letter-spacing: 0.16em; color: #ffffffcc; }
  .amp.picto .kn-l { font-size: 0; height: 16px; display: grid; place-items: end center; }
  .amp.picto .kn-l::after { content: attr(data-picto); font: 700 15px/1 var(--f-ui); }
  .amp.picto .kn:nth-child(2) .kn-l::after { font-size: 22px; } .amp.picto .kn:nth-child(4) .kn-l::after { font-size: 11px; }
  .amp-face { display: none; }
  .amp[data-face="radio"] .amp-face, .amp[data-face="lcd"] .amp-face, .amp[data-face="tape"] .amp-face, .amp[data-face="lure"] .amp-face, .amp[data-face="di"] .amp-face { display: block; }
  /* Straight Wire: a DI box's face, its jacks along a black strip (the logo sits on its plate above) */
  .amp[data-face="di"] .amp-face { position: absolute; left: 50%; bottom: 16px; width: min(320px, 72%); height: 58px; transform: translateX(-50%); border-radius: 5px;
    background: linear-gradient(#17191e, #0b0c0f); box-shadow: 0 0 0 2px #0d1a36, inset 0 1px 0 #ffffff1a; }
  .amp[data-face="di"] .amp-face::before { content: 'INPUT  ·  THRU  ·  PAD  ·  GND LIFT  ·  XLR OUT'; position: absolute; left: 0; right: 0; top: 6px; text-align: center; white-space: nowrap; overflow: hidden;
    font: 400 7px/1 var(--f-px); letter-spacing: 0.08em; color: #9fb4e8; }
  .amp[data-face="di"] .af-a, .amp[data-face="di"] .af-b { position: absolute; bottom: 8px; width: 26px; height: 26px; border-radius: 50%;
    background: radial-gradient(circle, #000 0 26%, #3a3d44 30% 52%, #c9ced6 56% 66%, #5b5f67 70%); box-shadow: 0 1px 0 #000; }
  .amp[data-face="di"] .af-a { left: 14%; } .amp[data-face="di"] .af-b { right: 14%; }
  .amp[data-face="di"] .amp-grille > .amp-lgw { top: 18px; }
  .am[data-face="di"] .am-face { display: block; position: absolute; left: 20%; right: 20%; bottom: 3px; height: 8px; border-radius: 2px; background: #0b0c0f; }
  /* Abyss: an anglerfish's lure on its stalk, glowing brighter while you play */
  .amp[data-face="lure"] .amp-face { position: absolute; right: 12%; top: 10px; width: 120px; height: 96px; pointer-events: none; }
  .amp[data-face="lure"] .af-b { position: absolute; right: 18px; top: 16px; width: 90px; height: 150px; border: 3px solid #1d3a48; border-color: #1d3a48 #1d3a48 transparent transparent; border-radius: 0 90px 0 0; }
  .amp[data-face="lure"] .af-a { position: absolute; left: 0; top: 4px; width: 22px; height: 22px; border-radius: 50%; background: radial-gradient(circle at 40% 35%, #fff 0 18%, #7df9ff 45%, #1aa6c4 75%); box-shadow: 0 0 12px 4px #2de2ff88, 0 0 40px 10px #2de2ff33; opacity: 0.55; transition: opacity 0.4s; }
  .amps.on .amp[data-face="lure"] .af-a { opacity: 1; }
  @media (prefers-reduced-motion: no-preference) { .amps.on .amp[data-face="lure"] .af-a { animation: amp-lure 2.6s ease-in-out infinite; } }
  @keyframes amp-lure { 50% { box-shadow: 0 0 18px 7px #2de2ffaa, 0 0 60px 18px #2de2ff44; transform: translateY(3px); } }
  /* the radio: a lit tuning dial across the slats (its needle is the gain), the name down in the corner */
  .amp[data-face="radio"] .amp-face { position: absolute; left: 34%; right: 7%; top: 16px; height: 42px; border-radius: 6px;
    background: repeating-linear-gradient(90deg, #3a2a14 0 1px, transparent 1px 6.25%) 0 100%/100% 9px no-repeat, linear-gradient(#fff6dc, #ecdcae);
    box-shadow: 0 0 0 3px #d9c79a, 0 0 0 4px #0006, inset 0 2px 6px #0004; transition: box-shadow 0.4s; }
  .amps.on .amp[data-face="radio"] .amp-face { box-shadow: 0 0 0 3px #d9c79a, 0 0 0 4px #0006, inset 0 0 22px #ffb02e99, 0 0 16px #ffb02e55; }
  .amp[data-face="radio"] .amp-face::before { content: '53 · 60 · 70 · 80 · 100 · 130 · 160'; position: absolute; left: 8px; right: 8px; top: 8px; font: 400 8px/1 var(--f-px); color: #3a2a14; text-align: center; white-space: nowrap; overflow: hidden; }
  .amp[data-face="radio"] .af-a { position: absolute; top: 4px; bottom: 3px; left: var(--dial, 50%); width: 2px; margin-left: -1px; background: #c0281b; box-shadow: 0 0 4px #ff5a3a; transition: left 0.15s; }
  .amp[data-face="radio"] .amp-grille > .amp-lgw { top: auto; bottom: 14px; }
  /* the console: the name in a green LCD in a dark bezel, a d-pad and two buttons, speaker slots in the corner */
  .amp[data-face="lcd"] .amp-grille { background: repeating-linear-gradient(-60deg, transparent 0 6px, #5a556c 6px 9px) calc(100% - 16px) calc(100% - 14px)/26% 44% no-repeat, linear-gradient(#c3bfcc, #a9a4b4); }
  .amp[data-face="lcd"] .amp-grille > .amp-lgw { left: 50%; top: 22px; transform: translateX(-50%); padding: 0.45em 0.9em; border-radius: 3px; box-shadow: 0 0 0 10px #5d5a6e, 0 0 0 11px #0004, inset 0 0 14px #0f380f55; }
  .amp[data-face="lcd"] .amp-grille > .amp-lgw::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: repeating-linear-gradient(0deg, #0f380f18 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, #0f380f18 0 1px, transparent 1px 3px); }
  .amp[data-face="lcd"] .af-a { position: absolute; left: 9%; bottom: 18px; width: 52px; height: 52px; filter: drop-shadow(0 2px 0 #0007);
    background: linear-gradient(#2b2833, #2b2833) 50% 0/17px 100% no-repeat, linear-gradient(#2b2833, #2b2833) 0 50%/100% 17px no-repeat; }
  .amp[data-face="lcd"] .af-b { position: absolute; left: 38%; bottom: 30px; width: 24px; height: 24px; border-radius: 50%;
    background: radial-gradient(circle at 40% 35%, #e0578e, #9e1f52 70%); box-shadow: 34px -12px 0 #a3245a, 0 2px 0 #0006, 34px -10px 0 #0006; }
  .amp[data-face="lcd"] .amp-maker { color: #2a256099; mix-blend-mode: normal; }
  /* the four-track: speakers either side of a cassette; its reels turn while you're plugged in */
  .amp[data-face="tape"] .amp-cones { grid-template-columns: 1fr 1.25fr 1fr; }
  .amp[data-face="tape"] .amp-cones i { height: min(150px, 82%); }
  .amp[data-face="tape"] .amp-cones i:nth-child(2) { grid-column: 3; }
  .amp[data-face="tape"] .amp-face { position: absolute; left: 50%; top: 56%; width: min(210px, 34%); aspect-ratio: 1.58; transform: translate(-50%, -50%); border-radius: 7px;
    background: linear-gradient(#35353b, #1b1b20); box-shadow: 0 0 0 3px #111, 0 0 0 5px #9ea3ab, 0 6px 10px #000a, inset 0 1px 0 #ffffff22; }
  .amp[data-face="tape"] .amp-face::before { content: 'SIDE A    C-60'; position: absolute; left: 7%; right: 7%; top: 8%; height: 58%; box-sizing: border-box; padding: 6% 6% 0; border-radius: 4px; white-space: nowrap; overflow: hidden;
    background: linear-gradient(#f5ecd6 0 26%, #ff7a59 26% 31%, #ffc371 31% 36%, #f5ecd6 36%); font: 400 7px/1 var(--f-px); letter-spacing: 0.08em; color: #3a2a14; }
  .amp[data-face="tape"] .amp-face::after { content: ''; position: absolute; left: 22%; right: 22%; top: 40%; height: 22%; border-radius: 999px; background: #20170fdd; box-shadow: inset 0 0 0 1px #000a, inset 0 2px 4px #000a; }
  .amp[data-face="tape"] .af-a, .amp[data-face="tape"] .af-b { position: absolute; z-index: 1; top: 41.5%; width: 12%; aspect-ratio: 1; border-radius: 50%;
    background: radial-gradient(circle, #f5ecd6 0 26%, transparent 29%), repeating-conic-gradient(#f5ecd6 0 14deg, transparent 14deg 60deg), radial-gradient(circle, #5b3d24 0 60%, #2b1c10 62%); }
  .amp[data-face="tape"] .af-a { left: 27%; } .amp[data-face="tape"] .af-b { right: 27%; }
  @keyframes amp-reel { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: no-preference) { .amps.on .amp[data-face="tape"] .af-a, .amps.on .amp[data-face="tape"] .af-b { animation: amp-reel 1.8s linear infinite; } }
  .amps.on .amp[data-face="tape"] .af-b { animation-duration: 2.3s; }
  /* the new knobs: flat 80s caps, chrome domes, ridged bakelite, square console buttons */
  .amp[data-knob="flat"] .kn-dial { background: radial-gradient(circle, #2e2e32 0 56%, #0d0d0f 59% 66%, #74767c 69%, #1a1a1c 74%); box-shadow: 0 2px 0 #000a; }
  .amp[data-knob="flat"] .kn-cap i { top: 3px; height: 38%; width: 2px; margin-left: -1px; background: #f2f2f2; }
  .amp[data-knob="chrome"] .kn-dial { background: radial-gradient(circle at 40% 32%, #ffffff, #d5d9df 26%, #7d838c 58%, #2a2c30 66%, #0e0e10 72%); box-shadow: 0 2px 0 #000a; }
  .amp[data-knob="chrome"] .kn-cap i { top: 2px; height: 30%; width: 2px; margin-left: -1px; background: #111; }
  .amp[data-knob="bakelite"] .kn-dial { background: radial-gradient(circle at 42% 35%, #fffaf0 0 20%, #efe4c8 44%, transparent 46%), repeating-conic-gradient(#f3ead2 0 7deg, #c9ba94 7deg 14deg); box-shadow: 0 2px 0 #6b5a3a, 0 0 0 1px #8a7a58; }
  .amp[data-knob="bakelite"] .kn-cap i { top: 2px; height: 30%; width: 3px; margin-left: -1.5px; background: #8a2414; }
  .amp[data-knob="pixel"] .kn-dial { border-radius: 7px; background: linear-gradient(#5a5474, #3b3653); box-shadow: 0 3px 0 #29253b, inset 0 1px 0 #ffffff33; }
  .amp[data-knob="pixel"] .kn-cap i { top: 4px; width: 4px; height: 8px; margin-left: -2px; border-radius: 0; background: #c9e36b; }
  .amp[data-knob="pixel"] .kn-dial::before { display: none; }
  /* ...and on the little ones */
  .am .am-cab { background: var(--tx2); }
  .am[data-knob="chrome"] .am-pn i { background: #d5d9df; } .am[data-knob="bakelite"] .am-pn i { background: #efe4c8; } .am[data-knob="pixel"] .am-pn i { border-radius: 1px; background: #3b3653; }
  .am .am-face { display: none; }
  .am[data-face="radio"] .am-face { display: block; position: absolute; left: 34%; right: 7%; top: 5px; height: 9px; border-radius: 2px; background: linear-gradient(#fff6dc, #ecdcae); box-shadow: 0 0 0 1px #d9c79a; }
  .am[data-face="radio"] .am-face i:first-child { position: absolute; left: 58%; top: 1px; bottom: 1px; width: 1px; background: #c0281b; }
  .am[data-face="radio"] .am-lgw { top: auto; bottom: 3px; }
  .am[data-face="lcd"] .am-gr { background: repeating-linear-gradient(-60deg, transparent 0 3px, #5a556c 3px 4.5px) calc(100% - 4px) calc(100% - 3px)/26% 40% no-repeat, linear-gradient(#c3bfcc, #a9a4b4); }
  .am[data-face="lcd"] .am-lgw { left: 50%; top: 7px; transform: translateX(-50%); box-shadow: 0 0 0 3px #5d5a6e; }
  .am[data-face="tape"] .am-face { display: block; position: absolute; left: 50%; top: 56%; width: 40%; aspect-ratio: 1.58; transform: translate(-50%, -50%); border-radius: 2px; background: #2a2a30; box-shadow: 0 0 0 1px #9ea3ab; }
  .am[data-face="tape"] .am-face i { position: absolute; top: 40%; width: 22%; aspect-ratio: 1; border-radius: 50%; background: radial-gradient(circle, #f5ecd6 0 30%, #5b3d24 34%); }
  .am[data-face="tape"] .am-face i:first-child { left: 18%; } .am[data-face="tape"] .am-face i:last-child { right: 18%; }
  /* the amp's chip on the pedalboard */
  .bd-amp { flex: 0 0 auto; width: 122px; min-height: 196px; display: grid; align-content: end; justify-items: center; gap: 7px; padding: 10px 6px 14px; text-align: center;
    border-radius: 8px; color: var(--paper); cursor: pointer; font: inherit; border: 0; background: radial-gradient(ellipse 70% 40% at 50% 30%, #ffffff12, transparent 70%); }
  .bd-amp small { order: 3; }
  .bd-amp .am { width: 100px; transition: transform 0.12s; }
  .bd-amp:hover .am { transform: translateY(-2px); }
  .bd-amp .bd-amp-n { font: 400 17px/1 ${FONTS.dirt}; }
  .bd-amp small { font: 400 7px var(--f-px); letter-spacing: 0.12em; color: var(--dim); }
  .bd-amp:hover .bd-amp-n { color: var(--focus); }
  .bd-amp:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }

  @media (max-width: 700px) {
    .amps-stage { grid-template-columns: 1fr 1fr; }
    .amp-wrap { grid-column: 1 / -1; grid-row: 1; }
    .amps-stage > .amps-nav, .amps-stage > .amps-nav.next { width: auto; height: 44px; justify-self: stretch; }
    .amp { --kw: 40px; }
    .amp-panel { flex-wrap: wrap; justify-content: center; padding: 10px 8px 8px; gap: 10px 14px; }
    .amp-knobs { flex: 1 1 100%; order: -1; gap: 2px; }
    .amp .kn { width: auto; flex: 1 1 0; }
    .amp .kn-l { font-size: 6px; }
    .amp-top, .amp-cab { padding-left: 8px; padding-right: 8px; }
    .amp-grille { height: 150px; }
    .amp[data-form="head"] .amp-grille { height: 170px; }
    .amp.small .amp-grille { height: 130px; }
    .amp-lgw { font-size: 32px; }
    .amp[data-form="head"] .amp-strip { height: 44px; }
    .amp[data-form="head"] .amp-strip .amp-lgw { font-size: 26px; }
    .sticker .amp-stk { width: 46px; height: 46px; right: 14px; top: auto; bottom: 16px; }
    .amp[data-form="combo"] .amp-grille > .amp-lgw { font-size: 27px; left: 14px; top: 14px; }
    .sticker .amp-stk::after { top: 27px; }
    .aw { flex-basis: 98px; min-height: 136px; }
    .aw .am { width: 74px; }
    .aw-n { font-size: 13px; }
    .amp[data-face="radio"] .amp-face { left: 30%; right: 5%; top: 12px; height: 36px; }
    .amp[data-face="radio"] .amp-face::before { font-size: 6px; }
    .amp[data-face="lcd"] .amp-grille > .amp-lgw { left: 50%; top: 18px; box-shadow: 0 0 0 7px #5d5a6e, 0 0 0 8px #0004, inset 0 0 14px #0f380f55; }
    .amp[data-face="lcd"] .af-a { width: 40px; height: 40px; bottom: 12px; background-size: 13px 100%, 100% 13px; }
    .amp[data-face="lcd"] .af-b { width: 18px; height: 18px; bottom: 18px; box-shadow: 26px -9px 0 #a3245a, 0 2px 0 #0006; }
    .amp[data-face="tape"] .amp-face { width: 44%; }
    .amp[data-face="radio"] .amp-grille > .amp-lgw { top: auto; bottom: 10px; }
    .amps-tones { flex-wrap: nowrap; overflow-x: auto; gap: 4px; scrollbar-width: none; }
    .amps-tone { flex: 0 0 auto; padding: 0 9px; }
    .amp-grille::after { left: 14px; bottom: 10px; }
  }`;
