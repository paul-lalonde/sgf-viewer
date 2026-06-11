// app.js — glue: file browser, file/move navigation, board + tree +
// comment display.

import { Board } from './board.js';
import { Game, isMove, leafVerdict, gtpPoint, moveOf, singleSetup, parsePoint } from './game.js';

// joseki node marks → board overlay types
const JOSEKI_MARKS = [['TR', 'triangle'], ['SQ', 'square'], ['CR', 'circle'], ['MA', 'x']];
import { buildIndex, matchAll as matchJosekiAll } from './joseki.js';
import { parseWgf, recordTitle, buildNameIndex, parseLinkTarget, tokenizeComment, buildResponses, propsToText, xsProse } from './wgf.js';
import { Quiz, isQuiz } from './quiz.js';

const CORNER_NAMES = ['↗ top-right', '↖ top-left', '↘ bottom-right', '↙ bottom-left'];

const JOSEKI_SGF = '/joseki/Kogos-Joseki-Dictionary.sgf';
const COLS = 'ABCDEFGHJKLMNOPQRST';
const coord = (x, y, size) => COLS[x] + (size - y);
import { TreeView } from './tree.js';
import { columnSplitter, rowSplitter } from './resize.js';
import { EMPTY, BLACK, WHITE } from './colors.js';

const $ = (id) => document.getElementById(id);

const state = {
  dir: '', dirs: [], files: [], file: null, game: null,
  tool: 'play', dirty: false, solve: false, replyTimer: null,
  engine: false, engineBusy: false, scoreNode: null,
  explore: false, exploreBusy: false, exploreNode: null,
  joseki: false, josekiIndex: null, josekiStatus: '',
};

const board = new Board($('board'), { onPointClick: onBoardClick });
const tree = new TreeView($('tree'), {
  onSelect: (node) => {
    state.game?.goTo(node);
    refresh();
  },
  onInspect: (node, e) => showNodeSource(node, e),
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
  // .wgf (Bruce Wilcox's Go Dojo): a collection of named lesson records
  const isWgf = name.toLowerCase().endsWith('.wgf');
  let records;
  try {
    records = isWgf ? parseWgf(text) : [new Game(text).root];
  } catch (err) {
    showError(`${path}: ${err.message}`);
    return;
  }
  if (!records.length) {
    showError(`${path}: no records`);
    return;
  }
  state.file = name;
  state.records = records;
  state.isWgf = isWgf;
  state.wgfNames = isWgf ? buildNameIndex(records) : null;
  state.wgfResponses = isWgf ? buildResponses(records) : null;
  tree.allowOutline = isWgf; // .wgf lesson records render as a slide outline
  clearTimeout(state.replyTimer);
  feedback('', '');
  $('savename').value = name.replace(/(\.edit)?\.[sw]gf$/i, '') + '.edit.sgf';
  $('savestatus').textContent = '';
  renderRecordBar();
  loadRecord(0);
  markCurrentFile();
}

// Show one record of the loaded file (index into state.records).
function loadRecord(i) {
  state.recordIndex = i;
  state.game = Game.fromRoot(state.records[i]);
  state.autosaveName = null;
  setDirty(false);
  const title = state.records.length > 1
    ? `${recordTitle(state.records[i], i)} — ${state.file}`
    : `${state.file} — SGF viewer`;
  document.title = title;
  $('recordsel').value = String(i);
  $('crumb').textContent = state.isWgf ? recordCrumb(state.records[i]) : '';
  board.setSize(state.game.size);
  tree.setGame(state.game);
  setInfo();
  refresh();
}

// A record's place in the Dojo lesson hierarchy, from its XN
// "level:category:title" tag → "category › title" (drop the level number).
function recordCrumb(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.props.XN) return n.props.XN[0].replace(/^\d+:/, '').replace(/\s*:\s*/g, ' › ');
    stack.push(...n.children);
  }
  return '';
}

