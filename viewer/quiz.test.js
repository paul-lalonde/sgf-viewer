// quiz.test.js — tests for viewer/quiz.js, per viewer/quiz.design.md.
// Run: node --test viewer/
//
// Fixtures are inlined (copied from the Dojo files) so the suite runs on
// branches that don't carry the library data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quiz, isQuiz } from './quiz.js';

const node = (props) => ({ props, parent: null, children: [] });
const quiz = (prop, values) => new Quiz(node({ [prop]: values }), 19);

// point helpers: 'xy' -> coords; click by point string
const X = (pt) => pt.charCodeAt(0) - 97;
const Y = (pt) => pt.charCodeAt(1) - 97;
const click = (q, pt, isStone = false) => q.click(X(pt), Y(pt), isStone);

test('[BEHAVIOR] R1/R3: single entries score by point, resp defaults to score', () => {
  const q = quiz('YN', ['tt:1', 'qo:0', 'dc:3', 'qf:2']);
  assert.equal(click(q, 'dc').kind, 'wrong');
  assert.equal(click(q, 'dc').score, '3');
  assert.equal(click(q, 'dc').resp, '3');
  const ok = click(q, 'qo');
  assert.equal(ok.kind, 'correct');
  assert.equal(ok.solved, true); // R9: YN solves on any correct
});

test('[BEHAVIOR] R1: upper-case typo points fold (OK -> ok) and stay answerable', () => {
  const q = quiz('YN', ['tt:1', 'OK:0', 'pl:11']);
  assert.ok(q.answerPoints().has('ok'));
  assert.equal(click(q, 'ok').kind, 'correct');
});

test('[BEHAVIOR] R2: answerPoints covers singles, any-of members, pair endpoints', () => {
  const q = quiz('YA', ['tt:1', 'tttt:1', 'mkgp:0', 'coei:0', 'kl:0']);
  assert.deepEqual([...q.answerPoints()].sort(), ['co', 'ei', 'gp', 'kl', 'mk']);
});

test('[BEHAVIOR] R3: any-of — each member point scores alone (YN[imhl=0])', () => {
  const q = quiz('YN', ['tt:1', 'jj:2', 'imhl=0']);
  assert.equal(click(q, 'jj').kind, 'wrong');
  const ok = click(q, 'im');
  assert.equal(ok.kind, 'correct');
  assert.equal(ok.solved, true);
  const q2 = quiz('YN', ['tt:1', 'jj:2', 'imhl=0']);
  assert.equal(click(q2, 'hl').kind, 'correct');
});

test('[BEHAVIOR] R4: off-list single resolves via tt; tt:0 = sente is correct', () => {
  const wrong = quiz('YN', ['tt:45', 'qo:0']);
  const r = click(wrong, 'aa');
  assert.equal(r.kind, 'wrong');
  assert.equal(r.score, '45');
  const sente = quiz('YN', ['tt:0', 'qo:0']);
  const s = click(sente, 'aa');
  assert.equal(s.kind, 'correct');
  assert.equal(s.solved, true);
  const none = quiz('YA', ['qo:0']);
  assert.equal(click(none, 'aa').kind, 'miss');
});

test('[BEHAVIOR] R5/R6: stone clicks arm endpoints; a pair scores unordered', () => {
  // SECTOR LINE TEST (Sector.wgf node 9)
  const q = quiz('YA', ['tttt:1', 'aaml:0', 'aajd:0', 'aafk:2', 'aack:3']);
  assert.ok(q.hasPairs);
  assert.equal(click(q, 'aa', true).kind, 'pending');
  const r = click(q, 'ml', true);
  assert.equal(r.kind, 'correct');
  assert.deepEqual(r.line, { x1: 0, y1: 0, x2: 12, y2: 11 });
  // reverse click order matches the same entries
  assert.equal(click(q, 'jd', true).kind, 'pending');
  assert.equal(click(q, 'aa', true).kind, 'correct');
  // wrong pair carries its reason
  assert.equal(click(q, 'aa', true).kind, 'pending');
  const w = click(q, 'fk', true);
  assert.equal(w.kind, 'wrong');
  assert.equal(w.score, '2');
});

