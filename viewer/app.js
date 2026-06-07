// app.js — glue: file browser, file/move navigation, board + tree +
// comment display.

import { Board } from './board.js';
import { Game, isMove, leafVerdict } from './game.js';
import { TreeView } from './tree.js';
import { BLACK, WHITE } from './colors.js';

const $ = (id) => document.getElementById(id);

const state = {
  dir: '', dirs: [], files: [], file: null, game: null,
  tool: 'play', dirty: false, solve: false, replyTimer: null,
};

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
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
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
  clearTimeout(state.replyTimer);
  feedback('', '');
  setDirty(false);
  $('savename').value = name.replace(/(\.edit)?\.sgf$/i, '') + '.edit.sgf';
  $('savestatus').textContent = '';
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
  board.setGhost(state.solve ? game.nextColor() : null);
  tree.update();
  if (state.file) {
    // Bookmarkable position: #dir/file.sgf@move (replaceState: no history spam)
    const hash = `#${encodeURIComponent(join(state.dir, state.file))}@${pos.moveNumber}`;
    history.replaceState(null, '', hash);
  }
  renderComment($('comment'), game.comment(), pos.marks);
  const box = $('commentbox');
  if (document.activeElement !== box) box.value = game.comment();
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

// Render comment text honoring the old review conventions: all-caps mark
// words become glyphs, and quoted letters that match a label on the
// current node are set as label chips. Display-only; the SGF is untouched.
const MARK_WORDS = { TRIANGLE: '△', SQUARE: '□', CIRCLE: '○', CROSS: '✕' };

function renderComment(el, text, marks) {
  el.textContent = '';
  const labels = new Set((marks || []).filter((m) => m.type === 'label').map((m) => m.text));
  const re = /\b(TRIANGLE|SQUARE|CIRCLE|CROSS)\b|'([a-zA-Z])'/g;
  let last = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) el.append(text.slice(last, m.index));
    if (m[1]) {
      el.append(chip('cmark', MARK_WORDS[m[1]], m[1].toLowerCase()));
    } else if (labels.has(m[2])) {
      el.append(chip('clabel', m[2], `label ${m[2]}`));
    } else {
      el.append(m[0]); // quoted letter without a matching label: leave as-is
    }
    last = m.index + m[0].length;
  }
  el.append(text.slice(last));
}

function chip(cls, text, title) {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = text;
  span.title = title;
  return span;
}

// Play tool: follow the matching variation or play a new move there.
// Mark tools: toggle the mark on the current node.
// Solve mode: traverse the solution tree with computer replies.
function onBoardClick(x, y) {
  const game = state.game;
  if (!game) return;
  if (state.solve) {
    solveClick(x, y);
    return;
  }
  if (state.tool === 'play') {
    const result = game.playAt(x, y);
    if (!result) return;
    if (result === 'added') {
      setDirty(true);
      tree.setGame(game); // structure changed: rebuild
    }
  } else {
    game.toggleMark(state.tool, x, y);
    setDirty(true);
    tree.setGame(game); // annotation status affects segments
  }
  refresh();
}

// ---------- tsumego solve mode ---------------------------------------------

function setSolveMode(on) {
  state.solve = on;
  $('solvemode').classList.toggle('active', on);
  clearTimeout(state.replyTimer);
  board.setGhost(on && state.game ? state.game.nextColor() : null);
  if (on && state.game && !state.game.current.children.length) {
    feedback('offpath', 'no solution tree in this file');
  } else {
    feedback('', '');
  }
}
$('solvemode').addEventListener('click', () => setSolveMode(!state.solve));

// Player's click: follow the matching branch, then judge or let the
// computer answer. A click with no matching branch is off-path.
function solveClick(x, y) {
  const game = state.game;
  clearTimeout(state.replyTimer);
  const child = game.childAt(x, y);
  if (!child) {
    feedback('offpath', '⊘ off-path');
    return;
  }
  feedback('', '');
  game.goTo(child);
  refresh();
  if (!child.children.length) {
    judge(child);
    return;
  }
  state.replyTimer = setTimeout(computerReply, 400);
}

// Unbiased random choice among the successor moves.
function computerReply() {
  const game = state.game;
  if (!game || !state.solve) return;
  const kids = game.current.children;
  if (!kids.length) return;
  const pick = kids[Math.floor(Math.random() * kids.length)];
  game.goTo(pick);
  refresh();
  if (!pick.children.length) judge(pick);
}

function judge(leaf) {
  const verdict = leafVerdict(leaf);
  feedback(verdict === 'correct' ? 'correct' : 'fail', verdict === 'correct' ? '✓ correct' : '✗ fail');
}

function feedback(cls, msg) {
  $('feedback').className = cls;
  $('feedback').textContent = msg;
}

// ---------- editing -------------------------------------------------------

function setDirty(dirty) {
  state.dirty = dirty;
  $('save').classList.toggle('dirty', dirty);
}

for (const btn of document.querySelectorAll('#tools .tool[data-tool]')) {
  btn.addEventListener('click', () => {
    state.tool = btn.dataset.tool;
    document.querySelector('#tools .tool[data-tool].active')?.classList.remove('active');
    btn.classList.add('active');
  });
}

let commentTimer = null;
$('commentbox').addEventListener('input', () => {
  if (!state.game) return;
  state.game.setComment($('commentbox').value);
  renderComment($('comment'), $('commentbox').value, state.game.position().marks);
  setDirty(true);
  // segments depend on comments: rebuild the tree once typing pauses
  clearTimeout(commentTimer);
  commentTimer = setTimeout(() => {
    tree.setGame(state.game);
    refresh();
  }, 700);
});

async function saveFile() {
  const name = $('savename').value.trim();
  if (!state.game) return;
  if (!name.toLowerCase().endsWith('.sgf')) {
    $('savestatus').textContent = '⚠ filename must end in .sgf';
    return;
  }
  const path = join(state.dir, name);
  const res = await fetch(`/api/save?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    body: state.game.serialize(),
  });
  if (!res.ok) {
    $('savestatus').textContent = `⚠ save failed (${res.status})`;
    return;
  }
  setDirty(false);
  state.file = name; // further saves and n/p navigate relative to the copy
  $('savestatus').textContent = `saved ${name}`;
  await loadDir(state.dir); // pick up the new file in the browser
  document.title = `${name} — SGF viewer`;
  refresh();
}
$('save').addEventListener('click', saveFile);

// Start a fresh game record in the current directory.
function newFile() {
  if (state.dirty && !confirm('Discard unsaved changes?')) return;
  const size = parseInt(prompt('Board size:', '19') ?? '', 10);
  if (!size || size < 2 || size > 19) return;
  const today = new Date().toISOString().slice(0, 10);
  state.game = new Game(`(;GM[1]FF[4]SZ[${size}]CA[UTF-8]DT[${today}])`);
  state.file = null;
  setDirty(false);
  $('savename').value = 'untitled.sgf';
  $('savestatus').textContent = '';
  document.title = 'new game — SGF viewer';
  history.replaceState(null, '', '#');
  board.setSize(size);
  tree.setGame(state.game);
  setInfo();
  markCurrentFile();
  refresh();
}
$('new').addEventListener('click', newFile);

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
    clearTimeout(state.replyTimer); // manual navigation halts a pending reply
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
  t: () => setSolveMode(!state.solve),
};
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.matches('input, textarea')) return; // typing, not navigating
  const fn = KEYS[e.key];
  if (!fn) return;
  e.preventDefault();
  clearTimeout(state.replyTimer); // manual navigation halts a pending reply
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
