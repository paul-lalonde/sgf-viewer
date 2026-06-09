// wgf.js — Bruce Wilcox's "Go Dojo" .wgf study files.
//
// WGF is SGF with two differences: `//` line comments, and a fat
// vocabulary of Dojo-only properties (X*/Y*: quiz answers, sector
// markers, hyperlinks…). We strip the comments and reuse the SGF parser;
// the standard properties (B/W/AB/AW, C, N, LB, TR, CR, SZ…) render in
// the normal viewer, and the unknown Dojo properties are simply ignored.
//
// A .wgf file is a COLLECTION of records (separate lesson trees), each
// titled by an N[] property near its root.

import { parseSGF } from './sgf.js';

// Drop `//`…end-of-line comments that sit OUTSIDE [...] values, so we
// don't corrupt comment text that happens to contain "//".
export function stripComments(text) {
  let out = '';
  let inValue = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inValue) {
      out += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === ']') inValue = false;
    } else if (c === '[') {
      inValue = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++; // skip to newline
      out += '\n';
    } else {
      out += c;
    }
  }
  return out;
}

// Parse a .wgf into its records (SGF node trees). Records that omit SZ
// inherit the file's board size (Dojo keeps one size per file), and each
// record's Dojo setup is converted to standard SGF (see convertSetup).
export function parseWgf(text) {
  const records = parseSGF(stripComments(text)).filter(Boolean);
  const fileSize = records.find((r) => r.props.SZ)?.props.SZ[0] || '19';
  for (const r of records) {
    if (!r.props.SZ) r.props.SZ = [fileSize];
    snapshotSource(r); // stash original Dojo props before we transform them
    convertSetup(r, parseInt(r.props.SZ[0], 10) || 19);
    expandPackedMoves(r);
    rerouteGameLine(r);
  }
  return records;
}

// A node's original properties as readable text (one property per line),
// so the UI can show the untouched .wgf source for a node.
export function propsToText(props) {
  return Object.entries(props)
    .map(([k, vals]) => k + vals.map((v) => `[${v}]`).join(''))
    .join('\n');
}

// Record the source text of every node before convertSetup/expand rewrite
// the props (XB/XW, XA, XT, packed moves…).
function snapshotSource(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    n.source = propsToText(n.props);
    stack.push(...n.children);
  }
}

// Dojo "game test" records pack a whole opening as many B[]/W[] moves in
// one node. Split such a node into a proper one-move-per-node chain (using
// the parser's moveSeq to keep order); the comment/links/marks move to the
// final move, where the test actually begins.
function expandPackedMoves(root) {
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const seq = n.moveSeq;
    if (seq && seq.length > 1 && n.props.AE) {
      // A packed node that also clears the board (AE) is a self-contained
      // diagram — e.g. an endgame sequence shown on a fresh board, numbered
      // by LB. The moves are often grouped by colour (not in play order),
      // so don't replay them: place them all at once as setup stones; the
      // LB labels carry the sequence. (The board shows the whole diagram.)
      for (const [c, v] of seq) {
        const prop = c === 'B' ? 'AB' : 'AW';
        n.props[prop] = (n.props[prop] || []).concat(v);
      }
      delete n.props.B;
      delete n.props.W;
      delete n.moveSeq;
    } else if (seq && seq.length > 1) {
      const origChildren = n.children;
      delete n.props.B;
      delete n.props.W;
      delete n.moveSeq;
      n.props[seq[0][0]] = [seq[0][1]];
      let cur = n;
      for (let i = 1; i < seq.length; i++) {
        // split moves share the original packed node's source
        cur.children = [{ props: { [seq[i][0]]: [seq[i][1]] }, parent: cur, children: [], source: n.source }];
        cur = cur.children[0];
      }
      cur.children = origChildren;
      for (const c of origChildren) c.parent = cur;
      for (const k of Object.keys(n.props)) {
        if (k === 'N' || k === 'SZ' || k === 'B' || k === 'W') continue;
        cur.props[k] = n.props[k];
        delete n.props[k];
      }
      stack.push(...origChildren);
    } else {
      stack.push(...n.children);
    }
  }
}

// In a game test the real game starts at the YF "Click here" target, which
// the file places after inline reference diagrams (.string defn / .atd —
// setup nodes that AE-clear the board). Re-link so a move node whose YF
// target is a move node further down its mainline — separated only by
// setup nodes — continues straight to it, demoting the reference diagrams
// to an off-line branch (still reachable via their links).
function rerouteGameLine(root) {
  const byName = new Map();
  for (const st = [root]; st.length;) {
    const n = st.pop();
    for (const nm of n.props.N || []) if (!byName.has(nm)) byName.set(nm, n);
    st.push(...n.children);
  }
  const isMoveNode = (n) => 'B' in n.props || 'W' in n.props;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    const target = byName.get((n.props.YF || [])[0]);
    if (target && isMoveNode(n) && isMoveNode(target) && n.children[0] !== target) {
      let d = n.children[0], steps = 0, onlySetup = true;
      while (d && d !== target && steps < 200) {
        if (isMoveNode(d)) { onlySetup = false; break; }
        d = d.children[0];
        steps++;
      }
      if (d === target && onlySetup && steps > 0) {
        target.parent.children = target.parent.children.filter((c) => c !== target);
        target.parent = n;
        n.children = [target, ...n.children.filter((c) => c !== target)];
      }
    }
    stack.push(...n.children);
  }
}

