// wgf.test.js — tests for the WGF helpers: the XC layout table (see
// docs/wgf-format.md §5.2) and the no-tree-surgery parse contract
// (timeline.design.md R4).
// Run: node --test viewer/wgf.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xcSplit, parseWgf } from './wgf.js';

test('[BEHAVIOR] R4: parseWgf keeps a packed node intact — no synthetic nodes', () => {
  const records = parseWgf(
    '(;GM[1]FF[4]SZ[19];B[pd]W[dp]B[cd]C[the opening]LB[pd:01]YN[qq:0](;B[qq])(;W[rr]))',
  );
  const node = records[0].children[0];
  assert.equal(node.moveSeq.length, 3); // moves stay packed…
  assert.equal(node.children.length, 2); // …variations attach to the node itself
  assert.deepEqual(node.props.C, ['the opening']); // comment stays put
  assert.deepEqual(node.props.YN, ['qq:0']); // so does the quiz
  assert.ok(node.source.includes('B[pd]')); // and the source snapshot
});

test('[BEHAVIOR] XC 2/23 are TOP/BOTTOM: omit the centre row', () => {
  assert.deepEqual(xcSplit('2'), { rows: [9], cols: [] });
  assert.deepEqual(xcSplit('23'), { rows: [9], cols: [] });
});

test('[BEHAVIOR] XC 3 is TOP/MIDDLE/BOTTOM: omit rows at the thirds', () => {
  assert.deepEqual(xcSplit('3'), { rows: [6, 12], cols: [] });
});

test('[BEHAVIOR] XC 20/22/24 are LEFT/RIGHT: omit the centre column', () => {
  for (const v of ['20', '22', '24']) {
    assert.deepEqual(xcSplit(v), { rows: [], cols: [9] }, `XC[${v}]`);
  }
});

test('[BEHAVIOR] XC 40–45 (and the mixed 32) request quadrant cuts', () => {
  for (const v of ['32', '40', '41', '42', '43', '44', '45']) {
    assert.deepEqual(xcSplit(v), { rows: [9], cols: [9] }, `XC[${v}]`);
  }
});

test('[BEHAVIOR] XC 6/60 are six-up: centre row plus column thirds', () => {
  assert.deepEqual(xcSplit('6'), { rows: [9], cols: [6, 12] });
  assert.deepEqual(xcSplit('60'), { rows: [9], cols: [6, 12] });
});

test('[BEHAVIOR] unknown values and non-centred sizes split nothing', () => {
  assert.equal(xcSplit('99'), null);
  assert.equal(xcSplit('junk'), null);
  assert.equal(xcSplit('2', 18), null); // no integer centre line
  assert.equal(xcSplit('3', 13), null); // thirds only observed on 19×19
  assert.deepEqual(xcSplit('2', 13), { rows: [6], cols: [] }); // centre generalizes
});
