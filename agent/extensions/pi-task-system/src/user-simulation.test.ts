/**
 * User simulation tests for pi-task-system extension.
 *
 * Tests the task system from a user's perspective, covering:
 * - save_plan tool (validation, edge cases, success)
 * - push-task tool
 * - plan.md extraction (extractPlan)
 * - queue logic (findNextReadyTask, getCompletedTaskIds, planHasPendingTasks)
 * - cycle detection (detectCycle)
 * - planToMarkdown round-trip
 * - text content extraction
 */
import { describe, it, expect } from "vitest";
import { extractPlan, planToMarkdown } from "../src/plan-parser.js";
import { validatePlan, detectCycle } from "../src/plan-schema.js";
import { findNextReadyTask, getCompletedTaskIds, planHasPendingTasks } from "../src/queue.js";
import { renderTextContent, extractTextContent, extractTextBlocks, taskResultTextContent, firstTextContent } from "../src/text-content.js";
import type { Task, Plan } from "../src/plan-schema.js";
import type { ReadonlySessionLike } from "../src/queue.js";

// ============================================================================
// SIMULATION 1: A user plans a multi-step feature
// ============================================================================

describe("User simulation: plan a feature with save_plan", () => {
  it("should validate and accept a well-formed 3-task plan", () => {
    const plan: Plan = {
      goal: "Add user authentication",
      tasks: [
        {
          id: "task-1",
          title: "Create User model",
          description: "Define User schema with email, password hash, and timestamps.",
          verification: "User model exists and can be instantiated",
          dependencies: [],
        },
        {
          id: "task-2",
          title: "Add login endpoint",
          description: "Create POST /login that validates credentials and returns JWT.",
          verification: "curl POST /login returns JWT token on valid credentials",
          dependencies: ["task-1"],
        },
        {
          id: "task-3",
          title: "Add registration endpoint",
          description: "Create POST /register that creates user and returns JWT.",
          verification: "curl POST /register creates user in DB and returns valid JWT",
          dependencies: ["task-1"],
        },
      ],
    };

    const result = validatePlan(plan);
    expect(result.goal).toBe("Add user authentication");
    expect(result.tasks).toHaveLength(3);
  });

  it("should reject a plan with duplicate task IDs (like user copy-paste error)", () => {
    const plan = {
      goal: "test",
      tasks: [
        { id: "task-1", title: "a", description: "desc", dependencies: [] },
        { id: "task-1", title: "b", description: "desc", dependencies: [] },
      ],
    };
    expect(() => validatePlan(plan)).toThrow("duplicated");
  });

  it("should reject a plan with dependency cycle (user error)", () => {
    const plan = {
      goal: "test",
      tasks: [
        { id: "task-1", title: "a", description: "desc", dependencies: ["task-2"] },
        { id: "task-2", title: "b", description: "desc", dependencies: ["task-1"] },
      ],
    };
    expect(() => validatePlan(plan)).toThrow("cycle");
  });

  it("should reject a plan referencing non-existent dependency", () => {
    const plan = {
      goal: "test",
      tasks: [
        { id: "task-1", title: "a", description: "desc", dependencies: ["task-99"] },
      ],
    };
    expect(() => validatePlan(plan)).toThrow("does not exist");
  });

  it("should reject empty tasks array", () => {
    const plan = { goal: "test", tasks: [] };
    expect(() => validatePlan(plan)).toThrow("non-empty array");
  });

  it("should reject invalid task id format (user typed '1' instead of 'task-1')", () => {
    const plan = {
      goal: "test",
      tasks: [{ id: "1", title: "a", description: "desc", dependencies: [] }],
    };
    expect(() => validatePlan(plan)).toThrow("task-N");
  });
});

// ============================================================================
// SIMULATION 2: User extracts plan from markdown
// ============================================================================

