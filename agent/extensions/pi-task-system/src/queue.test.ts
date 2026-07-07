import { describe, it, expect } from "vitest";
import {
  findNextReadyTask,
  planHasPendingTasks,
  getCompletedTaskIds,
} from "./queue.js";
import type { ReadonlySessionLike } from "./queue.js";
import type { Task, Plan } from "./plan-schema.js";

// ── helpers ────────────────────────────────────────────────────────

function task(
  id: string,
  title: string,
  deps: string[] = [],
): Task {
  return {
    id,
    title,
    description: `Description for ${id}`,
    dependencies: deps,
  };
}

function plan(goal: string, tasks: Task[]): Plan {
  return { goal, tasks };
}

function completedSet(...ids: string[]): Set<string> {
  return new Set(ids);
}

/** Minimal session entry shape matching queue.ts's SessionEntryLike. */
interface Entry {
  type: string;
  customType?: string;
  data?: Record<string, unknown>;
}

// ── findNextReadyTask ──────────────────────────────────────────────

describe("findNextReadyTask", () => {
  it("returns null for empty tasks array", () => {
    expect(findNextReadyTask([], new Set())).toBeNull();
    expect(findNextReadyTask([], completedSet("task-1"))).toBeNull();
  });

  it("returns first task when nothing is completed (all deps empty)", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second"),
    ];
    expect(findNextReadyTask(tasks, new Set())).toBe(tasks[0]);
  });

  it("returns task-2 when task-1 is completed and task-2 depends on task-1", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second", ["task-1"]),
    ];
    expect(findNextReadyTask(tasks, completedSet("task-1"))).toBe(tasks[1]);
  });

  it("returns task-3 when task-1 done but task-2 blocked by uncompleted task-3", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second", ["task-1", "task-3"]),
      task("task-3", "third"),
    ];
    // task-1 done, task-2 blocked (needs task-3), task-3 no deps → ready
    expect(findNextReadyTask(tasks, completedSet("task-1"))).toBe(tasks[2]);
  });

  it("returns null when all tasks are completed", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second", ["task-1"]),
      task("task-3", "third", ["task-2"]),
    ];
    expect(
      findNextReadyTask(tasks, completedSet("task-1", "task-2", "task-3")),
    ).toBeNull();
  });

  it("returns first ready task in order when multiple are ready", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second"),
      task("task-3", "third"),
    ];
    expect(findNextReadyTask(tasks, new Set())).toBe(tasks[0]);
  });

  it("skips completed ready task and returns next ready one", () => {
    const tasks = [
      task("task-1", "first"),
      task("task-2", "second"),
      task("task-3", "third"),
    ];
    expect(findNextReadyTask(tasks, completedSet("task-1"))).toBe(tasks[1]);
  });

  it("returns null when tasks exist but none are ready (all blocked)", () => {
    const tasks = [
      task("task-1", "first", ["task-99"]),
      task("task-2", "second", ["task-1"]),
    ];
    expect(findNextReadyTask(tasks, new Set())).toBeNull();
  });

  it("respects array order: earlier ready task wins over later", () => {
    const tasks = [
      task("task-1", "first", ["task-3"]),
      task("task-2", "second"),
      task("task-3", "third"),
    ];
    expect(findNextReadyTask(tasks, new Set())).toBe(tasks[1]);
  });
});

// ── planHasPendingTasks ────────────────────────────────────────────

describe("planHasPendingTasks", () => {
  it("returns false for plan with zero tasks (defensive)", () => {
    const p = plan("empty", []);
    expect(planHasPendingTasks(p, new Set())).toBe(false);
  });

  it("returns true when at least one task is uncompleted", () => {
    const p = plan("test", [
      task("task-1", "first"),
      task("task-2", "second"),
    ]);
    expect(planHasPendingTasks(p, completedSet("task-1"))).toBe(true);
  });

  it("returns false when all tasks are completed", () => {
    const p = plan("test", [
      task("task-1", "first"),
      task("task-2", "second"),
    ]);
    expect(planHasPendingTasks(p, completedSet("task-1", "task-2"))).toBe(
      false,
    );
  });

  it("returns true when no tasks are completed", () => {
    const p = plan("test", [task("task-1", "first")]);
    expect(planHasPendingTasks(p, new Set())).toBe(true);
  });

  it("ignores completedIds entries that are not in the plan", () => {
    const p = plan("test", [task("task-1", "first")]);
    expect(planHasPendingTasks(p, completedSet("task-99"))).toBe(true);
    expect(planHasPendingTasks(p, completedSet("task-1", "task-99"))).toBe(
      false,
    );
  });
});

// ── getCompletedTaskIds ────────────────────────────────────────────

describe("getCompletedTaskIds", () => {
  function makeTaskEntry(planTaskId: string): Entry {
    return {
      type: "custom",
      customType: "task",
      data: { prompt: "test prompt", planTaskId },
    };
  }

  function makeTaskDoneEntry(): Entry {
    return {
      type: "custom",
      customType: "task-done",
      data: {},
    };
  }

  function session(entries: Entry[]): ReadonlySessionLike {
    return {
      getLeafId: () => entries[entries.length - 1]?.data?.id as string ?? null,
      getBranch: () => entries,
    };
  }

  it("returns empty set for session with no task entries", () => {
    const s = session([]);
    expect(getCompletedTaskIds(s)).toEqual(new Set());
  });

  it("returns empty set when task has no matching task-done", () => {
    const s = session([makeTaskEntry("task-1")]);
    expect(getCompletedTaskIds(s)).toEqual(new Set());
  });

  it("returns completed planTaskId when task-done follows task entry", () => {
    const s = session([
      makeTaskEntry("task-1"),
      makeTaskDoneEntry(),
    ]);
    expect(getCompletedTaskIds(s)).toEqual(completedSet("task-1"));
  });

  it("pairs task entries LIFO with task-done entries", () => {
    const s = session([
      makeTaskEntry("task-1"),
      makeTaskEntry("task-2"),
      makeTaskDoneEntry(), // closes task-2
      makeTaskDoneEntry(), // closes task-1
    ]);
    expect(getCompletedTaskIds(s)).toEqual(
      completedSet("task-1", "task-2"),
    );
  });

  it("ignores task entries without planTaskId", () => {
    const entry: Entry = {
      type: "custom",
      customType: "task",
      data: { prompt: "no planTaskId" },
    };
    const s = session([entry, makeTaskDoneEntry()]);
    expect(getCompletedTaskIds(s)).toEqual(new Set());
  });

  it("handles interleaved entries (non-task entries between)", () => {
    const s = session([
      makeTaskEntry("task-1"),
      { type: "message", data: { role: "user", content: "hi" } },
      makeTaskDoneEntry(),
      makeTaskEntry("task-2"),
      makeTaskDoneEntry(),
    ]);
    expect(getCompletedTaskIds(s)).toEqual(
      completedSet("task-1", "task-2"),
    );
  });

  it("unpaired task entries are not considered completed", () => {
    const s = session([
      makeTaskEntry("task-1"),
      makeTaskDoneEntry(),
      makeTaskEntry("task-2"),
      // no task-done for task-2
    ]);
    expect(getCompletedTaskIds(s)).toEqual(completedSet("task-1"));
  });

  it("extra task-done entries without preceding task are ignored", () => {
    const s = session([
      makeTaskDoneEntry(), // no task before this
      makeTaskEntry("task-1"),
      makeTaskDoneEntry(),
    ]);
    expect(getCompletedTaskIds(s)).toEqual(completedSet("task-1"));
  });
});