test('[BEHAVIOR] R5: clicking the armed stone again disarms', () => {
  const q = quiz('YN', ['tttt:2', 'ajhj:0', 'aiei:0']);
  assert.equal(click(q, 'aj', true).kind, 'pending');
  assert.equal(click(q, 'aj', true).kind, 'unselect');
  assert.equal(q.foundOverlay().pending, null);
});

test('[BEHAVIOR] R5: a stone click matching a single answer scores instead of arming', () => {
  // mixed quiz (Sector.wgf node 316): two lines AND a running move
  const q = quiz('YA', ['tt:1', 'tttt:1', 'mkgp:0', 'coei:0', 'kl:0']);
  const r = click(q, 'kl', true); // kl sits on a stoneless point in the file,
  assert.equal(r.kind, 'correct'); // but must score even if clicked as a stone
  assert.equal(r.solved, false);
});

test('[BEHAVIOR] R6: an unlisted pair resolves via tttt', () => {
  const q = quiz('YN', ['tttt:2', 'ajhj:0', 'aiei:0']);
  click(q, 'aj', true);
  const r = click(q, 'ei', true); // aj-ei is not a listed pair
  assert.equal(r.kind, 'wrong');
  assert.equal(r.score, '2');
});

test('[BEHAVIOR] R7: empty-point clicks never arm; they fall through to tt', () => {
  const q = quiz('YN', ['tt:1', 'tttt:1', 'jmqk:0']);
  const r = click(q, 'cc', false);
  assert.equal(r.kind, 'wrong'); // scored by tt:1, not armed
  assert.equal(r.score, '1');
  assert.equal(q.foundOverlay().pending, null);
});

test('[BEHAVIOR] R8: find-all counts each slot once; any-of group is one slot', () => {
  // MOYO DEFENSE TEST (Sector.wgf node 34)
  const q = quiz('YA', ['gcgd=0', 'gb:2', 'tt:1', 'kpkololp=0', 'hqhpiqip=5', 'mqmpmo=3']);
  const r1 = click(q, 'gc');
  assert.equal(r1.kind, 'correct');
  assert.deepEqual({ found: r1.found, total: r1.total }, { found: 1, total: 2 });
  assert.equal(click(q, 'gd').kind, 'again'); // same slot, already found
  const r2 = click(q, 'ko');
  assert.equal(r2.kind, 'correct');
  assert.equal(r2.solved, true);
});

test('[BEHAVIOR] R8: find-all with pairs — solved when every line is found', () => {
  const q = quiz('YA', ['tttt:1', 'fnpq:0', 'fnan:0']);
  click(q, 'fn', true);
  assert.equal(click(q, 'pq', true).solved, false);
  click(q, 'fn', true);
  const r = click(q, 'an', true);
  assert.equal(r.solved, true);
  assert.equal(q.foundOverlay().lines.length, 2);
});

test('[BEHAVIOR] R10: ordered quiz consumes score-0 entries in file order', () => {
  // OPENING EXTENSION TEST (Sector.wgf node 391)
  const q = quiz('YO', ['tt:1', 'qj:0:2', 'jq:7', 'ic:8', 'cj:5',
    'cj:0:3', 'jq:9', 'ic:6', 'jq:0:4', 'ic:0']);
  const r1 = click(q, 'qj');
  assert.equal(r1.kind, 'correct');
  assert.equal(r1.resp, '2'); // R13: explicit resp key
  assert.equal(r1.solved, false);
  assert.equal(click(q, 'cj').resp, '3');
  assert.equal(click(q, 'jq').resp, '4');
  const last = click(q, 'ic');
  assert.equal(last.resp, '0');
  assert.equal(last.solved, true);
  assert.equal(q.revealKey, '0');
});

