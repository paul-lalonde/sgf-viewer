#!/usr/bin/env node
// Extract every YN/YA/YO/YS quiz entry from the Dojo .wgf files and
// classify it against the answer grammar. Flags anything unparseable so
// the viewer's quiz parser can be checked for full coverage.
//
// Usage: node CLAUDE.scripts/scan-quiz-entries.mjs [Dojo/*.wgf]

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Dojo/Contact.wgf', 'Dojo/Sector.wgf', 'Dojo/basic.wgf', 'Dojo/Intro.wgf'];

const PT = '[A-Sa-s][A-Sa-s]'; // tolerate the upper-case coordinate typos
const CLASSES = [
  ['verdict-pair', /^tttt:(\d+)$/],
  ['verdict-single', /^tt:(\d+)$/],
  ['placement', new RegExp(`^(${PT})@([bw])$`)],
  ['pair', new RegExp(`^(${PT})(${PT}):(\\d+)(:\\d+)?$`)],
  ['single', new RegExp(`^(${PT}):(\\d+)(:\\d+)?$`)],
  ['any-of', new RegExp(`^(${PT})+=(\\d+)$`)],
];

const counts = {};
const samples = {};
let bad = 0;

for (const file of files) {
  const text = readFileSync(file, 'latin1');
  // quiz prop with its bracket values (values never contain ']')
  const re = /\bY([NAOS])((?:\[[^\]]*\])+)/g;
  for (let m; (m = re.exec(text)); ) {
    const prop = `Y${m[1]}`;
    for (const vm of m[2].matchAll(/\[([^\]]*)\]/g)) {
      const v = vm[1];
      const cls = CLASSES.find(([, rx]) => rx.test(v))?.[0] || 'UNPARSEABLE';
      const key = `${prop} ${cls}`;
      counts[key] = (counts[key] || 0) + 1;
      (samples[key] = samples[key] || new Set()).add(v);
      if (cls === 'UNPARSEABLE') {
        bad++;
        console.log(`!! ${file}: ${prop}[${v}]`);
      }
    }
  }
}

console.log('\nentry counts by quiz prop and class:');
for (const key of Object.keys(counts).sort()) {
  const ex = [...samples[key]].slice(0, 4).join(' · ');
  console.log(`  ${key.padEnd(22)} ${String(counts[key]).padStart(5)}   e.g. ${ex}`);
}
console.log(bad ? `\n${bad} UNPARSEABLE entries` : '\nall entries parse');
