# Step 1.14: security and abuse review of the Workbench Worker

Reviewed by a different model from the builder (Fable), on 2026-11-13.
Reviewed: `origin/main` at `2ae2c68`. Typecheck passes, 216 tests pass.

## Verdict

Not yet, but it is close. The Worker is carefully built and most of it holds up: the
guest list, the size cap, the bot check, the log privacy and the provider "wall socket"
all do what they claim. No way was found for a visitor to reach the paid model without
a genuine bot check token, and no secret or visitor text is in any log. Two things
should be fixed before the model is switched on, both in the daily budget (findings 1
and 2): in two situations the Worker's own counter records less than the provider
really charges, so the $1 a day limit can be exceeded. Both are small code changes. One
thing could not be confirmed: the per-visitor rate limit never refused the reviewer,
because the reviewer's requests left from several addresses (finding 3). The provider's
monthly cap, which only Kyle can see, is the backstop for all of this: check it is set
before switching on.

## Findings

**1. Medium (fix before switching on). A timed-out model call is recorded as costing
nothing.** `src/check.ts:129-135`, `src/provider.ts:39,75-78`. Any failure in the
provider call, including the 25 second timeout, returns `unavailable`, and the
reservation is then settled at 0. A request that timed out was received by the provider
and is very likely still charged. Scenario: the provider is slow, or a draft coaxes a
long reply. Each such call costs real money while the daily counter stays at zero, so
the budget never trips. This breaks hard rule 5 (fail closed). Fix: on `unavailable`,
keep the full reservation instead of releasing it.

**2. Medium (fix before switching on). The reservation is not a true worst case, and the
real cost is capped down to it.** `src/budget.ts:111-113` and `:63-64`. `tokenCeiling`
assumes at most one token per two characters. That holds for English but not for emoji,
Chinese, Japanese or unusual symbols, which can run at two or three tokens per
character. Worst case for one check: reserved about $0.0029, real cost up to about
$0.0047. `settle` records `min(actual, reserved)`, so the excess is never counted. 344
such checks fit in the recorded $1.00 while really costing about $1.60. Fix: remove the
`Math.min` cap so the true cost is always recorded, and reserve at one token per
character (or more) for the draft.

**3. Medium (could not confirm live). The per-visitor rate limit is approximate, and no
429 was seen.** `src/guardrails.ts:64-72`, `wrangler.jsonc:56-60`. 12 POSTs to `/check`
in about 25 seconds and 22 GETs to `/stats` in 5 seconds all passed, because the
reviewer's requests left from at least 6 different IP addresses. Inconclusive, not a
proven failure. Cloudflare's documentation says these limits are approximate, apply
separately in each Cloudflare location, can be exceeded, and advises against IP
addresses as the key. An IPv6 user controls billions of addresses. Without bot check
tokens an attacker reaches nothing paid; with tokens bought from a solver service they
can spend the whole $1 daily budget, after which everyone gets the quick check until
midnight UTC. That is the designed worst case. Fix: from a single fixed address, send 8
quick POSTs and confirm a 429 before launch. Key IPv6 visitors by their /64 prefix. Treat
this layer as a speed bump, not a wall.

**4. Low. Cloudflare attaches the request URL to every stored log line.** Field
`$workers.event.request.url`, plus `path`, `rayId` and `requestId`. None of the stored
entries holds an IP address, location, browser or visitor text. But the full URL is
against the letter of rule 2. Query strings are stripped (`redact_query_string`), so in
practice it is one of three fixed addresses. Gap: a request from another website to any
made-up path is logged as an origin refusal with that path attached, so the comment in
`src/log.ts` ("the address asked for is not recorded") is not true. No setting removes
this field. Fix: reword rule 2 to "no query strings, and visitor text never in the
path", correct the comment, and return 404 for unknown paths before the origin refusal
is logged.

**5. Low. Log lines and counter writes with no limit before them.** `src/index.ts:48`,
`src/check.ts:231`, `src/stats.ts:197-202`. Every foreign-origin request and every
malformed `/check` request writes a log line before any rate limit. Every bot check
failure and size refusal that passes the rate limit calls Turnstile and writes to the
stats counter. A flood costs little on a paid plan and can exhaust daily allowances on
the free plan (which fails closed). It also lets anyone inflate the public "bot check"
count. Fix: a Cloudflare WAF rate limiting rule on the zone, and consider not recording
refusals in the stats counter.

**6. Low. A crafted draft makes the rules slow.** `src/rules.ts:96-112`.
`widenToSentences` re-splits the whole draft for every match. 8,000 characters of
`"not. we "` took 310 ms (a normal draft takes under 1 ms). Needs a valid bot check
token first. On the free plan (10 ms limit) Cloudflare would end the request with its own
error page. Fix: split into sentences once and reuse the result.

