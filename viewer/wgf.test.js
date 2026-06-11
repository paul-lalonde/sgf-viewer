// wgf.test.js — tests for the WGF helpers (currently the XC layout
// table; see docs/wgf-format.md §5.2 for the evidence).
// Run: node --test viewer/wgf.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xcSplit } from './wgf.js';

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