// A dropdown to pick among a multi-record file's lessons (.wgf).
function renderRecordBar() {
  const sel = $('recordsel');
  const multi = state.records && state.records.length > 1;
  document.body.classList.toggle('multirecord', multi);
  if (!multi) {
    sel.innerHTML = '';
    return;
  }
  sel.innerHTML = state.records
    .map((r, i) => `<option value="${i}">${i + 1}. ${escapeHtml(recordTitle(r, i))}</option>`)
    .join('');
}
$('recordsel').addEventListener('change', (e) => {
  if (state.dirty && !confirm('Discard unsaved changes?')) {
    e.target.value = String(state.recordIndex);
    return;
  }
  loadRecord(+e.target.value);
});

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
  // a quiz node answers clicks rather than placing stones: pointer, no ghost
  const node = state.game.current;
  const quiz = state.isWgf && isQuiz(node);
  // In .wgf the play tool navigates (no stone placed), so no ghost there.
  const placing = !quiz && (state.solve || state.engine || state.explore
    || (state.tool === 'play' && !state.isWgf));
  const busy = state.engineBusy || state.exploreBusy;
  board.setGhost(placing && !busy ? state.game.nextColor() : null);
  if (state.isWgf && state.tool === 'play') board.canvas.style.cursor = 'pointer';
}

// Dojo encodes a multi-board "n-up" layout in XC: the tens digit is the
// split (2x = side-by-side halves, 4x/6x = 2×2 quadrants), achieved by
// omitting the centre column and/or row line.
function splitFor(node) {
  if (!state.isWgf) return null;
  const xc = parseInt((node.props.XC || [])[0], 10);
  const tens = Number.isFinite(xc) ? Math.floor(xc / 10) : 0;
  return tens >= 2 ? { col: true, row: tens >= 4 } : null;
}

// Board annotations carried by a node: a shaded region (TT), lines and
// direction arrows (LN/LR plain, LS arrow), and continuation ghost stones
// (YB/YW black/white, numbered by any LB label on the same point).
function annotationOverlays(node, size) {
  const lb = {};
  for (const e of node.props.LB || []) {
    const i = e.indexOf(':');
    const p = parsePoint(e.slice(0, i), size);
    if (p) lb[`${p.x},${p.y}`] = e.slice(i + 1);
  }
  const ghosts = [];
  for (const [prop, color] of [['YB', BLACK], ['YW', WHITE]]) {
    for (const v of node.props[prop] || []) {
      const p = parsePoint(v, size);
      if (p) ghosts.push({ ...p, color, label: lb[`${p.x},${p.y}`] || '' });
    }
  }
  const lines = [];
  for (const [prop, dashed] of [['LN', false], ['LR', false], ['LS', true]]) {
    for (const v of node.props[prop] || []) {
      const [a, b] = v.split(':');
      const p = parsePoint(a, size), q = parsePoint(b, size);
      if (p && q) lines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, dashed });
    }
  }
  const regions = (node.props.TT || []).map((v) => parsePoint(v, size)).filter(Boolean);
  return {
    ghosts: ghosts.length ? ghosts : null,
    lines: lines.length ? lines : null,
    regions: regions.length ? regions : null,
  };
}

