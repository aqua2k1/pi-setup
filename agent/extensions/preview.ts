/**
 * /preview — open neovim to preview the agent's most recent reply turn.
 *
 * Behavior:
 *   - While the agent is busy (streaming / running tools): notify and do nothing.
 *   - If there is no assistant reply yet: notify and do nothing.
 *   - Otherwise: open `nvim -R` on a temp .md file containing the latest turn.
 *
 * The "latest turn" = all assistant messages after the most recent real
 * `role:"user"` message on the current branch, up to the current leaf.
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
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// nvim invocation. Hardcoded "nvim"; resolved via PATH.
// -R  read-only (prevents accidental :w to the original path)
const NVIM_COMMAND = "nvim";
const NVIM_ARGS = ["-R"];

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

/** Build the preview body for the current branch, or "" if nothing to show. */
function buildPreviewBody(getBranch: () => Array<{ type?: string; message?: any }>): string {
  const entries = getBranch(); // chronological: root -> leaf

  // Find the index of the last real user message.
  let lastUserIdx = -1;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.type === "message" && e.message?.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  // Slice assistant messages after the last user turn.
  const start = lastUserIdx + 1;
  const assistantMessages = entries
    .slice(start)
    .filter((e) => e?.type === "message" && e.message?.role === "assistant");

  const blocks: string[] = [];
  for (const e of assistantMessages) {
    const rendered = renderAssistantContent(e.message?.content);
    if (rendered.length > 0) blocks.push(rendered);
    // pure-toolCall assistant messages contribute nothing; silently skipped
  }
  return blocks.join("\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("preview", {
    description: "Preview the agent's latest reply in neovim (read-only)",
    handler: async (_args, ctx) => {
      if (!ctx.isIdle()) {
        ctx.ui.notify("回复尚未结束，请稍后再试", "info");
        return;
      }

      const body = buildPreviewBody(() => ctx.sessionManager.getBranch());
      if (!body.trim()) {
        ctx.ui.notify("尚无可预览的回复", "info");
        return;
      }

      if (ctx.mode !== "tui") {
        ctx.ui.notify("/preview 需要交互式终端", "error");
        return;
      }

      const sessionId = ctx.sessionManager.getSessionId() ?? "session";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = mkdtempSync(join(tmpdir(), "pi-preview-"));
      const file = join(dir, `pi-preview-${sessionId}-${stamp}.md`);
      writeFileSync(file, body + "\n", "utf8");

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