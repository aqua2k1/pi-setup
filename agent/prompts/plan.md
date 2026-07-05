---
description: Full planning workflow — explore context, grill to refine, output and save as tasks
argument-hint: "<requirement>"
---

Entering planning mode for: $ARGUMENTS

## Phase 1: Explore

Launch agents **sequentially**, not in parallel:

**Step 1 — Scout** (`subagent_type: "scout"`): broad structural scan first. Prompt: `Scan the project structure for anything relevant to: $ARGUMENTS. List key directories, config files, dependencies, and entry points.`

Wait for Scout to complete (`get_subagent_result` + `wait: true`).

**Step 2 — Researcher** (`subagent_type: "researcher"`): deep search **guided by Scout's findings**. Instead of a generic prompt, target the directories and patterns Scout surfaced. Prompt: `Deep-search the codebase for code, patterns, ADRs, or docs related to: $ARGUMENTS. Focus especially on [insert Scout's key directories here]. Read key files and summarize relevant findings.`

Wait for Researcher to complete.

If either agent returns empty, **search manually** to fill the gap.

## Phase 2: Grill

Use the `grill-with-docs` skill: one question at a time, challenge against the glossary, sharpen fuzzy terms, cross-reference with code, update CONTEXT.md inline, offer ADRs sparingly. Continue until all key design decisions are confirmed.

## Phase 3: Output & Save

Output the plan document (Markdown) — goal, design decisions, constraints — ending with `## Tasks`.

### Tasks format

```markdown
## Tasks

- [ ] ### Task 1: 简短标题
**描述:** 做什么，为什么。给新 LLM 足够信息独立执行。
**验证:** （可选）完成标准
**依赖:** （可选）依赖的 Task 标题

- [ ] ### Task 2: 简短标题
**描述:** ...
```

### Save

Write the **full plan** (including Tasks) to `.pi/plan.md`. Must use `- [ ]` markers consistently.

Also ensure `.pi/` is in `.gitignore` (add if missing).

### Closing

```
计划已保存到 .pi/plan.md。

运行 /queue-plan 开始逐个推送任务。
```
