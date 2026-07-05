/**
 * /context-preview — open neovim to preview the most recent provider request payload.
 *
 * Behavior:
 *   - /context-preview start  — start caching payloads from before_provider_request
 *   - /context-preview stop     — stop caching (keeps last cached payload viewable)
 *   - /context-preview status  — show enabled/disabled state
 *   - /context-preview         — open nvim -R on a temp .json file with cached payload (or empty)
 *
 * The payload is the raw HTTP request body object from before_provider_request.
 * Pure read-only preview: nothing is written back to the session. The temp file
 * is deleted when nvim exits.
 *
 * Usage: /context-preview [start|stop|status]
 */

import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const NVIM_COMMAND = "nvim";
const NVIM_ARGS = ["-R"];

export default function (pi: ExtensionAPI) {
  let enabled = false;
  let lastPayload: unknown = null;

  pi.on("session_start", async (_event, _ctx) => {
    enabled = false;
    lastPayload = null;
  });

  pi.on("before_provider_request", (event, _ctx) => {
    if (enabled) {
      lastPayload = event.payload;
    }
  });

  pi.registerCommand("context-preview", {
    description: "Preview the provider request payload in neovim (read-only)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/context-preview 需要交互式终端", "error");
        return;
      }

      const sub = args?.trim();

      if (sub === "start") {
        enabled = true;
        ctx.ui.notify("context-preview 已启用", "info");
        return;
      }

      if (sub === "stop") {
        enabled = false;
        ctx.ui.notify("context-preview 已禁用（已缓存内容保留）", "info");
        return;
      }

      if (sub === "status") {
        ctx.ui.notify(
          `context-preview: ${enabled ? "已启用" : "已禁用"}`,
          "info",
        );
        return;
      }

      // No subcommand — open nvim with cached payload (or empty content)
      const body =
        lastPayload != null ? JSON.stringify(lastPayload, null, 2) : "";

      const sessionId = ctx.sessionManager.getSessionId() ?? "session";
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = mkdtempSync(join(tmpdir(), "pi-context-preview-"));
      const file = join(dir, `pi-context-preview-${sessionId}-${stamp}.json`);
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
            if (notFound) done(new NvimNotFound());
            else done(null);
          } catch (err) {
            done(err instanceof Error ? err : new NvimNotFound());
          }

          // Resume the pi TUI in *all* exit paths before done() unwinds.
          tui.start();
          tui.requestRender(true);

          return { render: () => [], invalidate: () => {} };
        });
      } catch (err) {
        if (err instanceof NvimNotFound) {
          ctx.ui.notify("未找到 nvim，请确认已安装并在 PATH 中", "error");
        } else {
          ctx.ui.notify("/context-preview 打开 nvim 失败", "error");
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
  class NvimNotFound extends Error {
    constructor() {
      super("nvim not found");
      this.name = "NvimNotFound";
    }
  }
}