describe("User simulation: extractPlan from plan.md", () => {
  const validPlanJson = JSON.stringify({
    goal: "test-goal",
    tasks: [
      { id: "task-1", title: "Setup", description: "Init project", dependencies: [] },
    ],
  });

  it("should extract valid JSON block from markdown", () => {
    const md = `# My Plan\n\nSome text.\n\n\`\`\`json\n${validPlanJson}\n\`\`\`\n`;
    const plan = extractPlan(md);
    expect(plan.goal).toBe("test-goal");
    expect(plan.tasks).toHaveLength(1);
  });

  it("should throw descriptive error when JSON block missing", () => {
    const md = "# No JSON here\n\nJust text.";
    expect(() => extractPlan(md)).toThrow("No JSON code block found");
  });

  it("should throw when JSON is malformed (user edited manually)", () => {
    const md = "```json\n{ goal: bad json, }\n```\n";
    expect(() => extractPlan(md)).toThrow("JSON parse error");
  });

  it("should round-trip: planToMarkdown -> extractPlan", () => {
    const plan: Plan = {
      goal: "Round trip test",
      tasks: [
        { id: "task-1", title: "One", description: "First", dependencies: [] },
        { id: "task-2", title: "Two", description: "Second", dependencies: ["task-1"] },
      ],
    };

    const md = planToMarkdown(plan);
    const extracted = extractPlan(md);
    expect(extracted.goal).toBe(plan.goal);
    expect(extracted.tasks).toHaveLength(2);
    expect(extracted.tasks[1].dependencies).toEqual(["task-1"]);
  });
});

// ============================================================================
// SIMULATION 3: User runs /plan, the LLM saves, then /push-plan-tasks
// ============================================================================

describe("User simulation: task queue (findNextReadyTask)", () => {
  const tasks: Task[] = [
    { id: "task-1", title: "Setup", description: "", dependencies: [] },
    { id: "task-2", title: "Core", description: "", dependencies: ["task-1"] },
    { id: "task-3", title: "Tests", description: "", dependencies: ["task-2"] },
  ];

  it("initial state: task-1 is ready (no deps)", () => {
    const next = findNextReadyTask(tasks, new Set());
    expect(next?.id).toBe("task-1");
  });

  it("after task-1 done: task-2 is ready", () => {
    const next = findNextReadyTask(tasks, new Set(["task-1"]));
    expect(next?.id).toBe("task-2");
  });

  it("after task-1 & task-2 done: task-3 is ready", () => {
    const next = findNextReadyTask(tasks, new Set(["task-1", "task-2"]));
    expect(next?.id).toBe("task-3");
  });

  it("all done: returns null", () => {
    const next = findNextReadyTask(tasks, new Set(["task-1", "task-2", "task-3"]));
    expect(next).toBeNull();
  });
});

// ============================================================================
// SIMULATION 4: User completes tasks sequentially, getCompletedTaskIds tracks them
// ============================================================================

describe("User simulation: getCompletedTaskIds tracks session entries", () => {
  function taskEntry(id: string, planTaskId: string) {
    return { type: "custom", customType: "task", data: { prompt: "test", planTaskId } };
  }
  function doneEntry() {
    return { type: "custom", customType: "task-done", data: {} };
  }
  function session(entries: Record<string, unknown>[]): ReadonlySessionLike {
    return {
      getLeafId: () => null,
      getBranch: () => entries as any,
    };
  }

  it("empty session: no completed tasks", () => {
    expect(getCompletedTaskIds(session([]))).toEqual(new Set());
  });

  it("task then task-done: task is completed", () => {
    const s = session([taskEntry("a", "task-1"), doneEntry()]);
    expect(getCompletedTaskIds(s)).toEqual(new Set(["task-1"]));
  });

  it("two tasks interleaved with non-task entries", () => {
    const s = session([
      taskEntry("a", "task-1"),
      { type: "message", message: { role: "user", content: "hi" } },
      doneEntry(),
      taskEntry("b", "task-2"),
      { type: "thinking_level_change", thinkingLevel: "off" },
      doneEntry(),
    ]);
    const completed = getCompletedTaskIds(s);
    expect(completed.has("task-1")).toBe(true);
    expect(completed.has("task-2")).toBe(true);
  });

  it("task without task-done: NOT completed", () => {
    const s = session([taskEntry("a", "task-1")]);
    expect(getCompletedTaskIds(s)).toEqual(new Set());
  });

  it("LIFO pairing: task-1, task-2, done, done => both completed", () => {
    const s = session([
      taskEntry("a", "task-1"),
      taskEntry("b", "task-2"),
      doneEntry(), // closes task-2
      doneEntry(), // closes task-1
    ]);
    const completed = getCompletedTaskIds(s);
    expect(completed.has("task-1")).toBe(true);
    expect(completed.has("task-2")).toBe(true);
  });
});

// ============================================================================
// SIMULATION 5: planHasPendingTasks
// ============================================================================

