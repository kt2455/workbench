# Prompts

The instructions the Worker gives to a model. Each one is a plain file here, so a
change to a prompt shows up in a pull request like any other change.

**Analogy:** a recipe card. The kitchen cooks from the card, and when the recipe
changes, a new card is written and numbered. Nobody scribbles on the old one.

| File | What it is |
|---|---|
| `tells-checker/v1.md` | The Tells Checker's instructions (Layer 2 in `docs/tells-checker-design.md`) |

## Rules

1. **The whole file is the prompt.** Everything in a version file is sent to the
   model as its system prompt. Notes for people go in this README, not in the file.
2. **A version in use is frozen.** Once a version has been deployed or scored, it is
   not edited. A change means a new file (`v2.md`), so a score can always be traced to
   the exact words that produced it. Until `v1.md` is first deployed it is a draft and
   can change.
3. **Examples never come from the test set.** Anything in `testset/` is the exam
   paper. A prompt that quotes it has seen the answers, and its scores mean nothing.
   Examples are invented for the prompt.
4. **No model names and no secrets.** The prompt does not know which model runs it.
5. **The draft goes in the user message**, between `<draft>` and `</draft>` tags,
   with nothing else. The Worker builds that message. Visitor text is never added to
   the prompt file's text.

## What the Worker must do around the prompt

The prompt asks the model to behave. The Worker checks that it did. These are for
step 1.9 and are listed in `docs/tells-checker-design.md`:

- Reject output that is not the expected JSON shape and fall back to quick mode.
- Drop any finding whose quote is not found exactly in the draft.
- Enforce the limits in code: five findings, 200 characters for `why` and `fix`.
- Never let the model's output decide anything except the content of the reply. The
  model has no tools.

## Status of v1

Drafted in step 1.6. Not yet run against a model. Step 1.13 scores it against the
test set for the first time.
