// colors.js — shared point-state constants and grid helper.

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export function emptyGrid(size) {
  return Array.from({ length: size }, () => new Array(size).fill(EMPTY));
}
