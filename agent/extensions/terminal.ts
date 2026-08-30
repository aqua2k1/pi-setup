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
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

export interface RunTerminalAppOptions {
  /** Arguments passed directly to the executable. */
  args?: readonly string[];
  /** Clear the terminal after suspending pi and before starting the app. */
  clearScreen?: boolean;
}

/** Structured outcome; callers own user-facing notification policy. */
export type TerminalAppResult =
  | { kind: "unavailable" }
  | { kind: "not-found"; error: Error }
  | { kind: "launch-error"; error: Error }
  | {
      kind: "exited";
      status: number | null;
      signal: NodeJS.Signals | null;
    };

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isNotFound(error: Error): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * Suspend pi's TUI, run an interactive terminal app with inherited stdio,
 * and always restore the TUI afterward. This is the shared launch primitive
 * for extensions that need to hand full terminal control to another process.
 */
export async function runTerminalApp(
  ctx: ExtensionContext,
  command: string,
  options: RunTerminalAppOptions = {},
): Promise<TerminalAppResult> {
  if (ctx.mode !== "tui") return { kind: "unavailable" };

  try {
    return await ctx.ui.custom<TerminalAppResult>(
      (tui, _theme, _keybindings, done) => {
        let result: TerminalAppResult;
        try {
          tui.stop();
          if (options.clearScreen) process.stdout.write("\x1b[2J\x1b[H");

          const child = spawnSync(command, [...(options.args ?? [])], {
            stdio: "inherit",
            cwd: ctx.cwd,
            env: process.env,
          });

          if (child.error) {
            const error = asError(child.error);
            result = {
              kind: isNotFound(error) ? "not-found" : "launch-error",
              error,
            };
          } else {
            result = {
              kind: "exited",
              status: child.status,
              signal: child.signal,
            };
          }
        } catch (error) {
          const launchError = asError(error);
          result = {
            kind: isNotFound(launchError) ? "not-found" : "launch-error",
            error: launchError,
          };
        } finally {
          try {
            tui.start();
            tui.requestRender(true);
          } catch (error) {
            result = { kind: "launch-error", error: asError(error) };
          }
        }

        done(result);
        return { render: () => [], invalidate: () => {} };
      },
    );
  } catch (error) {
    return { kind: "launch-error", error: asError(error) };
  }
}

async function runSuspended(
  ctx: ExtensionContext,
  command: string,
  args: readonly string[] = [],
): Promise<void> {
  const result = await runTerminalApp(ctx, command, { args });

  switch (result.kind) {
    case "unavailable":
      ctx.ui.notify(`${command} requires an interactive terminal`, "warning");
      break;
    case "not-found":
      ctx.ui.notify(
        `${command} not found - please install it and ensure it's on PATH`,
        "error",
      );
      break;
    case "launch-error":
      ctx.ui.notify(
        `Failed to launch ${command}: ${result.error.message}`,
        "error",
      );
      break;
    case "exited":
      if (result.status === 0) {
        ctx.ui.notify(`${command} exited successfully`, "info");
      } else if (result.signal) {
        ctx.ui.notify(
          `${command} exited due to signal ${result.signal}`,
          "warning",
        );
      } else {
        ctx.ui.notify(
          `${command} exited with code ${result.status ?? "unknown"}`,
          "warning",
        );
      }
      break;
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