test('[BEHAVIOR] R11: ordered wrong answers are stage-dependent', () => {
  // SACRIFICE RUNNING TEST (Sector.wgf node 511): il:5 early, il:4 later
  const entries = ['tt:1', 'il:5', 'im:6', 'hl:0:2', 'hl@b', 'hm@w',
    'im:0:3', 'im@b', 'gm@w', 'il:4', 'in:0:3', 'in@b', 'il@w',
    'jl:0:3', 'jl@b', 'ik@w', 'jm:0', 'jm@b'];
  const q = quiz('YS', entries);
  assert.equal(click(q, 'il').score, '5'); // stage 1
  click(q, 'hl'); // correct; cursor advances
  click(q, 'im'); // correct
  assert.equal(click(q, 'il').score, '4'); // stage 3: the later reason
  // a not-yet-due correct point is not a match — falls back to tt
  assert.equal(click(q, 'jm').score, '1');
});

test('[BEHAVIOR] R11: ordered wrong falls back to a match before the cursor', () => {
  const q = quiz('YO', ['tt:1', 'im:6', 'hl:0', 'jl:0']);
  click(q, 'hl');
  assert.equal(click(q, 'im').score, '6'); // entry is behind the cursor
});

test('[BEHAVIOR] R12: consuming an ordered answer applies its placements', () => {
  const q = quiz('YS', ['tt:1', 'hl:0:2', 'hl@b', 'hm@w', 'jm:0', 'jm@b']);
  click(q, 'hl');
  assert.deepEqual(q.placed, [
    { x: X('hl'), y: Y('hl'), color: 'B' },
    { x: X('hm'), y: Y('hm'), color: 'W' },
  ]);
  const r = click(q, 'jm');
  assert.equal(r.solved, true);
  assert.equal(q.placed.length, 3);
});

test('[BEHAVIOR] R13: revealKey is the solving entry\'s feedback key', () => {
  const q = quiz('YN', ['tt:1', 'qo:0']);
  assert.equal(q.revealKey, '0');
  click(q, 'qo');
  assert.equal(q.revealKey, '0');
  const staged = quiz('YO', ['aa:0:7']);
  click(staged, 'aa');
  assert.equal(staged.revealKey, '7');
});

test('[BEHAVIOR] R14: foundOverlay reports points, lines, and the armed endpoint', () => {
  const q = quiz('YA', ['tttt:1', 'aaml:0', 'kl:0']);
  click(q, 'kl');
  click(q, 'aa', true);
  let ov = q.foundOverlay();
  assert.deepEqual(ov.points, [{ x: X('kl'), y: Y('kl') }]);
  assert.deepEqual(ov.pending, { x: 0, y: 0 });
  click(q, 'ml', true);
  ov = q.foundOverlay();
  assert.equal(ov.lines.length, 1);
  assert.equal(ov.pending, null);
});

test('[BEHAVIOR] R15: scores normalize numerically mod 256 (00 correct, 268 -> 12)', () => {
  const q = quiz('YN', ['tt:1', 'nfmf=00', 'os:268']);
  const w = click(q, 'os');
  assert.equal(w.kind, 'wrong');
  assert.equal(w.resp, '12');
  const ok = click(q, 'nf');
  assert.equal(ok.kind, 'correct');
  assert.equal(ok.solved, true);
});

test('[BEHAVIOR] edge: a quiz with no parseable answers misses every click', () => {
  const q = quiz('YN', ['zz!bogus', '12:xx']);
  assert.equal(click(q, 'aa').kind, 'miss');
});

test('[BEHAVIOR] isQuiz recognizes exactly the quiz properties', () => {
  assert.ok(isQuiz(node({ YN: ['aa:0'] })));
  assert.ok(isQuiz(node({ YS: ['aa:0'] })));
  assert.ok(!isQuiz(node({ C: ['hello'] })));
});
