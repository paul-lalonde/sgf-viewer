// joseki.js — match a board position against a joseki dictionary
// (Kogo's, which lives entirely in the top-right corner, Black first).
//
// Matching is shape-based (order-independent) and tolerant: a dictionary
// node matches if its stones are a SUBSET of the stones in one of your
// board's corners, under the full 16-fold symmetry — 4 corners ×
// diagonal reflection × colour swap. The best match is the node with the
// most stones (deepest into the joseki); ties prefer a commented node
// with more continuation.
//
// Coordinates: everything is normalized to a corner-relative frame with
// the corner at (u=0, v=0) and u, v increasing into the board — the same
// frame the dictionary's own top-right corner sits in.

import { parseSGF } from './sgf.js';
import { moveOf } from './game.js';
import { BLACK, WHITE, EMPTY } from './colors.js';

const WIN = 10; // corner window depth (lines from the corner) considered

const key = (color, u, v) => (color << 10) | (u << 5) | v; // u,v < 32

// --- index -----------------------------------------------------------------

// Build an index over the whole dictionary tree. One pass, applying and
// undoing each move on a shared board so captures are handled correctly.
export function buildIndex(sgfText) {
  const root = parseSGF(sgfText)[0];
  if (!root) throw new Error('empty joseki dictionary');
  const size = parseInt((root.props.SZ || ['19'])[0], 10) || 19;
  const grid = Array.from({ length: size }, () => new Int8Array(size));
  const byAnchor = new Map(); // anchor key -> [{node, stones, anchor}]
  let count = 0;

  const stack = [{ node: root, phase: 0, undo: null }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.phase === 0) {
      frame.phase = 1;
      if (frame.node.parent) frame.undo = applyMove(grid, frame.node, size);
      const stones = cornerStones(grid, size);
      if (stones.length) {
        const entry = { node: frame.node, stones, anchor: stones[0] };
        let list = byAnchor.get(entry.anchor);
        if (!list) byAnchor.set(entry.anchor, (list = []));
        list.push(entry);
        count++;
      }
      for (const c of frame.node.children) stack.push({ node: c, phase: 0, undo: null });
    } else {
      if (frame.undo) frame.undo();
      stack.pop();
    }
  }
  return { byAnchor, size, count };
}

// Place node's move, capturing dead enemy groups; return an undo closure.
function applyMove(grid, node, size) {
  const mv = moveOf(node, size);
  if (!mv || mv.pass) return null;
  const { x, y, color } = mv;
  grid[y][x] = color;
  const enemy = color === BLACK ? WHITE : BLACK;
  const captured = [];
  for (const [nx, ny] of neighbors(x, y, size)) {
    if (grid[ny][nx] === enemy) removeIfDead(grid, nx, ny, size, captured);
  }
  return () => {
    grid[y][x] = EMPTY;
    for (const [cx, cy] of captured) grid[cy][cx] = enemy;
  };
}

function removeIfDead(grid, x, y, size, out) {
  const color = grid[y][x];
  const group = [];
  const stack = [[x, y]];
  const seen = new Set([y * size + x]);
  while (stack.length) {
    const [cx, cy] = stack.pop();
    group.push([cx, cy]);
    for (const [nx, ny] of neighbors(cx, cy, size)) {
      if (grid[ny][nx] === EMPTY) return; // a liberty: alive
      if (grid[ny][nx] === color && !seen.has(ny * size + nx)) {
        seen.add(ny * size + nx);
        stack.push([nx, ny]);
      }
    }
  }
  for (const [gx, gy] of group) {
    grid[gy][gx] = EMPTY;
    out.push([gx, gy]);
  }
}

function neighbors(x, y, size) {
  const out = [];
  if (x > 0) out.push([x - 1, y]);
  if (x < size - 1) out.push([x + 1, y]);
  if (y > 0) out.push([x, y - 1]);
  if (y < size - 1) out.push([x, y + 1]);
  return out;
}

