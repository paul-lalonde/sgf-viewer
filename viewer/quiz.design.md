# quiz.js — Dojo quiz logic (design)

## Purpose

Encapsulate the WGF quiz answer grammar and interaction state in one pure,
DOM-free module. A `Quiz` is created when the player lands on a node
carrying `YN`/`YA`/`YO`/`YS`; it interprets clicks (single points, and the
sector-test "click the two endpoints" pairs), tracks find-all and ordered
sequence progress, and tells the caller what feedback to show. `app.js`
keeps the rendering and the solved/continue flow.

Grammar source: `docs/wgf-format.md` §5.4–§5.5, re-derived from the four
shipped Dojo files (every one of the 4,192 quiz entries classifies under
this grammar — `CLAUDE.scripts/scan-quiz-entries.mjs`).

## Entry grammar

Each quiz property value is one of (points lower-case, but upper-case
typos like `OK` fold to `ok` exactly as `parsePoint` does):

| form | meaning |
|---|---|
| `pt:score[:resp]` | single-point answer; optional explicit response key |
| `p1p2:score[:resp]` | **pair** answer — click both endpoints (unordered) |
| `p1p2…pn=score` | **any-of** — each listed point alone earns this score |
| `tt:score` | verdict for an off-list single click ("take sente") |
| `tttt:score` | verdict for an off-list pair |
| `pt@b` / `pt@w` | placement — stone added to the board when the preceding ordered answer is consumed |

`score = 0` is correct; non-zero is a wrong-answer reason code. The
feedback key for a result is the explicit `resp` field when present, else
the score itself (`qj:0:2` → show `XS[2]`; `jq:7` → show `XS[7]`).

## Requirements

- **R1 (parse).** Entries parse per the table above. Points are
  normalized through `parsePoint` (upper-case typos fold; `OK:0` is an
  answerable entry at `ok`). Unparseable entries are ignored.
- **R2 (marks are not hidden).** *(Inverted from the original design.)*
  A quiz node's own marks must stay visible while the quiz is unsolved:
  they are question furniture, not an answer key — `LB` letters are the
  clickable choices ("click on the letter G", "click on X to take
  sente"), `TR`/`TB` mark the stones the prose calls "triangle"/"the
  marked stone" (GROUP SECTOR LINE TEST 2 even asks you to *click* the
  marked stone). The answer-key marks live in the `XS` display responses
  (drawn only on reveal) and on separate `…ANSWERS` nodes. This module
  therefore exposes no point-hiding API.
- **R3 (single lookup).** A click on a point named by a single or any-of
  entry resolves to that entry's score/resp. Score 0 is correct.
- **R4 (off-list singles).** In `YN`/`YA`, a single click on no listed
  point resolves through the `tt` verdict when present (`tt:0` = taking
  sente is correct, and solves a YN); with no `tt`, the result is `miss`.
- **R5 (endpoint arming).** In a quiz that has pair entries (a pair
  answer or a `tttt` verdict), a click arms as an endpoint (`pending`)
  when it is a *stone*, **or a point named by any pair entry** (edge
  sector lines end on empty edge points — `ofsg:0` runs O14–T13 with
  nothing on T13), **or when an endpoint is already armed** (the second
  click of a pair always completes the attempt). Clicking the armed
  point again disarms (`unselect`). A click that matches a single/any-of
  answer scores immediately instead of arming (mixed quizzes like
  `YA[…][kl:0][mkgp:0]`).
- **R6 (pair lookup).** A formed pair matches a pair entry regardless of
  click order. Score 0 is correct and reports the pair's line; non-zero
  is wrong. An unlisted pair resolves through `tttt`, else `miss`.
- **R7 (unlisted empty points don't arm).** With no endpoint armed, a
  click on an empty intersection that no pair entry names goes through
  single lookup even in a pair quiz (moves are played on empty points;
  only R5's cases participate in pair selection).
- **R8 (find-all).** In `YA`, each correct answer entry counts once
  toward the total (`gcgd=0` is one slot satisfiable by either point;
  a pair is one slot). Re-finding a satisfied slot returns `again` and
  changes nothing. The quiz reports `{found, total}` and is solved when
  all slots are found.
- **R9 (pick-one).** In `YN`, any correct resolution solves the quiz.
- **R10 (ordered answers).** In `YO`/`YS`, the required answer is the
  first unconsumed score-0 entry in file order. Clicking a point of that
  entry consumes it and advances the cursor; the quiz is solved when no
  score-0 entries remain.
- **R11 (staged wrong answers).** An ordered wrong click resolves to the
  first matching non-zero entry **at/after the cursor**, falling back to
  a match anywhere, then to `tt`. (The same point may carry different
  reasons at different stages — `il:5` early, `il:4` later.)
- **R12 (placements).** Consuming an ordered correct entry also consumes
  the placement entries that immediately follow it; `placed` accumulates
  `{x, y, color}` stones for the caller to overlay (the guided playout,
  e.g. `hl:0:2  hl@b hm@w`).
- **R13 (reveal key).** `revealKey` is the feedback key of the solving
  entry (default `'0'`) so the caller can pull the right `XS` display
  marks for the answer reveal.
- **R14 (overlay).** `foundOverlay()` reports found points, found pair
  lines, and the armed endpoint, for board display.
- **R15 (score normalization).** Scores and response keys normalize
  numerically modulo 256: `nfmf=00` is a correct answer (score 0), and
  `os:268` / `kn:274` resolve to reason codes 12 / 18 (the file's only
  ≥3-digit codes; both wrapped codes have fitting `XS` prose, so the
  high bit is Dojo-internal flagging, not part of the code).

## Signatures

```js
export const isQuiz = (node) => boolean;        // node carries YN/YA/YO/YS

export class Quiz {
  constructor(node, size)
  kind            // 'YN' | 'YA' | 'YO' | 'YS'
  hasPairs        // quiz contains pair answers or a tttt verdict
  placed          // [{x, y, color}] — stones placed by consumed answers
  revealKey       // XS key for the answer reveal ('0' until solved)
  // isStone: whether the clicked point currently holds a stone
  click(x, y, isStone) // -> result
  foundOverlay()  // {points: [{x,y}], lines: [{x1,y1,x2,y2}], pending: {x,y}|null}
}
```

`click` results (`kind` discriminates):

| kind | fields | meaning |
|---|---|---|
| `pending` | | endpoint armed |
| `unselect` | | endpoint disarmed |
| `miss` | | not an answer point (no verdict entry to score it) |
| `wrong` | `score`, `resp` | wrong answer; show the reason |
| `again` | | re-found an already-satisfied find-all slot |
| `correct` | `resp`, `solved`, `found?`, `total?` | right answer; `solved` says reveal-and-wait |

## Edge cases

- A node with several quiz properties uses the first of `YN, YA, YO, YS`
  (the data never mixes them on one node).
- A quiz with no parseable answers: every click is `miss`.
- Clicking an armed endpoint's partner that is also a single answer:
  the single answer wins (R5) — observed data keeps single and pair
  point sets disjoint, so no conflict arises.
- `tt`/`tttt` in any position in the list (the data puts them anywhere).
- Ordered quiz, click on a *later* correct answer's point: not a match
  for the required entry — falls through R11 (usually to `tt`).

## Not in scope

- Rendering, feedback text lookup (`XS` prose, the file-wide reason map),
  and the solved/continue flow stay in `app.js`.
- `XS` display-mark parsing (`displayMarks`) stays in `app.js`.
- Enforcing that pair endpoints are stones of a particular colour.
