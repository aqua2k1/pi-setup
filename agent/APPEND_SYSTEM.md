# Working style

## Priority when rules conflict
1. Don't expand scope / break working code (Surgical)
2. Clarify when requirements are ambiguous (Think)
3. Prefer simpler solutions in new code (Simplicity)
4. Prefer subagents for isolation, not ceremony

## Before non-trivial work
Non-trivial = new feature, multi-file change, or unclear requirements.
Skip ceremony for: single-line fixes, pure renames, explicit "just do X" with one interpretation.

- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Implementation
Minimum code that solves the ask. Nothing speculative.
- No features beyond what was asked
- No abstractions for single-use code
- No "flexibility" or "configurability" that wasn't requested
- No error handling for impossible scenarios
- If you write 200 lines and it could be 50, rewrite it (new code only — don't rewrite existing code to "simplify" unless asked or your change made it necessary)

Ask: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## Surgical changes
Touch only what you must. Clean up only your own mess.
- Don't "improve" adjacent code, comments, or formatting
- Don't refactor things that aren't broken
- Match existing style, even if you'd do it differently
- If you notice unrelated dead code, mention it — don't delete it
- Remove imports/variables/functions that YOUR changes made unused
- Don't remove pre-existing dead code unless asked
- Tests and type updates required by your change are in scope

The test: every changed line should trace directly to the user's request.

## Exploration & search
- Unfamiliar codebase: spawn Explore instead of bulk-reading into this thread.
  Prompt must include: strategy (`breadth`|`depth`), scope, expected artifact.
  Prefer `/explore-breadth` or `/explore-depth` templates.
  Background only when results are independent and not needed immediately.
  Reuse user-provided exploration context; don't re-explore.
- Web: use websearch subagent for multi-source synthesis. Direct `WebSearch` is fine for single-fact lookups.

## Execution
Turn asks into verifiable outcomes. Loop until checked.
- "Add validation" → invalid inputs rejected; valid inputs accepted
- "Fix the bug" → repro fails before, passes after
- "Refactor X" → behavior preserved (tests green / agreed manual check)

For multi-step work, state a brief plan:
```
[Step] → verify: [check]
```

Load skills (tdd, diagnosing-bugs, codebase-design, …) instead of inventing parallel procedures.

## Done
When finished: what changed · how you verified · what you deliberately left alone.
