// game.js — SGF game state and navigation. Rules logic (captures) lives
// here; rendering does not.

import { parseSGF, writeSGF } from './sgf.js';
import { EMPTY, BLACK, WHITE, emptyGrid } from './colors.js';

export class Game {
  constructor(text) {
    const games = parseSGF(text);
    if (!games.length || !games[0]) throw new Error('no game tree found');
    this.root = games[0];
    this.size = parseInt((this.root.props.SZ || ['19'])[0], 10) || 19;
    this.current = this.root;
  }

  rootProp(name) {
    return (this.root.props[name] || [])[0];
  }

  comment() {
    return (this.current.props.C || []).join('\n');
  }

  path() {
    const nodes = [];
    for (let n = this.current; n; n = n.parent) nodes.push(n);
    return nodes.reverse();
  }

  // Replay from the root to the current node. Returns
  // {grid, lastMove, moveNumber, captures: {[BLACK], [WHITE]}, marks}.
  position() {
    const grid = emptyGrid(this.size);
    let lastMove = null;
    let moveNumber = 0;
    const captures = { [BLACK]: 0, [WHITE]: 0 };
    for (const node of this.path()) {
      applySetup(grid, node, this.size);
      const mv = moveOf(node, this.size);
      if (!mv) {
        // old demo lines add stones via AB/AW: ring the added stone
        const setup = singleSetup(node, this.size);
        if (setup) lastMove = setup;
        continue;
      }
      moveNumber++;
      if (mv.pass) {
        lastMove = null;
        continue;
      }
      captures[mv.color] += playMove(grid, mv);
      lastMove = mv;
    }
    return { grid, lastMove, moveNumber, captures, marks: marksOf(this.current, this.size) };
  }

