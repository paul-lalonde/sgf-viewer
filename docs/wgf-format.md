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
> rather than playing a stone — it never creates a variation; clicking a
> point where a variation's move is played enters that variation (Dojo:
> "click directly on a marked variation location"). On a quiz node
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
| `YN` | answer list (§5.4) | **quiz** — "play the move" (or click a line's two endpoints): score `0` = acceptable, non-zero = a wrong reason; `tt:score` = the verdict for tenuki/"take sente" | interactive quiz (see §5.4–§5.5) |
| `YA` | answer list (§5.4) | **quiz** — "find **all** the correct points / lines" | interactive find-all quiz |
| `YG` | `[index:]target` list | hyperlink **Goto** targets, paired with `_…_` links in the comment; `target` = `:NodeName` or `:B:file.wgf:.label` | resolve & navigate |
| `YF` | node name | **Forward** target — the "Next"/"Click here" continuation | resolve & navigate |
| `YB` / `YW` | point list | black / white stones of an illustrated **continuation** | → translucent ghost stones (numbered by any `LB` on the same point); the numbered sequence replays one stone at a time via the *step* button (Dojo's STEP) |
| `YO` `YS` | answer list (§5.4) | **staged** quiz — the score-`0` entries are consumed in file order ("pick A–D in order", guided playouts); `YS` interleaves `pt@b`/`pt@w` stone placements | staged quiz with placements (§5.4) |
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
`XC` is a small integer naming a **fixed layout table**, not a digit
formula (an earlier "tens digit" reading was an artifact of which values
got analysed). Decoded by cross-tabulating every XC node's prose words
("TOP:", "MIDDLE:", "LEFT:", "TOP RIGHT:") with the bands its stones
occupy:

| XC | layout | lines omitted |
|---|---|---|
| `2`, `23` | TOP / BOTTOM stacked | centre **row** (10) |
| `3` | TOP / MIDDLE / BOTTOM | rows at the thirds (7 & 13) |
| `20`, `22`, `24` | LEFT / RIGHT side-by-side | centre **column** (K) |
| `40`–`45` | 2×2 quadrants | centre column and row |
| `6`, `60` | 2×3 six-up | centre row + column thirds (G & N) |
| `32` | TOP pair over a full-width BOTTOM | quad cuts, trimmed by stones |

Evidence: 88 of 96 `XC[2]` nodes say TOP:/BOTTOM: and only one touches
the centre row (68 use the centre *column*, so it can't be a column
split); all 17 `XC[3]` nodes band their stones in rows 3–5/10–12/16–18
and say TOP:/MIDDLE:/BOTTOM:; `XC[6]`/`XC[60]` say TOP LEFT/MIDDLE/RIGHT
over BOTTOM LEFT/MIDDLE/RIGHT with stones banded in column thirds. What
distinguishes `2`/`23`, or `20`/`22`/`24`, remains internal bookkeeping.
**(open)**

> **Viewer:** the table lives in `xcSplit()`; the board renderer omits the
> listed grid lines, breaking the perpendicular lines at each gap and
> dropping the omitted lines' coordinate labels and the star points. A cut
> that would run through an actual stone drops out — which also renders
> `XC[32]`'s full-width bottom correctly. Empty sub-boards are still drawn
> (Dojo does not flag "no bottom").

### 5.3 Packed sequences & numbered diagrams
A sequence may be packed into one node (§1.4) and the points labelled
`01`,`02`,… via `LB`. Two cases:

* **Game opening** (no clear): expands to a played-out move chain.
* **Endgame/illustration over the game**: a move node with `XB`/`XW`
  additions + a packed sequence + `LB` numbers — plays on top of the live
  board (no clear), the `LB` numbers naming the order.

### 5.4 Quizzes and the score vocabulary
A quiz node carries `YN` (pick the move), `YA` (find all), or `YO`/`YS`
(staged). Every entry of the answer list is one of (this grammar covers
all 4,192 entries in the four files —
`CLAUDE.scripts/scan-quiz-entries.mjs`):

| entry | meaning |
|---|---|
| `pt:score[:resp]` | single-point answer; `resp` (optional) is the `XS` feedback key, defaulting to the score |
| `p1p2:score[:resp]` | **pair** answer — click **both endpoints** (unordered): the sector-line tests |
| `p1p2…pn=score` | **any-of** — each listed point alone earns this score (`mpnp=0` = "either triangle") |
| `tt:score` | verdict for an off-list single click (take sente, §5.5) |
| `tttt:score` | verdict for an off-list **pair** |
| `pt@b` / `pt@w` | stone placed when the preceding staged answer is consumed (`YS` guided playouts) |

* `score = 0` → an acceptable answer.
* `score > 0` → a wrong answer; the number is a **reason code**.
* Scores read numerically **mod 256**: `nfmf=00` is correct, and the two
  ≥3-digit codes in the data (`os:268`, `kn:274`/`qc:274`) wrap to reason
  codes 12 / 18, whose prose fits — the high bit is internal flagging.
  **(inferred)**

The matching `XS[score:…]` (§1.2) gives the feedback for that score: a
display response of marks + prose. A node usually defines a bespoke `XS[0]`
(its own "correct" explanation, often led by reveal marks) and relies on a
**file-wide shared vocabulary** for the wrong-answer codes (`44`/`45`/…),
which are defined as prose on whichever nodes introduce them.

**Pairs vs. moves.** Pair endpoints are usually stones (sector lines join
stones) — but **edge sector lines end on empty edge points** (19 of the
104 pair entries; `ofsg:0` runs O14–T13 with nothing on T13), so a click
selects an endpoint when it's a stone *or* a point some pair entry names,
and once one endpoint is armed the next click completes the attempt.
Other empty-point clicks answer as moves. Mixed quizzes rely on this:
*"Click on the relevant two sector lines AND click on the appropriate
running move"* (`YA[tt:1][tttt:1][mkgp:0][coei:0][kl:0]`).

**Staged quizzes (`YO`/`YS`).** The score-`0` entries are consumed in file
order — each is the one required answer of its stage, and its `resp` key
is the "Yes, next…" prompt (`qj:0:2` → show `XS[2]`, *not* an ordinal as
previously guessed). Wrong-answer entries are stage-sensitive: the first
match **at/after** the consumed position applies, so the same point can
draw different reasons at different stages (`il:5` early, `il:4` after the
position has grown). In `YS`, the `pt@b`/`pt@w` entries following a correct
answer are stones placed on the board before the next stage — the quiz
plays out the sequence (`hl:0:2 hl@b hm@w` = "right; Black hl is played,
White answers hm — now what?").

**Quiz-node marks are the question, not the key.** A quiz node's own
`LB`/`TR`/`TB` marks are clickable choices and subject stones ("click on
the letter G", "the marked stone"); the answer-key marks live in the `XS`
display responses and on the separate `…ANSWERS` nodes.

> **Viewer:** `quiz.js` implements exactly this grammar (see
> `quiz.design.md`); `CLAUDE.scripts/verify-quiz-solvability.mjs` replays
> every quiz in the corpus to solved. The node's marks stay visible while
> unsolved (an earlier version hid them, which blinded the letter-choice
> quizzes). A non-zero score shows the `XS` reason (the node's own prose,
> else the file-wide reason map) and the player retries. Find-all progress
> shows as green discs/lines; an armed endpoint shows as a green ring.
> Solving draws the solving `XS` display marks **and lines** — then waits
> for a click to continue (Dojo: "click to get to the next turn"), rather
> than auto-advancing.

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
4. ~~**`YO`/`YS` answer grammar**~~ — resolved: `cp:0:2` is
   `point:score:responseKey` (the `XS` prompt for that stage), not an
   ordinal. See §5.4.
5. **Score high bits.** `268`/`274` wrap mod 256 to codes with fitting
   prose; what the set bit means inside Dojo is unknown.
