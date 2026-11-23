---
paths:
  - "testset/**"
---

# Test set

This folder is the marked exam paper the Tells Checker is scored against.
`testset/README.md` explains each file.

- Never edit `samples/`, `labels.json` or `key.json`. They are Kyle's marking.
- Nothing from here goes into a prompt, a test fixture or an example, by wording or
  by sentence shape. A prompt that has seen the answers scores nothing real.
- Score a run with `python3 -I testset/score.py testset/runs/<run>.json testset`.
- Each scored run gets its own file in `runs/` and a `score-<version>.md` write-up.
  Compare like for like: the same samples in both runs.
