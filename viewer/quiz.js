// quiz.js — Dojo quiz logic (see quiz.design.md for the requirements).
//
// A WGF quiz node carries an answer list under YN ("pick the move"),
// YA ("find all"), or YO/YS (ordered sequence). Entries:
//
//   pt:score[:resp]     single-point answer (resp = XS feedback key)
//   p1p2:score[:resp]   pair answer — click both endpoints (sector lines)
//   p1p2…pn=score       any-of — each listed point alone earns the score
//   tt:score            verdict for an off-list single click (take sente)
//   tttt:score          verdict for an off-list pair
//   pt@b / pt@w         stone placed when the preceding answer is consumed
//
// score 0 = correct. This module is pure logic: rendering, XS prose
// lookup, and the solved/continue flow live in app.js.

import { parsePoint } from './game.js';

export const QUIZ_PROPS = ['YN', 'YA', 'YO', 'YS'];
export const isQuiz = (node) => QUIZ_PROPS.some((p) => p in node.props);

const enc = (x, y) => String.fromCharCode(97 + x, 97 + y);

// Split a run of coordinate pairs ("aaml…") into normalized points;
// null if any pair is off-board. parsePoint folds upper-case typos (OK→ok).
function splitPoints(s, size) {
  const pts = [];
  for (let i = 0; i + 1 < s.length; i += 2) {
    const p = parsePoint(s.slice(i, i + 2), size);
    if (!p) return null;
    pts.push(enc(p.x, p.y));
  }
  return pts.length ? pts : null;
}

// Scores normalize numerically mod 256: "00" is 0 (correct), and the
// data's two ≥3-digit codes (268, 274) wrap to reason codes (12, 18)
// that have matching XS prose — the high bit is Dojo-internal flagging.
const score = (s) => String(parseInt(s, 10) % 256);

function parseEntry(v, size) {
  let m;
  if ((m = /^(tt|tttt)[:=](\d+)$/.exec(v))) {
    return { type: m[1] === 'tttt' ? 'tttt' : 'tt', score: score(m[2]) };
  }
  if ((m = /^([A-Za-z]{2})@([bw])$/.exec(v))) {
    const p = parsePoint(m[1], size);
    return p && { type: 'place', x: p.x, y: p.y, color: m[2].toUpperCase() };
  }
  if ((m = /^([A-Za-z]{2,})=(\d+)$/.exec(v))) { // any-of
    const points = splitPoints(m[1], size);
    return points && { type: 'answer', points, pair: false, score: score(m[2]), resp: score(m[2]) };
  }
  if ((m = /^([A-Za-z]{2}|[A-Za-z]{4}):(\d+)(?::(\d+))?$/.exec(v))) {
    const points = splitPoints(m[1], size);
    if (!points) return null;
    const pair = m[1].length === 4;
    if (pair && points.length !== 2) return null;
    return { type: 'answer', points, pair, score: score(m[2]), resp: m[3] != null ? score(m[3]) : score(m[2]) };
  }
  return null;
}

export class Quiz {
  constructor(node, size) {
    this.node = node;
    this.size = size;
    this.kind = QUIZ_PROPS.find((p) => node.props[p]) || 'YN';
    this.entries = (node.props[this.kind] || [])
      .map((v) => parseEntry(v, size))
      .filter(Boolean);
    this.ordered = this.kind === 'YO' || this.kind === 'YS';
    this.hasPairs = this.entries.some((e) => e.type === 'tttt' || (e.type === 'answer' && e.pair));
    this.satisfied = new Set(); // indices of found/consumed correct entries
    this.cursor = 0; // ordered quizzes: scan position for staged reasons
    this.pending = null; // armed pair endpoint ('xy')
    this.placed = []; // [{x, y, color: 'B'|'W'}] stones from @ entries
    this.revealKey = '0'; // XS key for the answer reveal once solved
    this._foundPoints = [];
    this._foundLines = [];
  }

  // Found answers and the armed endpoint, for board display.
  foundOverlay() {
    const at = (p) => ({ x: p.charCodeAt(0) - 97, y: p.charCodeAt(1) - 97 });
    return {
      points: this._foundPoints.map(at),
      lines: this._foundLines.slice(),
      pending: this.pending ? at(this.pending) : null,
    };
  }

  // Interpret a board click. isStone: the clicked point holds a stone.
  // Pair endpoints are stones — or the empty edge points that edge
  // sector lines end on, so any point a pair entry names participates,
  // and once an endpoint is armed the next click always completes the
  // attempt. Single/any-of answers still score directly (mixed quizzes).
  click(x, y, isStone) {
    const pt = enc(x, y);
    const pairish = this.hasPairs && !this._singleAnswerAt(pt)
      && (isStone || this.pending !== null || this._pairPoints().has(pt));
    if (pairish) {
      if (this.pending === null) {
        this.pending = pt;
        return { kind: 'pending' };
      }
      if (this.pending === pt) {
        this.pending = null;
        return { kind: 'unselect' };
      }
      const first = this.pending;
      this.pending = null;
      return this._resolvePair(first, pt);
    }
    return this.ordered ? this._resolveOrdered(pt) : this._resolveSingle(pt);
  }

