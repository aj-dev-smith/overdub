// "Every edit is signed": a little piano roll and the history beside it. Warm notes are yours, cool notes are the
// agent's. Undo the agent's last change and only its notes leave; yours stay (the studio's store.undo({ by })).

const MELODY = [
  [57, 0, 1],
  [60, 1, 1],
  [64, 2, 2],
  [62, 4, 0.75],
  [60, 4.75, 0.75],
  [62, 5.5, 0.5],
  [64, 6, 1],
];
const HARMONY = [
  [53, 0, 1],
  [57, 1, 1],
  [60, 2, 2],
  [59, 4, 0.75],
  [57, 4.75, 0.75],
  [59, 5.5, 0.5],
  [60, 6, 1],
];
const NS = 'http://www.w3.org/2000/svg';

export function mountSigned(root) {
  const roll = root.querySelector('[data-roll]'),
    list = root.querySelector('[data-history]'),
    btn = root.querySelector('[data-undo]');
  const lo = 50,
    hi = 67,
    beats = 8,
    W = 640,
    H = 260;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute(
    'aria-label',
    'A piano roll: your melody outlined in warm orange, the agent’s harmony a third below outlined in cool blue',
  );
  const x = (b) => 8 + (b / beats) * (W - 16),
    y = (m) => 8 + ((hi - m) / (hi - lo)) * (H - 16),
    rowH = (H - 16) / (hi - lo);
  let grid = '';
  for (let m = lo; m <= hi; m++)
    if ([1, 3, 6, 8, 10].includes(m % 12))
      grid += `<rect x="0" y="${y(m) - rowH / 2}" width="${W}" height="${rowH}" class="roll-black"/>`;
  for (let b = 0; b <= beats; b++)
    grid += `<line x1="${x(b)}" x2="${x(b)}" y1="0" y2="${H}" class="${b % 4 ? 'roll-beat' : 'roll-bar'}"/>`;
  svg.innerHTML = `<g>${grid}</g><g data-agent></g><g data-human></g>`;
  const note = ([m, t, d], cls) =>
    `<rect class="${cls}" x="${x(t) + 1}" y="${y(m) - rowH / 2 + 1}" width="${x(t + d) - x(t) - 2}" height="${rowH - 2}" rx="1.5"/>`;
  const human = svg.querySelector('[data-human]'),
    agent = svg.querySelector('[data-agent]');
  roll.appendChild(svg);

  // the history, newest last. Undo by the agent takes back the agent's newest live entry.
  const H0 = [
    { by: 'you', who: 'You', what: 'hummed the hook', ops: 'clip.add, notes.add ×7' },
    { by: 'agent', who: 'Claude', what: 'added a harmony a third below', ops: 'notes.add ×7', harmony: true },
    { by: 'you', who: 'You', what: 'held the last note for two beats', ops: 'notes.set', stretch: true },
  ];
  const state = H0.map((e) => ({ ...e, undone: false }));
  function render() {
    const stretched = state.some((e) => e.stretch && !e.undone);
    human.innerHTML = MELODY.map((n, i) =>
      note(i === MELODY.length - 1 && stretched ? [n[0], n[1], 2] : n, 'n-human'),
    ).join('');
    const hasHarm = state.some((e) => e.harmony && !e.undone);
    agent.innerHTML = HARMONY.map((n, i) =>
      note(i === HARMONY.length - 1 && stretched ? [n[0], n[1], 1] : n, 'n-agent'),
    ).join('');
    agent.classList.toggle('is-gone', !hasHarm);
    list.innerHTML = state
      .map(
        (e) =>
          `<li class="h-row h-row--${e.by}${e.undone ? ' is-undone' : ''}"><span class="h-who by by-${e.by === 'agent' ? 'agent' : 'human'}">${e.who}</span><span class="h-what">${e.what}${e.undone ? ' <em>(undone)</em>' : ''}</span><code class="h-ops">${e.ops}</code></li>`,
      )
      .join('');
    const live = state.filter((e) => e.by === 'agent' && !e.undone);
    btn.textContent = live.length ? 'Undo Claude’s last change' : 'Redo Claude’s change';
    btn.dataset.mode = live.length ? 'undo' : 'redo';
  }
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === 'undo') {
      const e = [...state].reverse().find((s) => s.by === 'agent' && !s.undone);
      if (e) e.undone = true;
    } else {
      const e = state.find((s) => s.by === 'agent' && s.undone);
      if (e) e.undone = false;
    }
    render();
  });
  render();
  return { state };
}
