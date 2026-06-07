// game.js — SGF game state and navigation. Rules logic (captures) lives
// here; rendering does not.

import { parseSGF } from './sgf.js';
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
      if (!mv) continue;
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
}

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
