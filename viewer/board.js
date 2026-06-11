// board.js — minimalist Go board renderer on <canvas>.
// Pure display component: it knows stones, labels and markers, not game
// rules. Intended for reuse as the playing surface for live games.

import { EMPTY, BLACK, WHITE, emptyGrid } from './colors.js';

const COLS = 'ABCDEFGHJKLMNOPQRST'; // no 'I', per Go convention

export class Board {
  constructor(canvas, { size = 19, onPointClick = null } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPointClick = onPointClick;
    this.ghostColor = null; // BLACK/WHITE: stone preview follows the pointer
    this.hover = null;
    this.ownership = null; // size*size of [-1,1], +White/-Black, or null
    this.candidates = null; // [{x, y, text, rank}] engine suggestions, or null
    this.view = null; // {x0,y0,x1,y1} crop (SGF VW), or null = whole board
    this.showNumbers = false; // draw move numbers on stones
    this.josekiGhosts = null; // [{x,y,color,label}] joseki continuation overlay
    this.josekiMarks = null; // [{x,y,type,text}] marks from the joseki node
    this.quizFound = null; // {points, lines, pending} quiz progress overlay
    this.regions = null; // [{x,y}] shaded region (Dojo TT)
    this.lines = null; // [{x1,y1,x2,y2,arrow}] lines/arrows (LN/LR/LS)
    this.wgfGhosts = null; // [{x,y,color,label}] continuation stones (YB/YW)
    this.split = null; // {col,row}: Dojo "n-up" — omit centre line(s) to
                       // split the board into independent quadrant boards
    this.setSize(size);
    canvas.addEventListener('click', (e) => this._handleClick(e));
    canvas.addEventListener('mousemove', (e) => this._handleMove(e));
    canvas.addEventListener('mouseleave', () => this._handleLeave());
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setSize(size) {
    this.size = size;
    this.position = { grid: emptyGrid(size), lastMove: null };
    this.draw();
  }

  // position: {grid: size×size of EMPTY/BLACK/WHITE,
  //            lastMove: {x,y,color}|null,
  //            marks: [{x, y, type, text?}] (optional)}
  setPosition(position) {
    this.position = position;
    this.draw();
  }

  // Territory overlay: array of size*size ownership in [-1,1] (positive
  // White, negative Black, top-left first), or null to clear.
  setOwnership(ownership) {
    this.ownership = ownership;
    this.draw();
  }

  // Engine candidate moves: [{x, y, text, rank}] (rank 0 = best), or null.
  setCandidates(candidates) {
    this.candidates = candidates;
    this.draw();
  }

  // Toggle move numbers drawn on the stones.
  setShowNumbers(on) {
    if (this.showNumbers === on) return;
    this.showNumbers = on;
    this.draw();
  }

  // Joseki continuation overlay: [{x,y,color,label}], or null to clear.
  setJosekiGhosts(list) {
    this.josekiGhosts = list;
    this.draw();
  }

  // Marks from the matched joseki node (triangle, etc.), in dict accent.
  setJosekiMarks(list) {
    this.josekiMarks = list;
    this.draw();
  }

  // Quiz progress overlay: {points: [{x,y}] found answers, lines:
  // [{x1,y1,x2,y2}] found endpoint pairs, pending: {x,y}|null the armed
  // endpoint awaiting its partner}, or null to clear.
  setQuizFound(overlay) {
    this.quizFound = overlay;
    this.draw();
  }

  // Shaded region (Dojo TT): [{x,y}] or null.
  setRegions(list) {
    this.regions = list;
    this.draw();
  }

  // Lines/arrows (LN/LR/LS): [{x1,y1,x2,y2,arrow}] or null.
  setLines(list) {
    this.lines = list;
    this.draw();
  }

  // Continuation ghost stones (Dojo YB/YW): [{x,y,color,label}] or null.
  setWgfGhosts(list) {
    this.wgfGhosts = list;
    this.draw();
  }

  // Crop the board to a sub-rectangle (SGF VW), or null for the whole board.
  setView(rect) {
    const same = JSON.stringify(rect) === JSON.stringify(this.view);
    if (same) return;
    this.view = rect;
    this.draw();
  }

  // Show a stone of `color` under the pointer (null disables).
  setGhost(color) {
    if (this.ghostColor === color) return;
    this.ghostColor = color;
    if (!color) {
      this.hover = null;
      this.canvas.style.cursor = '';
    }
    this.draw();
  }

  // Layout for the visible region (whole board, or the VW crop). ox/oy
  // are the screen coords of the top-left visible intersection (x0,y0).
  _metrics() {
    const px = this.canvas.clientWidth;
    const v = this.view || { x0: 0, y0: 0, x1: this.size - 1, y1: this.size - 1 };
    const cols = v.x1 - v.x0 + 1;
    const rows = v.y1 - v.y0 + 1;
    const cell = px / (Math.max(cols, rows) + 1.7); // +1.7 leaves a label margin
    const ox = (px - (cols - 1) * cell) / 2;
    const oy = (px - (rows - 1) * cell) / 2;
    return { px, cell, ox, oy, x0: v.x0, y0: v.y0, x1: v.x1, y1: v.y1 };
  }

  _sx(m, x) { return m.ox + (x - m.x0) * m.cell; }
  _sy(m, y) { return m.oy + (y - m.y0) * m.cell; }
  _visible(m, x, y) { return x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1; }

  // Dojo "n-up" split: the board is shown as independent quadrant boards
  // by omitting the centre column and/or row line. Returns {c, col, row}
  // (c = centre index) or null. Disabled when cropped (VW), when the centre
  // isn't an integer line, or when a stone actually sits on a centre line.
  _splitAt() {
    if (!this.split || this.view) return null;
    const c = (this.size - 1) / 2;
    if (!Number.isInteger(c)) return null;
    const g = this.position?.grid;
    let col = !!this.split.col;
    let row = !!this.split.row;
    if (g) {
      if (col && g.some((rw) => rw[c] !== EMPTY)) col = false;
      if (row && (g[c] || []).some((v) => v !== EMPTY)) row = false;
    }
    return col || row ? { c, col, row } : null;
  }

  // Show/hide the n-up split. split: {col,row} or null.
  setSplit(split) {
    const s = split && (split.col || split.row)
      ? { col: !!split.col, row: !!split.row } : null;
    const key = s ? `${s.col}/${s.row}` : '';
    if (key === (this._splitKey || '')) return;
    this._splitKey = key;
    this.split = s;
    this.draw();
  }

  draw() {
    const m = this._metrics();
    if (!m.px) return;
    const dpr = window.devicePixelRatio || 1;
    const want = Math.round(m.px * dpr);
    if (this.canvas.width !== want) {
      this.canvas.width = want;
      this.canvas.height = want;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, m.px, m.px);
    this._drawGrid(ctx, m);
    this._drawLabels(ctx, m);
    this._drawStars(ctx, m);
    this._drawRegions(ctx, m);
    this._drawStones(ctx, m);
    this._drawOwnership(ctx, m);
    this._drawMarks(ctx, m);
    this._drawLines(ctx, m);
    this._drawLastMove(ctx, m);
    this._drawCandidates(ctx, m);
    this._drawQuizFound(ctx, m);
    this._drawGhostStones(ctx, m, this.josekiGhosts);
    // above the ghosts: a dictionary mark may sit on a choice stone
    // (e.g. Kogo's "squared position" under a what-if variation stone)
    this._drawJosekiMarks(ctx, m);
    this._drawGhostStones(ctx, m, this.wgfGhosts);
    this._drawGhost(ctx, m);
    ctx.restore();
  }

  _drawGrid(ctx, m) {
    const sp = this._splitAt();
    const left = this._sx(m, m.x0), right = this._sx(m, m.x1);
    const top = this._sy(m, m.y0), bottom = this._sy(m, m.y1);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    // horizontal lines, broken at the column gap so quadrants separate
    for (let y = m.y0; y <= m.y1; y++) {
      if (sp?.row && y === sp.c) continue;
      const py = this._sy(m, y);
      if (sp?.col) {
        ctx.moveTo(left, py); ctx.lineTo(this._sx(m, sp.c - 1), py);
        ctx.moveTo(this._sx(m, sp.c + 1), py); ctx.lineTo(right, py);
      } else {
        ctx.moveTo(left, py); ctx.lineTo(right, py);
      }
    }
    // vertical lines, broken at the row gap
    for (let x = m.x0; x <= m.x1; x++) {
      if (sp?.col && x === sp.c) continue;
      const px = this._sx(m, x);
      if (sp?.row) {
        ctx.moveTo(px, top); ctx.lineTo(px, this._sy(m, sp.c - 1));
        ctx.moveTo(px, this._sy(m, sp.c + 1)); ctx.lineTo(px, bottom);
      } else {
        ctx.moveTo(px, top); ctx.lineTo(px, bottom);
      }
    }
    ctx.stroke();
  }

  _drawLabels(ctx, m) {
    const cell = m.cell;
    const left = this._sx(m, m.x0), right = this._sx(m, m.x1);
    const top = this._sy(m, m.y0), bottom = this._sy(m, m.y1);
    ctx.fillStyle = '#444';
    ctx.font = `${(cell * 0.42).toFixed(1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const sp = this._splitAt();
    for (let x = m.x0; x <= m.x1; x++) {
      if (sp?.col && x === sp.c) continue; // no line here, no label
      const px = this._sx(m, x);
      ctx.fillText(COLS[x], px, top - cell * 0.9);
      ctx.fillText(COLS[x], px, bottom + cell * 0.9);
    }
    for (let y = m.y0; y <= m.y1; y++) {
      if (sp?.row && y === sp.c) continue;
      const py = this._sy(m, y);
      const row = String(this.size - y);
      ctx.fillText(row, left - cell * 0.9, py);
      ctx.fillText(row, right + cell * 0.9, py);
    }
  }

  _drawStars(ctx, m) {
    if (this._splitAt()) return; // sub-board layouts: star points just distract
    ctx.fillStyle = '#000';
    for (const [x, y] of starPoints(this.size)) {
      if (!this._visible(m, x, y)) continue;
      ctx.beginPath();
      ctx.arc(this._sx(m, x), this._sy(m, y), m.cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawStones(ctx, m) {
    const { grid, moveNumbers } = this.position;
    const r = m.cell * 0.47;
    for (let y = m.y0; y <= m.y1; y++) {
      for (let x = m.x0; x <= m.x1; x++) {
        const stone = grid[y][x];
        if (!stone) continue;
        const cx = this._sx(m, x), cy = this._sy(m, y);
        ctx.beginPath();
        ctx.arc(cx, cy, stone === WHITE ? r - 0.5 : r, 0, Math.PI * 2);
        if (stone === BLACK) {
          ctx.fillStyle = '#000';
          ctx.fill();
        } else {
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = '#000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        const num = this.showNumbers && moveNumbers && moveNumbers[y][x];
        if (num) {
          ctx.fillStyle = stone === BLACK ? '#fff' : '#000';
          const digits = num >= 100 ? 0.62 : num >= 10 ? 0.78 : 1;
          ctx.font = `${(r * digits).toFixed(1)}px system-ui, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(num), cx, cy);
        }
      }
    }
  }

  // Small square at each clearly-owned point, opacity tracking
  // confidence; black or white by who owns it.
  _drawOwnership(ctx, m) {
    if (!this.ownership) return;
    const side = m.cell * 0.38;
    for (let y = m.y0; y <= m.y1; y++) {
      for (let x = m.x0; x <= m.x1; x++) {
        const v = this.ownership[y * this.size + x];
        if (Math.abs(v) < 0.12) continue; // skip neutral / dame
        const cx = this._sx(m, x), cy = this._sy(m, y);
        ctx.save();
        ctx.globalAlpha = Math.min(0.85, Math.abs(v));
        ctx.fillStyle = v < 0 ? '#000' : '#fff';
        ctx.fillRect(cx - side / 2, cy - side / 2, side, side);
        if (v > 0) {
          ctx.strokeStyle = '#444'; // outline so white shows on the board
          ctx.lineWidth = 1;
          ctx.strokeRect(cx - side / 2, cy - side / 2, side, side);
        }
        ctx.restore();
      }
    }
  }

  _drawMarks(ctx, m) {
    const { grid, marks } = this.position;
    for (const mark of marks || []) {
      if (!this._visible(m, mark.x, mark.y)) continue;
      const cx = this._sx(m, mark.x), cy = this._sy(m, mark.y);
      const stone = grid[mark.y][mark.x];
      // Dojo marks a particular stone with TB/TW; a same-colour territory
      // square is invisible on it, so draw a contrasting square instead.
      if (mark.type.startsWith('territory') && stone !== EMPTY) {
        ctx.fillStyle = stone === BLACK ? '#fff' : '#000';
        ctx.fillRect(cx - m.cell * 0.14, cy - m.cell * 0.14, m.cell * 0.28, m.cell * 0.28);
        continue;
      }
      // marks on empty points get a white patch so grid lines don't cross them
      if (stone === EMPTY && !mark.type.startsWith('territory')) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - m.cell * 0.4, cy - m.cell * 0.4, m.cell * 0.8, m.cell * 0.8);
      }
      drawMark(ctx, mark, cx, cy, m.cell, stone === BLACK ? '#fff' : '#000');
    }
  }

  _drawLastMove(ctx, m) {
    const { lastMove } = this.position;
    if (this.showNumbers) return; // the number already marks the last move
    if (!lastMove || !this._visible(m, lastMove.x, lastMove.y)) return;
    ctx.beginPath();
    ctx.arc(this._sx(m, lastMove.x), this._sy(m, lastMove.y), m.cell * 0.26, 0, Math.PI * 2);
    ctx.strokeStyle = lastMove.color === BLACK ? '#fff' : '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Colored disc + delta label at each engine candidate, by rank.
  _drawCandidates(ctx, m) {
    if (!this.candidates) return;
    const colors = ['#2e7d32', '#f9a825', '#e65100']; // best → worse
    const r = m.cell * 0.46;
    for (const c of this.candidates) {
      if (!this._visible(m, c.x, c.y)) continue;
      const cx = this._sx(m, c.x), cy = this._sy(m, c.y);
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = colors[c.rank] || '#777';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${(m.cell * 0.32).toFixed(1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text, cx, cy);
      ctx.restore();
    }
  }

  // Marks declared on the matched joseki node (the "triangled" and
  // "squared" positions and letter labels the comment refers to), drawn
  // in the dictionary accent. A label on an empty point gets a white
  // patch so the grid doesn't run through it.
  _drawJosekiMarks(ctx, m) {
    if (!this.josekiMarks) return;
    for (const mark of this.josekiMarks) {
      if (!this._visible(m, mark.x, mark.y)) continue;
      const cx = this._sx(m, mark.x), cy = this._sy(m, mark.y);
      if (mark.type === 'label' && this.position.grid[mark.y][mark.x] === EMPTY) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - m.cell * 0.4, cy - m.cell * 0.4, m.cell * 0.8, m.cell * 0.8);
      }
      drawMark(ctx, mark, cx, cy, m.cell, '#b8860b');
    }
  }

  // Quiz progress: a solid accent disc at each found answer (a "pop"),
  // an accent line for each found endpoint pair (a sector line), and a
  // ring on the armed endpoint awaiting its partner.
  _drawQuizFound(ctx, m) {
    if (!this.quizFound) return;
    const { points = [], lines = [], pending = null } = this.quizFound;
    ctx.save();
    ctx.strokeStyle = '#2e7d32';
    ctx.lineWidth = 2.5;
    for (const l of lines) {
      if (!this._visible(m, l.x1, l.y1) || !this._visible(m, l.x2, l.y2)) continue;
      ctx.beginPath();
      ctx.moveTo(this._sx(m, l.x1), this._sy(m, l.y1));
      ctx.lineTo(this._sx(m, l.x2), this._sy(m, l.y2));
      ctx.stroke();
    }
    ctx.fillStyle = '#2e7d32';
    for (const { x, y } of points) {
      if (!this._visible(m, x, y)) continue;
      ctx.beginPath();
      ctx.arc(this._sx(m, x), this._sy(m, y), m.cell * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    if (pending && this._visible(m, pending.x, pending.y)) {
      ctx.beginPath();
      ctx.arc(this._sx(m, pending.x), this._sy(m, pending.y), m.cell * 0.38, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Shaded region behind the stones (Dojo TT — territory/moyo highlight).
  _drawRegions(ctx, m) {
    if (!this.regions) return;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (const { x, y } of this.regions) {
      if (!this._visible(m, x, y)) continue;
      ctx.fillRect(this._sx(m, x) - m.cell / 2, this._sy(m, y) - m.cell / 2, m.cell, m.cell);
    }
  }

  // Lines over the board: solid sector lines/boundaries (LN/LR) and dashed
  // "broken" lines (LS — sector lines cut by a stone, so they don't count).
  _drawLines(ctx, m) {
    if (!this.lines) return;
    ctx.strokeStyle = '#c0392b';
    ctx.lineWidth = 2;
    for (const l of this.lines) {
      if (!this._visible(m, l.x1, l.y1) || !this._visible(m, l.x2, l.y2)) continue;
      ctx.setLineDash(l.dashed ? [5, 4] : []);
      ctx.beginPath();
      ctx.moveTo(this._sx(m, l.x1), this._sy(m, l.y1));
      ctx.lineTo(this._sx(m, l.x2), this._sy(m, l.y2));
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Translucent numbered stones (a joseki or .wgf continuation).
  _drawGhostStones(ctx, m, list) {
    if (!list) return;
    const r = m.cell * 0.46;
    for (const g of list) {
      if (!this._visible(m, g.x, g.y)) continue;
      const cx = this._sx(m, g.x), cy = this._sy(m, g.y);
      ctx.save();
      ctx.globalAlpha = 0.7; // opaque enough that black vs white reads clearly
      ctx.beginPath();
      ctx.arc(cx, cy, g.color === WHITE ? r - 0.5 : r, 0, Math.PI * 2);
      if (g.color === BLACK) {
        ctx.fillStyle = '#000';
        ctx.fill();
      } else {
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = g.color === BLACK ? '#fff' : '#000';
      ctx.font = `bold ${(r * 0.85).toFixed(1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.label, cx, cy);
      ctx.restore();
    }
  }

  _drawGhost(ctx, m) {
    if (!this.ghostColor || !this.hover) return;
    const { x, y } = this.hover;
    if (!this._visible(m, x, y) || this.position.grid[y][x] !== EMPTY) return;
    const r = m.cell * 0.47;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(this._sx(m, x), this._sy(m, y), this.ghostColor === WHITE ? r - 0.5 : r, 0, Math.PI * 2);
    if (this.ghostColor === BLACK) {
      ctx.fillStyle = '#000';
      ctx.fill();
    } else {
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  _pointFromEvent(e) {
    const rect = this.canvas.getBoundingClientRect();
    const m = this._metrics();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = Math.round((mx - m.ox) / m.cell) + m.x0;
    const y = Math.round((my - m.oy) / m.cell) + m.y0;
    if (!this._visible(m, x, y)) return null;
    const dx = mx - this._sx(m, x);
    const dy = my - this._sy(m, y);
    return dx * dx + dy * dy <= m.cell * m.cell * 0.25 ? { x, y } : null;
  }

  _handleClick(e) {
    if (!this.onPointClick) return;
    const pt = this._pointFromEvent(e);
    if (pt) this.onPointClick(pt.x, pt.y);
  }

  _handleMove(e) {
    if (!this.ghostColor) return;
    const pt = this._pointFromEvent(e);
    const valid = pt && this.position.grid[pt.y][pt.x] === EMPTY ? pt : null;
    // the ghost replaces the pointer wherever a stone could land
    this.canvas.style.cursor = valid ? 'none' : '';
    if (valid?.x !== this.hover?.x || valid?.y !== this.hover?.y) {
      this.hover = valid;
      this.draw();
    }
  }

  _handleLeave() {
    if (this.hover) {
      this.hover = null;
      this.draw();
    }
    this.canvas.style.cursor = '';
  }
}

// SGF markup glyphs, inked for contrast against the underlying stone.
function drawMark(ctx, mark, cx, cy, cell, ink) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1.5;
  const r = cell * 0.27;
  switch (mark.type) {
    case 'triangle': {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const px = cx + Math.cos(a) * r * 1.2;
        const py = cy + Math.sin(a) * r * 1.2;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'square':
      ctx.strokeRect(cx - r * 0.9, cy - r * 0.9, r * 1.8, r * 1.8);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'x':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy - r * 0.8);
      ctx.lineTo(cx + r * 0.8, cy + r * 0.8);
      ctx.moveTo(cx + r * 0.8, cy - r * 0.8);
      ctx.lineTo(cx - r * 0.8, cy + r * 0.8);
      ctx.stroke();
      break;
    case 'label':
      ctx.font = `${Math.round(cell * 0.55)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mark.text.slice(0, 3), cx, cy);
      break;
    case 'territory-b':
    case 'territory-w':
      ctx.fillStyle = mark.type === 'territory-b' ? '#000' : '#fff';
      ctx.fillRect(cx - cell * 0.14, cy - cell * 0.14, cell * 0.28, cell * 0.28);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - cell * 0.14, cy - cell * 0.14, cell * 0.28, cell * 0.28);
      break;
  }
}

function starPoints(size) {
  if (size === 19) return combos([3, 9, 15]);
  if (size === 13) return [...combos([3, 9]), [6, 6]];
  if (size === 9) return [...combos([2, 6]), [4, 4]];
  return size % 2 ? [[(size - 1) / 2, (size - 1) / 2]] : [];
}

function combos(values) {
  const out = [];
  for (const x of values) for (const y of values) out.push([x, y]);
  return out;
}
