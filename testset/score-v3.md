# Score: prompt v3

The third scored run of the Tells Checker, compared with v2 (`score-v2.md`). v3
changed one thing: the rule "when you are unsure about a passage, leave it out; when
you are unsure about the whole draft, say it is clean" became explicit tests, with
"counts / does not count" tests for `staccato`, `signpost` and `engagement_hook`. The
aim was to win back missed tells without new false flags. The decision rule was set
before scoring (`prompts/README.md`, "Status of v3").

| | |
|---|---|
| Date | 2026-11-20 |
| Prompt | `prompts/tells-checker/v3.md` |
| Model | `claude-haiku-5-5`, effort `medium` (unchanged) |
| How it ran | All 38 samples sent to `https://api.kyletebo.com/check` from the private eval page, one at a time. **s34 failed before reaching the Worker** (`bot_check_not_issued`), so 37 were checked. s34 is an "obviously AI" sample, not a clean one, so all 14 clean samples were checked. Kyle ran all 38 again the same evening (see "A second run" below); that run checked s34. The run file's `step` field still says 1.13, because the eval page fills it in. |
| Replies | `runs/2026-11-20-prompt-v3-haiku-5-5.json` (the run the rule was applied to) and `runs/2026-11-20-prompt-v3-haiku-5-5-run2.json` |
| Scored with | `python3 -I testset/score.py testset/runs/2026-11-20-prompt-v3-haiku-5-5.json testset` |

## The decision: back to v2

| Rule, set before scoring | v3's result |
|---|---|
| Keep v3: 13 or more of 14 clean samples left clean, and 19 or more of 55 marked passages caught | Not met: catches passed (21), clean did not |
| Kyle decides: 17 or 18 catches, or 12 of 14 clean with catches up | Not met |
| **Back to v2: 11 or fewer of 14 clean samples left clean, or catches do not rise** | **Met: 11 of 14** |

v3 caught more of Kyle's marked passages, but it flagged two more clean samples. The
rule, set before scoring, sends v2 back into use. v3
stays in the repository, frozen as scored.

## A second run

Kyle ran all 38 samples through v3 a second time, with the same prompt, model and
Worker. This time s31's bot check failed and s34 came through. The second run was not
needed for the decision, but it shows how much a single run can be trusted.

| | Run 1 | Run 2 |
|---|---|---|
| Samples checked | 37 (no s34) | 37 (no s31) |
| Clean samples flagged | s11, s13, s27 | **s11, s13, s27** |
| Marked passages caught, on the 36 both checked | 19 | 20 |
| Verdicts that differ between the runs, of 36 | | 1 (s33: clean, then a few tells) |

- **The false flags are stable.** The same three clean samples were flagged both times,
  so they come from the prompt, not from chance.
- **Catches move by about one** between runs on the same samples. That supports
  treating a gain of one or two as noise in the decision rule.
- **s34** ("obviously AI", 3 marks) came back clean in run 2, with none of its marks
  caught. v2 caught 1 of them. Counting s34 from run 2, v3 catches 21 of 55 and flags 7
  of 9 "obviously AI" samples, and its verdicts match Kyle's on 20 of 38.

The decision stands: back to v2.

## The scores

On each run's own terms (v2 includes the hand re-run of s22; v3 is missing s34, which
holds 3 of the 55 marks):

| Measure | v2 | v3 |
|---|---|---|
| Clean samples with no findings | **13 of 14** | 11 of 14 |
| Marked passages caught | 16 of 55 | **21 of 55** (52 checked) |
| "Obviously AI" samples with at least one finding | 7 of 9 | 7 of 8 checked |
| Verdict matches Kyle's | **23 of 38** | 20 of 37 |

Like for like, on the 36 samples both eval-page runs checked (without s22 and s34):

| Measure | v2 | v3 |
|---|---|---|
| Clean samples with no findings | **12 of 13** | 10 of 13 |
| Marked passages caught | 15 of 52 | **21 of 52** |
| "Obviously AI" samples with at least one finding | 6 of 8 | 7 of 8 |
| Verdict matches Kyle's | **22 of 36** | 19 of 36 |
| Findings inside a marked passage | 15 of 35 (43%) | 22 of 40 (55%) |

## The new false flags

| Sample | Source | Finding |
|---|---|---|
| s13 | Kyle's older article, written before AI tools | `signpost`: "It's time to face facts that collaborating in the remote and hybrid world requires..." |
| s27 | raw AI draft, a new-job post Kyle marked clean | `engagement_hook`: "If you’re in the logistics space or want to connect about supply chain operations, feel free to reach out!" |
| s11 | Kyle's post (also flagged by v2) | `contrast_turn`: "You can't train intuition into people. But you can teach them..." |

s13 is the sharpest: the older article is the cleanest human writing in the set. The
fresh review of v3, before scoring, named s27, s29 and s38 as the samples to watch.
s27 was flagged; s29 and s38 stayed clean.

## Which verdicts changed (36 samples)

| Sample | Kyle | v2 | v3 | |
|---|---|---|---|---|
| s10, s17 | a few tells | clean | a few tells | better |
| s24 | obviously AI | clean | a few tells | closer, still wrong |
| s13, s27 | clean | clean | a few tells | worse: new false flags |
| s02 (Kyle's post), s16 | a few tells | a few tells | clean | worse |
| s08 | obviously AI | obviously AI | a few tells | worse |

s18, one of the two drafts v3 was aimed at, still comes back clean.

## By kind of tell (37 samples)

| Kind | Findings | On a mark | Stray | In clean samples |
|---|---|---|---|---|
| `signpost` | 14 | 7 | 6 | 1 (s13) |
| `contrast_turn` | 13 | 8 | 4 | 1 (s11) |
| `staccato` | 7 | 5 | 2 | 0 |
| `engagement_hook` | 5 | 1 | 3 | 1 (s27) |
| `other` | 1 | 1 | 0 | 0 |

`other` dropped from 4 findings to 1. That one is a switched-off pattern under another
name: s10's "Everything else is secondary.", a `tidy_closer`, which lands on a mark.

## What this shows

- **Catching more and flagging less pull against each other.** v3 raised catches by six
  and the share of findings on a mark from 43% to 55%. It also flagged two more clean
  samples. Phase 2 step 2.2 measures both numbers for this reason.
- **`staccato` findings had no false flags,** but the gain is small. 5 of its 7
  findings land on a mark, against 3 of 5 under v2. One of the 5 came from the rules
  layer, so only two new catches came from the model: s14's "It's slower. It's more
  expensive. And it's the best hiring decision we've made." and s24's run of short
  sentences. These may depend on dropping "when unsure, leave it out" as much as on the
  test itself.
- **The new false flags came through `signpost` and `engagement_hook`.** "It's time to
  face facts" and "feel free to reach out!" are routine human phrasing. Which part of v3
  let them through cannot be told from one run: the type tests, the dropped confidence
  rule, or the "performs" test. The `engagement_hook` test already excluded "a routine
  closing line", and the model flagged one anyway.
- **Small set, one run.** These are single changes in a few samples. The rule was set
  in advance so that this run decides, but a second run could move a sample either way.

## Where this leads

1. **Back to v2,** with v3 kept as a scored, frozen record.
2. **A possible v4:** v2 plus only the `staccato` test, the one kind with no false flags
   in v3. One change, scored against v2 with its own decision rule. It may not repeat
   v3's two staccato gains without v3's other changes, and that is what scoring it would
   show.
3. **The `signpost` and `engagement_hook` tests** should count less before they are tried
   again, for example by excluding routine openers ("It's time to") and routine
   sign-offs ("feel free to reach out").
