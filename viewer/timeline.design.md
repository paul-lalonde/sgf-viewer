# Node timelines (design)

## Purpose

Dojo's display model is "a base position plus a numbered, steppable
sequence". The format encodes that one concept several ways — many
`B[]`/`W[]` moves packed into one node, numbered `YB`/`YW` ghost stones,
`YS` quiz placements — and the viewer grew a separate mechanism for each.
The packed-move mechanism was the costly one: `expandPackedMoves`
fabricated synthetic nodes, relocated the comment/marks/quiz to the last
one, and `rerouteGameLine` then repaired the structure around the result.

This design replaces the tree surgery with an intra-node model: a node
*keeps* its packed moves, the position engine replays them all (or a
prefix, for stepping), and navigation stays node-granular — which is
exactly Dojo's behaviour: `>` jumps a whole numbered sequence at once,
and STEP takes it back and replays it stone by stone. One STEP control
then drives both packed moves and ghost sequences. (Quiz placements are
revealed by *answering*, not stepping, and stay in quiz.js.)

## Requirements

- **R1 (movesOf).** `movesOf(node, size)` returns the node's moves in
  played order: from the parser's `moveSeq` when several `B`/`W` are
  packed in one node (file order, colours interleaved as written), else
  the single `B`/`W` move, else `[]`. Each entry is `{x, y, color}` or
  `{color, pass: true}`.
- **R2 (replay).** `Game.position()` applies *every* move of each node
  on the path, in `movesOf` order, with captures and per-move numbering
  exactly as if each move were its own node (`moveNumber`, `captures`,
  `moveNumbers`, `movesAt` all count moves, not nodes). `lastMove` is
  the last move applied.
- **R3 (step cap).** `Game.position(moveCap)` limits how many of the
  **current** node's own moves are applied (ancestors always replay in
  full). `moveCap` past the end behaves as "all"; `0` shows the position
  before the node's first move (after its setup).
- **R4 (no tree surgery).** `parseWgf` no longer expands packed nodes:
  the parsed tree mirrors the file (children, comments, marks, and quiz
  properties stay on the node that carries them). `rerouteGameLine`
  still reroutes a `YF` continuation past inline reference diagrams.
- **R5 (engine flattening).** `engineMoves()` emits every move of every
  path node in order, so engine play/score/explore see the true game.
- **R6 (navigation).** `next`/`prev`/`goTo`/`variation` keep node
  granularity. `lineLength()` counts **moves** on the preferred line.
- **R7 (tree view).** A multi-move node renders as one cell labelled
  with its move range ("3–26"), coloured by its first move, and is never
  collapsed into a segment with its neighbours (it usually carries the
  sequence's comment). Single-move nodes are unchanged.
- **R8 (unified STEP).** The step button (and `.`) drives one combined
  timeline per node: the node's packed moves (when it has ≥ 2) followed
  by its numbered ghosts. Arriving at a node shows everything; the first
  press rewinds; each further press reveals the next move (via R3) or
  ghost; past the end the full display returns. Navigating away resets.
- **R9 (move targets).** `#file@move` bookmarks resolve to the node
  *containing* that move (counting per R2's numbering).

## Signatures

```js
// game.js
export function movesOf(node, size)       // R1; moveOf(node) stays = movesOf(...)[0]
class Game {
  position(moveCap = Infinity)            // R2, R3
  engineMoves()                           // R5 — flattened
  lineLength()                            // R6 — counts moves
}

// app.js (stepping state, replacing ghostStep)
nodeTimeline(node, size)  // -> { moves: count-or-0, ghosts: [...] }  (R8)
stepGhosts()              // renamed stepTimeline(); drives position cap + ghost reveal
```

## Edge cases

- A packed node whose moves include a pass (`B[]`): replayed as a pass
  (numbering advances, no stone).
- Captures inside a packed sequence (sacrifice openings): R2's per-move
  replay handles ko/recapture numbering via the existing `movesAt`.
- A packed node that also has setup (`AE`/`AB`/`AW`): setup applies
  before its first move (unchanged `applySetup` order).
- Step cap on a node with a single move: the moves part is not steppable
  (only its ghosts are) — `◀` already takes back a single move.
- Plain SGF files never pack moves; behaviour is unchanged throughout.

## Not in scope

- Quiz placements stay in quiz.js (revealed by answering).
- Persisting the step position across reloads (transient view state).
- Dojo's STEP button relocation choreography (left-of-< vs right-of->);
  one cycling button.
