#!/usr/bin/env node
// Integration sweep: parse the Dojo .wgf files through the real viewer
// pipeline (parseWgf), build a Quiz for every quiz node, and
//   1. check every raw answer entry was parsed (none silently dropped),
//   2. simulate solving each quiz by clicking its correct answers
//      (both endpoints for pairs) and confirm it reaches solved,
//   3. check every reachable response key has feedback prose (the node's
//      own XS or the file-wide reason map).
//
// Usage: node CLAUDE.scripts/verify-quiz-solvability.mjs

import { readFileSync } from 'node:fs';
import { parseWgf, buildResponses, xsProse } from '../viewer/wgf.js';
import { Quiz, isQuiz } from '../viewer/quiz.js';

const files = ['Dojo/Contact.wgf', 'Dojo/Sector.wgf', 'Dojo/basic.wgf', 'Dojo/Intro.wgf'];
let quizzes = 0, problems = 0;

const report = (file, node, msg) => {
  problems++;
  const name = (node.props.N || ['?'])[0];
  console.log(`!! ${file} [${name}]: ${msg}`);
};

for (const file of files) {
  const text = readFileSync(file, 'latin1');
  const records = parseWgf(text);
  const responses = buildResponses(records);
  const nodeXS = (node, key) => {
    for (const e of node.props.XS || []) {
      if (e.startsWith(`${key}:`) && xsProse(e.slice(key.length + 1))) return true;
    }
    return key in responses;
  };
  for (const root of records) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      stack.push(...node.children);
      if (!isQuiz(node)) continue;
      quizzes++;
      const quiz = new Quiz(node, 19);
      const raw = node.props[quiz.kind] || [];
      if (quiz.entries.length !== raw.length) {
        const parsedCount = quiz.entries.length;
        report(file, node, `parsed ${parsedCount}/${raw.length} entries: ${raw.join(' ')}`);
      }
      // simulate: click every correct answer until solved
      let solved = false;
      let clicks = 0;
      // a quiz whose only correct answer is tt:0 solves on an off-list
      // (take sente) click — simulate one on an unlisted empty point
      const hasZeroAnswer = quiz.entries.some((e) => e.type === 'answer' && e.score === '0');
      const tt = quiz.entries.find((e) => e.type === 'tt');
      if (!hasZeroAnswer && tt?.score === '0') {
        const r = quiz.click(0, 0, false);
        if (r.kind === 'correct' && r.solved) { solved = true; clicks = 1; }
        else report(file, node, `tt:0 sente click gave ${r.kind}`);
      }
      for (let guard = 0; guard < 200 && !solved; guard++) {
        const next = quiz.entries.find(
          (e, i) => e.type === 'answer' && e.score === '0' && !quiz.satisfied.has(i),
        );
        if (!next) break;
        const at = (p) => [p.charCodeAt(0) - 97, p.charCodeAt(1) - 97];
        let r;
        if (next.pair) {
          quiz.click(...at(next.points[0]), true);
          r = quiz.click(...at(next.points[1]), true);
        } else {
          r = quiz.click(...at(next.points[0]), quiz.hasPairs); // any-of: first member
        }
        clicks++;
        if (r.kind !== 'correct') {
          report(file, node, `clicking answer ${next.points.join('+')} gave ${r.kind}`);
          break;
        }
        if (!nodeXS(node, r.resp) && r.resp !== '0') {
          report(file, node, `correct resp key ${r.resp} has no XS prose anywhere`);
        }
        solved = r.solved;
      }
      if (!solved && clicks) report(file, node, 'never reached solved');
      if (!clicks) report(file, node, `no correct answers parsed (${raw.join(' ')})`);
      // every wrong score must have prose somewhere
      for (const e of quiz.entries) {
        if (e.type === 'answer' && e.score !== '0' && !nodeXS(node, e.resp)) {
          report(file, node, `wrong resp key ${e.resp} has no XS prose anywhere`);
        }
      }
    }
  }
}
console.log(`\n${quizzes} quizzes checked, ${problems} problems`);
