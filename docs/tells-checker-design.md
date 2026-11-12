# Tells Checker: design

How the first tool works, and the exact shape of what it sends back. This records the
decisions from steps 1.4 and 1.5 of the Phase 1 plan. The plan itself lives in the
website repository under `docs/workbench/`.

**What the tool is:** style feedback. Paste a draft, get back the passages that make a
reader think "a machine wrote this", each with a reason and a suggested fix.

**What it is not:** an AI detector. It never claims to know who or what wrote the
text. Bland writing produced by an AI is not flagged just for being bland.

## The evidence behind the design

Kyle marked 38 samples blind (see `testset/`). Three findings drive everything here:

1. Rhythm matters more than vocabulary.
2. Generic is not the same as AI-sounding.
3. The worst failure is flagging writing he considers clean.

Simple rules were then tested against his answer key:

| Rule | Fires on 14 clean | On 15 "a few tells" | On 9 "obviously AI" |
|---|---|---|---|
| Three or more very short sentences in a row | 0 | 0 | 2 |
| The contrast turn ("isn't X. It's Y") | 0 | 1 | 5 |
| Signpost phrases ("It turns out", "The key is") | 0 | 2 | 6 |
| Any of those three | 0 | 3 | 6 |
| Any word from the website's banned list | 4 | 4 | 3 |

**Caution:** these rules were written after seeing the answer key and tested on the
same samples. Expect worse numbers on new writing. Phase 2 measures by how much.

## The parts

```
draft ──> Layer 1: rhythm rules ──┐
      │                           ├──> merge ──> validated response
      └─> Layer 2: the model ─────┘
      └─> House style words (only when asked for)
```

**Analogy:** airport security. The rules are the metal detector: quick, cheap, catches
the obvious. The model is the officer who looks at you and decides something is off.
The house style panel is the sign about liquids.

### Layer 1: rhythm rules

Fixed patterns found by ordinary code. Free, instant, and the same answer every time.
Version 1 has three: the staccato run, the contrast turn, and signpost phrases.

A rule earns its place by evidence: it must not fire on any sample marked clean. A
rule that starts producing false flags is removed, not tuned until it passes.

### Layer 2: the model

One call that reads the whole draft and returns a verdict plus up to five findings.
Its instructions carry Kyle's taste: rhythm over vocabulary, and generic is not the
same as AI-sounding. The prompt is a versioned file: `prompts/tells-checker/v1.md`.

The draft is material to analyse, never instructions. The model gets no tools and no
secrets. Examples in the prompt never come from the test set, or the scores would be
meaningless.

### House style words

Words from a list, such as "leverage". Reported in their own section, labelled as word
choices. Never a tell, never part of the verdict. **Off by default**: the visitor asks
for it with a toggle. On the evidence it flags more clean samples than obvious ones, so
it may be removed.

The Worker keeps its own copy of the list in this repository. The website has a
separate list for its publishing checks. They do different jobs and are allowed to
differ.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | The two layers work independently. The model sees only the draft, not the rules' findings. | Each layer can be scored on its own, so Phase 2 can show whether the model earns its cost. |
| 2 | When both layers flag the same passage, it is shown once, with the model's explanation. | One finding per problem. The model explains in context; a rule can only name the pattern. |
| 3 | If the model is unavailable or the daily budget is spent, the tool runs the rules alone and says so. It gives findings but no verdict. | Degrades instead of breaking. A verdict from rules alone would claim more than they know. |
| 4 | The verdict is the model's, with one exception: if the model says "clean" but a rule fired, the verdict becomes "a few tells". | A rule firing is a concrete, checkable fact. "Clean" must mean nothing was found. |
| 5 | At most five findings per draft. | Kyle averaged a little over two marks per flagged sample. Fifteen flags is not how he reads. |
| 6 | A finding whose quoted text is not in the draft is dropped. | Models sometimes misquote. A finding the visitor cannot locate is worse than none. |
| 7 | The model returns the quoted text. The Worker works out where it sits in the draft. | Models count characters badly. Searching for the quote is exact. |
| 8 | Fixes are a short instruction, not a rewrite. | Full rewrites are out of scope for this phase, and a rewrite by a model would add tells of its own. |