  // Effective board-crop (SGF VW) at the current node: the bounding box
  // of the last VW point list on the path (VW is inherited; an empty VW
  // resets to the whole board). Returns {x0,y0,x1,y1} or null.
  viewRect() {
    let points = null;
    for (const node of this.path()) {
      if ('VW' in node.props) {
        points = (node.props.VW || []).flatMap((v) => expandPoints(v, this.size));
      }
    }
    if (!points || !points.length) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  // --- navigation ------------------------------------------------------
  // Each node remembers its preferred child (`pref`) so walking back and
  // forth retraces the variation you were on.

  next() {
    const kids = this.current.children;
    if (!kids.length) return this._nextSibling();
    this.current = kids[Math.min(this.current.pref ?? 0, kids.length - 1)];
    return true;
  }

  // In-order continuation at the end of a line: jump to the start of the
  // next sibling variation at the innermost enclosing split; after the
  // last variation, resume the parent line's continuation past the split.
  // Never descends into a subtree on its own.
  _nextSibling() {
    for (let n = this.current; n.parent; n = n.parent) {
      const idx = n.parent.children.indexOf(n);
      if (idx > 0) {
        const sibs = n.parent.children;
        this.goTo(sibs[idx + 1 < sibs.length ? idx + 1 : 0]);
        return true;
      }
    }
    return false;
  }

  prev() {
    const parent = this.current.parent;
    if (!parent) return false;
    parent.pref = parent.children.indexOf(this.current);
    this.current = parent;
    return true;
  }

  forward(n) {
    for (let i = 0; i < n; i++) if (!this.next()) return;
  }

  back(n) {
    for (let i = 0; i < n; i++) if (!this.prev()) return;
  }

  toStart() {
    this.current = this.root;
  }

  toEnd() {
    // end of the current line only — no in-order hop to a sibling
    while (this.current.children.length) this.next();
  }

  goTo(node) {
    this.current = node;
    for (let n = node; n.parent; n = n.parent) {
      n.parent.pref = n.parent.children.indexOf(n);
    }
  }

  // Switch to the previous/next sibling variation of the current node.
  variation(delta) {
    const parent = this.current.parent;
    if (!parent || parent.children.length < 2) return false;
    const i = parent.children.indexOf(this.current) + delta;
    if (i < 0 || i >= parent.children.length) return false;
    this.current = parent.children[i];
    parent.pref = i;
    return true;
  }

  // Number of moves on the currently-preferred line, for "move x / y".
  lineLength() {
    let count = 0;
    for (let n = this.root; n; n = n.children[Math.min(n.pref ?? 0, n.children.length - 1)]) {
      if (isMove(n)) count++;
      if (!n.children.length) break;
    }
    return count;
  }

  // Child of the current node whose move is at (x, y) — used for
  // click-to-follow navigation on the board.
  childAt(x, y) {
    return this.current.children.find((c) => {
      const mv = moveOf(c, this.size);
      return mv && !mv.pass && mv.x === x && mv.y === y;
    });
  }

  // --- editing ---------------------------------------------------------

  // Whose turn at the current node: a PL (player-to-play) property wins,
  // else opposite of the last move played, else White for handicap
  // games, else Black.
  nextColor() {
    for (let n = this.current; n; n = n.parent) {
      const pl = (n.props.PL || [])[0];
      if (pl) return pl.toUpperCase() === 'W' ? WHITE : BLACK;
      if ('B' in n.props) return WHITE;
      if ('W' in n.props) return BLACK;
    }
    return parseInt(this.rootProp('HA') || '0', 10) > 1 ? WHITE : BLACK;
  }

  // Play at (x, y): follow an existing child, else add a node — at the
  // end of a line this appends, mid-line it opens a new variation.
  // Returns 'followed' | 'added' | null (occupied point).
  playAt(x, y) {
    if (this.position().grid[y][x] !== EMPTY) return null;
    const existing = this.childAt(x, y);
    if (existing) {
      this.goTo(existing);
      return 'followed';
    }
    const prop = this.nextColor() === BLACK ? 'B' : 'W';
    const node = { props: { [prop]: [pt(x, y)] }, parent: this.current, children: [] };
    this.current.children.push(node);
    this.goTo(node);
    return 'added';
  }

  // Toggle a mark of `type` at (x, y) on the current node.
  toggleMark(type, x, y) {
    const point = pt(x, y);
    if (type === 'label') {
      this._toggleLabel(point);
      return;
    }
    const prop = MARK_TO_PROP[type];
    const values = this.current.props[prop] || [];
    const i = values.indexOf(point);
    if (i >= 0) values.splice(i, 1);
    else values.push(point);
    if (values.length) this.current.props[prop] = values;
    else delete this.current.props[prop];
  }

  // Labels get the first unused letter; clicking a labelled point clears it.
  _toggleLabel(point) {
    const values = this.current.props.LB || [];
    const i = values.findIndex((v) => v.startsWith(point + ':'));
    if (i >= 0) values.splice(i, 1);
    else {
      const used = new Set(values.map((v) => v.split(':')[1]));
      let code = 97;
      while (used.has(String.fromCharCode(code))) code++;
      values.push(`${point}:${String.fromCharCode(code)}`);
    }
    if (values.length) this.current.props.LB = values;
    else delete this.current.props.LB;
  }

  setComment(text) {
    if (text.trim()) this.current.props.C = [text];
    else delete this.current.props.C;
  }

  playPass() {
    const prop = this.nextColor() === BLACK ? 'B' : 'W';
    const node = { props: { [prop]: [''] }, parent: this.current, children: [] };
    this.current.children.push(node);
    this.goTo(node);
  }

  // Flatten the path to GTP plays for an engine: setup stones become
  // plays (KataGo accepts consecutive same-color moves). AE (clearing a
  // point) has no GTP equivalent and marks the position unsupported.
  engineMoves() {
    const moves = [];
    let unsupported = false;
    for (const node of this.path()) {
      if (node.props.AE?.length) unsupported = true;
      for (const [prop, color] of [['AB', 'B'], ['AW', 'W']]) {
        for (const value of node.props[prop] || []) {
          for (const pt of expandPoints(value, this.size)) {
            moves.push([color, gtpVertex(pt.x, pt.y, this.size)]);
          }
        }
      }
      const mv = moveOf(node, this.size);
      if (mv) {
        moves.push([mv.color === BLACK ? 'B' : 'W', mv.pass ? 'pass' : gtpVertex(mv.x, mv.y, this.size)]);
      }
    }
    return { moves, unsupported };
  }

  serialize() {
    this.root.props.CA = ['UTF-8']; // we always save as UTF-8
    return writeSGF(this.root);
  }
}

function pt(x, y) {
  return String.fromCharCode(97 + x, 97 + y);
}

// GTP vertex conversion ("Q16"; the column letters skip I).
const GTP_COLS = 'ABCDEFGHJKLMNOPQRST';

export function gtpVertex(x, y, size) {
  return GTP_COLS[x] + (size - y);
}

export function gtpPoint(vertex, size) {
  const m = /^([A-HJ-T])(\d{1,2})$/i.exec(vertex.trim());
  if (!m) return null;
  const x = GTP_COLS.indexOf(m[1].toUpperCase());
  const y = size - parseInt(m[2], 10);
  if (x < 0 || x >= size || y < 0 || y >= size) return null;
  return { x, y };
}

const MARK_TO_PROP = { triangle: 'TR', square: 'SQ', circle: 'CR', x: 'MA' };

export function isMove(node) {
  return 'B' in node.props || 'W' in node.props;
}

export function moveOf(node, size) {
  const color = 'B' in node.props ? BLACK : 'W' in node.props ? WHITE : null;
  if (!color) return null;
  const value = node.props[color === BLACK ? 'B' : 'W'][0] || '';
  const pt = parsePoint(value, size);
  return pt ? { ...pt, color } : { color, pass: true };
}

// Verdict for a solution-tree leaf, per common tsumego conventions:
// TE (tesuji) / BM (bad move) annotations win; otherwise a comment
// containing "correct" (any case) or all-caps "RIGHT" (goproblems
// style — lowercase "right" is Go prose, e.g. "the right side") marks
// success, and every unmarked ending is a refutation.
export function leafVerdict(node) {
  if ('TE' in node.props) return 'correct';
  if ('BM' in node.props) return 'fail';
  const text = (node.props.C || []).join(' ');
  return /\bcorrect\b/i.test(text) || /\bRIGHT\b/.test(text) ? 'correct' : 'fail';
}

// A node that just places one stone (AB/AW, no move) — how old mgt/IGS
// reviews encode demonstration lines. Returns {x, y, color} or null.
export function singleSetup(node, size) {
  if (isMove(node)) return null;
  const ab = node.props.AB || [];
  const aw = node.props.AW || [];
  if (ab.length + aw.length !== 1) return null;
  const points = expandPoints(ab[0] ?? aw[0], size);
  return points.length === 1 ? { ...points[0], color: ab.length ? BLACK : WHITE } : null;
}

export function parsePoint(value, size) {
  if (!value || value.length < 2) return null;
  const x = value.charCodeAt(0) - 97;
  const y = value.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x >= size || y >= size) return null; // includes 'tt' pass
  return { x, y };
}

