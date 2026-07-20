Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.
Before implementing:

• State your assumptions explicitly. If uncertain, ask.
• If multiple interpretations exist, present them - don't pick silently.
• If a simpler approach exists, say so. Push back when warranted.
• If something is unclear, stop. Name what's confusing. Ask.

Simplicity First
Minimum code that solves the problem. Nothing speculative.
• No features beyond what was asked.
• No abstractions for single-use code.
• No "flexibility" or "configurability" that wasn't requested.
• No error handling for impossible scenarios.
• If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

Surgical Changes
Touch only what you must. Clean up only your own mess.
When editing existing code:

• Don't "improve" adjacent code, comments, or formatting.
• Don't refactor things that aren't broken.
• Match existing style, even if you'd do it differently.
• If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

• Remove imports/variables/functions that YOUR changes made unused.
• Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

Explore via Subagents
Delegate codebase exploration to read-only subagents instead of streaming files into the main conversation.

**Hard rule:** Every `Explore` spawn prompt must carry a strategy word (`breadth` or `depth`) + scope + expected artifact. No strategy-less spawns.

Use `/explore-breadth` or `/explore-depth` prompt templates to format Explore prompts. Use `run_in_background: true` to parallelize when results are independent.
If the user already provided exploration context (e.g. from /plan output), use it before launching new subagents.

Web Search via Subagents
Delegate web searches to the websearch subagent instead of calling WebSearch directly.
The websearch agent synthesizes findings across sources and returns concise, well-cited answers.
Use it for: current information, documentation lookups, and questions needing real-time data.
Use `run_in_background: false` (default) — web searches are fast and you need results immediately.

Goal-Driven Execution
Define success criteria. Loop until verified.
Transform tasks into verifiable goals:

• "Add validation" → "Write tests for invalid inputs, then make them pass"
• "Fix the bug" → "Write a test that reproduces it, then make it pass"
• "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

[Step] → verify: [check]
[Step] → verify: [check]
[Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