## The request

`POST /check` with a JSON body. Nothing goes in the address or headers, so the draft
never reaches a log.

```json
{
  "text": "The draft to check.",
  "houseStyle": false,
  "botCheckToken": "token from the page's bot check"
}
```

| Field | Required | Meaning |
|---|---|---|
| `text` | Yes | The draft. Plain text. The length cap is set in step 1.10. |
| `houseStyle` | No | `true` to include the house style words. Defaults to `false`. |
| `botCheckToken` | Yes | Proof from the page's bot check (Cloudflare Turnstile). |

## The response

Every successful check has the same shape, whichever layers ran.

```json
{
  "mode": "full",
  "verdict": "a_few_tells",
  "summary": "Mostly reads naturally. Two passages have a rehearsed rhythm.",
  "findings": [
    {
      "quote": "No slides. No brainteasers. Just real work.",
      "start": 412,
      "end": 455,
      "type": "staccato",
      "why": "Three clipped sentences in a row read as a drumbeat, not a thought.",
      "fix": "Join them into one sentence and say what the session involves.",
      "foundBy": "both"
    }
  ],
  "houseStyle": null,
  "notice": null,
  "meta": {
    "promptVersion": "v1",
    "charactersChecked": 1180
  }
}
```

### Top-level fields

| Field | Values | Meaning |
|---|---|---|
| `mode` | `"full"`, `"quick"` | `full`: rules and model both ran. `quick`: rules only. |
| `verdict` | `"clean"`, `"a_few_tells"`, `"obviously_ai"`, or `null` | The overall read. Always `null` in quick mode. |
| `summary` | Text or `null` | One or two plain sentences on the overall read. `null` in quick mode. |
| `findings` | A list, possibly empty | At most five, in the order they appear in the draft. |
| `houseStyle` | A list or `null` | `null` unless the request asked for it. |
| `notice` | `null`, `"daily_budget_reached"`, `"model_unavailable"` | Why the check was quick, when it was. |
| `meta` | Object | The prompt version that produced the result and how much text was checked. |

The verdict names match the three labels Kyle used when marking, so the tool's output
and the answer key are compared like for like.

A verdict of `clean` always comes with an empty `findings` list.

### A finding

| Field | Meaning |
|---|---|
| `quote` | The passage, copied exactly from the draft. |
| `start`, `end` | Where the passage sits in the draft, counted in characters. Worked out by the Worker. The page uses these to highlight. |
| `type` | The kind of tell. One of the values below. |
| `why` | Why a reader hears it as machine-written. One sentence, at most 200 characters. |
| `fix` | What to do about it. One sentence, at most 200 characters. An instruction, not a rewrite. |
| `foundBy` | `"rule"`, `"model"` or `"both"`. Shown on the Open Kitchen page in totals, and used by the evals. |

### Kinds of tell

The list comes from what Kyle marked. It is short on purpose: a kind that never gets
used is removed, and `other` shows when a new one is needed.

| `type` | What it is | An example from the samples |
|---|---|---|
| `staccato` | A run of very short sentences used for effect | "No slides. No brainteasers. Just real work." |
| `contrast_turn` | Setting up one idea to knock it down for another | "It wasn't about the technology. It was about the people." |
| `signpost` | A phrase that announces a point instead of making it | "It turns out", "The key is", "One thing is clear" |
| `tidy_closer` | A neat wrap-up line that sounds like a slogan | "Everything else is secondary." |
| `engagement_hook` | A closing question or invitation aimed at getting replies | "Have you tried it? What did you notice?" |
| `stock_phrase` | A ready-made phrase that could sit in any piece | "work smarter, not harder" |
| `balanced_list` | Points arranged too evenly: matched pairs or sets of three | "On one hand... On the other hand..." |
| `neat_story` | An anecdote whose details and punchline are too convenient | The file-renaming post |
| `other` | A tell that fits none of the above | |

