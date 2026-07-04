---
description: Execute the most recent plan using a plan-impl subagent
---

## Step 1: Find the Plan

Scan the conversation history for the most recent plan. A "plan" is a structured output from the `/plan` workflow — typically containing sections like "Proposed Approach", "Tasks", or a numbered task list.

If multiple plans exist, list them briefly and ask the user which one to implement.

If no plan is found, tell the user: "No plan found. Use `/plan <requirement>` first."

## Step 2: Parse Tasks

Extract the actionable tasks from the plan. Present them as a numbered checklist:

```
Found plan: {summary}

Tasks to implement:
1. Task A
2. Task B
3. Task C
```

Ask: "Implement these? (y/n, or edit the list)"

Wait for confirmation.

## Step 3: Execute

Launch a **plan-impl** subagent in the background with the confirmed task list:

```
Implement the following plan tasks. Stop on first failure.

{confirmed task list}

Context from plan:
{relevant plan details — approach, constraints, patterns}
```

The agent runs in the background. You'll be notified when it completes.

## Step 4: Report

When plan-impl finishes, summarize:
- Tasks completed
- Files modified
- Any failures
