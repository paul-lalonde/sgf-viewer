// joseki.test.js — tests for the joseki matcher's symmetry transforms,
// the parity tie-break for colour-twin positions, the match-alternatives
// list, and comment localization.
// Run: node --test viewer/joseki.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, matchAll, makeTransform, localizeComment } from './joseki.js';
import { BLACK, WHITE, EMPTY, emptyGrid } from './colors.js';

const SIZE = 19;
const put = (grid, pt, color) => {
  grid[pt.charCodeAt(1) - 97][pt.charCodeAt(0) - 97] = color;
};

test('[BEHAVIOR] every transform round-trips points and colours', () => {
  for (let corner = 0; corner < 4; corner++) {
    for (const diag of [false, true]) {
      for (const swap of [false, true]) {
        const T = makeTransform(corner, diag, swap, SIZE);
        for (const [x, y] of [[0, 0], [3, 15], [9, 9], [18, 2]]) {
          const [u, v] = T.toCanon(x, y);
          assert.deepEqual(T.toBoard(u, v), [x, y]);
        }
        assert.equal(T.col(T.col(BLACK)), BLACK);
        assert.equal(T.col(BLACK), swap ? WHITE : BLACK);
        assert.equal(T.col(EMPTY), EMPTY); // empty never swaps
      }
    }
  }
});

// A colour-twin pair: the same two stones appear in two lines, with the
// mover roles reversed. Which line is right depends on whose turn it is.
const TWIN_DICT = `(;GM[1]FF[4]SZ[19]
(;B[pd];W[qf]C[lineA];B[nd])
(;B[qf];W[pd]C[lineB];B[nd]))`;

test('[BEHAVIOR] colour twins resolve by whose turn it is (parity tie-break)', () => {
  const index = buildIndex(TWIN_DICT);
  const grid = emptyGrid(SIZE);
  put(grid, 'pd', BLACK);
  put(grid, 'qf', WHITE);
  const black = matchAll(index, grid, SIZE, { nextColor: BLACK })[0];
  assert.equal(black.comment, 'lineA'); // lineA continues with Black
  assert.equal(black.transform.swap, false);
  assert.equal(black.parity, 1);
  const white = matchAll(index, grid, SIZE, { nextColor: WHITE })[0];
  assert.equal(white.comment, 'lineB'); // lineB's Black-next reads as White here
  assert.equal(white.transform.swap, true);
  assert.equal(white.parity, 1);
});

test('[BEHAVIOR] a pass continuation ("plays elsewhere") still carries parity', () => {
  const dict = `(;GM[1]FF[4]SZ[19]
(;B[pd];W[qf]C[lineA];B[])
(;B[qf];W[pd]C[lineB];B[]))`;
  const index = buildIndex(dict);
  const grid = emptyGrid(SIZE);
  put(grid, 'pd', BLACK);
  put(grid, 'qf', WHITE);
  assert.equal(matchAll(index, grid, SIZE, { nextColor: BLACK })[0].comment, 'lineA');
  assert.equal(matchAll(index, grid, SIZE, { nextColor: WHITE })[0].comment, 'lineB');
});

test('[BEHAVIOR] all deepest candidates are reported as alternatives, chosen first', () => {
  const index = buildIndex(TWIN_DICT);
  const grid = emptyGrid(SIZE);
  put(grid, 'pd', BLACK);
  put(grid, 'qf', WHITE);
  const r = matchAll(index, grid, SIZE, { nextColor: BLACK })[0];
  assert.equal(r.alternatives.length, 2);
  assert.equal(r.alternatives[0].node, r.node);
  assert.deepEqual(r.alternatives.map((a) => a.comment).sort(), ['lineA', 'lineB']);
  assert.deepEqual(r.alternatives.map((a) => a.parity), [1, 0]);
});

test('[BEHAVIOR] without nextColor the matcher still returns a stable best match', () => {
  const index = buildIndex(TWIN_DICT);
  const grid = emptyGrid(SIZE);
  put(grid, 'pd', BLACK);
  put(grid, 'qf', WHITE);
  const r = matchAll(index, grid, SIZE)[0];
  assert.equal(r.matched, 2);
  assert.equal(r.alternatives.length, 2);
});

// --- localizeComment ----------------------------------------------------

const T_ID = makeTransform(0, false, false, SIZE); // dictionary frame itself
const T_BL = makeTransform(3, false, false, SIZE); // bottom-left corner
const T_DIAG = makeTransform(0, true, false, SIZE); // reflect across the anti-diagonal

test('[BEHAVIOR] identity geometry leaves the text alone', () => {
  const s = 'Black takes the upper right corner; White slides left.';
  assert.equal(localizeComment(s, T_ID, false), s);
});

test('[BEHAVIOR] colour words swap with the match, preserving case', () => {
  assert.equal(
    localizeComment('Black attacks, white defends. BLACK wins.', T_ID, true),
    'White attacks, black defends. WHITE wins.',
  );
});

test('[BEHAVIOR] single direction words follow the geometry', () => {
  assert.equal(localizeComment('the top side, then left', T_BL, false),
    'the bottom side, then right');
  assert.equal(localizeComment('the upper side', T_DIAG, false), 'the right side');
});

test('[BEHAVIOR] corner phrases localize as a unit, vertical word first', () => {
  // bottom-left placement: a full point reflection
  assert.equal(localizeComment('the upper right corner', T_BL, false),
    'the lower left corner');
  assert.equal(localizeComment('the top-left corner', T_BL, false),
    'the bottom-right corner');
  // anti-diagonal reflection: top-right is fixed, top-left goes to bottom-right
  assert.equal(localizeComment('the upper right corner', T_DIAG, false),
    'the upper right corner');
  assert.equal(localizeComment('the upper left corner', T_DIAG, false),
    'the lower right corner');
  assert.equal(localizeComment('Upper Left then lower right', T_DIAG, false),
    'Lower Right then upper left');
});

test('[BEHAVIOR] words inside other words are safe', () => {
  const s = 'copyright; blacksmith tops the uppermost lefty';
  assert.equal(localizeComment(s, T_BL, true), s);
});
