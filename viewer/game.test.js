// game.test.js — tests for Game.playAt's forced-colour parameter (used
// by the joseki navigator) and for node timelines (packed multi-move
// nodes replayed in file order — see timeline.design.md).
// Run: node --test viewer/game.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, movesOf, moveOf } from './game.js';
import { BLACK, WHITE, EMPTY } from './colors.js';

test('[BEHAVIOR] playAt without colour alternates from the game turn', () => {
  const g = new Game('(;GM[1]FF[4]SZ[19])');
  g.playAt(3, 3);
  g.playAt(15, 3);
  assert.match(g.serialize(), /B\[dd\][\s\S]*W\[pd\]/);
});

test('[BEHAVIOR] playAt with a colour forces it, alternation be damned', () => {
  const g = new Game('(;GM[1]FF[4]SZ[19])');
  assert.equal(g.playAt(3, 3, WHITE), 'added');
  assert.equal(g.playAt(4, 3, WHITE), 'added'); // consecutive same colour
  const sgf = g.serialize();
  assert.match(sgf, /W\[dd\][\s\S]*W\[ed\]/);
  assert.doesNotMatch(sgf, /B\[/);
});

test('[BEHAVIOR] forced colour follows an existing child only when colours agree', () => {
  const g = new Game('(;GM[1]FF[4]SZ[19];B[dd])');
  g.toStart();
  assert.equal(g.playAt(3, 3, BLACK), 'followed'); // the B[dd] child
  g.toStart();
  assert.equal(g.playAt(3, 3, WHITE), 'added'); // same point, other colour: variation
  assert.equal(g.root.children.length, 2);
  assert.equal(g.playAt(3, 3, WHITE), null); // now occupied
});

// --- node timelines (packed multi-move nodes) ----------------------------

// a .wgf game test packs a whole opening into one node, colours
// interleaved in file order
const PACKED = '(;GM[1]FF[4]SZ[19];B[pd]W[dp]B[cd]W[qp]C[opening])';

test('[BEHAVIOR] R1: movesOf returns a packed node\'s moves in file order', () => {
  const g = new Game(PACKED);
  g.toEnd();
  const moves = movesOf(g.current, 19);
  assert.equal(moves.length, 4);
  assert.deepEqual(moves.map((m) => m.color), [BLACK, WHITE, BLACK, WHITE]);
  assert.deepEqual([moves[0].x, moves[0].y], [15, 3]); // pd
  assert.deepEqual([moves[1].x, moves[1].y], [3, 15]); // dp
  // moveOf = the first move, even when the file leads with W
  const gw = new Game('(;GM[1]FF[4]SZ[19];W[dp]B[pd])');
  gw.toEnd();
  assert.equal(moveOf(gw.current, 19).color, WHITE);
});

test('[BEHAVIOR] R2: position replays every packed move with numbering', () => {
  const g = new Game(PACKED);
  g.toEnd();
  const pos = g.position();
  assert.equal(pos.moveNumber, 4);
  assert.equal(pos.grid[3][15], BLACK); // pd
  assert.equal(pos.grid[15][3], WHITE); // dp
  assert.equal(pos.moveNumbers[3][15], 1);
  assert.equal(pos.moveNumbers[15][3], 2);
  assert.equal(pos.moveNumbers[3][2], 3); // cd = (x2, y3)
  assert.deepEqual([pos.lastMove.x, pos.lastMove.y], [16, 15]); // qp
});

test('[BEHAVIOR] R2: captures resolve inside a packed sequence', () => {
  // B aa, W ba, W ab: the corner stone is captured mid-node
  const g = new Game('(;GM[1]FF[4]SZ[19];B[aa]W[ba]W[ab])');
  g.toEnd();
  const pos = g.position();
  assert.equal(pos.grid[0][0], EMPTY);
  assert.equal(pos.captures[WHITE], 1);
  assert.equal(pos.moveNumber, 3);
});

test('[BEHAVIOR] R3: position(moveCap) replays a prefix of the current node', () => {
  const g = new Game(PACKED);
  g.toEnd();
  const two = g.position(2);
  assert.equal(two.moveNumber, 2);
  assert.equal(two.grid[3][15], BLACK); // pd played
  assert.equal(two.grid[3][3], EMPTY); // cd not yet
  const none = g.position(0);
  assert.equal(none.moveNumber, 0);
  assert.equal(none.grid[3][15], EMPTY);
  // ancestors always replay in full
  g.playAt(9, 9);
  assert.equal(g.position(0).moveNumber, 4); // the packed parent is complete
});

test('[BEHAVIOR] R5: engineMoves flattens packed nodes in order', () => {
  const g = new Game(PACKED);
  g.toEnd();
  const { moves } = g.engineMoves();
  assert.deepEqual(moves.map((m) => m[0]), ['B', 'W', 'B', 'W']);
  assert.deepEqual(moves[0], ['B', 'Q16']);
});

test('[BEHAVIOR] R6: lineLength counts moves, not nodes', () => {
  const g = new Game(PACKED);
  assert.equal(g.lineLength(), 4);
});

test('[BEHAVIOR] serialize splits a packed node into legal one-move SGF nodes', () => {
  const g = new Game(PACKED);
  const round = new Game(g.serialize());
  round.toEnd();
  const pos = round.position();
  assert.equal(pos.moveNumber, 4);
  assert.equal(pos.moveNumbers[15][3], 2); // dp is still move 2 after round-trip
});
