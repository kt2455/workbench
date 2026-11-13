# Baseline score (plan step 1.13)

The first full run of the test set against the live Tells Checker. Every later prompt
or model change is compared with these numbers.

| | |
|---|---|
| Date | 2026-11-13 |
| Prompt | `prompts/tells-checker/v1.md` |
| Model | `claude-haiku-5-5`, effort `medium` |
| How it ran | All 38 samples sent to `https://api.kyletebo.com/check` from the private page `kyletebo.com/workbench/eval/`, one at a time, each with its own bot check token |
| Replies | `runs/2026-11-13-prompt-v1-haiku-5-5.json` |
| Scored with | `python3 -I testset/score.py testset/runs/2026-11-13-prompt-v1-haiku-5-5.json testset` |

## The scores

Scored the way `README.md` describes: the verdict per sample first, marked passages as
regions, and any finding in a sample marked clean counts as a false flag.

| Measure | Result | The bar from step 1.3 |
|---|---|---|
| Clean samples with no findings | **3 of 14** | All 14 (the worst failure is a false flag) |
| "Obviously AI" samples with at least one finding | **8 of 9** | All 9 |
| Verdict matches Kyle's | **14 of 38** (37%) | The headline score; no bar set yet |
| Marked passages caught | 27 of 55 (49%) | Most, on the "a few tells" samples |
| Findings inside a marked passage | 27 of 89 (30%) | |
| Findings per draft | 0 to 5 | About 5 at most: met |

**It does not meet the bar.** The tool finds something in most of what it reads,
including 11 of the 14 samples Kyle marked clean.

How Kyle's verdicts compare with the tool's:

| Kyle said | Tool said clean | A few tells | Obviously AI |
|---|---|---|---|
| Clean (14) | 3 | 10 | 1 |
| A few tells (15) | 5 | 8 | 2 |
| Obviously AI (9) | 1 | 5 | 3 |

## What went wrong

1. **The false flags all come from the model.** The rules layer found nothing in any
   clean sample. All 31 findings in clean samples were the model's: 17 `stock_phrase`,
   7 `tidy_closer`, 6 `balanced_list`, 1 `contrast_turn`.
2. **It flags generic writing, which the marking said not to.** All five excerpts from
   Kyle's older article, written before AI tools, were called "a few tells", mostly for
   promotional wording ("supercharge", "unlock innovation", "capture some of the
   magic"). Bland corporate AI drafts Kyle marked clean were flagged too, one of them
   (s22, a stock professional bio) as "obviously AI". This is finding 2 of the marking
   ("generic is not the same as AI-sounding") and decision 4 ("vocabulary is a side
   note"), and the prompt does not yet hold the model to either.
3. **It under-calls the heavily edited drafts.** Five of nine "obviously AI" samples got
   "a few tells", and one (s18) got nothing at all. These are the AI drafts with the
   obvious tells already edited out, so the cadence Kyle marked is subtler.
4. **It misses some of Kyle's own tells.** Four of his recent posts that he marked "a
   few tells" came back clean. Missing a subtle tell is acceptable under step 1.3, so
   this matters less than the false flags.

## Speed and cost

From the Worker's own log lines for the run:

| | |
|---|---|
| Total cost | $0.029 for 38 checks (about $0.0008 each) |
| Tokens | 142,353 in, 30,066 out; the longest reply used 1,791 of its 4,096 cap |
| Time per check | median 4.6 seconds, slowest 9.1 seconds |
| Failures | none: all 38 were full checks |

## Where this leads

The clearest single lever is the `stock_phrase` type and the prompt's handling of
generic wording: more than half the false flags are stock phrases. Changing the prompt
is Phase 2 work (scored against this baseline before it ships), or the fixes step 1.20
if Kyle wants it sooner.
