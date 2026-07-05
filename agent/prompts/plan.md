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

### Required Output: Tasks Section

Every plan MUST end with a `## Tasks` section using this format:

```markdown
## Tasks

### Task 1: 简短标题
**描述:** 具体做什么，为什么

### Task 2: 简短标题
**描述:** 具体做什么，为什么
**验证:** 如何验证完成（可选）
**依赖:** Task 1（可选）
```

Rules:
- **描述** is required for every task. Be specific enough that a fresh-context LLM can execute it.
- **验证** is optional. If a clear verification command or expected output exists, include it.
- **依赖** is optional. List task title(s) this task depends on, for ordering context.
- Use these exact Chinese field names: `描述:`, `验证:`, `依赖:`.
- Task titles must be unique within the plan.

This enables `/queue-plan` to parse the plan and queue tasks via push-task.
