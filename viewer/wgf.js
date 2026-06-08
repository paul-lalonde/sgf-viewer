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
    convertSetup(r, parseInt(r.props.SZ[0], 10) || 19);
  }
  return records;
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
    // remaining X<letter> point lists label those points with that letter
    // (XX → "X", XY → "Y", …); skip non-point props (XC counts, XS answers).
    for (const prop of Object.keys(n.props)) {
      if (!/^X[A-Z]$/.test(prop)) continue;
      const vals = n.props[prop];
      if (!vals.every((v) => /^[a-s][a-s]$/.test(v))) continue;
      n.props.LB = (n.props.LB || []).concat(vals.map((v) => `${v}:${prop[1]}`));
      delete n.props[prop];
    }
    stack.push(...n.children);
  }
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
