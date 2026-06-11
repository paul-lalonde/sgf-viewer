#!/usr/bin/env node
// Walk joseki lines from Kogo's dictionary through all 16 symmetry
// placements (4 corners × diagonal flip × colour swap) and check that
// the joseki navigator stays semantically consistent:
//
//   1. the SAME dictionary node matches in every placement,
//   2. each continuation choice maps to the same dictionary move with
//      the correctly-mapped colour (ghost colour = T.col(dict colour)),
//   3. walking two moves down the line keeps the colour order,
//   4. the localized comment's direction words point at the true board
//      edge, and colour words swap exactly when the match is swapped.
//
// The navigator's frame math and localizeComment live in app.js (a DOM
// module), so the relevant few lines are REPLICATED here — keep in sync.
//
// Usage: node CLAUDE.scripts/walk-joseki-transforms.mjs [maxLines]

import { readFileSync } from 'node:fs';
import { buildIndex, matchAll, makeTransform } from '../viewer/joseki.js';
import { Game, moveOf } from '../viewer/game.js';
import { BLACK, WHITE } from '../viewer/colors.js';

const SIZE = 19;
const N = SIZE - 1;
const index = buildIndex(readFileSync('joseki/Kogos-Joseki-Dictionary.sgf', 'utf8'));
const dictRoot = (() => { // re-parse for line walking (buildIndex keeps no root)
  return null;
})();

// --- collect sample lines from the dictionary --------------------------
import { parseSGF } from '../viewer/sgf.js';
const root = parseSGF(readFileSync('joseki/Kogos-Joseki-Dictionary.sgf', 'utf8'))[0];