function refresh() {
  const game = state.game;
  if (!game) return;
  if (state.quizSolved && state.quizSolved !== game.current) state.quizSolved = null;
  if (state.quiz && state.quiz.node !== game.current) { // left the quiz
    state.quiz = null;
    board.setQuizFound(null);
    feedback('', ''); // erase the quiz verdict (e.g. the green "✓ Yes")
  }
  const pos = game.position();
  // A .wgf quiz node's own marks are its answer key; hide the marks on
  // answer points while it's unsolved so the quiz isn't spoiled. Once
  // solved, reveal them and add the answer's XS display marks.
  let revealLines = null;
  if (state.isWgf && isQuiz(game.current)) {
    const quiz = ensureQuiz(game.current);
    if (state.quizSolved === game.current) {
      const reveal = displayMarks(game.current, quiz.revealKey, game.size);
      pos.marks = pos.marks.concat(reveal.marks);
      revealLines = reveal.lines;
    } else {
      const ans = quiz.answerPoints();
      pos.marks = pos.marks.filter((m) => !ans.has(String.fromCharCode(97 + m.x, 97 + m.y)));
    }
    // stones placed by consumed sequence answers (YS guided playouts)
    for (const p of quiz.placed) pos.grid[p.y][p.x] = p.color === 'B' ? BLACK : WHITE;
    board.setQuizFound(quiz.foundOverlay());
  }
  board.setPosition(pos);
  board.setView(game.viewRect()); // honor SGF VW board-crop
  board.setSplit(splitFor(game.current)); // Dojo "n-up" quadrant boards
  const ov = annotationOverlays(game.current, game.size); // TT/LN/LR/LS/YB/YW
  board.setRegions(ov.regions);
  board.setLines(revealLines ? (ov.lines || []).concat(revealLines) : ov.lines);
  board.setWgfGhosts(ov.ghosts);
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
  document.body.classList.toggle('treeoutline', !!tree.isOutline);
  tree.update();
  if (state.file) {
    // Bookmarkable position: #dir/file.sgf@move (replaceState: no history spam)
    const hash = `#${encodeURIComponent(join(state.dir, state.file))}@${pos.moveNumber}`;
    history.replaceState(null, '', hash);
  }
  if (state.isWgf) renderWgfComment($('comment'), game.current);
  else renderComment($('comment'), game.comment(), pos.marks);
  placeComment();
  const box = $('commentbox');
  if (document.activeElement !== box) box.value = game.comment();
  $('movecount').textContent =
    `move ${pos.moveNumber} / ${game.lineLength()}` +
    ` · captures ● ${pos.captures[BLACK]} ○ ${pos.captures[WHITE]}`;
  // "X at Y" notes for points replayed after a capture (only meaningful
  // when move numbers are shown)
  $('movesat').textContent = board.showNumbers && pos.movesAt.length
    ? pos.movesAt.map((n) => `${n.lost} at ${n.shown}`).join(' · ')
    : '';
  if (state.joseki) {
    updateJoseki(pos);
  } else if (board.josekiGhosts || board.josekiMarks) {
    board.setJosekiGhosts(null);
    board.setJosekiMarks(null);
  }
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

// A long node comment (e.g. a .wgf lesson) moves into a scrolling panel
// below the tree, like the joseki browser; short comments stay under the
// board. Measured at board width; never relocated while in joseki mode
// (which owns that panel region).
function placeComment() {
  const el = $('comment');
  const main = document.querySelector('main');
  main.appendChild(el); // back under the board to measure at full width
  const cs = getComputedStyle(el);
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45;
  const long = !state.joseki && el.textContent.trim() && el.offsetHeight > line * 3.3;
  document.body.classList.toggle('sidecomment', long);
  if (long) $('commentbody').appendChild(el);
}

// Render a Dojo comment with _underscored_ phrases as clickable links.
// Each distinct link text pairs with a YG[] entry in order of first
// appearance (a repeated phrase reuses the same target).
function renderWgfComment(el, node) {
  el.textContent = '';
  const order = new Map(); // link text -> YG index
  for (const tok of tokenizeComment((node.props.C || []).join('\n'))) {
    if (tok.link) {
      if (!order.has(tok.text)) order.set(tok.text, order.size);
      const a = document.createElement('span');
      a.className = 'wlink';
      a.textContent = tok.text;
      a.dataset.i = order.get(tok.text);
      el.append(a);
    } else {
      el.append(tok.text);
    }
  }
}

// Follow the k-th link in the current node's comment, via its YG[]
// targets (positional), with YF as the fallback / "Next".
function followWgfLink(k, text) {
  const node = state.game.current;
  const yg = node.props.YG || [];
  const yf = (node.props.YF || [])[0];
  let target = null;
  if (yg[k]) target = parseLinkTarget(yg[k]); // explicit target wins
  else if (findWgfName(text.trim())) target = { name: text.trim() }; // link text is a node name
  else if (yf) target = { name: yf }; // e.g. "Next"
  else if (node.children.length) target = { next: true }; // "continue" link → next slide
  if (target) navigateWgf(target);
}

// Case-insensitive node-name lookup in the current file.
function findWgfName(name) {
  if (!state.wgfNames) return null;
  if (state.wgfNames.has(name)) return state.wgfNames.get(name);
  const lower = name.toLowerCase();
  for (const [k, v] of state.wgfNames) if (k.toLowerCase() === lower) return v;
  return null;
}

function navigateWgf(target) {
  if (target.next) { if (state.game.next()) refresh(); return; }
  const hit = target.name && findWgfName(target.name);
  if (hit) {
    if (hit.recordIndex !== state.recordIndex) loadRecord(hit.recordIndex);
    state.game.goTo(hit.node);
    refresh();
  } else if (target.file) {
    loadCrossFileLink(target);
  } else {
    feedback('offpath', `link target not found: ${target.name || target.file}`);
  }
}

// A cross-file link (":B:other.wgf:.label"): load that file, then jump
// to the labelled node if present.
async function loadCrossFileLink(target) {
  await loadFile(target.file);
  const hit = target.label && findWgfName(target.label);
  if (hit) {
    if (hit.recordIndex !== state.recordIndex) loadRecord(hit.recordIndex);
    state.game.goTo(hit.node);
    refresh();
  }
}

// the comment element moves between the board column and the notes panel,
// so the listener lives on the element itself
$('comment').addEventListener('click', (e) => {
  const a = e.target.closest('.wlink');
  if (a && state.isWgf && state.game) followWgfLink(+a.dataset.i, a.textContent);
});

// ---------- Dojo quizzes ---------------------------------------------------
// A quiz node has an answer list (YN "pick the move", YA "find all", or the
// YO/YS ordered sequences) of entries — single points, click-both-endpoints
// pairs (sector lines), any-of groups — with XS[score:response] feedback.
// The grammar and interaction rules live in quiz.js; this section renders
// its results and owns the solved/continue flow.

function ensureQuiz(node) {
  if (state.quiz?.node !== node) state.quiz = new Quiz(node, state.game.size);
  return state.quiz;
}

// The feedback prose for a score: the node's own XS (its leading display
// marks stripped), falling back to the file-wide reason map.
function quizResponse(node, score) {
  for (const e of node.props.XS || []) {
    if (!e.startsWith(`${score}:`)) continue;
    const prose = xsProse(e.slice(score.length + 1));
    if (prose) return prose;
    break;
  }
  return state.wgfResponses?.[score] ?? null;
}

// The board marks and lines carried inside an XS display response (the
// leading TR[..]/LR[..]/LB[..]… before the prose) — the answer reveal.
const REVEAL_SHAPE = {
  TR: 'triangle', XT: 'triangle', CR: 'circle', XU: 'circle', SQ: 'square', MA: 'x',
  TB: 'territory-b', TW: 'territory-w', // a TB/TW on a stone marks "the marked stone"
};
const REVEAL_LINE = { LN: false, LR: false, LS: true }; // prop -> dashed
function displayMarks(node, score, size) {
  const xs = (node.props.XS || []).find((e) => e.startsWith(`${score}:`));
  if (!xs) return { marks: [], lines: [] };
  const lead = (xs.slice(score.length + 1).match(/^([A-Z]{1,2}(?:\[[^\][]*\])+)+/) || [''])[0];
  const marks = [];
  const lines = [];
  const re = /([A-Z]{1,2})((?:\[[^\][]*\])+)/g;
  for (let m; (m = re.exec(lead)); ) {
    const prop = m[1];
    for (const raw of m[2].match(/\[([^\][]*)\]/g)) {
      const v = raw.slice(1, -1);
      if (prop === 'LB') {
        const i = v.indexOf(':');
        const pt = parsePoint(v.slice(0, i), size);
        if (pt) marks.push({ ...pt, type: 'label', text: v.slice(i + 1) });
      } else if (prop in REVEAL_LINE) {
        const [a, b] = v.split(':');
        const p = parsePoint(a, size), q = parsePoint(b || '', size);
        if (p && q) lines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, dashed: REVEAL_LINE[prop] });
      } else {
        const pt = parsePoint(v, size);
        if (!pt) continue;
        if (REVEAL_SHAPE[prop]) marks.push({ ...pt, type: REVEAL_SHAPE[prop] });
        else if (/^X[A-Z]$/.test(prop)) marks.push({ ...pt, type: 'label', text: prop[1] });
      }
    }
  }
  return { marks, lines };
}

