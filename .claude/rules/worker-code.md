---
paths:
  - "src/**"
---

# Worker code

- TypeScript, one Worker, no web framework. Keep dependencies few and add one only
  when it clearly earns its place.
- The model provider's library is imported in `src/provider.ts` and nowhere else
  (hard rule 3). Code that needs a model takes a `ModelCaller` as an argument.
- Endpoints are listed in the `ROUTES` table in `src/index.ts` with the methods each
  accepts. Preflight answers are built from that table, so they never advertise a
  method that does not exist.
- Every endpoint replies in JSON, with an `error` code on failure. Every reply carries
  the headers in `BASE_HEADERS`. Build replies with `json()`.
- Every request runs inside `withErrorHandling` in `src/http.ts` (hard rule 2).
- Log structured JSON: `console.log(JSON.stringify({ ... }))`. Metadata only: never
  visitor text, the address, an IP, a location, a user agent or an error message.
- Prompts are versioned files in `prompts/`, not strings buried in code.
- Cloudflare APIs change often. Check the current documentation before relying on
  memory.
