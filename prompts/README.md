# Prompts

The instructions the Worker gives to a model. Each one is a plain file here, so a
change to a prompt shows up in a pull request like any other change.

**Analogy:** a recipe card. The kitchen cooks from the card, and when the recipe
changes, a new card is written and numbered. Nobody scribbles on the old one.

| File | What it is |
|---|---|
| `tells-checker/v1.md` | The Tells Checker's first instructions (Layer 2 in `docs/tells-checker-design.md`). Frozen: scored in the baseline. |
| `tells-checker/v2.md` | v1 with three noisy kinds of tell switched off. Frozen: scored in `testset/score-v2.md`. |
| `tells-checker/v3.md` | v2 with explicit tests instead of "when unsure, leave it out". In use. |

The version in use, and the kinds of tell it may report, are set in `src/prompt.ts`.

## Rules

1. **The whole file is the prompt.** Everything in a version file is sent to the
   model as its system prompt. Notes for people go in this README, not in the file.
2. **A version in use is frozen.** Once a version has been deployed or scored, it is
   not edited. A change means a new file (`v3.md`, and so on), so a score can always be
   traced to the exact words that produced it. A new version is a draft, and can change,
   until it is first deployed or scored.
3. **Examples never come from the test set.** Anything in `testset/` is the exam
   paper. A prompt that quotes it has seen the answers, and its scores mean nothing.
   Examples are invented for the prompt.
4. **No model names and no secrets.** The prompt does not know which model runs it.
5. **The draft goes in the user message**, between `<draft>` and `</draft>` tags,
   with nothing else. The Worker builds that message. Visitor text is never added to
   the prompt file's text.

## What the Worker must do around the prompt

The prompt asks the model to behave. The Worker checks that it did. These are for
step 1.9 and are listed in `docs/tells-checker-design.md`:

- Reject output that is not the expected JSON shape and fall back to quick mode.
- Drop any finding whose quote is not found exactly in the draft.
- Enforce the limits in code: five findings, 200 characters for `why` and `fix`.
- Never let the model's output decide anything except the content of the reply. The
  model has no tools.

## Status of v1

Drafted in step 1.6. Scored in step 1.13 (`testset/baseline.md`): only 3 of the 14
samples Kyle marked clean were left clean. Frozen.

## Status of v2

**One change, measured on its own:** `stock_phrase`, `tidy_closer` and `balanced_list`
are switched off. Their rows and guidance are removed, the "rhythm" paragraph no
longer lists "an ending that lands like a slogan", and a short paragraph says the three
patterns are out of scope, including under `other`. The output section says "one of the
types in the table" instead of "one of the nine types". Everything else is word for word
v1, including "when you are unsure about a passage, leave it out".

Why, from the baseline run (a finding "on a mark" overlaps a passage Kyle marked):

| Kind of tell | Findings | On a mark | In clean samples |
|---|---|---|---|
| `stock_phrase` | 27 | 2 | 17 |
| `tidy_closer` | 12 | 2 | 7 |
| `balanced_list` | 17 | 5 | 6 |
| All other kinds | 33 | 18 | 1 |

Removing the three from the baseline's findings after the fact (a rough estimate: the
model's verdicts were not re-run, and the five-finding cap was not re-applied) leaves 13
of 14 clean samples clean, still flags 8 of 9 "obviously AI" samples, and catches about 18
of 55 marked passages instead of 27. It may be 19: in one sample a rule finding on a
marked passage was hidden by the cap and would now show.

The switch-off is enforced in code as well as in the prompt: see `src/prompt.ts`. Code
cannot stop the model reporting one of these patterns under `other`, so the scoring
run counts `other` findings too.

Known gap: if every finding the model gives is a switched-off kind, they are all
dropped but the model's verdict stands, so a reply can say "a few tells" with nothing
to show. The reply shape makes this unlikely, since the model cannot return those kinds.
The same was already true when a quote could not be found. The scoring run will show
whether it happens.

**Scored 2026-11-20** (`testset/score-v2.md`; 37 samples from the eval page, s22 re-run
by hand): clean samples left clean rose from 3 of 14 to 13 of 14, and verdicts matching
Kyle's rose from 14 to 23 of 38. Marked passages caught fell from 27 to 16 of 55. Two of the four `other`
findings were switched-off patterns under another name. Frozen.

Next: v3. Then the three kinds come back one at a time, each with sharper criteria and
its own scoring run.

## Status of v3

**One change, measured on its own:** the confidence rule ("when you are unsure about a
passage, leave it out; when you are unsure about the whole draft, say it is clean")
becomes explicit tests. Specifically:

- A passage is reported when it matches a pattern in the table **and** it performs: it
  is there for rhythm, emphasis or applause, and saying it plainly would lose nothing.
- `staccato`, `signpost` and `engagement_hook` each get a short "counts / does not
  count" test.
- "Generic is not the same as AI-sounding" gains one sentence: a bland piece can still
  contain a pattern, so flag the pattern, not the blandness.
- Two invented worked examples are added: a short story with a clipped run and a
  comment-bait ending (`a_few_tells`), and a plain meeting notice (`clean`).

The switched-off kinds stay off. Everything else is word for word v2.

**Why:** v2 fixed the false flags (13 of 14 clean samples left clean) but caught only
16 of 55 marked passages. Two heavily edited "obviously AI" drafts (s18, s24) came back
with nothing. What it missed, besides the switched-off kinds, was mostly clipped runs in
personal stories, signposts and comment-bait endings. In s24 its summary excused a
reply request as "the standard kind a newsletter uses". Most of v2's findings outside
Kyle's marks looked like real tells he had not marked, so v3 aims at catching more, not
at cutting those.

**The examples were checked against the test set:** no five-word run in the new text
appears in any sample. Two first-draft illustrations were replaced because they came
from the samples.

**The decision rule, set before scoring** (all 38 samples, compared with v2):

| Result | Decision |
|---|---|
| Clean samples left clean stay at 13 of 14, and marked passages caught rise above 16 of 55 | Keep v3 |
| Catches rise, but one more clean sample is flagged (12 of 14) | Kyle decides |
| 11 or fewer of 14 clean samples left clean, or catches do not rise | Go back to v2 (one line in `src/prompt.ts`) |

**Not yet scored.**
