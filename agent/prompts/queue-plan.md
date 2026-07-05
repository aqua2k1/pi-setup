---
description: Read plan from .pi/plan.md and push the next uncompleted task
---

## Trigger

`/queue-plan` command, and automatically after every `/finish-task` returns to the main branch.

## Read Plan

`read .pi/plan.md`. If missing → "先运行 /plan".

## Find Next Task

In the `## Tasks` section, find the **first** `- [ ]` task:

- If it has `**依赖:** Task X`, check that Task X is marked `- [x]`
- If dependency not yet completed → skip, continue scanning
- If task has no 依赖 field → treat as ready

None found → "全部任务已完成 ✓", done.

## Push One Task

**Only one. Never batch.**

`push-task` parameters:

- **title**: `Task标题` (the part after `Task N:`)
- **prompt**:

```
## 计划文件
请先 read .pi/plan.md 获取完整上下文和所有任务。

## 当前任务
{描述内容}

{如果有验证: **验证:** {验证内容}}

完成后通知用户运行 /finish-task 回到主分支。
```

After push → tell user: `已排队: {标题}。运行 /start-task。`

## Auto-Continue After /finish-task

`/start-task` and `/finish-task` are run by the user. When back on the main branch after `/finish-task`, **automatically**:

1. `read .pi/plan.md`
2. `edit` the just-completed task's `- [ ]` to `- [x]`
3. Return to "Find Next Task"
4. If found → `push-task` one. If not → "全部任务已完成 ✓"
