// tree.js — game-tree view. Pure navigation UI: renders the SGF node
// tree, highlights the current node, reports clicks.
//
// Layout: every line of play is one absolutely-positioned horizontal row.
// A variation is packed into the first free row below its split point,
// rooted at the same x as the mainline continuation, with an SVG
// connector bar running up to the split point. Collapsing keeps things
// compact: variations can be folded behind ▾n toggles (default open),
// and stretches of plain consecutive moves (no comments, marks, or
// branches) collapse into one "12–45" segment that shows the current
// move number while you are inside it.

import { isMove, moveOf, singleSetup } from './game.js';
import { BLACK } from './colors.js';

// Props that make a node worth showing individually.
const ANNOTATIONS = ['C', 'TR', 'SQ', 'CR', 'MA', 'LB', 'TB', 'TW', 'AB', 'AW', 'AE', 'M', 'L'];

const ROW_H = 26; // vertical pitch between rows
const CELL_MID = 10; // y of a row's visual center, within the row
const CELL_BOT = 18; // y of a row's visual bottom, within the row
const PAD = 14; // min horizontal gap between lines sharing a row
const BAR = 8; // connector bar offset, left of a variation's first cell
const MARGIN = { left: 12, top: 4 };
const CLEAN_SCAN = 40; // rows to try for a crossing-free connector

export class TreeView {
  constructor(container, { onSelect } = {}) {
    this.container = container;
    this.onSelect = onSelect || (() => {});
    this.info = new Map(); // node -> {el, num, seg?}
    this.toggles = new Map(); // branch node -> {btn, node, open}
    this.lines = []; // parents always precede their variations
    this.game = null;
    this._cur = null;
  }

  setGame(game) {
    this.game = game;
    this.container.textContent = '';
    this.info.clear();
    this.toggles.clear();
    this.lines = [];
    this._cur = null;
    if (!game) return;
    this.wrap = document.createElement('div');
    this.wrap.className = 'treewrap';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('class', 'connectors');
    this.wrap.appendChild(this.svg);
    this.container.appendChild(this.wrap);
    // Depth-first: a line's whole subtree precedes its later siblings,
    // so the packer keeps subtrees vertically contiguous.
    const build = (spec) => {
      const subSpecs = [];
      this.lines.push(this._buildLine(spec, subSpecs));
      for (const sub of subSpecs) build(sub);
    };
    build({ start: game.root, movesBefore: 0, parent: null, toggle: null, anchor: null });
    for (const line of this.lines) this.wrap.appendChild(line.el);
    this._layout();
    this.update();
  }

