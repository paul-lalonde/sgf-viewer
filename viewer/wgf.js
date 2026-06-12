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
// one node. The node KEEPS its packed sequence (the parser's moveSeq
// preserves play order): the position engine replays every move, and the
// STEP control walks them one by one — see timeline.design.md. (An
// earlier version split such nodes into synthetic one-move chains.)

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

// Dojo lists a position with XB/XW (black/white points), not SGF's AB/AW.
// On a pure setup slide this is the FULL board state replacing the
// previous one, so clear first (AE) then place the stones. But on a move
// node the XB/XW just ADD stones to the running game (e.g. an endgame
// shown over the existing position) — there we must NOT clear. Moves
// (B/W) are otherwise left as-is.
function convertSetup(root, size) {
  const last = String.fromCharCode(97 + size - 1);
  const whole = `aa:${last}${last}`;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (n.props.XB || n.props.XW) {
      if (!(n.props.B || n.props.W)) n.props.AE = [whole]; // reset only on a setup slide
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

// Dojo's XC encodes a multi-board "n-up" layout, drawn by omitting grid
// line(s) so the board splits into independent sub-boards. The values
// are a fixed table, decoded from the prose ("TOP:", "MIDDLE:", "LEFT:")
// and the stone bands of every XC node in the corpus:
//
//   2, 23      TOP/BOTTOM            omit the centre row
//   3          TOP/MIDDLE/BOTTOM     omit rows at the thirds
//   20, 22, 24 LEFT/RIGHT            omit the centre column
//   40..45     2×2 quadrants         omit centre row and column
//   6, 60      2×3 six-up            omit centre row + column thirds
//   32         TOP pair over a full-width BOTTOM — request the quad cuts;
//              the renderer drops any cut that crosses a stone, which
//              trims this to what each diagram actually uses.
//
// Returns {rows: [...], cols: [...]} of grid lines to omit, or null.
export function xcSplit(value, size = 19) {
  const xc = parseInt(value, 10);
  if (!Number.isFinite(xc)) return null;
  const mid = (size - 1) / 2;
  if (!Number.isInteger(mid)) return null;
  const thirds = size === 19 ? [6, 12] : null; // observed only on 19×19
  switch (xc) {
    case 2: case 23: return { rows: [mid], cols: [] };
    case 3: return thirds && { rows: thirds, cols: [] };
    case 20: case 22: case 24: return { rows: [], cols: [mid] };
    case 6: case 60: return thirds && { rows: [mid], cols: thirds };
    case 32: case 40: case 41: case 42: case 43: case 44: case 45:
      return { rows: [mid], cols: [mid] };
    default: return null;
  }
}

// An XS "display response" value is `score:` then a one-level "display
// response": leading mark properties (TR[..], XX[..], LB[..], …) followed
// by the feedback prose. Strip the marks and return just the prose.
export function xsProse(text) {
  return text
    .replace(/^([A-Z]{1,2}(\[[^\][]*\])+)+/, '') // leading mark groups
    .replace(/\n\s*_[^_\r\n]+_\s*$/, '') // trailing standalone link (e.g. _Next_)
    .replace(/_([^_]+)_/g, '$1') // keep inline link text
    .trim();
}

// Build a file-wide map of quiz feedback prose by score code. The reason
// vocabulary (1, 44, 45, …) is shared across nodes, so many nodes
// reference a score whose prose lives on another node.
export function buildResponses(records) {
  const map = {};
  for (const root of records) {
    const stack = [root];
    while (stack.length) {
      const n = stack.pop();
      for (const e of n.props.XS || []) {
        const m = /^(\d+):([\s\S]*)$/.exec(e);
        if (!m) continue;
        const prose = xsProse(m[2]);
        if (prose && !(m[1] in map)) map[m[1]] = prose;
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