Only the model can return `tidy_closer`, `engagement_hook`, `stock_phrase`,
`balanced_list`, `neat_story` and `other`. The rules return the first three.

### A house style note

```json
{ "quote": "leverage", "start": 88, "end": 96, "note": "Often plainer as \"use\"." }
```

### What the model itself returns

The model is asked for a smaller object. The Worker adds the rest.

```json
{
  "verdict": "a_few_tells",
  "summary": "Mostly reads naturally. Two passages have a rehearsed rhythm.",
  "findings": [
    { "quote": "...", "type": "staccato", "why": "...", "fix": "..." }
  ]
}
```

The Worker then checks it before anything reaches the visitor:

1. The object matches the expected shape. If not, the check falls back to quick mode.
2. `verdict` and every `type` is one of the allowed values.
3. Each `quote` is found in the draft. If not, that finding is dropped.
4. `why` and `fix` are within their length limits.
5. Findings beyond five are dropped, keeping the earliest in the draft.
6. Rule findings are merged in, and overlaps become one finding marked `both`.
7. Decision 4 is applied to the verdict.

## Errors

Errors use the Worker's standard shape: `{"error": "code"}`. No error ever includes any
part of the draft.

| Status | `error` | When |
|---|---|---|
| 400 | `invalid_request` | The body is not JSON, or `text` is missing or empty |
| 403 | `origin_not_allowed` | The call came from a page on another website |
| 403 | `bot_check_failed` | The bot check token is missing or was rejected |
| 413 | `text_too_long` | The draft is over the length cap |
| 429 | `rate_limited` | Too many checks from one visitor. Includes `retryAfterSeconds`. |
| 500 | `internal_error` | Anything unexpected. The details are discarded, not logged. |

A spent daily budget is **not** an error. The visitor still gets a quick check, with
`notice` saying why.

## What is logged for each check

Metadata only: the time, `mode`, `verdict`, the number of findings by `type` and
`foundBy`, tokens used, cost, how long it took, and which guardrail fired if one did.
Never the draft, a quote, the summary, an IP address, a location or a browser.

## Decisions made while building (step 1.9)

| Question | Decision | Why |
|---|---|---|
| A draft that contains the text `</draft>` | Sent unaltered. | Changing the draft would break exact quote matching. The prompt says closing tags are material, the model has no tools, and every quote is checked against the draft, so the worst outcome is poor feedback on that visitor's own draft. Step 1.14 tests this. |
| A kind of tell that is not on the list | Becomes `other`. | The finding may still be good. |
| A `why` or `fix` over 200 characters | Shortened at a word boundary. | Better than losing the finding. |
| Two model findings that overlap | The first is kept. | The page highlights passages, and highlights cannot overlap. |
| A cap on quote length | Asked for in the prompt, not enforced. | A long quote that is in the draft does no harm. Revisit if the evals show whole-paragraph quotes. |
| A verdict other than `clean` whose findings were all dropped | Verdict and summary are kept, with an empty list. | Rare, and Phase 2 counts how often it happens. |
| `start` and `end` | Counted the way JavaScript counts (UTF-16 code units). | The page is JavaScript, so `draft.slice(start, end)` is the quote on both sides. The offsets in `testset/labels.json` were counted by Python, which differs after an emoji. The evals must compare by quoted text or convert. |
| House style words | Accepted in the request, not built. `houseStyle` in the reply is always `null`. | The list is Kyle's and lives in the private website repository. Putting it in this public one is his decision. |
| The model on or off | A setting, `MODEL_ENABLED`, off by default. | The endpoint can be merged and deployed before the spending guardrails exist without the key being usable. |

The model is called with a JSON schema (the provider's "structured output"), so its
reply is valid JSON of the right shape nearly always. The Worker checks it anyway.

## Open questions for later steps

- The length cap, rate limits and daily budget figures (step 1.10). The cap in the
  code, 10,000 characters, is a placeholder.
- Whether the three rules still earn their place on new samples (Phase 2).
- Whether to publish the house style list and build the panel.