function quizClick(x, y) {
  const node = state.game.current;
  // Answered correctly already: the reveal is showing — any click continues
  // to the next turn (Dojo: "click to get to the next turn").
  if (state.quizSolved === node) {
    state.quizSolved = null;
    state.game.next();
    refresh();
    return;
  }
  const quiz = ensureQuiz(node);
  // pairs join stones; the rendered grid includes quiz-placed stones
  const isStone = board.position.grid[y][x] !== EMPTY;
  const r = quiz.click(x, y, isStone);
  const prose = r.resp != null ? quizResponse(node, r.resp) : null;
  switch (r.kind) {
    case 'pending':
      feedback('', '◐ first endpoint — now click the other end of the line');
      break;
    case 'unselect':
      feedback('', '');
      break;
    case 'again': // already-found answer: nothing new to say
      return;
    case 'miss':
      feedback('offpath', '⊘ not an answer point');
      return;
    case 'wrong':
      feedback('fail', `✗ ${prose || 'not the best — try again'}`);
      break;
    case 'correct': {
      const base = prose || (r.sente ? 'sente' : 'correct');
      if (r.solved) {
        state.quizSolved = node; // reveal; next click continues
        feedback('correct', r.total > 1 ? `✓ all ${r.total} found!` : `✓ ${base}`);
      } else if (r.total) { // find-all progress
        feedback('correct', `✓ ${base} (${r.found}/${r.total})`);
      } else { // ordered quiz: this step is right, more to come
        feedback('correct', `✓ ${base}`);
      }
      break;
    }
  }
  refresh(); // sync overlays (armed endpoint, found lines, placed stones)
}