  _pairPoints() {
    const set = new Set();
    for (const e of this.entries) {
      if (e.type === 'answer' && e.pair) for (const p of e.points) set.add(p);
    }
    return set;
  }

  _singleAnswerAt(pt) {
    return this.entries.some((e) => e.type === 'answer' && !e.pair && e.points.includes(pt));
  }

  _verdict(type) {
    return this.entries.find((e) => e.type === type) || null;
  }

  _totalToFind() {
    return this.entries.filter((e) => e.type === 'answer' && e.score === '0').length;
  }

  _resolveSingle(pt) {
    const idx = this.entries.findIndex(
      (e) => e.type === 'answer' && !e.pair && e.points.includes(pt),
    );
    if (idx < 0) {
      const tt = this._verdict('tt');
      if (!tt) return { kind: 'miss' };
      if (tt.score !== '0') return { kind: 'wrong', score: tt.score, resp: tt.score };
      this.revealKey = '0';
      return { kind: 'correct', resp: '0', solved: true, sente: true };
    }
    const e = this.entries[idx];
    if (e.score !== '0') return { kind: 'wrong', score: e.score, resp: e.resp };
    return this._correct(idx, pt);
  }

  _resolvePair(a, b) {
    const key = [a, b].sort().join('');
    const idx = this.entries.findIndex(
      (e) => e.type === 'answer' && e.pair && e.points.slice().sort().join('') === key,
    );
    if (idx < 0) {
      const tttt = this._verdict('tttt');
      return tttt
        ? { kind: 'wrong', score: tttt.score, resp: tttt.score }
        : { kind: 'miss' };
    }
    const e = this.entries[idx];
    if (e.score !== '0') return { kind: 'wrong', score: e.score, resp: e.resp };
    return this._correct(idx);
  }

  // A correct unordered answer: count it (find-all), record its display
  // (a disc, or the pair's line), and report whether the quiz is solved.
  _correct(idx, clickedPt = null) {
    const e = this.entries[idx];
    if (this.satisfied.has(idx)) return { kind: 'again' };
    this.satisfied.add(idx);
    const line = e.pair ? lineOf(e) : undefined;
    if (line) this._foundLines.push(line);
    else if (clickedPt) this._foundPoints.push(clickedPt);
    this.revealKey = e.resp;
    if (this.kind === 'YA') {
      const total = this._totalToFind();
      const found = this.satisfied.size;
      return { kind: 'correct', resp: e.resp, solved: found >= total, found, total, line };
    }
    return { kind: 'correct', resp: e.resp, solved: true, line };
  }

  // Ordered (YO/YS): the required answer is the first unconsumed score-0
  // entry; consuming it applies the placement entries that follow it.
  // Wrong reasons are staged — first match at/after the cursor wins.
  _resolveOrdered(pt) {
    const reqIdx = this.entries.findIndex(
      (e, i) => e.type === 'answer' && e.score === '0' && !this.satisfied.has(i),
    );
    if (reqIdx >= 0 && this.entries[reqIdx].points.includes(pt)) {
      const e = this.entries[reqIdx];
      this.satisfied.add(reqIdx);
      this.cursor = reqIdx + 1;
      let placedHere = false;
      while (this.entries[this.cursor]?.type === 'place') {
        const p = this.entries[this.cursor++];
        this.placed.push({ x: p.x, y: p.y, color: p.color });
        if (enc(p.x, p.y) === pt) placedHere = true;
      }
      if (!placedHere) this._foundPoints.push(pt); // a placed stone shows itself
      const solved = !this.entries.some(
        (en, i) => en.type === 'answer' && en.score === '0' && !this.satisfied.has(i),
      );
      if (solved) this.revealKey = e.resp;
      return { kind: 'correct', resp: e.resp, solved };
    }
    const find = (from) => this.entries.findIndex(
      (e, i) => i >= from && e.type === 'answer' && e.score !== '0' && e.points.includes(pt),
    );
    let i = find(this.cursor);
    if (i < 0) i = find(0);
    if (i >= 0) {
      return { kind: 'wrong', score: this.entries[i].score, resp: this.entries[i].resp };
    }
    const tt = this._verdict('tt');
    return tt ? { kind: 'wrong', score: tt.score, resp: tt.score } : { kind: 'miss' };
  }
}

function lineOf(e) {
  const [a, b] = e.points;
  return {
    x1: a.charCodeAt(0) - 97, y1: a.charCodeAt(1) - 97,
    x2: b.charCodeAt(0) - 97, y2: b.charCodeAt(1) - 97,
  };
}
