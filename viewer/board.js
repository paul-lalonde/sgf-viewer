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

  _metrics() {
    const px = this.canvas.clientWidth;
    const cell = px / (this.size + 1.7);
    return { px, cell, origin: cell * 1.35 };
  }

  draw() {
    const { px, cell, origin } = this._metrics();
    if (!px) return;
    const dpr = window.devicePixelRatio || 1;
    const want = Math.round(px * dpr);
    if (this.canvas.width !== want) {
      this.canvas.width = want;
      this.canvas.height = want;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, px, px);
    this._drawGrid(ctx, cell, origin);
    this._drawLabels(ctx, cell, origin);
    this._drawStars(ctx, cell, origin);
    this._drawStones(ctx, cell, origin);
    this._drawOwnership(ctx, cell, origin);
    this._drawMarks(ctx, cell, origin);
    this._drawLastMove(ctx, cell, origin);
    this._drawGhost(ctx, cell, origin);
    ctx.restore();
  }

  _drawGrid(ctx, cell, origin) {
    const far = origin + (this.size - 1) * cell;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < this.size; i++) {
      const p = origin + i * cell;
      ctx.moveTo(origin, p);
      ctx.lineTo(far, p);
      ctx.moveTo(p, origin);
      ctx.lineTo(p, far);
    }
    ctx.stroke();
  }

  _drawLabels(ctx, cell, origin) {
    const far = origin + (this.size - 1) * cell;
    ctx.fillStyle = '#444';
    ctx.font = `${(cell * 0.42).toFixed(1)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.size; i++) {
      const p = origin + i * cell;
      const col = COLS[i];
      const row = String(this.size - i);
      ctx.fillText(col, p, origin - cell * 0.9);
      ctx.fillText(col, p, far + cell * 0.9);
      ctx.fillText(row, origin - cell * 0.9, p);
      ctx.fillText(row, far + cell * 0.9, p);
    }
  }

  _drawStars(ctx, cell, origin) {
    ctx.fillStyle = '#000';
    for (const [x, y] of starPoints(this.size)) {
      ctx.beginPath();
      ctx.arc(origin + x * cell, origin + y * cell, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _drawStones(ctx, cell, origin) {
    const { grid } = this.position;
    const r = cell * 0.47;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const stone = grid[y][x];
        if (!stone) continue;
        ctx.beginPath();
        ctx.arc(origin + x * cell, origin + y * cell, stone === WHITE ? r - 0.5 : r, 0, Math.PI * 2);
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
      }
    }
  }

  // Small square at each clearly-owned point, opacity tracking
  // confidence; black or white by who owns it.
  _drawOwnership(ctx, cell, origin) {
    if (!this.ownership) return;
    const side = cell * 0.38;
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const v = this.ownership[y * this.size + x];
        if (Math.abs(v) < 0.12) continue; // skip neutral / dame
        const cx = origin + x * cell;
        const cy = origin + y * cell;
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

  _drawMarks(ctx, cell, origin) {
    const { grid, marks } = this.position;
    for (const mark of marks || []) {
      const cx = origin + mark.x * cell;
      const cy = origin + mark.y * cell;
      const stone = grid[mark.y][mark.x];
      // marks on empty points get a white patch so grid lines don't cross them
      if (stone === EMPTY && !mark.type.startsWith('territory')) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(cx - cell * 0.4, cy - cell * 0.4, cell * 0.8, cell * 0.8);
      }
      drawMark(ctx, mark, cx, cy, cell, stone === BLACK ? '#fff' : '#000');
    }
  }

  _drawLastMove(ctx, cell, origin) {
    const { lastMove } = this.position;
    if (!lastMove) return;
    ctx.beginPath();
    ctx.arc(origin + lastMove.x * cell, origin + lastMove.y * cell, cell * 0.26, 0, Math.PI * 2);
    ctx.strokeStyle = lastMove.color === BLACK ? '#fff' : '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawGhost(ctx, cell, origin) {
    if (!this.ghostColor || !this.hover) return;
    const { x, y } = this.hover;
    if (this.position.grid[y][x] !== EMPTY) return;
    const r = cell * 0.47;
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(origin + x * cell, origin + y * cell, this.ghostColor === WHITE ? r - 0.5 : r, 0, Math.PI * 2);
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
    const { cell, origin } = this._metrics();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const x = Math.round((mx - origin) / cell);
    const y = Math.round((my - origin) / cell);
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return null;
    const dx = mx - (origin + x * cell);
    const dy = my - (origin + y * cell);
    return dx * dx + dy * dy <= cell * cell * 0.25 ? { x, y } : null;
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
