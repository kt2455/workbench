# workbench

The backend for the AI tools on [kyletebo.com](https://kyletebo.com).

## Why this exists

kyletebo.com is a static site. Think of it as a printed brochure: everything in it
is visible to anyone who picks it up, so it cannot keep a secret. Calling an AI model
needs a secret (an API key that costs money when used), so the key has to live
somewhere else.

That somewhere is this project: a **Cloudflare Worker**. A Worker is a small program
that runs on Cloudflare's servers and answers requests. Here it plays the bouncer. It
stands between visitors and the model, holds the key, and decides who gets in.

```
Visitor's browser            This Worker ("the bouncer")                Model API
kyletebo.com page   ---->    checks size, rate, budget, bots   ---->    Claude
(static, no secrets)  <----  logs cost and speed, no text      <----
```

The full build plan lives in the website repository under `docs/workbench/`.

## Where it is today

**Phase 1: the Tells Checker, part built.** The Worker has its first real endpoint,
`/check`. The model was switched on on 2026-11-13, after the security review
(`docs/security-review-1.14.md`). There is no page on the website that calls it yet.

| Address | What it does |
|---|---|
| `POST https://api.kyletebo.com/check` | Checks a draft for passages that sound machine-written. See `docs/tells-checker-design.md` for the exact reply. |
| `GET https://api.kyletebo.com/stats` | Public totals for the Open Kitchen page. See "The public stats" below. |
| `GET https://api.kyletebo.com/hello` | Returns a fixed reply. A health check: proof the Worker is up. |
| Any other address | Returns `{"error": "not_found"}` |
| An address with the wrong kind of request | Returns `{"error": "method_not_allowed"}` |
| A call from a page on another website | Returns `{"error": "origin_not_allowed"}` |
| Something unexpected going wrong inside | Returns `{"error": "internal_error"}` and nothing else |

### How a check works

Two layers read the draft independently, and their results are combined.

1. **The rules** (`src/rules.ts`): three fixed patterns found by ordinary code. Free
   and instant.
2. **The model** (`src/provider.ts`): one call that reads the whole draft with Kyle's
   taste written into its instructions (`prompts/`).

Nothing the model says reaches a visitor unchecked (`src/merge.ts`). A finding that
quotes text which is not in the draft is thrown away.

**The master switch.** `MODEL_ENABLED` in `wrangler.jsonc` is `"true"`. Set to
`"false"`, `/check` runs the rules alone, says so in its reply, and never touches the
paid key. Changing it back and deploying is the quickest way to stop all model
spending. The tests always run with it off unless a test turns it on.

### What protects the budget

| Guardrail | What it does |
|---|---|
| Rate limit | 5 checks a minute for each visitor (for IPv6, each /64 network). Approximate: a speed bump, not a wall |
| Size cap | Drafts up to 8,000 characters, about 1,300 words |
| Bot check | Cloudflare Turnstile, confirmed on every request |
| Daily budget | $1.00 a day. When it is spent, checks use the free rules until midnight UTC. Each call sets aside a deliberately high estimate first, the real cost is always recorded in full, and a call that fails without a bill is counted at the full estimate |
| Monthly cap | Set at the model provider, outside this code |

If any of these breaks, it refuses rather than lets everything through.

### Who may call it

The Worker checks which website a browser request came from. Only pages on
`https://kyletebo.com` are let in. A page on any other website gets
`{"error": "origin_not_allowed"}`. This check is called CORS.

Think of it as a guest list at the door. It stops other websites from using the
Worker through their visitors' browsers. It does not stop someone calling the Worker
directly with a script, because scripts do not have to say where they came from.
Rate limits, a daily budget and a bot check (all in Phase 1) cover that.

## What is in this folder

| File or folder | What it is | Analogy |
|---|---|---|
| `src/index.ts` | The Worker's code | The bouncer's instructions |
| `src/cors.ts` | The check on which website a request came from | The guest list |
| `src/http.ts` | Headers sent on every reply, and the safety net for unexpected errors | The house rules |
| `src/check.ts` | The `/check` endpoint: reads the request and runs both layers | The front desk |
| `src/rules.ts` | Layer 1: the three rhythm rules | The metal detector |
| `src/provider.ts` | The only code that talks to a model provider | The wall socket |
| `src/merge.ts` | Checks the model's reply and combines the two layers | The editor's red pen |
| `src/tells.ts` | The list of kinds of tell and the shape of a reply | The glossary |
| `src/guardrails.ts` | The size cap, the rate limit and the bot check | The door staff |
| `src/budget.ts` | The daily budget counter | The bar tab |
| `src/log.ts` | The one log line per request: time, tokens, cost, speed, guardrail | The till receipt |
| `src/stats.ts` | The running totals behind `/stats` | The scoreboard |
| `.github/workflows/checks.yml` | Runs the tests automatically on every pull request | The inspector who signs off before opening |
| `.github/workflows/deploy.yml` | Publishes the Worker to Cloudflare when started by hand | The loading dock |
| `test/` | Automated checks that the code does what it should | A pre-flight checklist |
| `testset/` | 38 writing samples and Kyle's hand-marked answer key | The marked exam paper |
| `docs/security-review-1.14.md` | The security and abuse review before the model was switched on, and what was done about each finding | The inspection report |
| `docs/tells-checker-design.md` | How the first tool works and the exact shape of its replies | The blueprint |
| `prompts/` | The instructions given to the model, one numbered file per version | Recipe cards |
| `wrangler.jsonc` | Settings: the Worker's name, address and non-secret options | The venue's licence on the wall |
| `package.json` | The list of tools this project needs | A shopping list |
| `package-lock.json` | The exact versions of those tools | The receipt |
| `tsconfig.json`, `vitest.config.ts` | Settings for the code checker and the test runner | |
| `CLAUDE.md` | Rules for AI agents working on this project | The staff handbook |

**Wrangler** is Cloudflare's command-line tool for Workers. It runs the Worker on
your own computer for testing and publishes it to Cloudflare.

## The public stats

`GET /stats` returns running totals for the Open Kitchen page:

```json
{
  "since": "2026-11-13",
  "asOf": "2026-11-20",
  "checks": { "total": 12, "full": 9, "quick": 3 },
  "quickBecause": { "modelOff": 1, "dailyBudget": 0, "modelUnavailable": 2 },
  "guardrails": { "sizeCap": 1, "botCheck": 4, "dailyBudget": 0 },
  "model": { "calls": 11, "averageSeconds": 2.4 },
  "cost": { "totalUsd": 0.01, "perModelCallUsd": 0.0004 }
}
```

`since` and `asOf` are the first and last day (UTC) included. Both are `null`, and
every number is 0, until there is something to show.

Totals and averages only. Three rules stop anyone working out one visitor's request
by reading the totals before and after it:

1. **Finished days only.** Today's checks appear tomorrow at the earliest.
2. **Batches only.** The totals move forward only once at least 5 checks
   (`STATS_MIN_BATCH`) have built up since the last move, and, if any of them called
   the model, at least 5 model calls. Like a ballot box that is opened only when
   enough votes are in: any change shows a group, never one check. With little
   traffic this means the numbers can lag by a few days.
3. **Rounded numbers.** The total cost is rounded to the cent, the cost per model
   call to $0.0001 and the average time to a tenth of a second. Token counts are not
   published. So even someone who sent four of the five checks in a batch cannot
   subtract their own and see the fifth. Early on, the total cost will read $0.00.

The cost is per model call, not per check. Quick checks made while the model is off
cost nothing, and counting them would make a real check look cheaper than it is.

Not counted: requests turned away by the rate limit or the guest list, and malformed
requests. A script can send those as fast as it likes, and the counter should not be
something a script can keep busy. They still appear in the log. Reading `/stats` has
its own rate limit, 20 times a minute per visitor.

Two things to know when reading the numbers:

- **Every deploy adds one to `guardrails.botCheck`.** The deploy confirms the live
  Worker by sending a check with no bot token, which is refused and counted.
- **A single guardrail hit can show as +1.** On a quiet day, one refused request is
  visible on its own. It says only that something was refused, never anything about a
  draft, so it is not held back.

## Secrets

- The API key is **never** in this repository, in any file, in any form.
- It lives in three places only: the model provider's console, Kyle's password
  manager, and the Worker's secret store in the Cloudflare dashboard.
- `wrangler.jsonc` is public. Only non-secret settings go in it.

## What gets logged

Almost nothing, on purpose. Cloudflare can keep a record of every request, including
each visitor's IP address, rough location and browser. That is switched off.

Two things can still reach the log: lines this code writes deliberately, and errors.

**The deliberate lines** (`src/log.ts`). Each request to `/check` writes one line,
like a till receipt: it says what was bought and what it cost, never what was said
at the counter. A line holds:

| Field | What it says |
|---|---|
| `at`, `durationMs` | When the request finished and how long it took |
| `result`, `status` | `full` or `quick`, or the error code the visitor got |
| `guardrail` | Which guardrail fired: `rate_limit`, `size_cap`, `bot_check` or `daily_budget`, or none. `daily_budget` also covers the budget counter being unreachable, since the model is then not called |
| `characters` | Roughly how long the draft was, rounded up to the next 100. A count, not the text |
| `modelStep` | What happened with the model: called and `ok`, or why not (`switched_off`, `budget_reached`, `unavailable` and so on) |
| `model`, `promptVersion` | Which model and which prompt file, both from the settings |
| `modelMs`, `inputTokens`, `outputTokens` | How long the model took, and how much it read and wrote |
| `costMicros`, `costUsd` | What that cost: in millionths of a dollar (a whole number, so totals add up exactly) and in dollars |
| `verdict`, `findings` | The verdict sent back, and how many findings of each kind. Counts only, never the quotes |

A page on another website that is turned away gets a shorter line: `event`
`refused`, `guardrail` `origin`. The address it asked for is not recorded.

Every field is a number, a word from a fixed list, or one of two names from the
settings (the model and the prompt version). The code that writes the line checks
each word against its list as it runs, and writes anything unexpected as `null`, so
there is no slot a draft could end up in. It copies the fields one by one, so
anything else handed to it is left behind. If a missing setting stops the model from
being called, `guardrail` is empty and `modelStep` says `settings_broken`. Tests send a draft with a made-up word in
it and check that the word, the visitor's address and the bot check token appear in
no line.

Cloudflare adds a few fields of its own to every stored line, including the address
that was requested (for example `https://api.kyletebo.com/check`). It cannot be
switched off. Query strings are stripped from it (`redact_query_string`), visitor text
never travels in the address, and a request for an address that does not exist is
answered before anything is logged, so the address is always one of the Worker's own.

To read the lines: Cloudflare dashboard, Workers, `workbench`, Logs. Filter by
`event` or `guardrail`.

**Errors** are caught by a safety net that records one fixed line,
"unhandled_error", and throws the details away, because an error message can contain
whatever the code was handling at the time. Text a visitor pastes is never stored.

## Working on it

You need [Node.js](https://nodejs.org) installed. Then, in this folder:

```bash
npm install
```

That downloads the tools on the shopping list. After that:

| Command | What it does |
|---|---|
| `npm test` | Runs the automated checks |
| `npm run typecheck` | Checks the code for mistakes without running it |
| `npm run dev` | Runs the Worker on your own computer at `http://localhost:8787` |

### Publishing

Publishing happens on GitHub, not from anyone's computer. The "Deploy" workflow in
the Actions tab is started by hand, runs the tests, publishes, and then checks the
live Worker. It can be set to wait for Kyle's approval first. That is off for now. The access token it uses is kept in
GitHub's encrypted secrets store, which is separate from the files in this
repository.

Most of the time Claude runs these in a session and Kyle reviews the pull request.
GitHub also runs the type check and the tests on every pull request, and shows a
green tick or a red cross next to it.