  update() {
    if (!this.game) return;
    if (this._expandTo(this.game.current)) this._layout();
    if (this._cur) {
      this._cur.el.classList.remove('current');
      const seg = this._cur.seg;
      if (seg) seg.el.textContent = `${seg.first}–${seg.last}`;
    }
    const info = this.info.get(this.game.current) || null;
    this._cur = info;
    if (!info) return; // e.g. at the (unrendered) root
    info.el.classList.add('current');
    // inside a segment, show just the current move number (never wider
    // than the range label, so the layout stays valid without a re-pack)
    if (info.seg) info.el.textContent = String(info.num);
    // center horizontally so upcoming forks are visible
    info.el.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  // --- construction -----------------------------------------------------

  // Build one line of play: follow first children from `start` to the
  // end, emitting cells. Variations found along the way are queued as
  // new lines (so this.lines stays parent-before-child).
  _buildLine({ start, movesBefore, parent, toggle, anchor }, queue) {
    const el = document.createElement('div');
    el.className = 'line';
    const line = { el, parent, toggle, anchor, row: 0, left: 0, width: 0 };
    let node = start;
    let num = movesBefore;
    let run = []; // pending collapsible moves: [{node, num}]
    const flush = () => {
      if (run.length) this._emit(el, run);
      run = [];
    };
    while (node) {
      if (stepOf(node, this.game.size)) num++;
      if (!node.parent && !isMove(node)) {
        // root placeholder: redundant, the board shows the setup
      } else if (collapsible(node, this.game.size)) {
        run.push({ node, num });
      } else {
        flush();
        el.appendChild(this._moveEl(node, num));
      }
      if (node.children.length > 1) {
        flush();
        const t = this._addToggle(el, node);
        for (const child of node.children.slice(1)) {
          queue.push({ start: child, movesBefore: num, parent: line, toggle: t, anchor: node.children[0] });
        }
      }
      node = node.children[0];
    }
    flush();
    return line;
  }

  // Emit a run of collapsible moves: single moves stand alone, longer
  // runs become one segment. Clicking a segment jumps to its last move.
  _emit(el, run) {
    if (run.length === 1) {
      el.appendChild(this._moveEl(run[0].node, run[0].num));
      return;
    }
    const segEl = document.createElement('span');
    segEl.className = 'seg';
    const seg = { el: segEl, first: run[0].num, last: run[run.length - 1].num };
    segEl.textContent = `${seg.first}–${seg.last}`;
    segEl.title = `moves ${seg.first}–${seg.last}`;
    const lastNode = run[run.length - 1].node;
    segEl.addEventListener('click', () => this.onSelect(lastNode));
    for (const { node, num } of run) this.info.set(node, { el: segEl, num, seg });
    el.appendChild(segEl);
  }

  _moveEl(node, num) {
    const el = document.createElement('span');
    const mv = moveOf(node, this.game.size);
    const step = stepOf(node, this.game.size);
    if (step) {
      el.className = `move ${step.color === BLACK ? 'b' : 'w'}`;
      el.textContent = step.pass ? `${num}·pass` : String(num);
    } else {
      el.className = 'move setup';
      el.textContent = '·';
    }
    if (node.props.C) el.classList.add('commented');
    el.addEventListener('click', () => this.onSelect(node));
    this.info.set(node, { el, num });
    return el;
  }

  _addToggle(el, node) {
    const btn = document.createElement('span');
    btn.className = 'toggle';
    const toggle = { btn, node, open: true };
    btn.textContent = `▾${node.children.length - 1}`;
    btn.addEventListener('click', () => {
      this._setOpen(toggle, !toggle.open);
      this._layout();
      this.update();
    });
    this.toggles.set(node, toggle);
    el.appendChild(btn);
    return toggle;
  }

  _setOpen(toggle, open) {
    toggle.open = open;
    toggle.btn.textContent = `${open ? '▾' : '▸'}${toggle.node.children.length - 1}`;
  }

  // Open every collapsed variation on the path to `node`; returns
  // whether anything changed (and a re-layout is needed).
  _expandTo(node) {
    let changed = false;
    const path = [];
    for (let n = node; n; n = n.parent) path.push(n);
    path.reverse();
    for (let i = 0; i + 1 < path.length; i++) {
      const toggle = this.toggles.get(path[i]);
      if (toggle && !toggle.open && path[i].children.indexOf(path[i + 1]) > 0) {
        this._setOpen(toggle, true);
        changed = true;
      }
    }
    return changed;
  }

  _visible(line) {
    for (let l = line; l.toggle; l = l.parent) {
      if (!l.toggle.open) return false;
    }
    return true;
  }

  // --- layout ------------------------------------------------------------

  // Pack each visible line into the first free row below its split
  // point, then draw connector bars from each variation up to its split.
  _layout() {
    // measure with inactive segment labels (the active form is narrower)
    if (this._cur?.seg) {
      const seg = this._cur.seg;
      seg.el.textContent = `${seg.first}–${seg.last}`;
    }
    const placed = [];
    for (const line of this.lines) {
      const visible = this._visible(line);
      line.el.style.display = visible ? '' : 'none';
      if (visible) placed.push(line);
    }
    for (const line of placed) line.width = line.el.offsetWidth;

    const content = []; // content[row] = [[x1, x2], ...]
    const channels = []; // channels[row] = [x, ...] of connector bars
    const contentFree = (r, x1, x2) =>
      !(content[r] || []).some(([a, b]) => x1 < b && a < x2) &&
      !(channels[r] || []).some((x) => x >= x1 - 2 && x <= x2 + 2);
    const channelFree = (r, x) => !(content[r] || []).some(([a, b]) => x - 1 < b && a < x + 1);

    let floor = 0; // rows never decrease in DFS order: subtrees stay contiguous
    for (const line of placed) {
      if (!line.parent) {
        line.row = 0;
        line.left = 0;
        (content[0] = content[0] || []).push([0, line.width + PAD]);
        continue;
      }
      const anchorEl = this.info.get(line.anchor)?.el;
      line.left = line.parent.left + (anchorEl ? anchorEl.offsetLeft : 0);
      const barX = Math.max(line.left - BAR, 2);
      const fitsAt = (r, needCleanBar) => {
        if (!contentFree(r, barX - 2, line.left + line.width + PAD)) return false;
        if (!needCleanBar) return true;
        for (let i = line.parent.row + 1; i < r; i++) {
          if (!channelFree(i, barX)) return false;
        }
        return true;
      };
      const first = Math.max(line.parent.row + 1, floor);
      let r = first;
      while (r < first + CLEAN_SCAN && !fitsAt(r, true)) r++;
      if (r === first + CLEAN_SCAN) {
        // no crossing-free row nearby: tuck close and let the bar cross
        r = first;
        while (!fitsAt(r, false)) r++;
      }
      line.row = r;
      floor = r;
      (content[r] = content[r] || []).push([barX - 2, line.left + line.width + PAD]);
      for (let i = line.parent.row + 1; i < r; i++) (channels[i] = channels[i] || []).push(barX);
    }

    let maxRight = 0;
    let maxRow = 0;
    for (const line of placed) {
      line.el.style.left = `${line.left + MARGIN.left}px`;
      line.el.style.top = `${line.row * ROW_H + MARGIN.top}px`;
      maxRight = Math.max(maxRight, line.left + line.width);
      maxRow = Math.max(maxRow, line.row);
    }
    const width = maxRight + MARGIN.left + 24;
    const height = (maxRow + 1) * ROW_H + MARGIN.top + 12;
    this.wrap.style.width = `${width}px`;
    this.wrap.style.height = `${height}px`;
    this._drawConnectors(placed, width, height);
    if (this._cur?.seg) this._cur.seg.el.textContent = String(this._cur.num);
  }

  _drawConnectors(placed, width, height) {
    this.svg.setAttribute('width', width);
    this.svg.setAttribute('height', height);
    let d = '';
    for (const line of placed) {
      if (!line.parent) continue;
      const x = Math.max(line.left - BAR, 2) + MARGIN.left;
      const y1 = line.parent.row * ROW_H + MARGIN.top + CELL_BOT;
      const y2 = line.row * ROW_H + MARGIN.top + CELL_MID;
      d += `M${x} ${y1}V${y2}H${line.left + MARGIN.left - 2}`;
    }
    this.svg.innerHTML = d ? `<path d="${d}" fill="none" stroke="#bbb" stroke-width="1.5"/>` : '';
  }
}

// A "step" is one stone appearing: a move, or a single-stone AB/AW node
// (how old mgt/IGS reviews encode demonstration lines). Both are
// numbered sequentially in the tree.
function stepOf(node, size) {
  return moveOf(node, size) || singleSetup(node, size);
}

function collapsible(node, size) {
  if (node.children.length > 1) return false;
  if (isMove(node)) return !annotated(node);
  if (singleSetup(node, size)) return !annotatedBeyondSetup(node);
  return false;
}

function annotated(node) {
  return ANNOTATIONS.some((p) => p in node.props);
}

function annotatedBeyondSetup(node) {
  return ANNOTATIONS.some((p) => p !== 'AB' && p !== 'AW' && p in node.props);
}
