# The WGF (Go Dojo) file format

`.wgf` is the lesson format used by Bruce Wilcox's **Go Dojo** teaching
software. It is a strict **superset of SGF** (FF[4]): a WGF file is an SGF
*collection*, and most of its structure is ordinary SGF. The differences
are (a) a couple of lexical conveniences, and (b) a fixed vocabulary of
`X…`/`Y…` properties that carry the interactive teaching content — board
diagrams, multi-board layouts, quizzes, scored answers, and hyperlinked
navigation between lessons.

This document describes WGF as observed in the four shipped Dojo files
(`Contact.wgf`, `Sector.wgf`, `basic.wgf`, `Intro.wgf`) and notes, for each
feature, how this viewer maps it onto plain SGF for rendering. It is
reverse-engineered, not authoritative; sections marked **(inferred)** are
our best reading, and a final section lists what we have *not* pinned down.

A guiding assumption (the format is the work of a rigorous author): the
property set is a **fixed table**, not a generative grammar. Where two
plausible meanings exist we prefer the one that makes the table regular.

---

## 1. Lexical differences from SGF

A standard SGF parser will *mostly* read a WGF file, but three things will
trip it up. A WGF reader must handle all three.

### 1.1 `//` line comments
Outside of a `[…]` property value, `//` begins a comment that runs to the
end of the line. SGF has no comments. These appear between nodes and
properties (often `; // Record 3 Turn 28 node 61`).

> **Viewer:** `stripComments()` removes `//`…EOL when not inside a value,
> before handing the text to the SGF parser.

### 1.2 Nested properties inside `XS` values
SGF property values do not nest brackets and require `]` to be escaped as
`\]`. WGF's `XS` (quiz-feedback) value does neither: it is a **one-level
"display response"** — some mark properties followed by prose — written
with the inner brackets *balanced* but unescaped, e.g.

```
XS[0:XY[nb][nb]XX[lb]TR[md][lc]Yes. X bends... _Next_]
```

Semantically `XS[score:…]` means *"when the answer scores `score`, draw
these marks and show this text."* The value runs to the `]` that balances
the opening `[`, **not** the first `]`. A naive parser truncates at the
first `]` (here, after `XY[nb`), losing the marks and the prose — and can
swallow a real property that follows (we lost a `W[mb]` move this way).

> **Viewer:** the SGF parser reads an `XS` value with bracket-**depth**
> matching (`parseNestedValue`), so the whole display response is preserved;
> `xsProse()` recovers the feedback text and `displayMarks()` the marks. (It
> also tolerates stray junk inside any node as a backstop against other
> unescaped `]`.) Both are shown on the answer reveal — see §5.4.

### 1.3 Upper-cased coordinates
Coordinates are lower-case `a`–`s`, but a few are accidentally upper-cased
in the data — `CR[OK]`, `LB[OK:10]` (meaning `ok`). On a board this small an
upper-case letter is never a real point (SGF reserves `A`–`Z` for sizes
> 26), so these are data typos, not a feature.

> **Viewer:** `parsePoint()` folds an out-of-range upper-case letter to
> lower-case, so `OK` is read as `ok`. (Recovers a dropped circle in FIXING
> BAD SHAPE and a label in the endgame diagram.)

### 1.4 Packed move sequences
A single node may carry **many** `B[…]`/`W[…]` properties — a whole opening
or sequence written inside one `;` node, e.g.
`B[pd] W[pp] B[dc] W[dp] …`. SGF says a node has at most one move. The play
order is the **order written in the file** (the colours interleave
correctly there even when a serializer would group them by property).

> **Viewer:** the SGF parser records `moveSeq` (colour+point in file order);
> `expandPackedMoves()` splits such a node into a normal one-move-per-node
> chain. Setup (`AE`/`AB`/`AW`) stays on the first node; comment/labels/quiz
> move to the last.

---

## 2. Collection & record structure

* A WGF file is an SGF **collection** — several `(…)` game trees at top
  level. Each tree is a **record**: one lesson, test, or game.
