// app.js — glue: file browser, file/move navigation, board + tree +
// comment display.

import { Board } from './board.js';
import { Game, isMove, leafVerdict, gtpPoint } from './game.js';
import { TreeView } from './tree.js';
import { BLACK, WHITE } from './colors.js';

const $ = (id) => document.getElementById(id);

const state = {
  dir: '', dirs: [], files: [], file: null, game: null,
  tool: 'play', dirty: false, solve: false, replyTimer: null,
  engine: false, engineBusy: false, scoreNode: null,
  explore: false, exploreBusy: false, exploreNode: null,
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

// Ghost stone of the colour to play, shown whenever a click would place
// a stone: tsumego/engine/explore modes, or the plain play tool. Hidden
// while the engine is busy, and for the mark tools.
function updateGhost() {
  if (!state.game) return;
  const placing = state.solve || state.engine || state.explore || state.tool === 'play';
  const busy = state.engineBusy || state.exploreBusy;
  board.setGhost(placing && !busy ? state.game.nextColor() : null);
}

function refresh() {
  const game = state.game;
  if (!game) return;
  const pos = game.position();
  board.setPosition(pos);
  board.setView(game.viewRect()); // honor SGF VW board-crop
  updateGhost();
  // the score overlay belongs to one node; drop it once we move away
  if (state.scoreNode && state.scoreNode !== game.current) clearScore();
  board.setOwnership(state.scoreNode ? board.ownership : null);
  // explore: keep candidate overlay synced to the current node
  if (state.explore) {
    if (!state.exploreBusy && state.exploreNode !== game.current) {
      board.setCandidates(null); // clear stale markers while we recompute
      requestCandidates();
    }
  } else if (board.candidates) {
    board.setCandidates(null);
  }
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
  persist();
}

function setInfo() {
  const p = (name) => state.game.rootProp(name);
  const side = (name, rank) =>
    [p(name), p(rank) && `(${p(rank)})`].filter(Boolean).join(' ');
  // event · round, and time · overtime, read as single units when present
  const event = [p('EV'), p('RO') && `round ${p('RO')}`].filter(Boolean).join(' ');
  const time = [p('TM'), p('OT')].filter(Boolean).join(' + ');
  const bits = [
    `${side('PB', 'BR') || 'Black'} vs ${side('PW', 'WR') || 'White'}`,
    p('HA') > 1 && `${p('HA')} stones`,
    p('KM') && `komi ${p('KM')}`,
    p('RE'),
    event,
    p('DT'),
    p('PC'), // place
    p('RU') && `${p('RU')} rules`,
    time && `time ${time}`,
    p('GN'), // game name
    p('AN') && `annotated by ${p('AN')}`,
    p('SO') && `source: ${p('SO')}`,
    p('CP'), // copyright
  ].filter(Boolean);
  $('info').textContent = bits.join(' · ');
  // GC = a comment on the whole game, distinct from per-node comments
  $('gamecomment').textContent = (state.game.root.props.GC || []).join('\n');
  placeInfo();
}

// Keep the game-info banner above the board while it's short; once it
// runs past ~3 lines (e.g. Kogo's long copyright block) move it into the
// lower split of the file pane, where it scrolls and tucks away with the
// rest of that sidebar.
function placeInfo() {
  const top = $('topinfo');
  const main = document.querySelector('main');
  main.insertBefore(top, main.firstChild); // measure at full board width
  const cs = getComputedStyle($('info'));
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
  if (top.offsetHeight > line * 3.3) $('sideinfo').appendChild(top);
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
  if (state.engine) {
    engineClick(x, y);
    return;
  }
  if (state.explore) {
    exploreClick(x, y);
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
  if (on && state.engine) setEngineMode(false);
  if (on && state.explore) setExploreMode(false);
  $('solvemode').classList.toggle('active', on);
  clearTimeout(state.replyTimer);
  updateGhost();
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

// ---------- play vs engine --------------------------------------------------

function setEngineMode(on) {
  state.engine = on;
  if (on && state.solve) setSolveMode(false);
  if (on && state.explore) setExploreMode(false);
  $('enginemode').classList.toggle('active', on);
  if (on && !state.game) startFreshGame(19); // nothing loaded: just start playing
  if (on && state.game) {
    const you = state.game.nextColor() === BLACK ? 'black' : 'white';
    feedback('', `you are ${you} — KataGo (${strengthLabel()}) answers`);
  } else {
    feedback('', '');
  }
  refresh();
}
$('enginemode').addEventListener('click', () => setEngineMode(!state.engine));

function strengthLabel() {
  return $('strength').selectedOptions[0]?.textContent ?? 'max';
}

// remember the chosen strength across sessions
$('strength').value = localStorage.getItem('sgf-strength') ?? 'rank_10k';
$('strength').addEventListener('change', () => {
  localStorage.setItem('sgf-strength', $('strength').value);
  if (state.engine) feedback('', `KataGo now plays at ${strengthLabel()}`);
});

// Player's click in engine mode: play the move, then ask KataGo to answer.
function engineClick(x, y) {
  const game = state.game;
  if (state.engineBusy) {
    feedback('', 'engine is thinking…');
    return;
  }
  const result = game.playAt(x, y);
  if (!result) {
    feedback('offpath', 'that point is occupied');
    return;
  }
  if (result === 'added') setDirty(true);
  tree.setGame(game);
  refresh();
  requestEngineMove();
}

async function requestEngineMove() {
  const game = state.game;
  const { moves, unsupported } = game.engineMoves();
  if (unsupported) {
    feedback('offpath', 'position uses AE (cleared points) — engine play unsupported here');
    return;
  }
  state.engineBusy = true;
  feedback('', 'engine is thinking…');
  refresh(); // hides the ghost while it is the engine’s turn
  try {
    const res = await fetch('/api/engine/move', {
      method: 'POST',
      body: JSON.stringify({
        size: game.size,
        komi: parseFloat(game.rootProp('KM')) || 6.5,
        moves,
        color: game.nextColor() === BLACK ? 'B' : 'W',
        profile: $('strength').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    applyEngineMove(data.move);
  } catch (err) {
    feedback('fail', `engine error: ${err.message}`);
  } finally {
    state.engineBusy = false;
    refresh();
  }
}

function applyEngineMove(move) {
  const game = state.game;
  const lower = move.toLowerCase();
  if (lower === 'resign') {
    feedback('correct', '🏳 the engine resigns');
    return;
  }
  if (lower === 'pass') {
    game.playPass();
    feedback('', 'engine passes');
  } else {
    const pt = gtpPoint(move, game.size);
    if (!pt) {
      feedback('fail', `engine returned unparseable move: ${move}`);
      return;
    }
    game.playAt(pt.x, pt.y);
    feedback('', '');
  }
  setDirty(true);
  tree.setGame(game);
  refresh();
}

// ---------- score & territory estimate -------------------------------------

$('scorebtn').addEventListener('click', toggleScore);

function clearScore() {
  state.scoreNode = null;
  board.setOwnership(null);
  $('scorebtn').classList.remove('active');
}

async function toggleScore() {
  if (!state.game) return;
  if (state.scoreNode) { // showing for this node already: turn it off
    clearScore();
    feedback('', '');
    return;
  }
  const game = state.game;
  const { moves, unsupported } = game.engineMoves();
  if (unsupported) {
    feedback('offpath', 'position uses AE (cleared points) — score estimate unsupported');
    return;
  }
  feedback('', 'estimating score…');
  try {
    const res = await fetch('/api/engine/score', {
      method: 'POST',
      body: JSON.stringify({
        size: game.size,
        komi: parseFloat(game.rootProp('KM')) || 6.5,
        moves,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (game !== state.game) return; // user moved on while we waited
    state.scoreNode = game.current;
    board.setOwnership(data.ownership);
    $('scorebtn').classList.add('active');
    feedback('', scoreText(data.lead));
  } catch (err) {
    feedback('fail', `score error: ${err.message}`);
  }
}

// whiteLead (positive = White ahead) -> "B+12.5" / "W+3.5" / "even"
function leadToBW(lead) {
  const r = Math.round(Math.abs(lead) * 2) / 2;
  return r === 0 ? 'even' : `${lead > 0 ? 'W' : 'B'}+${r}`;
}

function scoreText(lead) {
  return `estimated score: ${leadToBW(lead)} (approximate)`;
}

// ---------- explore: walk KataGo's top moves --------------------------------

function setExploreMode(on) {
  state.explore = on;
  if (on) {
    if (state.solve) setSolveMode(false);
    if (state.engine) setEngineMode(false);
    if (!state.game) startFreshGame(19);
  }
  $('exploremode').classList.toggle('active', on);
  state.exploreNode = null; // force a fresh analysis on (re)entry
  if (!on) board.setCandidates(null);
  feedback('', on ? 'analyzing…' : '');
  refresh();
}
$('exploremode').addEventListener('click', () => setExploreMode(!state.explore));

// Click in explore mode: play the move (any empty point), then the
// refresh cycle re-analyzes for the new color.
function exploreClick(x, y) {
  if (state.exploreBusy) {
    feedback('', 'analyzing…');
    return;
  }
  const result = state.game.playAt(x, y);
  if (!result) {
    feedback('offpath', 'that point is occupied');
    return;
  }
  if (result === 'added') setDirty(true);
  tree.setGame(state.game);
  refresh();
}

// Fetch the top candidate moves for the current node and overlay them.
async function requestCandidates() {
  const game = state.game;
  const node = game.current;
  const { moves, unsupported } = game.engineMoves();
  if (unsupported) {
    feedback('offpath', 'position uses AE (cleared points) — explore unsupported here');
    state.exploreNode = node;
    return;
  }
  state.exploreBusy = true;
  try {
    const res = await fetch('/api/engine/candidates', {
      method: 'POST',
      body: JSON.stringify({
        size: game.size,
        komi: parseFloat(game.rootProp('KM')) || 6.5,
        moves,
        maxmoves: 3,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    if (state.explore && game === state.game && node === game.current) {
      showCandidates(data);
    }
  } catch (err) {
    if (node === state.game?.current) feedback('fail', `explore error: ${err.message}`);
  } finally {
    state.exploreBusy = false;
    state.exploreNode = node;
    // position moved while we were computing: analyze the new one
    if (state.explore && state.game && state.exploreNode !== state.game.current) {
      board.setCandidates(null);
      requestCandidates();
    }
  }
}

// Convert engine candidates to board markers labelled with the point
// delta (points lost vs the best move), from the to-move perspective.
function showCandidates({ currentPlayer, candidates }) {
  if (!candidates.length) {
    board.setCandidates(null);
    feedback('', 'no candidate moves (game over?)');
    return;
  }
  const persp = (lead) => (currentPlayer === 'W' ? lead : -lead); // to-move perspective
  // delta vs KataGo's top recommendation (candidates are order-sorted),
  // so the colour rank and the labelled point delta share one reference.
  const top = persp(candidates[0].scoreLead);
  const markers = [];
  for (const c of candidates) {
    const pt = gtpPoint(c.move, state.game.size);
    if (!pt) continue; // skip pass
    markers.push({ x: pt.x, y: pt.y, rank: c.order, text: fmtDelta(persp(c.scoreLead) - top) });
  }
  board.setCandidates(markers);
  const who = currentPlayer === 'W' ? 'White' : 'Black';
  feedback('', `${who} to play · best ${candidates[0].move} (${leadToBW(candidates[0].scoreLead)})`);
}

function fmtDelta(d) {
  if (Math.abs(d) < 0.05) return '0';
  return (d > 0 ? '+' : '') + d.toFixed(1);
}

// ---------- move numbers (view toggle) -------------------------------------

function setNumbers(on) {
  board.setShowNumbers(on);
  $('numbersbtn').classList.toggle('active', on);
  localStorage.setItem('sgf-numbers', on ? '1' : '');
}
$('numbersbtn').addEventListener('click', () => setNumbers(!board.showNumbers));

// ---------- editing -------------------------------------------------------

function setDirty(dirty) {
  state.dirty = dirty;
  $('save').classList.toggle('dirty', dirty);
}

// ---------- crash recovery: persist unsaved work to localStorage -----------
// Only dirty (unsaved) games are kept; clean loaded files restore via the
// URL hash. Restored on reload so an accidental refresh doesn't lose a new
// game or unsaved edits.

const SESSION_KEY = 'sgf-session';
let persistTimer = null;

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveSession, 400);
}

function saveSession() {
  if (!state.game || !state.dirty) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      sgf: state.game.serialize(),
      path: nodePath(state.game), // child indices root → current node
      dir: state.dir,
      file: state.file, // null for a never-saved game
      name: $('savename').value,
      title: document.title,
    }));
  } catch {
    /* quota or serialization failure — recovery is best-effort */
  }
}

function clearSession() {
  clearTimeout(persistTimer);
  localStorage.removeItem(SESSION_KEY);
}

function nodePath(game) {
  const path = [];
  for (let n = game.current; n.parent; n = n.parent) {
    path.push(n.parent.children.indexOf(n));
  }
  return path.reverse();
}

function applyPath(game, path) {
  game.toStart();
  for (const i of path) {
    const child = game.current.children[i];
    if (!child) break;
    game.goTo(child);
  }
}

// Rebuild a dirty game saved before a reload. Returns true if restored.
async function restoreSession() {
  let s;
  try {
    s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    s = null;
  }
  if (!s?.sgf) return false;
  let game;
  try {
    game = new Game(s.sgf);
  } catch {
    clearSession();
    return false;
  }
  await loadDir(s.dir || ''); // populate the file browser context
  state.game = game;
  state.file = s.file ?? null;
  setDirty(true);
  $('savename').value = s.name || 'untitled.sgf';
  document.title = s.title || 'restored — SGF viewer';
  board.setSize(game.size);
  tree.setGame(game);
  applyPath(game, s.path || []);
  setInfo();
  markCurrentFile();
  refresh();
  feedback('', '↩ restored your unsaved game');
  return true;
}

for (const btn of document.querySelectorAll('#tools .tool[data-tool]')) {
  btn.addEventListener('click', () => {
    state.tool = btn.dataset.tool;
    document.querySelector('#tools .tool[data-tool].active')?.classList.remove('active');
    btn.classList.add('active');
    updateGhost(); // play tool shows the ghost; mark tools don't
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
  clearSession(); // it's on disk now
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
  startFreshGame(size);
}
$('new').addEventListener('click', newFile);

function startFreshGame(size) {
  const today = new Date().toISOString().slice(0, 10);
  state.game = new Game(`(;GM[1]FF[4]SZ[${size}]CA[UTF-8]DT[${today}])`);
  state.file = null;
  setDirty(false);
  clearSession(); // empty game isn't worth restoring until a move is played
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
  e: () => setEngineMode(!state.engine),
  x: () => setExploreMode(!state.explore),
  s: () => toggleScore(),
  m: () => setNumbers(!board.showNumbers),
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
  setNumbers(localStorage.getItem('sgf-numbers') === '1'); // restore the view pref
  // unsaved work takes precedence over the hash: restore it if present
  if (await restoreSession()) return;
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
