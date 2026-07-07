import type { Task, Plan } from "./plan-schema.js";

// ── types (self-contained, no runtime deps on pi-coding-agent) ────

/** Minimal entry shape needed for getCompletedTaskIds. */
interface SessionEntryLike {
  type: string;
  customType?: string;
  data?: Record<string, unknown>;
}

/**
 * Minimal read-only session interface needed by queue functions.
 * Compatible with both ReadonlySessionManager and SessionManager at runtime.
 */
export interface ReadonlySessionLike {
  getLeafId(): string | null;
  getBranch(): SessionEntryLike[];
}

// ── helpers (inlined from index.ts to keep queue.ts self-contained) ─

const TASK_ENTRY_TYPE = "task";
const TASK_DONE_ENTRY_TYPE = "task-done";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTaskData(value: unknown): value is { prompt: string; planTaskId?: string } {
  return isRecord(value) && typeof value.prompt === "string";
}

function isTaskEntry(
  entry: SessionEntryLike,
): entry is SessionEntryLike & { customType: "task"; data: { prompt: string; planTaskId?: string } } {
  return (
    entry.type === "custom" &&
    entry.customType === TASK_ENTRY_TYPE &&
    !!entry.data &&
    isTaskData(entry.data)
  );
}

// ── public API ─────────────────────────────────────────────────────

/**
 * Find the first uncompleted task whose dependencies are all satisfied.
 *
 * Traverses tasks in array order. A task is eligible when:
 * - It is NOT in completedIds
 * - All ids listed in its `dependencies` array are in completedIds
 *
 * Returns null if all tasks are completed (or if tasks is empty).
 */
export function findNextReadyTask(
  tasks: Task[],
  completedIds: Set<string>,
): Task | null {
  for (const task of tasks) {
    if (completedIds.has(task.id)) continue;
    if (task.dependencies.every((dep) => completedIds.has(dep))) {
      return task;
    }
  }
  return null;
}

/**
 * Scan the current session branch for all completed task entries with a planTaskId.
 *
 * A task is considered "completed" when a TASK_ENTRY_TYPE ("task") entry is followed
 * (possibly after other entries) by a TASK_DONE_ENTRY_TYPE ("task-done") entry on the
 * same branch. Task entries are paired LIFO with task-done entries.
 *
 * Only tasks with a non-undefined planTaskId are included in the returned set.
 */
export function getCompletedTaskIds(session: ReadonlySessionLike): Set<string> {
  const branch = session.getBranch();
  const completed = new Set<string>();
  const pending: SessionEntryLike[] = [];

  for (const entry of branch) {
    if (isTaskEntry(entry)) {
      pending.push(entry);
    } else if (
      entry.type === "custom" &&
      entry.customType === TASK_DONE_ENTRY_TYPE
    ) {
      const taskEntry = pending.pop();
      if (
        taskEntry?.data &&
        typeof taskEntry.data.planTaskId === "string"
      ) {
        completed.add(taskEntry.data.planTaskId);
      }
    }
  }

  return completed;
}

/**
 * Check whether the plan has any unfinished tasks.
 *
 * Returns true if at least one task in `plan.tasks` is NOT in completedIds.
 */
export function planHasPendingTasks(
  plan: Plan,
  completedIds: Set<string>,
): boolean {
  return plan.tasks.some((task) => !completedIds.has(task.id));
}