// Right-click a tree node to inspect its source. For .wgf we show the
// original Dojo properties (captured before our transforms); otherwise the
// node's current properties.
function showNodeSource(node, e) {
  closeNodeSource();
  const pop = document.createElement('div');
  pop.id = 'nodesrc';
  const head = document.createElement('div');
  head.className = 'nshead';
  head.textContent = state.isWgf ? 'node source (.wgf)' : 'node source';
  const close = document.createElement('button');
  close.textContent = '×';
  close.title = 'Close (Esc)';
  close.addEventListener('click', closeNodeSource);
  head.appendChild(close);
  const pre = document.createElement('pre');
  pre.textContent = node.source ?? propsToText(node.props) ?? '';
  if (!pre.textContent.trim()) pre.textContent = '(empty node)';
  pop.append(head, pre);
  document.body.appendChild(pop);
  // place near the click, clamped into the viewport
  const r = pop.getBoundingClientRect();
  pop.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - r.width - 8))}px`;
  pop.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - r.height - 8))}px`;
  const onKey = (ev) => ev.key === 'Escape' && closeNodeSource();
  const onDown = (ev) => !pop.contains(ev.target) && closeNodeSource();
  pop._cleanup = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mousedown', onDown);
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('mousedown', onDown), 0);
}

function closeNodeSource() {
  const pop = $('nodesrc');
  if (pop) {
    pop._cleanup?.();
    pop.remove();
  }
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
  if (state.isWgf && isQuiz(game.current)) {
    quizClick(x, y);
    return;
  }
  // A .wgf is a guided playout: a plain click steps to the next position
  // (Dojo's "just click"), it does not place a stone or start a variation.
  // (An explicitly chosen mark tool still annotates — see below.)
  if (state.isWgf && state.tool === 'play') {
    if (game.next()) refresh();
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

// ---------- joseki dictionary matching -------------------------------------

function setJosekiMode(on) {
  state.joseki = on;
  document.body.classList.toggle('joseki', on);
  $('josekibtn').classList.toggle('active', on);
  if (on && !state.josekiIndex && state.josekiStatus !== 'loading') loadJosekiIndex();
  if (state.game) refresh();
}
$('josekibtn').addEventListener('click', () => setJosekiMode(!state.joseki));

async function loadJosekiIndex() {
  state.josekiStatus = 'loading';
  setJosekiBody('<div class="jmsg">loading joseki dictionary…</div>');
  try {
    const res = await fetch(JOSEKI_SGF);
    if (!res.ok) throw new Error(`not found at ${JOSEKI_SGF}`);
    state.josekiIndex = buildIndex(await res.text());
    state.josekiStatus = 'ready';
  } catch (err) {
    state.josekiStatus = 'error';
    setJosekiBody(`<div class="jmsg">⚠ ${err.message}</div>`);
    return;
  }
  if (state.joseki && state.game) refresh();
}

function updateJoseki(pos) {
  if (state.josekiStatus !== 'ready') return; // loading/error message already shown
  const results = matchJosekiAll(state.josekiIndex, pos.grid, state.game.size);
  state.josekiResults = results;
  if (!results.length) {
    board.setJosekiGhosts(null);
    board.setJosekiMarks(null);
    state.josekiBase = null;
    setJosekiBody('<div class="jmsg">no joseki match in any corner</div>');
    return;
  }
  // keep the corner you were looking at if it still matches, else the deepest
  const sel = results.find((r) => r.corner === state.josekiSel) || results[0];
  anchorJoseki(sel);
  renderJosekiNav();
}

// Re-anchor the navigator on a corner's match (resets the walked line).
function anchorJoseki(result) {
  // unchanged only if BOTH the corner and the node are the same — two
  // corners can share one dictionary node (same shape) yet need different
  // transforms, so guarding on the node alone would ignore a corner switch
  if (result.corner === state.josekiSel && result.node === state.josekiBase) return;
  state.josekiSel = result.corner;
  state.josekiBase = result.node;
  state.josekiNode = result.node;
  state.josekiT = result.transform;
  state.josekiMatched = result.matched;
}

// Navigator at state.josekiNode in the dictionary subtree: numbered
// ghosts for the line walked from the match, lettered ghosts for the
// next choices, plus a clickable choice list and comment in the panel.
function renderJosekiNav() {
  const size = state.game.size;
  const { josekiT: T, josekiBase: base, josekiNode: node } = state;
  const toXY = (sx, sy) => T.toBoard(size - 1 - sx, sy);
  // Every stone is coloured by the matched transform (T.col), and the
  // comment is colour-swapped by the same transform (T.swap) — one
  // mapping for both, so ghosts and text never disagree. A joseki you
  // took with the corner as White matches with swap=true, flipping both.
  const path = []; // base (exclusive) → node
  for (let n = node; n && n !== base; n = n.parent) path.push(n);
  path.reverse();
  const ghosts = [];
  path.forEach((n, i) => {
    const st = childStone(n, size);
    if (!st) return;
    const [x, y] = toXY(st.x, st.y);
    ghosts.push({ x, y, color: T.col(st.color), label: String(i + 1) });
  });
  const choices = [];
  node.children.forEach((c, i) => {
    const st = childStone(c, size);
    if (!st) return;
    const [x, y] = toXY(st.x, st.y);
    const letter = childLetter(node, c, size) || String.fromCharCode(97 + i);
    choices.push({ child: c, letter, x, y, color: T.col(st.color), setup: st.setup });
  });
  choices.forEach((ch) => ghosts.push({ x: ch.x, y: ch.y, color: ch.color, label: ch.letter }));
  board.setJosekiGhosts(ghosts.length ? ghosts : null);
  board.setJosekiMarks(josekiMarks(node, T, size));
  state.josekiChoices = choices;

  const where = path.length
    ? `${path.length} move${path.length > 1 ? 's' : ''} into the joseki — board shows the line (numbered)`
    : `matched ${state.josekiMatched} stones`;
  // localize the comment to your board: same transform as the ghosts —
  // swap colours when the match is colour-swapped, rotate direction words
  // by the geometry
  let commentText = node.props.C ? node.props.C.join('\n') : '';
  commentText = localizeComment(commentText, T, T.swap);
  const comment = commentText ? `<div class="jcomment">${escapeHtml(commentText)}</div>` : '';
  const choiceChips = choices.length
    ? '<div class="jcont">' +
      choices.map((ch, i) => `<span class="jmove jchoice" data-i="${i}">${ch.letter}·${coord(ch.x, ch.y, size)}${ch.setup ? ' +stone' : ''}</span>`).join('') +
      '</div>'
    : '<div class="jmsg">(end of this joseki line)</div>';
  const nav = (node !== base ? '<span class="jmove jback">↑ back</span>' : '') +
    (path.length ? '<span class="jmove jplay">play this line into my game</span>' : '');
  // corner selector when more than one corner matched
  const corners = state.josekiResults.length > 1
    ? '<div class="jcont jcorners">' + state.josekiResults.map((r) =>
        `<span class="jmove jcorner${r.corner === state.josekiSel ? ' sel' : ''}" data-c="${r.corner}" title="${CORNER_NAMES[r.corner]}">${CORNER_NAMES[r.corner].split(' ')[0]} ${r.matched}</span>`).join('') +
      '</div>'
    : '';
  setJosekiBody(
    corners +
    `<div class="jmsg">${where}; pick a variation:</div>` +
    comment + choiceChips + (nav ? `<div class="jcont jnav">${nav}</div>` : ''),
  );
}

// A child's representative stone — a move, or a single setup stone (the
// "additional stone on the triangled position" variations). {x,y,color,setup}.
function childStone(node, size) {
  const mv = moveOf(node, size);
  if (mv) return mv.pass ? null : { x: mv.x, y: mv.y, color: mv.color, setup: false };
  const s = singleSetup(node, size);
  return s ? { x: s.x, y: s.y, color: s.color, setup: true } : null;
}

// The joseki node's own marks (triangle etc.) mapped onto your board.
function josekiMarks(node, T, size) {
  const marks = [];
  for (const [prop, type] of JOSEKI_MARKS) {
    for (const v of node.props[prop] || []) {
      if (v.length < 2 || v.includes(':')) continue; // single points only
      const px = v.charCodeAt(0) - 97;
      const py = v.charCodeAt(1) - 97;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const [x, y] = T.toBoard(size - 1 - px, py);
      marks.push({ x, y, type });
    }
  }
  return marks.length ? marks : null;
}

function childLetter(parent, child, size) {
  const st = childStone(child, size);
  if (!st) return null;
  const mv = { x: st.x, y: st.y };
  const pt = String.fromCharCode(97 + mv.x, 97 + mv.y); // child's move as a dict SGF point
  for (const v of parent.props.LB || []) {
    const i = v.indexOf(':');
    if (i >= 0 && v.slice(0, i) === pt) return v.slice(i + 1);
  }
  return null;
}

// Rewrite a joseki comment so its colour and direction words match how
// the joseki actually sits on your board. The dictionary is written for
// the top-right corner with Black first; under a colour-swapped or
// rotated/reflected match those words must follow, or the description
// contradicts the stones. Word boundaries keep "copyright" etc. safe.
function localizeComment(text, T, colorSwap) {
  if (colorSwap) {
    text = text.replace(/\b(black|white)\b/gi, (m) =>
      matchCase(m, m[0].toLowerCase() === 'b' ? 'white' : 'black'));
  }
  // direction permutation induced by the geometry (corner + diagonal)
  const dir = {
    top: boardDir(T, 0, -1),
    bottom: boardDir(T, 0, 1),
    left: boardDir(T, 1, 0),
    right: boardDir(T, -1, 0),
  };
  if (dir.top === 'top' && dir.left === 'left') return text; // identity geometry
  return text.replace(/\b(upper|lower|top|bottom|left|right)\b/gi, (m) => {
    const lw = m.toLowerCase();
    const key = lw === 'upper' ? 'top' : lw === 'lower' ? 'bottom' : lw;
    return matchCase(m, dir[key]);
  });
}

// The board direction a canonical (dict-frame) step maps to under T.
function boardDir(T, du, dv) {
  const [ax, ay] = T.toBoard(5, 5);
  const [bx, by] = T.toBoard(5 + du, 5 + dv);
  if (bx !== ax) return bx > ax ? 'right' : 'left';
  return by > ay ? 'bottom' : 'top'; // board y grows downward
}

function matchCase(orig, repl) {
  if (orig === orig.toUpperCase()) return repl.toUpperCase();
  if (orig[0] === orig[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

function setJosekiBody(html) {
  $('josekibody').innerHTML = html;
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Navigate the dictionary (descend into a choice, back up) or commit the
// walked line into your own game.
$('josekibody').addEventListener('click', (e) => {
  if (!state.game || !state.josekiBase) return;
  const cornerEl = e.target.closest('.jcorner');
  if (cornerEl) {
    const r = state.josekiResults.find((x) => x.corner === +cornerEl.dataset.c);
    if (r) {
      anchorJoseki(r);
      renderJosekiNav();
    }
    return;
  }
  if (e.target.closest('.jback')) {
    if (state.josekiNode !== state.josekiBase) state.josekiNode = state.josekiNode.parent;
    renderJosekiNav();
  } else if (e.target.closest('.jchoice')) {
    const ch = state.josekiChoices[+e.target.closest('.jchoice').dataset.i];
    if (ch) {
      state.josekiNode = ch.child;
      renderJosekiNav();
    }
  } else if (e.target.closest('.jplay')) {
    playJosekiLine();
  }
});

function playJosekiLine() {
  const size = state.game.size;
  const { josekiT: T, josekiBase: base, josekiNode: node } = state;
  const path = [];
  for (let n = node; n && n !== base; n = n.parent) path.push(n);
  path.reverse();
  for (const n of path) {
    const mv = moveOf(n, size);
    if (!mv || mv.pass) continue;
    const [x, y] = T.toBoard(size - 1 - mv.x, mv.y);
    if (state.game.playAt(x, y) === null) break;
  }
  setDirty(true);
  tree.setGame(state.game);
  refresh();
}

// ---------- move numbers (view toggle) -------------------------------------

function setNumbers(on) {
  board.setShowNumbers(on);
  $('numbersbtn').classList.toggle('active', on);
  localStorage.setItem('sgf-numbers', on ? '1' : '');
  if (state.game) refresh(); // sync the "X at Y" notes line
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

// Each browser tab gets its own crash-recovery slot, keyed by a per-tab id
// kept in sessionStorage (survives reload, unique per tab), so tabs don't
// overwrite each other's unsaved work. View prefs and pane sizes stay shared
// (plain keys). A live tab refreshes its slot's timestamp on a heartbeat;
// a fresh tab may adopt a slot whose timestamp has gone stale (a tab that
// closed or crashed), which restores work after a browser restart.
function tabId() {
  let id = sessionStorage.getItem('sgf-tab');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    sessionStorage.setItem('sgf-tab', id);
  }
  return id;
}
const SESSION_KEY = `sgf-session:${tabId()}`;
const SESSION_STALE = 30_000; // a slot older than this isn't from a live tab

(() => { // one-time housekeeping: migrate the old single slot; drop ancient ones
  const legacy = localStorage.getItem('sgf-session');
  if (legacy && !localStorage.getItem(SESSION_KEY)) localStorage.setItem(SESSION_KEY, legacy);
  localStorage.removeItem('sgf-session');
  const cutoff = Date.now() - 7 * 864e5; // 7 days
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith('sgf-session:') || k === SESSION_KEY) continue;
    let s; try { s = JSON.parse(localStorage.getItem(k)); } catch { s = null; }
    if (!s || (s.ts || 0) < cutoff) localStorage.removeItem(k);
  }
})();
setInterval(saveSession, 10_000); // heartbeat: keep a live tab's slot fresh
let persistTimer = null;

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(saveSession, 400);
  scheduleAutosave();
}

// Autosave an unsaved (new) game to autosaves/ once it passes 10 moves,
// so games you never explicitly saved aren't lost. Reuses one filename
// per game (overwrites as it grows); skips files you opened or saved.
let autosaveTimer = null;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(maybeAutosave, 1500);
}

async function maybeAutosave() {
  if (!state.game || state.file) return; // only never-saved games
  if (state.game.lineLength() <= 10) return;
  if (!state.autosaveName) {
    const ts = new Date().toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
    state.autosaveName = `game-${ts}-${tabId().slice(0, 6)}.sgf`; // per-tab: avoid collisions
  }
  const path = `autosaves/${state.autosaveName}`;
  try {
    const res = await fetch(`/api/save?path=${encodeURIComponent(path)}`, {
      method: 'POST',
      body: state.game.serialize(),
    });
    if (res.ok) $('savestatus').textContent = `autosaved → ${path}`;
  } catch {
    /* best-effort */
  }
}

function saveSession() {
  if (!state.game || !state.dirty) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      ts: Date.now(), // heartbeat / liveness for cross-tab slot ownership
      sgf: state.game.serialize(),
      path: nodePath(state.game), // child indices root → current node
      dir: state.dir,
      file: state.file, // null for a never-saved game
      name: $('savename').value,
      title: document.title,
      autosaveName: state.autosaveName, // keep writing the same autosave file
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
  let raw = localStorage.getItem(SESSION_KEY);
  if (!raw) {
    // fresh tab with no slot of its own: recover the most recent slot left
    // by a tab that's no longer live (closed/crashed) and claim it. Live
    // tabs heartbeat their timestamp, so we never steal an active tab's slot.
    const orphans = Object.keys(localStorage)
      .filter((k) => k.startsWith('sgf-session:') && k !== SESSION_KEY)
      .map((k) => { try { return [k, JSON.parse(localStorage.getItem(k))]; } catch { return null; } })
      .filter((e) => e?.[1] && Date.now() - (e[1].ts || 0) > SESSION_STALE)
      .sort((a, b) => (b[1].ts || 0) - (a[1].ts || 0));
    if (orphans.length) {
      raw = localStorage.getItem(orphans[0][0]);
      localStorage.removeItem(orphans[0][0]);
      localStorage.setItem(SESSION_KEY, raw); // claim it for this tab
    }
  }
  let s;
  try {
    s = JSON.parse(raw || 'null');
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
  state.autosaveName = s.autosaveName ?? null;
  state.records = null;
  state.isWgf = false;
  tree.allowOutline = false;
  renderRecordBar();
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
  state.records = null;
  state.isWgf = false;
  tree.allowOutline = false;
  renderRecordBar();
  state.autosaveName = null; // this game gets its own autosave file
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
  j: () => setJosekiMode(!state.joseki),
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

// Draggable splitters between the panels (sizes persist in localStorage).
columnSplitter($('lsplit'), { side: 'left', min: 150, max: 480, store: 'sgf-lcol' });
columnSplitter($('rsplit'), { side: 'right', min: 220, max: 760, store: 'sgf-rcol' });
rowSplitter($('split-tree'), $('tree'), { pos: 'above', varName: '--toch', min: 48, max: 600, store: 'sgf-toch' });
rowSplitter($('split-edit'), $('editpane'), { pos: 'below', varName: '--edith', min: 90, max: 700, store: 'sgf-edith' });

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
