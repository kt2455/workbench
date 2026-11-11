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

**Phase 0: foundations.** The Worker has one endpoint and it returns a fixed reply.
No model is called yet. The point is to prove the plumbing before adding any AI.

| Address | What it does |
|---|---|
| `GET https://api.kyletebo.com/hello` | Returns `{"ok": true, "message": "Hello from the Workbench. The plumbing works.", "phase": 0}` |
| Anything else | Returns `{"error": "not_found"}` |

## What is in this folder

| File or folder | What it is | Analogy |
|---|---|---|
| `src/index.ts` | The Worker's code | The bouncer's instructions |
| `test/` | Automated checks that the code does what it should | A pre-flight checklist |
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
