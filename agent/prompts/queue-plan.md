---
description: Parse the most recent plan and queue its tasks via push-task
---

## Step 1: Find the Plan

Scan the conversation history for the most recent plan. A plan contains a `## Tasks` section with numbered tasks in this format:

```
### Task N: 简短标题
**描述:** ...
**验证:** ...（可选）
**依赖:** ...（可选）
```

If multiple plans exist, list them briefly and ask which to implement.

If no plan is found, tell the user: "No plan found. Use `/plan <requirement>` first."

## Step 2: Extract Plan Context

Capture the plan's preamble — everything before `## Tasks` — as shared context. Every task needs to know:
- What the overall goal is
- Key design decisions and constraints
- Any conventions or patterns the plan assumes

Summarize this into a short context block (3-5 sentences max).

## Step 3: Queue Tasks

For each task in the `## Tasks` section, call `push-task`:

- **title** = `Task标题` (the title after `Task N:`)
- **prompt** = assembled from:

```
{plan context summary}

## 当前任务
{task 描述}

{optional: 验证要求: {task 验证}}

{optional: 依赖任务: {task 依赖}}
```

**Call push-task once per task in order.** Tasks with dependencies should go after their dependencies. Do not batch multiple push-task calls in one response — call them sequentially, one per turn.

## Step 4: Report

After all tasks are queued, confirm:

```
N tasks queued:
1. 标题A
2. 标题B
3. 标题C

Run /start-task to execute one at a time, or /auto to run all hands-free.
```
