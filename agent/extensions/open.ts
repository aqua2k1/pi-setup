/**
 * Open Extension
 *
 * Opens files, URLs, and directories with the system's default application.
 *
 * /open — user command
 * open  — LLM-callable tool
 */

import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ── Platform detection ────────────────────────────────────────────────

const platform = process.platform; // "linux" | "darwin" | "win32"

let isWsl = false;
if (platform === "linux") {
  try {
    const procVersion = readFileSync("/proc/version", "utf-8");
    isWsl = /microsoft|WSL|microsoft/i.test(procVersion);
  } catch {
    // not WSL
  }
}

const hasWslpath = (() => {
  try { execSync("which wslpath", { stdio: "ignore" }); return true; } catch { return false; }
})();
const hasCmdExe = (() => {
  try { execSync("which cmd.exe", { stdio: "ignore" }); return true; } catch { return false; }
})();

const wslFallbackAvailable = isWsl && hasWslpath && hasCmdExe;

// ── Helpers ────────────────────────────────────────────────────────────

function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

function toWindowsPath(linuxPath: string): string {
  return execSync(`wslpath -w "${linuxPath}"`, { encoding: "utf-8" }).trim();
}

/** Resolve input to an absolute path (URLs pass through unchanged). */
function resolveTarget(raw: string, cwd: string): string {
  const trimmed = raw.trim().replace(/^@+/, "");
  if (isUrl(trimmed)) return trimmed;
  if (trimmed.startsWith("~")) return trimmed.replace(/^~/, homedir());
  if (trimmed.startsWith("/")) return trimmed;
  return resolve(cwd, trimmed);
}

/** Open the target. Returns { ok, message }. */
function doOpen(target: string): { ok: boolean; message: string } {
  try {
    let cmd: string;
    let args: string[];

    if (platform === "darwin") {
      // macOS
      cmd = "open";
      args = [target];
    } else if (platform === "win32") {
      // Windows native
      cmd = "cmd";
      args = ["/c", "start", "", target];
    } else {
      // Linux — try xdg-open first
      const proc = spawn("xdg-open", [target], {
        detached: true,
        stdio: "ignore",
      });
      proc.unref();

      // If xdg-open failed and we're in WSL, fallback to cmd.exe
      if (wslFallbackAvailable) {
        let fallbackFired = false;
        const tryFallback = () => {
          if (fallbackFired) return;
          fallbackFired = true;
          const winPath = target.startsWith("/") ? toWindowsPath(target) : target;
          const fallback = spawn("cmd.exe", ["/c", "start", "", winPath], {
            detached: true,
            stdio: "ignore",
          });
          fallback.unref();
        };
        proc.on("exit", (code) => {
          if (code !== 0) tryFallback();
        });
        proc.on("error", () => tryFallback());
        return { ok: true, message: `Opening with xdg-open (fallback: Windows)` };
      }

      return { ok: true, message: `Opened with xdg-open` };
    }

    // macOS / Windows native — synchronous path
    const proc = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    proc.unref();
    return { ok: true, message: `Opened with ${cmd}` };
  } catch (err: any) {
    return { ok: false, message: `Failed to open: ${err.message}` };
  }
}

// ── Extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Shared implementation
  function openTarget(args: string | undefined, cwd: string): { ok: boolean; message: string } {
    if (!args?.trim()) {
      return { ok: false, message: "Usage: /open <file|url|directory>" };
    }

    const target = resolveTarget(args, cwd);

    if (!isUrl(target) && !existsSync(target)) {
      return { ok: false, message: `File not found: ${target}` };
    }

    return doOpen(target);
  }

  // ── Command ──
  pi.registerCommand("open", {
    description: "Open a file, URL, or directory with the default application",
    handler: async (args, ctx) => {
      const result = openTarget(args, ctx.cwd);
      ctx.ui.notify(result.message, result.ok ? "info" : "warning");
    },
  });

  // ── Tool ──
  pi.registerTool({
    name: "open",
    label: "Open",
    description:
      "Open a file, URL, or directory with the system's default application. Use this to open HTML files in a browser, PDFs in a reader, directories in a file manager, etc.",
    parameters: Type.Object({
      target: Type.String({
        description: "The file path, URL, or directory to open",
      }),
    }),
    async execute(_toolCallId, params) {
      const result = openTarget(params.target, process.cwd());
      return {
        content: [{ type: "text", text: result.message }],
        details: {},
      };
    },
  });
}
