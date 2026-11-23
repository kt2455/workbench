# MCP server: design (steps 4.1 to 4.3)

The plan for Phase 4 lives in the website repository, in
`docs/workbench/phase-4-mcp-server.md`. This note records the decisions from steps
4.1 to 4.3 so step 4.4 can build from them. Kyle agreed them on 2026-11-23.

## What is exposed (4.1)

One tool and one resource. Nothing that calls a model.

| Name | Kind | What it does | Cost to Kyle |
|---|---|---|---|
| `find_rhythm_tells` | Tool | Runs the rhythm rules (`src/rules.ts`) on a draft | None: plain code, no model call |
| `tells://catalog` | Resource | Fixed reference text: the kinds of tell, with invented examples | None |

The split of work: the rules do the mechanical checks, and the visitor's own
assistant reads the catalog and judges the kinds the rules cannot find. The thinking
happens on the visitor's side, so no model spend happens on ours.

Why a resource and not a second tool for the catalog: it keeps the tool count at one
(exam 2.3), and the catalog takes no input, which is what a resource is for (exam
2.4). Some clients do not let the assistant read resources on its own, so every reply
from `find_rhythm_tells` ends with a one-line pointer to `tells://catalog`. That line
is fixed text written by us, never built from the visitor's draft.

Why not an existing community MCP server: none offers these rules. This is our own
tool, not a standard integration.

## Access (4.2)

Open to anyone, no sign-in, because the tool cannot spend money.

- The per-visitor rate limit applies, as for `/check`.
- The 8,000-character cap (`MAX_DRAFT_CHARS`) applies.
- There is no bot check. Turnstile needs a browser and MCP clients are not browsers.
  That is acceptable only because the MCP code path has no route to the provider: it
  must not import `src/provider.ts` or the budget at all, so a bad setting cannot
  switch spending on. Step 4.4 adds a test for this.
- Hard rule 2 holds: the draft arrives in the request body, is never logged, and log
  lines hold metadata only.
- Model-backed tools stay out until step 4.11, behind a sign-in, and only if Kyle
  decides he wants them.

Open questions for 4.4: the path (for example `api.kyletebo.com/mcp`), how the
`ALLOWED_ORIGIN` check treats MCP clients that send no `Origin`, and the current
Cloudflare and MCP documentation for remote servers.

## Descriptions (4.3)

A description is a prompt written for a model we do not control. Each one says what
it does, the input and its limits, what it returns, an example, and when not to use
it. Each names the other, so an assistant that picked the wrong one knows where to go.

### Tool: `find_rhythm_tells`

> Scans English prose for three fixed rhythm patterns that often make writing read as
> AI-generated: staccato (three or more sentences of five words or fewer in a row,
> within one paragraph), contrast_turn ("It isn't X. It's Y.") and signpost (phrases
> such as "It turns out" or "The key is" that announce a point instead of making it).
> Pattern matching only: no AI model reads the text, so results are instant and
> identical every time.
>
> Input: `text`, the draft as plain text, up to 8,000 characters. Line breaks
> separate paragraphs.
>
> Returns: a JSON list of findings, each with `type`, `quote` (the exact passage),
> `start` and `end` (character positions), `why` and `fix`. An empty list means none
> of these three patterns was found. It does not mean the text reads as
> human-written, because other kinds of tell are not checked.
>
> Example: "We shipped it. Nobody noticed. Then the emails started." returns one
> staccato finding quoting all three sentences.
>
> Use it when the user asks you to review prose they wrote, such as a post or an
> email, before they publish it. Do not use it to decide whether someone else's text
> was written by AI, on code, or on non-English text. Do not use it to look for kinds
> of tell other than these three. For those, read the `tells://catalog` resource and
> judge the text yourself.

Input schema: one required string, `text`, with `maxLength` 8000. No other fields.

### Resource: `tells://catalog`

> A reference list of the five kinds of writing tell the Workbench recognises. Each
> entry gives what the tell is, an invented example and a suggested fix, and marks
> whether `find_rhythm_tells` detects it automatically (three do) or it needs your
> judgement (two do). It is fixed reference text and does not analyse anything. Read
> it when you need to judge the other kinds yourself, or to explain what a finding's
> `type` means.

### How the two stay distinct

- Different verbs: the tool scans text you give it; the resource is read.
- Each says what it does not do: the tool "does not check other kinds", the resource
  "does not analyse anything".
- Each names the other as the place to go instead.

## The catalog's contents

Five kinds. Every example is invented for this catalog (hard rule 7); none comes from
Kyle's samples or the test set. The three rule examples were run through
`runRules` and each fires its own rule. The two judgement examples fire none.

| `type` | Found by | What it is | Invented example | Fix |
|---|---|---|---|---|
| `staccato` | Tool | A run of very short sentences used for effect | "We shipped it. Nobody noticed. Then the emails started." | Join them into one or two full sentences that say what you mean. |
| `contrast_turn` | Tool | Setting up one idea only to knock it down for another | "The problem wasn't the budget. It was the deadline." | Say the point you believe in one plain sentence and drop the setup. |
| `signpost` | Tool | A phrase that announces a point instead of making it | "It turns out the old version was faster." | Delete the phrase and start with the point itself. |
| `engagement_hook` | Your judgement | A closing question or invitation aimed at getting replies | "What would you have done? Tell me below." | End on your last real point. |
| `neat_story` | Your judgement | An anecdote whose details and punchline are too convenient | A stranger on a train says exactly the line the post needed, then gets off at the next stop. | Keep the details that really happened, including the untidy ones, or cut the story. |

The fix wording for the three rule kinds matches `EXPLANATIONS` in `src/rules.ts`.
Step 4.4 should build the catalog from that same source so the two cannot drift.

Left out on purpose:

- `stock_phrase`, `tidy_closer` and `balanced_list`, switched off from prompt v2
  because they flagged clean writing far too often (see `prompts/README.md`). They
  come back here only when they come back in the prompt, with sharper criteria.
- `other`, which is a catch-all for the model's replies, not a kind of tell.

## For step 4.6, the safety review

The reply lands inside someone else's assistant. Everything in it is either fixed
text written by us (`type`, `why`, `fix`, the catalog pointer) or a slice of the
visitor's own draft (`quote`). Nothing we write reads as an instruction to that
assistant beyond the descriptions' "use it when" guidance.
