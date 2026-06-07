# SGF viewer

Minimalist browser-based viewer for Go games and teaching material: point
it at any directory of `.sgf` files and browse, replay, edit, solve
problems, and play/study against KataGo.

No game records ship in this repo — `serve.py` serves whatever is in its
working directory, so drop your own `.sgf` collections alongside it (each
top-level folder shows up in the file browser). Some good free sources:

- **Pro games** — Andries Brouwer's database (public domain):
  <https://homepages.cwi.nl/~aeb/go/games/>
- **Commented reviews** — the Go Teaching Ladder (personal use):
  <https://gtl.xmp.net/>
- **Tsumego** — classical collections as SGF via
  <https://tsumego.tasuki.org/> (e.g. github.com/Seon82/tasuki2sgf), and
  GoGameGuru's weekly problems (CC BY-NC-SA): github.com/gogameguru/go-problems

Mind each source's license before redistributing.

## Install (macOS)

```sh
./install.sh                 # Homebrew, katago, the human SL model, KaTrain
./install.sh --skip-katrain  # core only (no GUI)
```

Idempotent — safe to re-run. The viewer needs no Python packages (serve.py
is stdlib only); `katago` and the human model are only needed for the
engine modes (vs engine / score / explore).

## Run

```sh
python3 serve.py [port]      # default 8000
open http://127.0.0.1:8000/
```

The Python server only adds a `/api/ls` directory-listing endpoint on top of
static file serving; everything else is plain ES modules, no build step.

## Use

- **Left pane** — file browser for the served directory. Click directories
  and `.sgf` files; `↑` goes to the parent.
- **Center** — board, navigation controls, move counter, and the current
  node's commentary below.
- **Right pane** — game tree. Each line of play is one horizontal row (the
  pane scrolls both ways and keeps the current node centered). Variations
  start expanded, packed into the nearest free row below their split point
  and rooted at the same horizontal position as the mainline continuation,
  with connector bars up to the split; `▾n` toggles fold them away.
  Stretches of plain moves collapse into one `12–45` segment that shows the
  current move number while you are inside it; clicking a segment jumps to
  its end. Annotated moves (comments or marks) stay individual; commented
  ones are underlined in blue.
- Board markup is rendered: triangles, squares, circles, X marks, letter
  labels, and territory marks, inked white on black stones for contrast.
- Clicking a board intersection follows the variation that plays there.
- URL hash is bookmarkable: `#gtl/1234-foo.sgf@87` opens a file at move 87.

### Editing

The panel under the game tree edits the loaded game:

- **play** (default tool) — clicking an empty point plays a move with
  alternating colors: mid-line it opens a new variation, at a line end it
  appends. Clicking where an existing child plays just follows it.
- **△ □ ○ ✕ abc** — mark tools: clicking toggles that mark on the current
  node (`abc` assigns letters in order).
- The text box edits the current node's comment, live.
- **save** writes the game (UTF-8 SGF) to the current directory under the
  name in the box — defaulting to `<original>.edit.sgf` so the source file
  stays untouched. The dot on the save button marks unsaved changes.
- **new** starts a fresh game record (it asks for the board size); save it
  into the current directory under whatever name you type.

### Play vs engine

The **vs engine** button (or `e`) plays your board clicks and has KataGo
answer; engine moves enter the game tree like any move, so the game is a
savable record. Enabling it with nothing loaded starts a fresh 19×19
game on the spot. The current position (handicap/setup stones included) is
replayed to the engine each turn — you can also start from any mid-game
or problem position. Needs `katago` on PATH (`brew install katago`);
serve.py finds the newest model and gtp config next to the binary, or
set `KATAGO_BIN` / `KATAGO_MODEL` / `KATAGO_CFG` / `KATAGO_VISITS`.
Komi comes from the file's `KM` (default 6.5). Positions using `AE`
(cleared points) can't be expressed over GTP and are refused.

The strength dropdown selects a human rank for the engine to imitate
(15 kyu … 3 dan, or **max**), KaTrain-style: it uses KataGo's human SL
network (`~/.katago/b18c384nbt-humanv0.bin.gz`, from the KataGo v1.15
release) with `humanSLProfile = rank_XX`, switched at runtime. Without
that file the engine still plays, but only at max strength. KaTrain (installed via pipx) is
the full-featured GUI for the same engine: run `katrain`, and point its
engine settings at `/opt/homebrew/bin/katago` if it asks.

### Explore (walk KataGo's moves)

The **explore** button (or `x`) overlays KataGo's top three moves for the
side to play, each as a coloured disc — green (its pick), amber, orange —
labelled with the **point delta versus the recommended move** (0 for the
pick; `+0.4` means a slightly higher score the engine nonetheless ranks
below the pick, e.g. for winrate). Click any empty point to play it
(either colour — you drive both sides); the overlay then recomputes for
the next colour, so you walk down KataGo's tree move by move. Arrow keys
re-analyse as you step too, and moves enter the game tree like any other
(savable). Backed by KataGo's analysis engine (`KATAGO_EXPLORE_VISITS`,
default 100 — more visits = sharper, slower).

### Score & territory

The **score** button (or `s`) asks KataGo for an estimate of the current
position and overlays it: each clearly-owned point gets a small square
(black or white, opacity tracking confidence; faint/empty in dame), and
the feedback line shows e.g. `estimated score: B+12.5 (approximate)`.
It's a fast single raw-net read (no search), so it's an approximation —
good for whole-board judgment, less reliable in unsettled life-and-death.
The overlay belongs to one node and clears as soon as you move elsewhere;
press the button again to dismiss it. Needs the same KataGo setup as play
mode.

### Tsumego mode

The **tsumego** button (or `t`) switches board clicks to solving: your
click follows the matching branch of the solution tree, and the computer
answers with a uniformly random successor move. Feedback above the
comment: **✓ correct** on a winning leaf (comment containing "correct",
goproblems-style "RIGHT", or a TE[] annotation), **✗ fail** on any other
ending, **⊘ off-path** when your move isn't in the tree (the position
doesn't change). Manual navigation still works for reviewing; it cancels
a pending computer reply.

Keys: `←`/`→` move, `↑`/`↓` switch variation, `PgUp`/`PgDn` ±10,
`Home`/`End` start/end, `n`/`p` next/previous file.

## Architecture

| file               | role                                                        |
|--------------------|-------------------------------------------------------------|
| `viewer/sgf.js`    | SGF parser → plain node tree                                |
| `viewer/game.js`   | game state: replay, captures, tree navigation               |
| `viewer/board.js`  | pure canvas board renderer — no SGF/rules knowledge, meant  |
|                    | to be reused as the playing surface for live games          |
| `viewer/tree.js`   | collapsible game-tree view (lazy DOM, handles huge reviews) |
| `viewer/app.js`    | glue: file browser, keyboard, comments                      |
| `viewer/colors.js` | shared EMPTY/BLACK/WHITE constants                          |

The board exposes `setSize`, `setPosition({grid, lastMove})`, and an
`onPointClick(x, y)` callback — enough surface to drive it from a live game
engine later.

## License

MIT — see [LICENSE](LICENSE). Applies to the viewer code only; any `.sgf`
collections you add carry their own licenses (see above).