// --- markup -------------------------------------------------------------

const MARK_PROPS = [
  ['TR', 'triangle'],
  ['M', 'triangle'], // FF[3] "mark": old IGS reviews say "TRIANGLE" in comments
  ['SQ', 'square'],
  ['CR', 'circle'],
  ['MA', 'x'],
  ['TB', 'territory-b'],
  ['TW', 'territory-w'],
];

// Display marks on the current node: shapes, labels, territory.
function marksOf(node, size) {
  const marks = [];
  for (const [prop, type] of MARK_PROPS) {
    for (const value of node.props[prop] || []) {
      for (const pt of expandPoints(value, size)) marks.push({ ...pt, type });
    }
  }
  for (const value of node.props.LB || []) {
    const sep = value.indexOf(':');
    if (sep < 0) continue;
    const pt = parsePoint(value.slice(0, sep), size);
    if (pt) marks.push({ ...pt, type: 'label', text: value.slice(sep + 1) });
  }
  // FF[3] "letters": points get 'a', 'b', 'c'… in declaration order,
  // which is how the old comments reference them.
  for (const [i, value] of (node.props.L || []).entries()) {
    const pt = parsePoint(value, size);
    if (pt) marks.push({ ...pt, type: 'label', text: String.fromCharCode(97 + i) });
  }
  return marks;
}

// --- rules helpers -----------------------------------------------------

const SETUP = [['AB', BLACK], ['AW', WHITE], ['AE', EMPTY]];

function applySetup(grid, node, size) {
  for (const [prop, color] of SETUP) {
    for (const value of node.props[prop] || []) {
      for (const { x, y } of expandPoints(value, size)) grid[y][x] = color;
    }
  }
}

// A point list value is either "ab" or a compressed rectangle "ab:cd".
function expandPoints(value, size) {
  const [from, to] = value.split(':');
  const a = parsePoint(from, size);
  if (!a) return [];
  const b = to ? parsePoint(to, size) : a;
  if (!b) return [a];
  const points = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
      points.push({ x, y });
    }
  }
  return points;
}

// Place a stone, remove dead enemy groups (then suicide). Returns the
// number of enemy stones captured.
function playMove(grid, { x, y, color }) {
  grid[y][x] = color;
  const enemy = color === BLACK ? WHITE : BLACK;
  let captured = 0;
  for (const [nx, ny] of neighbors(grid, x, y)) {
    if (grid[ny][nx] === enemy) captured += captureIfDead(grid, nx, ny);
  }
  captureIfDead(grid, x, y); // suicide is legal under some rules
  return captured;
}

function captureIfDead(grid, x, y) {
  if (grid[y][x] === EMPTY) return 0;
  const { stones, liberties } = groupAt(grid, x, y);
  if (liberties > 0) return 0;
  for (const [sx, sy] of stones) grid[sy][sx] = EMPTY;
  return stones.length;
}

function groupAt(grid, x, y) {
  const size = grid.length;
  const color = grid[y][x];
  const stones = [];
  const stack = [[x, y]];
  const seen = new Set([y * size + x]);
  const libs = new Set();
  while (stack.length) {
    const [cx, cy] = stack.pop();
    stones.push([cx, cy]);
    for (const [nx, ny] of neighbors(grid, cx, cy)) {
      const key = ny * size + nx;
      if (grid[ny][nx] === EMPTY) {
        libs.add(key);
      } else if (grid[ny][nx] === color && !seen.has(key)) {
        seen.add(key);
        stack.push([nx, ny]);
      }
    }
  }
  return { stones, liberties: libs.size };
}

function neighbors(grid, x, y) {
  const size = grid.length;
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < size - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < size - 1) out.push([x, y + 1]);
  return out;
}
