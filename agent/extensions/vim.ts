/**
 * Vim Extension
 *
 * Opens nvim via the /vim command. Suspends the pi TUI while nvim runs,
 * then restores it when nvim exits.
 *
 * Usage: /vim [file]
 */

import { spawnSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vim", {
    description: "Open nvim (optionally with a file path)",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/vim requires an interactive terminal", "warning");
        return;
      }

      // Strip leading @ (leftover from file completion trigger) and trim
      const file = args?.trim().replace(/^@+/, "") || "";
      const nvimArgs = file ? [file] : [];

      try {
        const exitCode = await ctx.ui.custom<number>((tui, _theme, _kb, done) => {
          // Stop pi's TUI to release the terminal
          tui.stop();

          // Run nvim with full terminal access
          const result = spawnSync("nvim", nvimArgs, {
            stdio: "inherit",
            cwd: ctx.cwd,
            env: process.env,
          });

          // Restart pi's TUI
          tui.start();
          tui.requestRender(true);

          // Check for ENOENT (nvim not on PATH)
          const notFound =
            !!result.error &&
            (result.error as NodeJS.ErrnoException).code === "ENOENT";
          if (notFound) {
            done(new NvimNotFound());
          } else {
            done(result.status ?? 0);
          }

          return { render: () => [], invalidate: () => {} };
        });

        if (exitCode === 0) {
          ctx.ui.notify("nvim exited successfully", "info");
        } else {
          ctx.ui.notify(`nvim exited with code ${exitCode}`, "warning");
        }
      } catch (err) {
        if (err instanceof NvimNotFound) {
          ctx.ui.notify("nvim not found — please install it and ensure it's on PATH", "error");
        } else {
          ctx.ui.notify("failed to launch nvim", "error");
        }
      }
    },
  });

  /** Sentinel to distinguish ENOENT from other errors thrown via done(). */
  class NvimNotFound extends Error {
    constructor() {
      super("nvim not found");
      this.name = "NvimNotFound";
    }
  }
}