// Stones in the dictionary's canonical top-right window, sorted.
function cornerStones(grid, size) {
  const out = [];
  for (let v = 0; v < WIN; v++) {
    for (let u = 0; u < WIN; u++) {
      const s = grid[v][size - 1 - u];
      if (s) out.push(key(s, u, v));
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

// --- transforms ------------------------------------------------------------

// One of the 16 symmetries: maps your board (x,y,colour) into the
// canonical frame, and back. corner ∈ 0..3, diag/swap booleans.
export function makeTransform(corner, diag, swap, size) {
  const N = size - 1;
  const toCanon = (x, y) => {
    let u = corner & 1 ? x : N - x; // bit0: keep x (left corners) vs flip
    let v = corner & 2 ? N - y : y; // bit1: flip y (bottom corners)
    return diag ? [v, u] : [u, v];
  };
  const toBoard = (u, v) => {
    if (diag) [u, v] = [v, u];
    return [corner & 1 ? u : N - u, corner & 2 ? N - v : v];
  };
  const col = (c) => (swap && c ? (c === BLACK ? WHITE : BLACK) : c);
  return { toCanon, toBoard, col, corner, diag, swap };
}

const TRANSFORMS = [];
for (let corner = 0; corner < 4; corner++) {
  for (const diag of [false, true]) {
    for (const swap of [false, true]) TRANSFORMS.push({ corner, diag, swap });
  }
}

// --- match -----------------------------------------------------------------

// Best dictionary match in EACH of your board's corners, deepest first.
// Returns [{corner, node, matched, transform, comment}] (one per corner
// that has a match of at least minStones).
export function matchAll(index, grid, size, { minStones = 2 } = {}) {
  const best = new Map(); // corner -> {entry, T}
  for (const { corner, diag, swap } of TRANSFORMS) {
    const T = makeTransform(corner, diag, swap, size);
    const Q = cornerSetUnder(grid, size, T);
    if (Q.size < minStones) continue;
    const seen = new Set();
    for (const k of Q) {
      const list = index.byAnchor.get(k);
      if (!list) continue;
      for (const entry of list) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (entry.stones.length < minStones) continue;
        if (!subset(entry.stones, Q)) continue;
        const cur = best.get(corner);
        if (!cur || better(entry, cur.entry)) best.set(corner, { entry, T });
      }
    }
  }
  const results = [];
  for (const [corner, b] of best) {
    results.push({
      corner,
      node: b.entry.node,
      matched: b.entry.stones.length,
      transform: b.T,
      comment: (b.entry.node.props.C || []).join('\n'),
    });
  }
  return results.sort((a, b) => b.matched - a.matched);
}

// Single best match across all corners (deepest), with its mainline
// continuation; null if nothing matches.
export function match(index, grid, size, opts) {
  const all = matchAll(index, grid, size, opts);
  if (!all.length) return null;
  const m = all[0];
  return { ...m, continuation: continuation(m.node, m.transform, size) };
}

function cornerSetUnder(grid, size, T) {
  const Q = new Set();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = grid[y][x];
      if (!s) continue;
      const [u, v] = T.toCanon(x, y);
      if (u >= 0 && u < WIN && v >= 0 && v < WIN) Q.add(key(T.col(s), u, v));
    }
  }
  return Q;
}

function subset(stones, Q) {
  for (const k of stones) if (!Q.has(k)) return false;
  return true;
}

// Prefer more stones; tie-break toward a commented node with more children.
function better(entry, prev) {
  if (entry.stones.length !== prev.stones.length) return entry.stones.length > prev.stones.length;
  const score = (n) => (n.props.C ? 2 : 0) + Math.min(n.children.length, 1);
  return score(entry.node) > score(prev.node);
}

// The matched node's mainline continuation, mapped onto your board.
function continuation(node, T, size, max = 12) {
  const moves = [];
  let n = node;
  while (n.children.length && moves.length < max) {
    n = n.children[0];
    const mv = moveOf(n, size);
    if (!mv || mv.pass) break;
    const [u, v] = [size - 1 - mv.x, mv.y]; // dict move → canonical frame
    const [x, y] = T.toBoard(u, v);
    moves.push({ x, y, color: T.col(mv.color) });
  }
  return moves;
}