// Dojo defines each lesson position with XB/XW (full board state per
// node, replacing the previous), not SGF's incremental AB/AW. Convert
// every XB/XW node to: clear the whole board (AE) then place the stones
// (AB/AW) — so our normal SGF replay reproduces the reset semantics and
// every viewer feature works unchanged. Moves (B/W) are left as-is.
function convertSetup(root, size) {
  const last = String.fromCharCode(97 + size - 1);
  const whole = `aa:${last}${last}`;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.props.XB || n.props.XW) {
      n.props.AE = [whole];
      if (n.props.XB) n.props.AB = (n.props.AB || []).concat(n.props.XB);
      if (n.props.XW) n.props.AW = (n.props.AW || []).concat(n.props.XW);
      delete n.props.XB;
      delete n.props.XW;
    }
    // Dojo shape marks: XT = triangle, XU = circle (the lessons describe
    // these points as "triangle" / "circle", not letters).
    for (const [prop, sgf] of [['XT', 'TR'], ['XU', 'CR']]) {
      const pts = (n.props[prop] || []).filter((v) => /^[a-s][a-s]$/.test(v));
      if (pts.length) n.props[sgf] = (n.props[sgf] || []).concat(pts);
      delete n.props[prop];
    }
    // remaining X<letter> props label points: a bare point gets the prop
    // letter (XX → "X", XY → "Y"); a "point:text" entry gets that text
    // (XA → the reason number, e.g. bd:1). Skip score-lists (XS "11:…")
    // and non-point props (XC counts); drop off-board entries (tt = pass).
    for (const prop of Object.keys(n.props)) {
      if (!/^X[A-Z]$/.test(prop)) continue;
      const vals = n.props[prop];
      if (vals.some((v) => /^\d/.test(v))) continue; // XS-style score:text list
      const labels = [];
      for (const v of vals) {
        if (/^[a-s][a-s]$/.test(v)) labels.push(`${v}:${prop[1]}`);
        else {
          const m = /^([a-s][a-s]):(.+)$/.exec(v);
          if (m) labels.push(`${m[1]}:${m[2]}`);
        }
      }
      if (!labels.length) continue;
      n.props.LB = (n.props.LB || []).concat(labels);
      delete n.props[prop];
    }
    stack.push(...n.children);
  }
}

// Build a file-wide map of quiz feedback by score code (XS "score:text").
// The reason vocabulary (1, 44, 45, …) is shared across nodes, so many
// nodes reference a score whose prose lives on another node. Board-markup
// answers (XS "0:TR[…]") are skipped — they're per-node, not reasons.
export function buildResponses(records) {
  const map = {};
  for (const root of records) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const e of n.props.XS || []) {
        const m = /^(\d+):(.*)$/.exec(e);
        if (!m || /^[A-Z]{2}\[/.test(m[2])) continue;
        if (!(m[1] in map)) map[m[1]] = m[2].replace(/_([^_]+)_/g, '$1').trim();
      }
      stack.push(...n.children);
    }
  }
  return map;
}

// A record's display title: the first N[] near its root, else a number.
export function recordTitle(root, index) {
  for (let n = root, k = 0; n && k < 3; n = n.children[0], k++) {
    if (n.props.N) return n.props.N[0];
  }
  return `record ${index + 1}`;
}

// Index every named node (N[]) across the records, so hyperlinks can
// resolve a target name to {recordIndex, node}.
export function buildNameIndex(records) {
  const index = new Map();
  records.forEach((root, recordIndex) => {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const name of n.props.N || []) {
        if (!index.has(name)) index.set(name, { recordIndex, node: n });
      }
      stack.push(...n.children);
    }
  });
  return index;
}

// Resolve a YG[] hyperlink target. Same-file targets are ":NodeName";
// cross-file are ":B:file.wgf:.label". Returns {name} or {file, label}.
export function parseLinkTarget(entry) {
  const s = entry.replace(/^:/, '');
  if (/^B:/.test(s)) {
    const [, file, label] = s.split(':');
    return { file, label: label || '' };
  }
  return { name: s };
}

// Split a comment into text/link tokens. _underscored_ phrases become
// {link:true, text} (in order, to pair with the node's YG[] entries).
export function tokenizeComment(text) {
  const tokens = [];
  let last = 0;
  const re = /_([^_\r\n]+)_/g;
  let m;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index) });
    tokens.push({ link: true, text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ text: text.slice(last) });
  return tokens;
}
