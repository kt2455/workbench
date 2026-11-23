---
name: score-testset
description: Score a Tells Checker run against Kyle's answer key in testset/ and report the headline numbers, compared with the previous prompt version's scored run. Use when asked to score a run, or to compare a new prompt or model run with an earlier one.
argument-hint: "[run file in testset/runs/, e.g. 2026-11-20-prompt-v2-haiku-5-5.json]"
context: fork
agent: Explore
background: false
allowed-tools: Bash(ls testset/runs) Bash(python3 -I testset/score.py *) Read Glob
disallowed-tools: Edit Write NotebookEdit
---

# Score a test set run

You are scoring one Tells Checker run against Kyle's answer key. You work
read-only: run nothing except the commands below, and change no files. Send
back a short summary, not the script's full table.

Runs available now:

!`ls testset/runs`

Run to score: $ARGUMENTS

## Steps

1. Pick the run file. If the run above is blank, use the last file in the list
   and say that you did. Accept a bare file name or a path under
   `testset/runs/`.
2. Run exactly:
   `python3 -I testset/score.py testset/runs/<file> testset`
3. Find the comparison. The run's file name names its prompt version (v1, v2,
   ...). Compare with the write-up for the version before it: if the previous
   version is v1, use `baseline.md`; otherwise use `score-v<N>.md` for that
   previous version N, as listed in `prompts/README.md`. If the run being
   scored is v1, there is nothing earlier: compare with nothing and say so. Compare
   like for like: if the two runs scored different samples, say which.

## Report back (under 20 lines)

- Which run, and which earlier version it is compared with.
- A table of five numbers for both runs, worded as the write-ups word them:
  - Verdict agreement (from "Verdict agreement").
  - Clean samples left clean: clean samples that got a verdict, minus those
    with any finding. Leave out clean samples that errored, and say which.
  - "Obviously AI" samples with at least one finding.
  - Marked passages caught.
  - Findings inside a marked passage: total findings minus "Findings outside
    any marked passage".
- The ids of clean samples that were flagged, and of samples that errored.
- One plain sentence on what moved. If `prompts/README.md` has a decision rule
  for this version, say which outcome it points to. Do not make the decision:
  that is Kyle's.

## Rules

- Never edit anything in `testset/`. It is the answer key.
- Report sample ids, never sample text. Text from the test set must not travel
  into prompts or examples.
