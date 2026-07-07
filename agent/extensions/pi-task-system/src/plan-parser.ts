import { type Plan, validatePlan } from "./plan-schema.js";

/**
 * Extract and validate a Plan from markdown containing a ```json code block.
 *
 * Searches for the first ```json code block, parses it as JSON,
 * and validates it as a Plan via validatePlan. Throws descriptive
 * errors with contextual information on failure.
 *
 * Error conditions:
 *  - No ```json block found
 *  - JSON syntax error (includes line number)
 *  - Validation failure (includes field path — from validatePlan)
 *  - Dependency cycle (includes cycle path — from validatePlan/detectCycle)
 */
export function extractPlan(markdown: string): Plan {
  const blockMatch = /```json\s*\n([\s\S]*?)\n\s*```/.exec(markdown);

  if (!blockMatch) {
    throw new Error(
      "No JSON code block found in markdown. Expected a ```json block containing the plan configuration.",
    );
  }

  const jsonText = blockMatch[1];

  // Compute the 1-based line number of the JSON text within the markdown
  const blockOffset = blockMatch.index + blockMatch[0].indexOf(jsonText);
  const jsonStartLine = markdown.slice(0, blockOffset).split("\n").length;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const errMsg = (e as Error).message;
    const posMatch = /position (\d+)/.exec(errMsg);
    const charPos = posMatch ? parseInt(posMatch[1], 10) : 0;
    const jsonLineOffset = jsonText.slice(0, charPos).split("\n").length;
    throw new Error(
      `JSON parse error at markdown line ${jsonStartLine + jsonLineOffset - 1}: ${errMsg}`,
    );
  }

  try {
    return validatePlan(parsed);
  } catch (e) {
    throw new Error(`Plan validation failed: ${(e as Error).message}`);
  }
}

/**
 * Generate a complete plan.md document from a Plan object.
 *
 * Produces markdown with a human-readable task list followed by
 * a ```json block containing the full plan configuration (machine-readable).
 * The output mirrors the format expected by extractPlan for round-trip
 * compatibility.
 */
export function planToMarkdown(plan: Plan): string {
  const lines: string[] = [];

  lines.push(`# Plan: ${plan.goal}`);
  lines.push("");

  if (plan.created) {
    lines.push(`> Created: ${plan.created}`);
    lines.push("");
  }

  lines.push("## Tasks");
  lines.push("");

  for (const task of plan.tasks) {
    const depSuffix =
      task.dependencies.length > 0
        ? ` (depends: ${task.dependencies.join(", ")})`
        : "";

    lines.push(`- [ ] ### ${task.id}: ${task.title}${depSuffix}`);
    lines.push("");
    lines.push(`**Description:** ${task.description}`);
    lines.push("");

    if (task.verification) {
      lines.push(`**Verification:** ${task.verification}`);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push("");
  lines.push("## Task Config");
  lines.push("");
  lines.push("```json");
  lines.push(JSON.stringify(plan, null, 2));
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}
