# Branch workflow

`main` is the only branch that gets pushed to `origin`. It must never contain
library data (`gtl/`, `pro-games/`, `tsumego/`, `my-games/`, `Dojo/`,
`autosaves/`, `*.sgf`, `*.wgf` outside of the codebase itself, etc.).

`library` is a local-only branch that lives on top of `main` and adds the
library data as committed files. We work on `library` (or feature branches
forked off `library`) so the viewer has real content to load while developing.
**Never push `library` or any branch that contains library data.**

## Shipping work to main

1. Do the work on a feature branch off `library` (so the data is present).
2. To ship: cherry-pick the source-code commits onto `main` (skip everything
   that touches the library data dirs).
3. Push `main`.
4. Rebase `library` onto the new `main` so it stays a thin data-only layer on
   top.

The feature branch can usually be deleted once its commits are on `main` and
`library` has been rebased.
