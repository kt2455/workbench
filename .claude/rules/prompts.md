---
paths:
  - "prompts/**"
  - "src/prompt.ts"
---

# Prompts

`prompts/README.md` holds the full rules and each version's history. Read it before
changing a prompt. In short:

1. The whole file is the prompt. Notes for people go in the README, not in the file.
2. A version that has been deployed or scored is frozen. A change is a new file
   (`v4.md`, and so on), so every score traces to the exact words that produced it.
   A new version is a draft, and can change, until it is first deployed or scored.
3. Examples are invented. Never quote or copy the shape of anything in `testset/`.
   Check new examples against the samples by wording and by sentence shape.
4. No model names and no secrets in a prompt.
5. Visitor text goes in the user message between `<draft>` and `</draft>`, built by
   the Worker. It is never added to the prompt file's text.

The version in use is set in `src/prompt.ts`.

How v2 and v3 were done, and the pattern to follow unless Kyle decides otherwise:
each new version changes one thing, its decision rule (keep, Kyle decides, go back)
is written before scoring, and `prompts/README.md` gets a table row and a
"Status of" section for it.
