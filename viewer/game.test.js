// game.test.js — tests for Game.playAt's forced-colour parameter (used
// by the joseki navigator to play a line's own colours into the game).
// Run: node --test viewer/game.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from './game.js';
import { BLACK, WHITE } from './colors.js';

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
