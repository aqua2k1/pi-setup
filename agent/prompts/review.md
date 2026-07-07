---
description: Multi-angle code review (security, performance, architecture, style, testing)
argument-hint: "[files...]"
---

## Step 1: Gather code to review

If `$ARGUMENTS` is non-empty, read the specified files using the `read` tool:

```
$ARGUMENTS
```

Otherwise, run `git diff` to get the latest uncommitted changes:

```bash
git diff
```

Store the gathered code as `$CODE` for use in Step 2.

## Step 2: Spawn 5 review subagents in parallel

Use the `subagent` tool with `run_in_background: true` to spawn all 5 agents simultaneously. Each agent is of type `review`. The prompt for each must include the angle-specific instructions followed by the full code content from Step 1.

### Agent 1 — Security

```
subagent_type: "review"
description: "Security review"
prompt: |
  Review the following code from the **Security** perspective. Focus on: injection vulnerabilities, XSS, authentication bypass, secret leaks (hardcoded credentials, API keys), missing or weak input validation, and permission/authorization checks.

  Produce specific, actionable findings sorted by severity (Critical → High → Medium → Low). Each finding must include the file path and line number.

  Code to review:

  $CODE
run_in_background: true
```

### Agent 2 — Performance

```
subagent_type: "review"
description: "Performance review"
prompt: |
  Review the following code from the **Performance** perspective. Focus on: N+1 queries, unnecessary memory allocations, blocking I/O, missing caching opportunities, and algorithmic complexity issues.

  Produce specific, actionable findings sorted by severity (Critical → High → Medium → Low). Each finding must include the file path and line number.

  Code to review:

  $CODE
run_in_background: true
```

### Agent 3 — Architecture

```
subagent_type: "review"
description: "Architecture review"
prompt: |
  Review the following code from the **Architecture** perspective. Focus on: layer violations, circular dependencies, SOLID principle violations, module boundary issues, and excessive coupling.

  Produce specific, actionable findings sorted by severity (Critical → High → Medium → Low). Each finding must include the file path and line number.

  Code to review:

  $CODE
run_in_background: true
```

### Agent 4 — Style

```
subagent_type: "review"
description: "Style review"
prompt: |
  Review the following code from the **Style** perspective. Focus on: naming consistency, dead code, code duplication, function length, and comment quality.

  Produce specific, actionable findings sorted by severity (Critical → High → Medium → Low). Each finding must include the file path and line number.

  Code to review:

  $CODE
run_in_background: true
```

### Agent 5 — Testing

```
subagent_type: "review"
description: "Testing review"
prompt: |
  Review the following code from the **Testing** perspective. Focus on: missing boundary cases, untested exception/error paths, excessive mock usage, and test readability/maintainability.

  Produce specific, actionable findings sorted by severity (Critical → High → Medium → Low). Each finding must include the file path and line number.

  Code to review:

  $CODE
run_in_background: true
```

Record each returned agent ID as `$SEC_ID`, `$PERF_ID`, `$ARCH_ID`, `$STYLE_ID`, `$TEST_ID`.

## Step 3: Wait for all subagents to complete

Use `get_subagent_result(wait: true)` for each agent ID:

```
get_subagent_result(agent_id: $SEC_ID, wait: true)
get_subagent_result(agent_id: $PERF_ID, wait: true)
get_subagent_result(agent_id: $ARCH_ID, wait: true)
get_subagent_result(agent_id: $STYLE_ID, wait: true)
get_subagent_result(agent_id: $TEST_ID, wait: true)
```

## Step 4: Aggregate results

Combine all results into a single review report with the following structure:

---

# Code Review Report

## Security `[FAILED]` (only if the subagent failed)

_One-sentence summary of the key security concern, or "No issues found."_

| Severity | File | Line | Finding |
|----------|------|------|---------|
| Critical | path/to/file.ts | 42 | Specific, actionable recommendation |
| High     | ... | ... | ... |
| Medium   | ... | ... | ... |
| Low      | ... | ... | ... |

## Performance `[FAILED]` (only if the subagent failed)

_One-sentence summary of the key performance concern, or "No issues found."_

| Severity | File | Line | Finding |
|----------|------|------|---------|
| ...      | ...  | ...  | ...     |

## Architecture `[FAILED]` (only if the subagent failed)

_One-sentence summary of the key architecture concern, or "No issues found."_

| Severity | File | Line | Finding |
|----------|------|------|---------|
| ...      | ...  | ...  | ...     |

## Style `[FAILED]` (only if the subagent failed)

_One-sentence summary of the key style concern, or "No issues found."_

| Severity | File | Line | Finding |
|----------|------|------|---------|
| ...      | ...  | ...  | ...     |

## Testing `[FAILED]` (only if the subagent failed)

_One-sentence summary of the key testing concern, or "No issues found."_

| Severity | File | Line | Finding |
|----------|------|------|---------|
| ...      | ...  | ...  | ...     |

## Overall Stats

| Angle        | Critical | High | Medium | Low | Total |
|-------------|----------|------|--------|-----|-------|
| Security    | N        | N    | N      | N   | N     |
| Performance | N        | N    | N      | N   | N     |
| Architecture| N        | N    | N      | N   | N     |
| Style       | N        | N    | N      | N   | N     |
| Testing     | N        | N    | N      | N   | N     |

**Total token usage:** N (sum from subagent metadata if available, otherwise "N/A")

---

## Step 5: Failure handling

If any subagent fails (error response from `get_subagent_result`), mark the corresponding angle section as `[FAILED]` in the heading, include the error message, and continue aggregating the remaining angles. Do not retry failed agents.