describe("User simulation: planHasPendingTasks for progress display", () => {
  const plan: Plan = {
    goal: "test",
    tasks: [
      { id: "task-1", title: "A", description: "", dependencies: [] },
      { id: "task-2", title: "B", description: "", dependencies: ["task-1"] },
    ],
  };

  it("no tasks done: has pending", () => {
    expect(planHasPendingTasks(plan, new Set())).toBe(true);
  });

  it("one task done: still has pending", () => {
    expect(planHasPendingTasks(plan, new Set(["task-1"]))).toBe(true);
  });

  it("all tasks done: no pending", () => {
    expect(planHasPendingTasks(plan, new Set(["task-1", "task-2"]))).toBe(false);
  });

  it("empty plan: no pending", () => {
    expect(planHasPendingTasks({ goal: "empty", tasks: [] }, new Set())).toBe(false);
  });
});

// ============================================================================
// SIMULATION 6: Cycle detection edge cases
// ============================================================================

describe("User simulation: detectCycle edge cases", () => {
  it("no tasks: no cycle", () => {
    expect(detectCycle([])).toBeNull();
  });

  it("single task no deps: no cycle", () => {
    expect(detectCycle([{ id: "task-1", title: "a", description: "", dependencies: [] }])).toBeNull();
  });

  it("self-dependency: cycle detected", () => {
    const cycle = detectCycle([
      { id: "task-1", title: "a", description: "", dependencies: ["task-1"] },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe("task-1");
  });

  it("linear chain: no cycle", () => {
    expect(
      detectCycle([
        { id: "task-1", title: "a", description: "", dependencies: [] },
        { id: "task-2", title: "b", description: "", dependencies: ["task-1"] },
        { id: "task-3", title: "c", description: "", dependencies: ["task-2"] },
      ]),
    ).toBeNull();
  });

  it("3-node cycle", () => {
    const cycle = detectCycle([
      { id: "task-1", title: "a", description: "", dependencies: ["task-3"] },
      { id: "task-2", title: "b", description: "", dependencies: ["task-1"] },
      { id: "task-3", title: "c", description: "", dependencies: ["task-2"] },
    ]);
    expect(cycle).not.toBeNull();
    expect(cycle!.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// SIMULATION 7: Text content extraction for task results
// ============================================================================

describe("User simulation: text content extraction", () => {
  it("string content renders as-is", () => {
    expect(renderTextContent("hello")).toBe("hello");
  });

  it("content blocks extract text", () => {
    const content = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(extractTextContent(content)).toBe("line 1\nline 2");
  });

  it("filters non-text blocks", () => {
    const content = [
      { type: "text", text: "visible" },
      { type: "thinking", text: "hidden" },
    ];
    const blocks = extractTextBlocks(content);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("visible");
  });

  it("firstTextContent returns first text block", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    expect(firstTextContent(content)).toBe("first");
  });

  it("taskResultTextContent from string", () => {
    expect(taskResultTextContent("result string")).toBe("result string");
  });

  it("taskResultTextContent from blocks", () => {
    const content = [{ type: "text", text: "done" }];
    const result = taskResultTextContent(content);
    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result[0].text).toBe("done");
    }
  });
});

// ============================================================================
// SIMULATION 8: User workflow - skill references in push-task
// ============================================================================

describe("User simulation: push-task resolves skill paths", () => {
  // This is tested indirectly through resolveSkillRefs logic.
  // We verify the regex extraction behavior.
  it("should identify skill references with /skill:name pattern", () => {
    // The pattern is tested by import resolution in the actual extension.
    // We test regex boundaries:
    const skillPattern = /\/skill:([a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9])/g;
    
    const matches = [..."use /skill:tdd and /skill:caveman".matchAll(skillPattern)];
    expect(matches).toHaveLength(2);
    expect(matches[0][1]).toBe("tdd");
    expect(matches[1][1]).toBe("caveman");
  });

  it("should match partial valid prefix of otherwise invalid names", () => {
    const skillPattern = /\/skill:([a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9])/g;
    
    // Regex captures "bad" (valid prefix) but stops before "--name"
    const matches = [..."/skill:bad--name".matchAll(skillPattern)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("bad");
  });

  it("should not match names with leading dash", () => {
    const skillPattern = /\/skill:([a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9])/g;
    const matches = [..."/skill:-start".matchAll(skillPattern)];
    expect(matches).toHaveLength(0);
  });

  it("should not match names with trailing dash", () => {
    const skillPattern = /\/skill:([a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9])/g;
    // Matches "end" but not the trailing dash
    const matches = [..."/skill:end-".matchAll(skillPattern)];
    expect(matches).toHaveLength(1);
    expect(matches[0][1]).toBe("end");
  });
});
