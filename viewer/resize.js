// resize.js — draggable splitter handles between the layout panels.
//
// Columns are sized by CSS custom properties on <html> (--lcol, --rcol);
// a column splitter drags one of them. Rows inside a flex column are
// sized by a CSS var the pane's height reads; the flex:1 sibling absorbs
// the difference. All sizes persist in localStorage.

const px = (n) => `${Math.round(n)}px`;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Run onMove for every pointermove until the pointer is released.
function drag(onMove, cursor) {
  const move = (e) => onMove(e);
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.body.style.userSelect = 'none';
  document.body.style.cursor = cursor;
}

// A vertical bar that resizes a grid column. side 'left' sets --lcol to
// the pointer x; 'right' sets --rcol to the distance from the right edge.
export function columnSplitter(handle, { side, min, max, store }) {
  const root = document.documentElement;
  const varName = side === 'left' ? '--lcol' : '--rcol';
  const saved = store && localStorage.getItem(store);
  if (saved) root.style.setProperty(varName, saved);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag((ev) => {
      const raw = side === 'left' ? ev.clientX : window.innerWidth - ev.clientX;
      const w = px(clamp(raw, min, max));
      root.style.setProperty(varName, w);
      if (store) localStorage.setItem(store, w);
    }, 'col-resize');
  });
}

// A horizontal bar that resizes `pane`'s height via a CSS var. `pos` is
// where the pane sits relative to the handle: 'above' (handle on the
// pane's bottom edge) or 'below' (handle on its top edge).
export function rowSplitter(handle, pane, { pos, varName, min, max, store }) {
  const root = document.documentElement;
  const saved = store && localStorage.getItem(store);
  if (saved) root.style.setProperty(varName, saved);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag((ev) => {
      const r = pane.getBoundingClientRect();
      const raw = pos === 'above' ? ev.clientY - r.top : r.bottom - ev.clientY;
      const h = px(clamp(raw, min, max));
      root.style.setProperty(varName, h);
      if (store) localStorage.setItem(store, h);
    }, 'row-resize');
  });
}
