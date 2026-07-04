---
description: Full planning workflow — explore context, then grill to refine
argument-hint: "<requirement>"
---

You are now in planning mode for: $ARGUMENTS

## Phase 1: Gather Context

Launch two agents in the **background**:

- **Scout** (`subagent_type: "Scout"`): broad structural scan. Prompt: "Scan the project structure for anything relevant to: $ARGUMENTS. List key directories, config files, dependencies, and entry points."

- **Researcher** (`subagent_type: "Researcher"`): deep search. Prompt: "Deep-search the codebase for code, patterns, ADRs, or docs related to: $ARGUMENTS. Read key files and summarize relevant findings."

**Wait for both to complete** before proceeding to Phase 2. Use `get_subagent_result` with `wait: true` to block until each finishes.

## Phase 2: Grill the User

Now that you have full context from Scout and Researcher, interview the user relentlessly about the requirement.

- **One question at a time.** Wait for the answer before asking the next.
- **Challenge vague terminology.** Propose precise alternatives. "You say 'cache' — do you mean in-memory, Redis, or file-based?"
- **Stress-test with edge cases.** Invent concrete scenarios that probe boundaries.
- **Cross-reference with code.** If the user's claims contradict existing code or docs, surface it.

For each question, provide your recommended answer.

## Phase 3: Document

When Scout/Researcher complete and decisions crystallize:
- Propose `CONTEXT.md` updates when a term is resolved (glossary only — no implementation details)
- Offer an ADR only when: hard to reverse + surprising without context + real trade-off with genuine alternatives
