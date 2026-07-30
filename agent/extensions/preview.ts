/**
 * /preview - pick one of the agent's complete replies and preview it in neovim.
 *
 * Behavior:
 *   - While the agent is busy (streaming / running tools): notify and do nothing.
 *   - If there is no assistant reply yet: notify and do nothing.
 *   - Otherwise: open a selector listing every complete LLM reply on the
 *     current branch, newest on top. Each reply = all assistant messages
 *     between two role:"user" messages (a full agent run). Pick one -> open
 *     `nvim -R` on a temp .md file containing that reply's text + thinking.
 *
 * Only text and thinking blocks are included. Thinking is rendered with a
 * `> ` quote prefix. Other block types (toolCall / images) are omitted.
 *
 * Pure read-only preview: nothing is written back to the session. The temp
 * file is deleted when nvim exits. User may still `:w!` to another path; only
 * the original temp path is removed.
 *
 * Usage: /preview
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// nvim invocation. Hardcoded "nvim"; resolved via PATH.
// -R  read-only (prevents accidental :w to the original path)
const NVIM_COMMAND = "nvim";
const NVIM_ARGS = ["-R"];

/** Max chars of the reply snippet shown in the selector. */
const SNIPPET_MAX = 50;

/** Minimal entry shape we read from a session branch. */
type BranchEntry = { type?: string; message?: { role?: string; content?: unknown } };

/** Truncate to maxLen chars, appending an ellipsis if cut. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/** Extract text from a content block array. Returns joined markdown. */
function renderAssistantContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block == null || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; thinking?: string };
    if (b.type === "text" && typeof b.text === "string") {
      if (b.text.length > 0) parts.push(b.text);
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      if (b.thinking.length > 0) {
        // blockquote-prefix every line
        parts.push(
          b.thinking
            .split("\n")
            .map((ln) => `> ${ln}`)
            .join("\n"),
        );
      }
    }
    // toolCall / image / other -> omitted
  }
  return parts.join("\n\n");
}

/**
 * Segment the current branch into records. Each record = the assistant
 * messages of one complete agent run, i.e. all assistant messages between two
 * role:"user" messages (or the start/end of the branch). toolResult / custom /
 * bashExecution entries between assistant messages do not split a run.
 * Returns records chronologically (oldest first).
 */
function buildRecords(getBranch: () => BranchEntry[]): BranchEntry[][] {
  const entries = getBranch(); // chronological: root -> leaf
  const records: BranchEntry[][] = [];
  let current: BranchEntry[] = [];
  for (const e of entries) {
    if (e?.type === "message" && e.message?.role === "user") {
      if (current.length > 0) {
        records.push(current);
        current = [];
      }
    } else if (e?.type === "message" && e.message?.role === "assistant") {
      current.push(e);
    }
    // toolResult / custom / bashExecution / etc. -> ignored, do not split
  }
  if (current.length > 0) records.push(current);
  return records;
}

/** First non-empty line of the first non-empty text block in the run. "" if none. */
function openingLineOfRun(record: BranchEntry[]): string {
  for (const e of record) {
    if (e?.type !== "message" || e.message?.role !== "assistant") continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block == null || typeof block !== "object") continue;
      const b = block as { type?: string; text?: string };
      if (b.type === "text" && typeof b.text === "string" && b.text.length > 0) {
        const line = b.text
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 0);
        if (line) return line;
      }
    }
  }
  return "";
}

/** Render a record's body: text + thinking of all its assistant messages, joined by blank lines. */
function renderRecordBody(record: BranchEntry[]): string {
  const blocks: string[] = [];
  for (const e of record) {
    const rendered = renderAssistantContent(e.message?.content);
    if (rendered.length > 0) blocks.push(rendered);
  }
  return blocks.join("\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("preview", {
    description: "Preview a past reply in neovim (read-only)",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("回复尚未结束，请稍后再试", "info");
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("/preview 需要交互式终端", "error");
        return;
      }

      const records = buildRecords(() => ctx.sessionManager.getBranch());
      if (records.length === 0) {
        ctx.ui.notify("尚无可预览的回复", "info");
        return;
      }

      // #1 = oldest ... #N = newest; list newest-first so #N is on top.
      const labels = records.map((rec, i) => {
        const snippet = openingLineOfRun(rec);
        const text = snippet ? truncate(snippet, SNIPPET_MAX) : "(无文本)";
        return `#${i + 1} · ${text}`;
      });
      const ordered = [...labels].reverse();

      const choice = await ctx.ui.select("预览哪条回复：", ordered);
      if (choice === undefined) return; // cancelled

      const idx = labels.indexOf(choice);
      if (idx === -1) return;
      const body = renderRecordBody(records[idx]);
      if (!body.trim()) {
        ctx.ui.notify("该回复无可预览内容", "info");
        return;
      }

      const sessionId = ctx.sessionManager.getSessionId() ?? "session";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = mkdtempSync(join(tmpdir(), "pi-preview-"));
      const file = join(dir, `pi-preview-${sessionId}-${stamp}.md`);
      writeFileSync(file, `${body}\n`, "utf8");

      try {
        await ctx.ui.custom<null>((tui, _theme, _kb, done) => {
          // Release the terminal for nvim.
          tui.stop();
          process.stdout.write("\x1b[2J\x1b[H");

          try {
            const result = spawnSync(NVIM_COMMAND, [...NVIM_ARGS, file], {
              stdio: "inherit",
              env: process.env,
            });
            // ENOENT (nvim not on PATH) appears as result.error.
            const notFound =
              !!result.error &&
              (result.error as NodeJS.ErrnoException).code === "ENOENT";
            if (notFound) done(new nvimNotFound());
            else done(null);
          } catch (err) {
            done(err instanceof Error ? err : new nvimNotFound());
          }

          // Resume the pi TUI in *all* exit paths before done() unwinds.
          tui.start();
          tui.requestRender(true);

          return { render: () => [], invalidate: () => {} };
        });
      } catch (err) {
        if (err instanceof nvimNotFound) {
          ctx.ui.notify("未找到 nvim，请确认已安装并在 PATH 中", "error");
        } else {
          ctx.ui.notify("/preview 打开 nvim 失败", "error");
        }
        return;
      } finally {
        // Best-effort cleanup of the temp file/dir.
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    },
  });

  // Sentinel used to distinguish ENOENT from other errors thrown via done().
  class nvimNotFound extends Error {
    constructor() {
      super("nvim not found");
      this.name = "NvimNotFound";
    }
  }
}
