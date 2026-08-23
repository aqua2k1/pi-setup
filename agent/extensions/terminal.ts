/**
 * Terminal Extension
 *
 * Suspends the pi TUI to run a terminal app (nvim, lazygit, yazi), then
 * restores it when the app exits.
 *
 * Commands:
 *   /vim [file] - open nvim (optionally with a file path)
 *   /lg         - open lazygit in the current directory
 *   /fm         - open yazi in the current directory
 */

import { spawnSync } from "node:child_process";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";

/** Result of running a suspended terminal app. */
interface RunResult {
  status: number | null;
  notFound: boolean;
}

/**
 * Suspend the TUI, run a terminal app with inherited stdio, then restore
 * the TUI. Requires interactive TUI mode (stdio: inherit needs a real TTY).
 */
async function runSuspended(
  ctx: ExtensionCommandContext,
  cmd: string,
  args: string[] = [],
): Promise<void> {
  if (ctx.mode !== "tui") {
    ctx.ui.notify(`${cmd} requires an interactive terminal`, "warning");
    return;
  }

  const result = await ctx.ui.custom<RunResult>((tui, _theme, _kb, done) => {
    // Stop pi's TUI to release the terminal
    tui.stop();

    // Run the app with full terminal access
    const r = spawnSync(cmd, args, {
      stdio: "inherit",
      cwd: ctx.cwd,
      env: process.env,
    });

    // Restart pi's TUI
    tui.start();
    tui.requestRender(true);

    done({
      status: r.status,
      notFound:
        !!r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT",
    });

    return { render: () => [], invalidate: () => {} };
  });

  if (result.notFound) {
    ctx.ui.notify(
      `${cmd} not found - please install it and ensure it's on PATH`,
      "error",
    );
  } else if (result.status === 0) {
    ctx.ui.notify(`${cmd} exited successfully`, "info");
  } else {
    ctx.ui.notify(`${cmd} exited with code ${result.status}`, "warning");
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("vim", {
    description: "Open nvim (optionally with a file path)",
    handler: async (args, ctx) => {
      // Strip leading @ (leftover from file completion trigger) and trim
      const file = args?.trim().replace(/^@+/, "") || "";
      await runSuspended(ctx, "nvim", file ? [file] : []);
    },
  });

  pi.registerCommand("lg", {
    description: "Open lazygit in the current directory",
    handler: async (_args, ctx) => {
      await runSuspended(ctx, "lazygit");
    },
  });

  pi.registerCommand("fm", {
    description: "Open yazi in the current directory",
    handler: async (_args, ctx) => {
      await runSuspended(ctx, "yazi");
    },
  });
}
