# CLAUDE.scripts index

Quick investigation scripts. Prefer re-using these over writing new ones.

- `scan-quiz-entries.mjs` — extract every YN/YA/YO/YS quiz entry from the
  Dojo `.wgf` files and classify it against the answer grammar (single,
  pair, any-of, tt/tttt verdicts, @placements); flags unparseable entries.
  Run: `node CLAUDE.scripts/scan-quiz-entries.mjs`
- `verify-quiz-solvability.mjs` — integration sweep: parse the Dojo files
  through the real viewer pipeline, build a `Quiz` for every quiz node,
  simulate solving it, and check every response key has feedback prose.
  Run: `node CLAUDE.scripts/verify-quiz-solvability.mjs`
- `../dev/cdp-quiz-test.py` — drive the sector-line pair quiz in headless
  Chrome (arm endpoint, wrong pair, find-all to solved) with screenshot.
  Run: `python3 serve.py 8013 &` then `python3 dev/cdp-quiz-test.py 8013`
- `walk-joseki-transforms.mjs` — place sample Kogo joseki lines in all 16
  symmetry variants (4 corners × diagonal × colour swap) through the real
  Game+matchAll pipeline; checks matched-node identity, continuation
  points/colours, walk order, and localized direction/colour words stay
  consistent. Replicates app.js's navigator math — keep in sync.
  Run: `node CLAUDE.scripts/walk-joseki-transforms.mjs [maxLines]`
