// app.js — glue: file browser, file/move navigation, board + tree +
// comment display.

import { Board } from './board.js';
import { Game, isMove } from './game.js';
import { TreeView } from './tree.js';
import { BLACK, WHITE } from './colors.js';

const $ = (id) => document.getElementById(id);

const state = { dir: '', dirs: [], files: [], file: null, game: null };

const board = new Board($('board'), { onPointClick: onBoardClick });
const tree = new TreeView($('tree'), {
  onSelect: (node) => {
    state.game?.goTo(node);
    refresh();
  },
});

// ---------- file browser ------------------------------------------------

async function loadDir(path) {
  const res = await fetch(`/api/ls?path=${encodeURIComponent(path)}`);
  if (!res.ok) {
    showError(`cannot list /${path}`);
    return;
  }
  const data = await res.json();
  state.dir = data.path;
  state.dirs = data.dirs;
  state.files = data.files;
  renderFileList();
}

function renderFileList() {
  $('path').textContent = '/' + state.dir;
  const list = $('filelist');
  list.textContent = '';
  for (const d of state.dirs) {
    list.appendChild(entryEl(`${d}/`, 'dir', () => loadDir(join(state.dir, d))));
  }
  for (const f of state.files) {
    list.appendChild(entryEl(f, 'file', () => loadFile(f)));
  }
  markCurrentFile();
}

function entryEl(label, cls, onclick) {
  const el = document.createElement('div');
  el.className = `entry ${cls}`;
  el.textContent = label;
  el.dataset.name = label;
  el.addEventListener('click', onclick);
  return el;
}

function markCurrentFile() {
  const list = $('filelist');
  list.querySelector('.entry.current')?.classList.remove('current');
  if (!state.file) return;
  for (const el of list.children) {
    if (el.dataset.name === state.file) {
      el.classList.add('current');
      el.scrollIntoView({ block: 'nearest' });
      break;
    }
  }
}

const join = (a, b) => (a ? `${a}/${b}` : b);
const parentOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

// ---------- file loading --------------------------------------------------

async function loadFile(name) {
  const path = join(state.dir, name);
  const res = await fetch('/' + encodeURI(path).replace(/#/g, '%23'));
  if (!res.ok) {
    showError(`cannot load ${path}`);
    return;
  }
  const text = decodeSGF(await res.arrayBuffer());
  let game;
  try {
    game = new Game(text);
  } catch (err) {
    showError(`${path}: ${err.message}`);
    return;
  }
  state.game = game;
  state.file = name;
  document.title = `${name} — SGF viewer`;
  board.setSize(game.size);
  tree.setGame(game);
  setInfo();
  markCurrentFile();
  refresh();
}

function nextFile(step) {
  const i = state.files.indexOf(state.file) + step;
  if (i >= 0 && i < state.files.length) loadFile(state.files[i]);
}

// Decode honoring the CA[] charset property; fall back utf-8 → latin1.
function decodeSGF(buf) {
  const latin1 = new TextDecoder('latin1').decode(buf);
  const declared = latin1.match(/CA\s*\[\s*([\w-]+)\s*\]/)?.[1];
  for (const enc of [declared, 'utf-8'].filter(Boolean)) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf);
    } catch {
      /* try the next encoding */
    }
  }
  return latin1;
}

// ---------- display -------------------------------------------------------

function refresh() {
  const game = state.game;
  if (!game) return;
  const pos = game.position();
  board.setPosition(pos);
  tree.update();
  // Bookmarkable position: #dir/file.sgf@move (replaceState: no history spam)
  const hash = `#${encodeURIComponent(join(state.dir, state.file))}@${pos.moveNumber}`;
  history.replaceState(null, '', hash);
  $('comment').textContent = game.comment();
  $('movecount').textContent =
    `move ${pos.moveNumber} / ${game.lineLength()}` +
    ` · captures ● ${pos.captures[BLACK]} ○ ${pos.captures[WHITE]}`;
}

function setInfo() {
  const p = (name) => state.game.rootProp(name);
  const side = (name, rank) =>
    [p(name), p(rank) && `(${p(rank)})`].filter(Boolean).join(' ');
  const bits = [
    `${side('PB', 'BR') || 'Black'} vs ${side('PW', 'WR') || 'White'}`,
    p('HA') > 1 && `${p('HA')} stones`,
    p('KM') && `komi ${p('KM')}`,
    p('RE'),
    p('DT'),
    p('EV'),
  ].filter(Boolean);
  $('info').textContent = bits.join(' · ');
}

function showError(msg) {
  $('comment').textContent = `⚠ ${msg}`;
}

// Clicking an empty point follows the matching variation, if any.
function onBoardClick(x, y) {
  const child = state.game?.childAt(x, y);
  if (child) {
    state.game.goTo(child);
    refresh();
  }
}

// ---------- controls ------------------------------------------------------

const MOVES = {
  'b-start': (g) => g.toStart(),
  'b-back10': (g) => g.back(10),
  'b-prev': (g) => g.prev(),
  'b-next': (g) => g.next(),
  'b-fwd10': (g) => g.forward(10),
  'b-end': (g) => g.toEnd(),
  'b-varup': (g) => g.variation(-1),
  'b-vardown': (g) => g.variation(1),
};
for (const [id, fn] of Object.entries(MOVES)) {
  $(id).addEventListener('click', () => {
    if (!state.game) return;
    fn(state.game);
    refresh();
  });
}
$('b-prevfile').addEventListener('click', () => nextFile(-1));
$('b-nextfile').addEventListener('click', () => nextFile(1));
$('up').addEventListener('click', () => loadDir(parentOf(state.dir)));

// Tuck the file browser away to reclaim space (persists across reloads).
function setFilesHidden(hidden) {
  document.body.classList.toggle('nofiles', hidden);
  localStorage.setItem('sgf-nofiles', hidden ? '1' : '');
}
$('hidefiles').addEventListener('click', () => setFilesHidden(true));
$('showfiles').addEventListener('click', () => setFilesHidden(false));
setFilesHidden(localStorage.getItem('sgf-nofiles') === '1');

const KEYS = {
  ArrowLeft: () => state.game?.prev(),
  ArrowRight: () => state.game?.next(),
  ArrowUp: () => state.game?.variation(-1),
  ArrowDown: () => state.game?.variation(1),
  Home: () => state.game?.toStart(),
  End: () => state.game?.toEnd(),
  PageUp: () => state.game?.back(10),
  PageDown: () => state.game?.forward(10),
  n: () => nextFile(1),
  p: () => nextFile(-1),
  f: () => setFilesHidden(!document.body.classList.contains('nofiles')),
};
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const fn = KEYS[e.key];
  if (!fn) return;
  e.preventDefault();
  fn();
  refresh();
});

// ---------- startup -------------------------------------------------------

(async function init() {
  const target = decodeURIComponent(location.hash.slice(1));
  const [path, at] = target.split('@');
  await loadDir(path ? parentOf(path) : '');
  const name = path.split('/').pop();
  if (name && state.files.includes(name)) {
    await loadFile(name);
    if (at > 0) {
      forwardToMove(state.game, +at);
      refresh();
    }
  }
})();

function forwardToMove(game, target) {
  let n = 0;
  while (n < target && game.next()) {
    if (isMove(game.current)) n++;
  }
}