* Records are **named**: an `N[…]` near the root gives the lesson title;
  interior nodes are also named with `N[…]` and serve as hyperlink targets.
  Names beginning with `.` (e.g. `.bb19`, `.string defn`) are internal
  anchors not meant as user-facing titles.
* `SZ[]` may appear once; records that omit it inherit the file's size.
* `CP[]` (copyright) and `AN[]` (author/version) sit at the file root.

### Navigation is by link, not by tree shape
This is the most important structural point. In a Dojo game test the file's
*tree order* is **not** the lesson's *reading order*. The mainline often
threads through reference diagrams that are reached only by clicking links,
and the "real" continuation is named by a `YF` ("Next"/"Click here") target
(see §5.5). A faithful reader must follow the link graph, not just
`children[0]`.

> **Viewer:** we keep tree-walking as the primary UI but rewrite two cases
> at load: (a) split packed openings, and (b) `rerouteGameLine()` — when a
> move node's `YF` target is a move node further down its own mainline,
> separated only by setup nodes, we splice it in as the continuation and
> demote the inline reference diagrams to an off-line branch (still reachable
> via their links). Pure-setup lesson records (no moves) are shown as a flat
> "slide outline" instead of a tree. A `.wgf` is a *guided playout*, so a
> plain board click **advances** to the next position (Dojo's "just click")
> rather than playing a stone — it never creates a variation. On a quiz node
> the click answers the quiz; an explicitly chosen mark tool still annotates.

---

## 3. Coordinates, moves, marks (standard SGF, used as-is)

WGF uses SGF point notation (`aa`–`ss` on 19×19; `tt` or an off-board
letter = pass/tenuki). The following **standard** properties appear and mean
exactly what SGF says:

| Property | Meaning |
|---|---|
| `B` / `W` | a move (but a node may carry many — see §1.4) |
| `AB` / `AW` / `AE` | add black / add white / add empty (clear) |
| `C` | node comment |
| `N` | node name (lesson title / link anchor) |
| `SZ` | board size |
| `LB` | labels `point:text` (Dojo numbers move sequences `01`,`02`,…) |
| `TR` `CR` `SQ` `MA` | triangle / circle / square / X marks |
| `TB` / `TW` | black / white territory points |
| `LN` | line between two points `pt:pt` |

`B`/`W`/`AB`/`AW`/`AE`/`LB`/marks are the only things the core board
renderer needs; everything in §4–§5 is translated into these.

---

## 4. The Dojo property table

### 4.1 `X…` — board content, configuration, and lesson data

| Prop | Value form | Meaning | Viewer mapping |
|---|---|---|---|
| `XB` / `XW` | point list | black / white stones for the diagram | see §5.1 (reset vs. add) |
| `XC` | one integer | board **configuration** / multi-board layout | see §5.2 |
| `XT` | point list | **triangle** marks | → `TR` |
| `XU` | point list | **circle** marks (inferred) | → `CR` |
| `XX` | point list | **"X"** marks / labels | → `LB` `pt:X` |
| `XY` `XE` `XZ` `XD` `XG` | point list | **letter labels** (Y, E, Z, D, G) used in the prose | → `LB` `pt:<letter>` |
| `XA` | `point:code` list | **answer marks** — wrong-move points labelled with the reason code (see §5.4); `tt:` = pass | → `LB` `pt:<code>` (off-board `tt` dropped) |
| `XS` | `score:<marks><prose>` | **quiz feedback** keyed by score code: a one-level display response (marks + prose), see §1.2 | prose → feedback; marks → answer reveal (§5.4) |
| `XN` | `level:category:title` | hierarchical **menu / table-of-contents** entry | not rendered |
| `XI` | one integer | "illustrated example" flag (inferred) | ignored |

The `X` namespace is overloaded: most second-letters denote a **mark/label
of that letter** (`XX`→X, `XY`→Y, …), but `XB/XW/XC/XS/XN/XI/XA` are
reserved for structural data, and `XT`/`XU` are reserved for the triangle and
circle *glyphs* (the circle is `XU` rather than `XC`, which is taken by the
layout code). This is the one irregularity in the table; see Open Questions.

### 4.2 `Y…` — interaction and navigation

| Prop | Value form | Meaning | Viewer mapping |
|---|---|---|---|
| `YN` | `point:score` list | **quiz** — "play the move": score `0` = acceptable, non-zero = a wrong reason; `tt:score` = the verdict for tenuki/"take sente" | interactive quiz (see §5.4–§5.5) |
| `YA` | `point:score` list | **quiz** — "find **all** the correct points" | interactive find-all quiz |
| `YG` | `[index:]target` list | hyperlink **Goto** targets, paired with `_…_` links in the comment; `target` = `:NodeName` or `:B:file.wgf:.label` | resolve & navigate |
| `YF` | node name | **Forward** target — the "Next"/"Click here" continuation | resolve & navigate |
| `YB` / `YW` | point list | black / white stones of an illustrated **continuation** | → translucent ghost stones (numbered by any `LB` on the same point) |
| `YO` `YS` | `point:score[:order]` list | ordered **sequence** quiz (play moves in turn); occasional multi-point answers | answerable like `YN` (order not enforced) |
| `YX` | `0`/`1` | a per-node flag on game nodes (inferred: test mode) | ignored |
| `YC` | one integer | counter near "back" links (inferred) | ignored |

### 4.3 Lines / regions

| Prop | Value form | Meaning | Viewer |
|---|---|---|---|
| `LN` | `pt:pt` list | solid line (standard SGF) | → solid line |
| `LR` | `pt:pt` list | solid line / boundary | → solid line |
| `LS` | `pt:pt` list | **dashed** line — a "broken" sector line (cut by a stone, so it doesn't count) | → dashed line |
| `TT` | point list | shaded region ("owns the shaded center") | → translucent shaded cells |

`LN`/`LR` draw solid; `LS` dashes. The SECTOR LINE TEST makes the contrast
explicit: *"the two solid lines are unbroken sector lines; the two dashed
lines are broken… and don't count."*

---

## 5. Semantic systems

### 5.1 Board state: `XB`/`XW` — reset *or* add
`XB`/`XW` list stones for the diagram. Their effect depends on the node:

* **On a pure setup node (no `B`/`W` move)** — a lesson *slide*. The list is
  the **complete** board state and **replaces** the previous one: clear the
  whole board, then place these stones.
* **On a move node** — the list **adds** stones to the running game (e.g. an
  endgame shown *on top of* the live position). It does **not** clear.

> **Viewer:** `convertSetup()` emits `AE[whole-board]` + `AB`/`AW` for setup
> slides, but only `AB`/`AW` (no clear) when the node also has a move.

### 5.2 `XC` — board configuration / multi-board layout
`XC` is a small integer. Its **tens digit** selects how the 19×19 grid is
split into independent sub-boards by omitting centre line(s):

| tens | layout | lines omitted |
|---|---|---|
| 0 (`2`,`3`,`6`,…) | single full board | none |
| 2 (`20`,`22`…) | two boards side-by-side | centre **column** (K) |
| 4 (`40`–`45`) | 2×2 quadrants | centre **column and row** (K & 10) |
| 6 (`60`) | inferred 2×3 | (inferred: two columns + one row) |

Evidence: across 121 `XC[40]` nodes **no stone ever sits on the centre
column or row** (vs. ~20 % on un-split nodes); `XC[20]` nodes avoid the
centre column only. The **units digit** has no detected effect on layout,
quadrant count, quiz role, or geometry — it appears to be internal
bookkeeping. **(inferred / open)**

> **Viewer:** `splitFor()` reads the tens digit; the board renderer breaks
> the perpendicular grid lines at the omitted centre line(s), drops their
> coordinate labels and star points. Empty sub-boards are still drawn (Dojo
> does not flag "no bottom"). `XC[32]` (3-up) and `XC[60]` (6-up) render as a
> plain quad today.

### 5.3 Packed sequences & numbered diagrams
A sequence may be packed into one node (§1.4) and the points labelled
`01`,`02`,… via `LB`. Two cases:

* **Game opening** (no clear): expands to a played-out move chain.
* **Endgame/illustration over the game**: a move node with `XB`/`XW`
  additions + a packed sequence + `LB` numbers — plays on top of the live
  board (no clear), the `LB` numbers naming the order.

### 5.4 Quizzes and the score vocabulary
A quiz node carries `YN` (pick the move) or `YA` (find all). Each entry is
`point:score`:

* `score = 0` → an acceptable answer.
* `score > 0` → a wrong answer; the number is a **reason code**.

The matching `XS[score:…]` (§1.2) gives the feedback for that score: a
display response of marks + prose. A node usually defines a bespoke `XS[0]`
(its own "correct" explanation, often led by reveal marks) and relies on a
**file-wide shared vocabulary** for the wrong-answer codes (`44`/`45`/…),
which are defined as prose on whichever nodes introduce them.

> **Viewer:** clicking a listed point looks up its score. The node's own
> answer-key marks are **hidden** while the quiz is unanswered, so it isn't
> spoiled. A non-zero score shows the `XS` reason (the node's own prose, else
> the file-wide reason map) and the player retries. A `0` reveals the answer
> — un-hides the answer-key marks, draws the `XS[0]` display marks, and shows
> the prose — then waits for a click to continue (Dojo: "click to get to the
> next turn"), rather than auto-advancing.

Observed reason codes (Contact/Sector): `1` continue contact · `2`/`3` don't
take/butt · `5` both stable, take sente · `44` you're stable, take sente ·
`45` your move ignores the contacted strings · `48` there's a sente
interrupt. (Codes ≥ 20 are the "negative rules"; see the `.Neg*` nodes.)

### 5.5 Take sente, and the `tt` entry
The `tt` (pass / play-elsewhere) entry in `YN` is the verdict for **not**
answering locally — i.e. taking sente: `tt:0` means leaving is correct,
`tt:45` means a local response is required. So clicking *any point that is
not a listed local response* is "taking sente" and is scored by `tt`.

> **Viewer:** an off-list click on a `YN` quiz is scored via the `tt` entry,
> exactly reproducing "if your stones are stable, click anywhere else."

### 5.6 Hyperlinks
Comment text wraps link phrases in underscores: `_Click here_`,
`_*definition*_`. The links pair, in order, with the node's `YG` entries; a
`YG` target is `:NodeName` (same file) or `:B:other.wgf:.label`
(cross-file). A link with no `YG` resolves by: matching node **name**, else
the node's `YF` target, else simply the next node.

> **Viewer:** `tokenizeComment()` finds `_…_` spans; `followWgfLink()`
> applies that resolution order; `parseLinkTarget()` decodes the target.

---

## 6. What the viewer does **not** yet interpret

These are observed in the files but currently ignored or only partially
handled:

* `YO` / `YS` — sequence quizzes are answerable like `YN`, but the move
  **order** isn't enforced (and the occasional multi-point answer is
  treated as its constituent points).
* `XN` — the lesson menu/table-of-contents *tree* (we show its
  category/title as a breadcrumb but don't build the nav tree).
* `XC` units digit; `XC[32]`/`XC[60]` exact layouts.
* `XI`, `YX`, `YC` flags.

## 7. Open questions

1. **`XT`/`XU` glyphs vs. letters.** Are `XT`/`XU` genuinely triangle/circle
   in Dojo, or literal "T"/"U" labels that the lesson prose happens to call
   "triangle"/"circle"? We render glyphs because the prose and the user's
   reading agree, but the regular rule would be letter labels.
2. **`XC` units digit.** Tested against quadrant count, quiz presence,
   numbered-sequence count, omitted lines, and inter-board gap — no
   correlation found. Likely an authoring/version field.
3. **`tt` reason codes 44 vs 45.** Confirmed by their `XS` text, but the full
   code table (especially ≥ 20) is only partially mapped.
4. **`YO`/`YS` answer grammar** — `cp:0:2` appears to be
   `point:score:ordinal`; unverified.
