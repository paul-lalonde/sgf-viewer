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
    if (!ident) {
      // End the node only at a real boundary. Otherwise tolerate the stray
      // char and keep scanning: .wgf packs prose with unescaped ] into XS
      // values, which leaks text here — bailing would drop the real
      // properties (e.g. a move) that follow it.
      const ch = p.text[p.pos];
      if (ch === undefined || ch === ';' || ch === '(' || ch === ')') break;
      p.pos++;
      continue;
    }
    const key = ident.replace(/[a-z]/g, ''); // FF[3] long names: uppercase wins
    skipSpace(p);
    if (p.text[p.pos] !== '[') continue; // ident without value: ignore
    const values = [];
    while (p.text[p.pos] === '[') {
      // XS is a .wgf "display response": its value nests other properties'
      // brackets (TR[..], XX[..], …) before the prose, so read it with
      // bracket-depth matching rather than stopping at the first ].
      values.push(key === 'XS' ? parseNestedValue(p) : parseValue(p));
      skipSpace(p);
    }
    if (key) {
      node.props[key] = (node.props[key] || []).concat(values);
      // record move order: some .wgf nodes pack a whole opening as many
      // B[]/W[] in one node, and merging into per-colour arrays loses the
      // interleaving. moveSeq keeps [colour, point] in file order.
      if (key === 'B' || key === 'W') {
        for (const v of values) (node.moveSeq = node.moveSeq || []).push([key, v]);
      }
    }
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

// Read a value whose content may nest other [..] brackets (the .wgf XS
// "display response"). The value ends at the ] that returns bracket depth
// to 0; interior [..] are kept verbatim.
function parseNestedValue(p) {
  p.pos++; // consume opening '['
  let out = '';
  let depth = 1;
  while (p.pos < p.text.length) {
    const ch = p.text[p.pos++];
    if (ch === '\\') {
      const next = p.text[p.pos++];
      if (next !== '\n') out += next; // escaped newline is a soft break
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']' && --depth === 0) return out;
    out += ch;
  }
  return out; // unterminated value
}

// Serialize a node tree back to SGF text.
export function writeSGF(root) {
  const out = [];
  const writeNode = (n) => {
    out.push(';');
    for (const [key, values] of Object.entries(n.props)) {
      out.push(key, ...values.flatMap((v) => ['[', escapeValue(v), ']']));
    }
    out.push('\n');
  };
  const writeSeq = (start) => {
    let n = start;
    writeNode(n);
    while (n.children.length === 1) {
      n = n.children[0];
      writeNode(n);
    }
    for (const child of n.children) {
      out.push('(');
      writeSeq(child);
      out.push(')\n');
    }
  };
  out.push('(');
  writeSeq(root);
  out.push(')\n');
  return out.join('');
}

function escapeValue(v) {
  return String(v).replace(/[\\\]]/g, (c) => '\\' + c);
}

function skipSpace(p) {
  while (/\s/.test(p.text[p.pos] || '')) p.pos++;
}

function skipJunk(p) {
  while (p.pos < p.text.length && p.text[p.pos] !== '(') p.pos++;
}
