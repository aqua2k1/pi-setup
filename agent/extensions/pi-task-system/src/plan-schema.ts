/**
 * Schema definitions for plan/task data structures.
 *
 * Plan JSON structure (embedded as a ```json code block in plan.md):
 *   { goal, created?, tasks: [{ id, title, description, verification?, dependencies }] }
 *
 * Task id format: task-N (e.g., task-1, task-2)
 */

/** Regex matching valid task ids: task-1, task-2, task-42, etc. */
export const TASK_ID_PATTERN = /^task-\d+$/;

/** A single task in a plan. */
export interface Task {
  id: string;
  title: string;
  description: string;
  verification?: string;
  dependencies: string[];
}

/** The JSON structure inside plan.md. */
export interface Plan {
  goal: string;
  created?: string;
  tasks: Task[];
}

/** Top-level plan file representation (same JSON structure as Plan). */
export type PlanFile = Plan;

// ── helpers ────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ── validation ─────────────────────────────────────────────────────

/**
 * Validate an unknown value as a Plan.
 *
 * Returns the typed Plan on success, throws with a message containing the
 * specific field path on failure (e.g., "plan.tasks[2].dependencies[0] must
 * match pattern task-N").
 */
export function validatePlan(plan: unknown): Plan {
  if (!isRecord(plan)) {
    throw new Error("plan must be an object");
  }

  // goal
  if (typeof plan.goal !== "string" || plan.goal.trim().length === 0) {
    throw new Error("plan.goal must be a non-empty string");
  }

  // created (optional)
  if (plan.created !== undefined && typeof plan.created !== "string") {
    throw new Error("plan.created must be a string (ISO date) if provided");
  }

  // tasks
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    throw new Error("plan.tasks must be a non-empty array");
  }

  const taskIds = new Set<string>();
  const tasks: Task[] = [];

  for (let i = 0; i < plan.tasks.length; i++) {
    const t = plan.tasks[i];
    const prefix = `plan.tasks[${i}]`;

    if (!isRecord(t)) {
      throw new Error(`${prefix} must be an object`);
    }

    // id
    if (typeof t.id !== "string" || !TASK_ID_PATTERN.test(t.id)) {
      throw new Error(`${prefix}.id must match pattern task-N (e.g., task-1), got: ${JSON.stringify(t.id)}`);
    }
    if (taskIds.has(t.id)) {
      throw new Error(`${prefix}.id "${t.id}" is duplicated`);
    }
    taskIds.add(t.id);

    // title
    if (typeof t.title !== "string" || t.title.trim().length === 0) {
      throw new Error(`${prefix}.title must be a non-empty string`);
    }

    // description
    if (typeof t.description !== "string") {
      throw new Error(`${prefix}.description must be a string`);
    }

    // verification (optional)
    if (t.verification !== undefined && typeof t.verification !== "string") {
      throw new Error(`${prefix}.verification must be a string if provided`);
    }

    // dependencies
    if (!Array.isArray(t.dependencies)) {
      throw new Error(`${prefix}.dependencies must be an array`);
    }
    for (let j = 0; j < t.dependencies.length; j++) {
      const dep = t.dependencies[j];
      if (typeof dep !== "string" || !TASK_ID_PATTERN.test(dep)) {
        throw new Error(`${prefix}.dependencies[${j}] must match pattern task-N, got: ${JSON.stringify(dep)}`);
      }
    }

    tasks.push({
      id: t.id,
      title: t.title,
      description: t.description,
      verification: t.verification,
      dependencies: t.dependencies as string[],
    });
  }

  // cross-check: every dependency must reference an existing task id
  for (const task of tasks) {
    for (let j = 0; j < task.dependencies.length; j++) {
      const dep = task.dependencies[j];
      if (!taskIds.has(dep)) {
        throw new Error(`task "${task.id}" depends on "${dep}" which does not exist in plan.tasks`);
      }
    }
  }

  // cycle detection
  const cycle = detectCycle(tasks);
  if (cycle !== null) {
    throw new Error(`plan.tasks has a dependency cycle: ${cycle.join(" → ")}`);
  }

  return {
    goal: plan.goal as string,
    created: plan.created as string | undefined,
    tasks,
  };
}

// ── cycle detection ────────────────────────────────────────────────

const Color = {
  WHITE: 0,
  GRAY: 1,
  BLACK: 2,
} as const;

/**
 * Detect a dependency cycle among tasks.
 *
 * Uses depth-first search with color marking. Returns the cycle as an array
 * of task ids (starting and ending with the same id) if a cycle is found, or
 * null if the dependency graph is acyclic.
 *
 * Tasks whose dependencies reference non-existent ids are ignored here (the
 * caller should validate that separately via validatePlan).
 */
export function detectCycle(tasks: Task[]): string[] | null {
  const taskMap = new Map<string, Task>();
  for (const task of tasks) {
    taskMap.set(task.id, task);
  }

  const color = new Map<string, Color>();
  const parent = new Map<string, string | null>();

  for (const task of tasks) {
    color.set(task.id, Color.WHITE);
    parent.set(task.id, null);
  }

  function dfs(nodeId: string): string[] | null {
    color.set(nodeId, Color.GRAY);

    const task = taskMap.get(nodeId);
    // Should never happen since we iterate known tasks, but guard defensively
    if (!task) return null;

    for (const depId of task.dependencies) {
      // Skip dependencies not in the task set (external references).
      // validatePlan already checks these, so this is just defensive.
      if (!color.has(depId)) continue;

      const depColor = color.get(depId)!;

      if (depColor === Color.GRAY) {
        // Back-edge found — reconstruct the cycle path
        const cycle: string[] = [depId];
        let current = nodeId;
        while (current !== depId) {
          cycle.push(current);
          current = parent.get(current)!;
        }
        cycle.push(depId); // close the cycle
        return cycle;
      }

      if (depColor === Color.WHITE) {
        parent.set(depId, nodeId);
        const result = dfs(depId);
        if (result !== null) return result;
      }
    }

    color.set(nodeId, Color.BLACK);
    return null;
  }

  for (const task of tasks) {
    if (color.get(task.id) === Color.WHITE) {
      const result = dfs(task.id);
      if (result !== null) return result;
    }
  }

  return null;
}
