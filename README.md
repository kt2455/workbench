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
`/check`. It is not switched on for visitors yet: the model stays off until the
security review is done, and there is no page on the website that calls it.

| Address | What it does |
|---|---|
| `POST https://api.kyletebo.com/check` | Checks a draft for passages that sound machine-written. See `docs/tells-checker-design.md` for the exact reply. |
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

**The master switch.** `MODEL_ENABLED` in `wrangler.jsonc` is `"false"`. While it is,
`/check` runs the rules alone, says so in its reply, and never touches the paid key.

### What protects the budget

| Guardrail | What it does |
|---|---|
| Rate limit | 5 checks a minute for each visitor |
| Size cap | Drafts up to 8,000 characters, about 1,300 words |
| Bot check | Cloudflare Turnstile, confirmed on every request |
| Daily budget | $1.00 a day. When it is spent, checks use the free rules until midnight UTC |
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
| `.github/workflows/checks.yml` | Runs the tests automatically on every pull request | The inspector who signs off before opening |
| `test/` | Automated checks that the code does what it should | A pre-flight checklist |
| `testset/` | 38 writing samples and Kyle's hand-marked answer key | The marked exam paper |
| `docs/tells-checker-design.md` | How the first tool works and the exact shape of its replies | The blueprint |
| `prompts/` | The instructions given to the model, one numbered file per version | Recipe cards |
| `wrangler.jsonc` | Settings: the Worker's name, address and non-secret options | The venue's licence on the wall |
| `package.json` | The list of tools this project needs | A shopping list |
| `package-lock.json` | The exact versions of those tools | The receipt |
| `tsconfig.json`, `vitest.config.ts` | Settings for the code checker and the test runner | |
| `CLAUDE.md` | Rules for AI agents working on this project | The staff handbook |

**Wrangler** is Cloudflare's command-line tool for Workers. It runs the Worker on
your own computer for testing and publishes it to Cloudflare.

## Secrets

- The API key is **never** in this repository, in any file, in any form.
- It lives in three places only: the model provider's console, Kyle's password
  manager, and the Worker's secret store in the Cloudflare dashboard.
- `wrangler.jsonc` is public. Only non-secret settings go in it.

## What gets logged

Almost nothing, on purpose. Cloudflare can keep a record of every request, including
each visitor's IP address, rough location and browser. That is switched off.

Two things can still reach the log: lines this code writes deliberately, and errors.
The deliberate lines are limited to counts, cost and speed. Errors are caught by a
safety net that records one fixed line, "unhandled_error", and throws the details
away, because an error message can contain whatever the code was handling at the
time. Text a visitor pastes is never stored.

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
| `npm run deploy` | Publishes the Worker to Cloudflare |

Most of the time Claude runs these in a session and Kyle reviews the pull request.
GitHub also runs the type check and the tests on every pull request, and shows a
green tick or a red cross next to it.
