---
paths:
  - "test/**"
  - "vitest.config.ts"
---

# Tests

- Tests run inside a local copy of the Workers runtime through
  `@cloudflare/vitest-plugin`. `npm test` runs them all.
- Every endpoint and every guardrail gets a test. Do not skip or weaken a test to get
  a change through.
- No test may reach a real provider. Code that needs a model takes a `ModelCaller`,
  and tests pass a stand-in. Network calls the code makes (the provider, Turnstile's
  siteverify) are faked: see `test/helpers.ts`.
- Visitor addresses in tests are made up (`newVisitor()` in `test/helpers.ts`) so one
  test's rate limit never affects another's.
- Fixtures and example drafts are invented. Never client material (hard rule 7), and
  never text from `testset/`.
- A guardrail test checks that it fails closed: when it breaks or cannot be read, the
  request is refused or the model is not called.
