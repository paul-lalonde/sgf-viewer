// sgf.js — SGF parser. Produces a plain node tree:
//   node = { props: {ID: [values...]}, parent, children: [] }
// Tolerant of junk between tokens (some wild files need it).

export function parseSGF(text) {
  const p = { text, pos: 0 };
  const games = [];
  skipJunk(p);
  while (p.pos < text.length && text[p.pos] === '(') {
    const game = parseTree(p, null);
    if (game) games.push(game);
    skipJunk(p);
  }
  return games;
}

function parseTree(p, parent) {
  p.pos++; // consume '('
  let head = null;
  let tail = parent;
  while (p.pos < p.text.length) {
    skipSpace(p);
    const ch = p.text[p.pos];
    if (ch === ';') {
      const node = parseNode(p);
      node.parent = tail;
      if (tail) tail.children.push(node);
      if (!head) head = node;
      tail = node;
    } else if (ch === '(') {
      parseTree(p, tail);
    } else if (ch === ')') {
      p.pos++;
      return head;
    } else {
      p.pos++; // tolerate stray characters
    }
  }
  return head; // unterminated tree: salvage what we have
}

function parseNode(p) {
  p.pos++; // consume ';'
  const node = { props: {}, parent: null, children: [] };
  while (p.pos < p.text.length) {
    skipSpace(p);
    let ident = '';
    while (/[A-Za-z]/.test(p.text[p.pos] || '')) ident += p.text[p.pos++];
    if (!ident) break;
    const key = ident.replace(/[a-z]/g, ''); // FF[3] long names: uppercase wins
    skipSpace(p);
    if (p.text[p.pos] !== '[') continue; // ident without value: ignore
    const values = [];
    while (p.text[p.pos] === '[') {
      values.push(parseValue(p));
      skipSpace(p);
    }
    if (key) node.props[key] = (node.props[key] || []).concat(values);
  }
  return node;
}

function parseValue(p) {
  p.pos++; // consume '['
  let out = '';
  while (p.pos < p.text.length) {
    const ch = p.text[p.pos++];
    if (ch === ']') return out;
    if (ch === '\\') {
      const next = p.text[p.pos++];
      if (next !== '\n') out += next; // escaped newline is a soft break
    } else {
      out += ch;
    }
  }
  return out; // unterminated value
}

function skipSpace(p) {
  while (/\s/.test(p.text[p.pos] || '')) p.pos++;
}

function skipJunk(p) {
  while (p.pos < p.text.length && p.text[p.pos] !== '(') p.pos++;
}
