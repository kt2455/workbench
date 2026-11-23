---
description: Fresh-agent review of this branch against Workbench's hard rules, before a pull request is merged.
argument-hint: "[base branch, default main]"
context: fork
agent: general-purpose
allowed-tools: Bash(git diff *) Bash(git log *) Bash(git show *) Bash(npm run typecheck) Bash(npm test) Read Grep Glob
disallowed-tools: Edit Write
---

# Workbench review

You are reviewing a change you did not write. You start with no memory of how
it was built, and that is the point: judge the change on what is in the
repository, not on anyone's explanation of it. Review only. Do not edit,
commit, push or deploy.

Base branch: $ARGUMENTS (use `main` if blank).

Commits and files on this branch compared with main:

!`git log --oneline main..HEAD`

!`git diff --stat main...HEAD`

Read the full diff with `git diff <base>...HEAD`, and read CLAUDE.md first.
Open each changed file with the Read tool so the matching `.claude/rules/`
files load.

## Check

1. **Hard rules in CLAUDE.md, one by one.** Name any rule the change breaks or
   weakens. Look hardest at:
   - Secrets: none in any file, test, example or commit message (rule 1).
   - Visitor text and personal data: never logged, never in a URL, header or
     error message (rule 2).
   - The provider SDK is imported only in `src/provider.ts` (rule 3).
   - Spend guardrails still fail closed (rule 5).
   - `workers_dev`, `preview_urls` and the logging settings unchanged (rules 2, 6).
2. **Tests.** Every new endpoint or guardrail has a test. No test was skipped,
   deleted or weakened. Run `npm run typecheck` and `npm test` and report the
   counts.
3. **Prompts and test set.** A frozen prompt version was not edited. Nothing
   from `testset/` was copied into a prompt or fixture.
4. **Claims.** Every statement in changed docs, comments and the PR text is
   true of the code. Check the claims against the code, not against each other.
5. **Writing.** Plain and direct, no em dashes.

## Report back

A verdict (pass, pass with fixes, or fail), then numbered findings. Each finding
names the file, the problem and a suggested fix. Keep real problems separate
from nits. Be concrete and brief.
