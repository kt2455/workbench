# Score: prompt v2

The second scored run of the Tells Checker, compared with the baseline
(`baseline.md`, prompt v1). v2 changes one thing: the model may no longer report
`stock_phrase`, `tidy_closer` or `balanced_list` (see `prompts/README.md`).

| | |
|---|---|
| Date | 2026-11-20 |
| Prompt | `prompts/tells-checker/v2.md` |
| Model | `claude-haiku-5-5`, effort `medium` (unchanged) |
| How it ran | All 38 samples sent to `https://api.kyletebo.com/check` from the private page `kyletebo.com/workbench/eval/`, one at a time. **s22 failed before reaching the Worker** (`bot_check_not_issued`: the browser got no bot check token), so 37 were checked. The run file's `step` field still says 1.13, because the eval page fills it in. |
| Replies | `runs/2026-11-20-prompt-v2-haiku-5-5.json` |
| Scored with | `python3 -I testset/score.py testset/runs/2026-11-20-prompt-v2-haiku-5-5.json testset` |

## The scores, like for like

s22 is a clean sample that the baseline wrongly called "obviously AI". Comparing v2's
37 samples with the baseline's 38 would flatter v2, so both runs are scored here on the
same 37.

| Measure | Baseline (v1) | v2 | The bar from step 1.3 |
|---|---|---|---|
| Clean samples with no findings | 3 of 13 | **12 of 13** | All of them |
| "Obviously AI" samples with at least one finding | 8 of 9 | 7 of 9 | All 9 |
| Verdict matches Kyle's | 14 of 37 (38%) | **22 of 37 (59%)** | No bar set yet |
| Marked passages caught | 27 of 55 (49%) | 16 of 55 (29%) | Most, on "a few tells" samples |
| Findings inside a marked passage | 27 of 84 (32%) | 16 of 36 (44%) | |
| Findings per draft | 0 to 5 | 0 to 5 | About 5 at most: met |

**v2 fixes most of the worst failure.** Wrongly flagged clean samples went from 10 of 13
to 1 of 13. The one left is s11, an excerpt from Kyle's own post, flagged for one
`contrast_turn`.

**The cost is fewer catches,** as expected: 16 marked passages instead of 27, and one
more "obviously AI" sample (s24) now comes back clean. The estimate made before the
run predicted about 18 catches and 8 of 9.

**It still misses the bar** on three counts: s11 is flagged; s18 and s24 (both
heavily edited AI drafts) come back clean; and on the "a few tells" samples, where the
bar asks for most marked passages, it catches 4 of 23 (the baseline caught 7).

How Kyle's verdicts compare with the tool's (37 samples):

| Kyle said | Tool said clean | A few tells | Obviously AI |
|---|---|---|---|
| Clean (13) | 12 | 1 | 0 |
| A few tells (15) | 7 | 7 | 1 |
| Obviously AI (9) | 2 | 4 | 3 |

## Which verdicts changed

| Sample | Kyle | v1 | v2 | |
|---|---|---|---|---|
| s01, s05, s06, s12, s13 (Kyle's older article) | clean | a few tells | clean | better |
| s27, s30, s37, s38 | clean | a few tells | clean | better |
| s02 | a few tells | clean | a few tells | better |
| s25 | a few tells | obviously AI | a few tells | better |
| s10, s17, s28 | a few tells | a few tells | clean | worse |
| s24 | obviously AI | a few tells | clean | worse: two levels off now, and 0 of its 3 marks caught (was 2) |

All five excerpts from the older article, written before AI tools, are now clean. That
was the sharpest complaint about v1.

## By kind of tell

| Kind | Findings | On a mark | Stray | In clean samples |
|---|---|---|---|---|
| `contrast_turn` | 13 | 8 | 4 | 1 |
| `signpost` | 11 | 5 | 6 | 0 |
| `staccato` | 5 | 3 | 2 | 0 |
| `other` | 4 | 0 | 4 | 0 |
| `engagement_hook` | 3 | 0 | 3 | 0 |

By layer, the share of findings on a marked passage: rules alone 4 of 5, both layers
agreeing 8 of 13, the model alone 4 of 18. As in the baseline, a finding the model
makes on its own is the least reliable.

## The gaps named before the run

- **Switched-off patterns came back as `other`, as predicted.** The four `other`
  findings, one by one:
  - s03, "evenly balanced clauses": a `balanced_list` under another name.
  - s23, "Onward and upward. 🚀": a `tidy_closer` under another name.
  - s16, a "headline-style takeaway": close to a `stock_phrase`.
  - s08, "The answer, perhaps unsurprisingly, lies somewhere in the middle.": a hedged
    reveal, also close to a `stock_phrase`.

  So two are clearly switched-off patterns and the other two are borderline. None of
  the four landed in a clean sample or on a marked passage. Code cannot close this gap;
  v3's wording can try.
- **The summary can still mention them.** At least two summaries describe a
  switched-off pattern that no finding backs up: s11 calls the closing line "the sort of
  slogan line that a reader would skim past", and s16 says "the closing thanks are
  formulaic". The s01 summary (a clean sample, verdict clean) also mentions "stock
  wording" and "an upbeat closing line" before dismissing them. The summary is shown to
  the visitor.
- **No "a few tells" verdict came back with nothing to show.** The gap in
  `prompts/README.md` did not occur.

## Speed

| | |
|---|---|
| Time per check | median 3.9 seconds, slowest 7.5 seconds (baseline: 4.6 and 9.1) |
| Failures | one bot check not issued (s22); every check that reached the Worker was a full check |

Cost was not taken from the Worker's log lines for this run.

## Where this leads

1. **Re-run s22** so the record covers all 38 samples.
2. **v3** (explicit criteria and invented examples) aims at the two remaining
   weaknesses: `engagement_hook` and `signpost` findings that land off Kyle's marks, and
   the switched-off patterns leaking through `other`.
3. **The catches lost are all on AI drafts:** 6 on raw drafts (s08, s09, s17, s19 twice,
   s36) and 5 on edited drafts (s10, s14, s24 twice, s31). None are on Kyle's own posts,
   which caught as much as before. So v2 stopped flagging clean writing without losing
   anything on the human samples. Bringing a switched-off kind back, one at a time with
   sharp criteria, is how to win back catches on the AI drafts without the false
   flags.
