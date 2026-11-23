---
paths:
  - "testset/**"
---

# Test set

This folder is the marked exam paper the Tells Checker is scored against.
`testset/README.md` explains each file.

- Samples and labels are frozen: never edit `samples/` or `labels.json` (Kyle's
  marking). To change the set, add new samples and have Kyle mark them.
- Nothing from here goes into a prompt, a test fixture or an example, by wording or
  by sentence shape. A prompt that has seen the answers scores nothing real.
- Score a run with `python3 -I testset/score.py testset/runs/<run>.json testset`.
- Past runs kept the tool's replies in `runs/` and a write-up beside them (see
  `score-v2.md`, `score-v3.md`), comparing like for like: the same samples in both
  runs.
