# SGF viewer

Minimalist browser-based viewer for the SGF collections in this directory
(`pro-games/` — 95k pro games, `gtl/` — 10k commented Go Teaching Ladder
reviews).

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