**7. Low. Model text is not filtered for markup or links.** `src/merge.ts:65-71,99-106`.
Fix in step 1.15, and optionally strip `<`, `>` and URLs from `summary`, `why` and `fix`
on the server.

**8. Low. GitHub Actions are pinned to version tags, not commit hashes.**
`checks.yml:19-20`, `deploy.yml:34-35`. A hijacked tag would run in the job that holds
the Cloudflare token. Fix: pin to full commit SHAs. Confirm in GitHub Settings that the
`production` environment allows `main` only.

**9. Info.** The 405 reply has no `Allow` header. Prices match the model named. `main`
requires a pull request and the check, with zero approvals required.

## Prompt injection (assessed by reading; the model is off)

A draft cannot change what the Worker does: the model has no tools, no secrets and no
memory, and the prompt is public anyway. A draft containing `</draft>` is not escaped,
so it can make text appear to sit outside the tags. The prompt anticipates this, and
the damage is limited: the reply must fit a fixed shape, verdict and type come from
fixed lists, quotes must appear word for word in the draft, at most 5 findings,
`summary` is cut to 400 characters and `why`/`fix` to 200. Worst case: the person who
pasted the draft sees up to about 2,400 characters of the attacker's choosing. It
reaches only that person.

Step 1.15 must: put `summary`, `why`, `fix` and `quote` on the page with `textContent`
only, never `innerHTML`; never turn text into links; build highlights from
`start`/`end` on the visitor's own text; send the draft in the request body only.

## What holds up

- Prompt injection: contained as above, provided the page renders text.
- Oversized input: holds, confirmed live (8,001 characters, 60 KB with a truthful
  length, 200 KB with no length: all 413; invalid UTF-8 and UTF-16: 400).
- Rapid fire: every guardrail fails closed on error. 429 not observed (finding 3).
- Provider independence: holds. Only `src/provider.ts` imports the SDK. Outside it: the
  model name in `wrangler.jsonc` (allowed), the dependency in `package.json`, the
  provider URL in `test/helpers.ts` as a test stand-in, and "Claude" in README prose.
- Stored log entry: no IP address, location, browser or visitor text. URL caveat in
  finding 4.
- One front door: `workers_dev` and `preview_urls` off; http redirects; foreign and
  look-alike origins get 403; preflight lists only real methods.
- Error safety net, headers, secrets: sound.
- Stats privacy: sound.

Carried over from Phase 0: all done (IP in memory only; one budget counter with
reservation, but see findings 1 and 2; bot check on the server with no IP sent; size
cap while reading; `/check` POST and JSON only; one error handler; findings dropped if
the quote is not in the draft; stats totals only; checks on pull requests and `main`
protected).

## Live requests

43 requests to api.kyletebo.com: GET /hello (200), foreign and allowed origins (403,
200), preflights (204, 403), GET /check (405), GET /nope?text=hello (404), plain http
(301), POST /check as text/plain (400), oversized bodies (413 x3), invalid encodings
(400 x2), POST /check x7 with no token (403 x7, no 429), GET /stats x22 (200 x22, no
429). The public stats will later show about 7 bot check and 3 size cap refusals from
this review.

## What was done about it

Fixed in the pull request that added this report:

| Finding | Done |
|---|---|
| 1. Timed-out call counted as free | Fixed. A call that fails without a bill now keeps its whole reservation, in the budget, the log and the stats. |
| 2. Reservation not a true worst case | Fixed. The estimate is now three tokens per character, and the real cost is always recorded in full, even above the reservation. |
| 3. Rate limit approximate | IPv6 visitors are now counted by /64 network. Kyle to confirm a 429 from one fixed address before launch. Documented as a speed bump. |
| 4. Request address in stored logs | Rule 2 reworded with Kyle's agreement. Unknown addresses now get 404 before anything is logged. Comment corrected. |
| 5. Writes before any limit | Kyle to add a rate limiting rule in the Cloudflare dashboard. |
| 6. Slow rules on a crafted draft | Fixed. The draft is split into sentences once. The crafted draft went from about 250 ms to about 6 ms. |
| 7. Model text may hold markup | Requirements for the page written into `docs/tells-checker-design.md` for step 1.15. |
| 8. Actions pinned by tag | Fixed. Pinned to full commit hashes (v4.4.0). Kyle to confirm the `production` environment allows `main` only. |
| 9. Info | No change. |

The provider's monthly cap is Kyle's to confirm before the model is switched on.