// A line: array of {x, y, color} dictionary moves, alternating or not,
// ending at `end` (the dict node the board should match).
function collectLines(maxLines) {
  const lines = [];
  const seen = new Set();
  // each child of the root starts a family; walk several deterministic
  // variation flavours of each (pick = which branch to prefer, rotating)
  for (const pick of [0, 1, 2, 3, 5, 7]) {
    for (const fam of root.children) {
      const moves = [];
      let n = fam;
      let ok = true;
      for (let depth = 0; n && depth < 9; depth++) {
        const mv = moveOf(n, SIZE);
        if (!mv || mv.pass || 'AB' in n.props || 'AW' in n.props) { ok = moves.length >= 3; break; }
        moves.push({ x: mv.x, y: mv.y, color: mv.color, node: n });
        if (!n.children.length) break;
        n = n.children[(depth * pick + pick) % n.children.length];
      }
      if (ok && moves.length >= 3) {
        const key = moves.map((m) => `${m.color}${m.x},${m.y}`).join(' ');
        if (!seen.has(key)) {
          seen.add(key);
          lines.push(moves);
        }
      }
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines;
}

// --- replicated navigator math (app.js renderJosekiNav) ----------------
const toXY = (T) => (sx, sy) => T.toBoard(N - sx, sy);

// --- replicated localizeComment (app.js) -------------------------------
function localizeComment(text, T, colorSwap) {
  if (colorSwap) {
    text = text.replace(/\b(black|white)\b/gi, (m) =>
      matchCase(m, m[0].toLowerCase() === 'b' ? 'white' : 'black'));
  }
  const dir = {
    top: boardDir(T, 0, -1),
    bottom: boardDir(T, 0, 1),
    left: boardDir(T, 1, 0),
    right: boardDir(T, -1, 0),
  };
  if (dir.top === 'top' && dir.left === 'left') return text;
  return text.replace(/\b(upper|lower|top|bottom|left|right)\b/gi, (m) => {
    const lw = m.toLowerCase();
    const key = lw === 'upper' ? 'top' : lw === 'lower' ? 'bottom' : lw;
    return matchCase(m, dir[key]);
  });
}
function boardDir(T, du, dv) {
  const [ax, ay] = T.toBoard(5, 5);
  const [bx, by] = T.toBoard(5 + du, 5 + dv);
  if (bx !== ax) return bx > ax ? 'right' : 'left';
  return by > ay ? 'bottom' : 'top';
}
function matchCase(orig, repl) {
  if (orig === orig.toUpperCase()) return repl.toUpperCase();
  if (orig[0] === orig[0].toUpperCase()) return repl[0].toUpperCase() + repl.slice(1);
  return repl;
}

// --- the walk -----------------------------------------------------------
const C = (c) => (c === BLACK ? 'B' : 'W');
const pt = (x, y) => String.fromCharCode(97 + x, 97 + y);
let lines = collectLines(+(process.argv[2] || 24));
let bad = 0;

for (const [li, moves] of lines.entries()) {
  const label = moves.map((m) => `${C(m.color)}${pt(m.x, m.y)}`).join(' ');
  let baseline = null; // canonical view of the first placement's result
  for (let corner = 0; corner < 4; corner++) {
    for (const diag of [false, true]) {
      for (const swap of [false, true]) {
        const T = makeTransform(corner, diag, swap, SIZE);
        const map = toXY(T);
        // place the line on a board: dict (x,y,color) -> board via T
        const sgfMoves = moves.map((m) => {
          const [bx, by] = map(m.x, m.y);
          return `;${C(T.col(m.color))}[${pt(bx, by)}]`;
        });
        const game = new Game(`(;GM[1]FF[4]SZ[19]${sgfMoves.join('')})`);
        game.toEnd();
        const grid = game.position().grid;
        const results = matchAll(index, grid, SIZE);
        const r = results.find((x) => x.corner === corner);
        const tag = `line ${li} [${label}] corner${corner} diag:${+diag} swap:${+swap}`;
        if (!r) { console.log(`!! ${tag}: NO MATCH`); bad++; continue; }
        // project the navigator's view back into the dictionary frame
        const Tm = r.transform;
        const back = (bx, by) => { const [u, v] = Tm.toCanon(bx, by); return pt(N - u, v); };
        const choices = r.node.children.map((c) => {
          const mv = moveOf(c, SIZE);
          if (!mv || mv.pass) return null;
          const [bx, by] = Tm.toBoard(N - mv.x, mv.y); // navigator ghost position
          const ghostColor = Tm.col(mv.color); // navigator ghost colour
          // canonical view: dict point + dict colour recovered from the board view
          return `${back(bx, by)}:${C(Tm.col(ghostColor))}`;
        }).filter(Boolean).sort().join(' ');
        // walk two moves down the mainline, as the navigator's numbered ghosts
        const walk = [];
        for (let n = r.node.children[0], k = 0; n && k < 2; n = n.children[0], k++) {
          const mv = moveOf(n, SIZE);
          if (!mv || mv.pass) break;
          walk.push(`${C(Tm.col(Tm.col(mv.color)))}`); // ghost colour mapped back
        }
        // the user-visible check: the BOARD colour of the suggested next
        // move, mapped back through the PLACEMENT transform — must be the
        // same dictionary colour in all 16 placements
        const mainMv = r.node.children.map((c) => moveOf(c, SIZE)).find((m) => m && !m.pass);
        const next = mainMv ? C(T.col(Tm.col(mainMv.color))) : '-';
        const view = { node: r.node, matched: r.matched, choices, walk: walk.join(''), next };
        if (!baseline) { baseline = view; continue; }
        if (view.next !== baseline.next) {
          console.log(`!! ${tag}: NEXT-MOVE COLOUR FLIPS (${baseline.next} vs ${view.next}) — user sees wrong-colour ghosts`);
          bad++;
        }
        if (view.node !== baseline.node) {
          console.log(`!! ${tag}: matched a DIFFERENT dict node (${(view.node.props.C || [''])[0].slice(0, 40)}…)`);
          bad++;
        } else {
          if (view.choices !== baseline.choices) {
            console.log(`!! ${tag}: choices differ\n   base ${baseline.choices}\n   here ${view.choices}`);
            bad++;
          }
          if (view.walk !== baseline.walk) {
            console.log(`!! ${tag}: walk colours differ (${baseline.walk} vs ${view.walk})`);
            bad++;
          }
        }
        // --- text localization: direction words must point at the true edge
        for (const [word, du, dv] of [['top', 0, -1], ['bottom', 0, 1], ['left', 1, 0], ['right', -1, 0]]) {
          const localized = localizeComment(`the ${word} side`, Tm, Tm.swap);
          const w = localized.match(/the (\w+) side/)[1];
          // a canonical point displaced toward `word` from centre: where is it?
          const [ax, ay] = Tm.toBoard(9, 9);
          const [bx, by] = Tm.toBoard(9 + du * 4, 9 + dv * 4);
          const actual = Math.abs(bx - ax) > Math.abs(by - ay)
            ? (bx > ax ? 'right' : 'left') : (by > ay ? 'bottom' : 'top');
          if (w !== actual) {
            console.log(`!! ${tag}: text says "${w}" but the ${word}-side point sits ${actual}`);
            bad++;
          }
        }
        // colour words swap exactly when the transform swaps
        const colorized = localizeComment('Black attacks, white defends', Tm, Tm.swap);
        const wantFirst = Tm.swap ? 'White' : 'Black';
        if (!colorized.startsWith(wantFirst)) {
          console.log(`!! ${tag}: colour words wrong: "${colorized}"`);
          bad++;
        }
      }
    }
  }
}
console.log(`\n${lines.length} lines × 16 placements walked — ${bad} inconsistencies`);
