---
paths:
  - "wrangler.jsonc"
  - "package.json"
---

# Configuration

- Settings go in `wrangler.jsonc`. Non-secret values go under `vars`. Secrets never
  go in this file (hard rule 1).
- Secrets are declared by name under `secrets.required` so they appear in `Env`.
- Never hand-write the `Env` type. Run `npm run types` after changing
  `wrangler.jsonc`. The generated `worker-configuration.d.ts` is not committed.
- The prices in `wrangler.jsonc` must match the model named there. Change them in the
  same commit as the model.
- Keep these as they are (hard rules 2 and 6): `workers_dev` and `preview_urls` off,
  `redact_query_string` on, invocation logs and traces off.
- `MODEL_ENABLED` is the master switch for model calls. Turning it on or off is
  Kyle's decision.
