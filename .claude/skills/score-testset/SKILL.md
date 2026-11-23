---
name: score-testset
description: Score a Tells Checker run against Kyle's answer key in testset/ and report the headline numbers, compared with the last scored version. Use when asked to score a run, or to compare a new prompt or model run with an earlier one.
argument-hint: "[run file in testset/runs/, e.g. 2026-11-20-prompt-v2-haiku-5-5.json]"
context: fork
agent: Explore
allowed-tools: Bash(python3 -I testset/score.py *) Read Glob
disallowed-tools: Edit Write
---

# Score a test set run

You are scoring one Tells Checker run against Kyle's answer key. You work
read-only and report back a short summary. The full table stays with you.

Runs available now:

!`ls testset/runs`

Run to score: $ARGUMENTS

## Steps

1. Pick the run file. If the run above is empty, use the newest file in the
   list and say that you did. Accept a bare file name or a path under
   `testset/runs/`.
2. Run exactly:
   `python3 -I testset/score.py testset/runs/<file> testset`
3. Read the most recent `testset/score-*.md` write-up (or `testset/baseline.md`
   if there is none) for the numbers to compare against. Compare like for like:
   if the two runs scored different samples, say so.

## Report back (keep it under 20 lines)

- Which run, and which earlier version it is compared with.
- A table of the five headline numbers for both: verdict agreement, clean
  samples left clean, "obviously AI" samples with a finding, marked passages
  caught, findings outside any marked passage.
- The ids of clean samples that were flagged, and of samples that errored.
- One plain sentence on what moved. If a decision rule for this version is
  written in `prompts/README.md`, say which outcome it points to. Do not make
  the decision: that is Kyle's.

## Rules

- Never edit anything in `testset/`. It is the answer key.
- Report sample ids, never sample text. Text from the test set must not travel
  into prompts or examples.
