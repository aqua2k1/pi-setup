/**
 * Subagent Model Extension
 *
 * Pins per-subagent model (+ optional thinking level), overriding what the
 * agent's frontmatter would otherwise inherit. Config file:
 * ~/.pi/agent/subagent-model.json — { "<agent>": { "model": "provider/model-id", "thinking": "max" } }
 *
 * Injection happens on subagent tool calls: pi-subagents' agent tool accepts
 * `model` and `thinking` parameters and resolves them in-process against the
 * parent registry. The extension is intentionally read-only on the main
 * session — no synthetic models, no model swapping.
 * Configure: /subagent-model (agent → model → thinking, hot re-read)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getAgentDir,
  readConfigMap,
  listEnabledAgents,
  type ConfigMap,
} from "./config.js";
import { runSubagentModelUi } from "./ui.js";

export default function (pi: ExtensionAPI) {
  // Load at factory time so /reload (which re-runs factories) re-reads the
  // config file — otherwise tool_call injection silently uses an empty map.
  let config: ConfigMap = readConfigMap(getAgentDir());

  function reloadConfig(): void {
    config = readConfigMap(getAgentDir());
  }

  // tool_call: inject pinned model/thinking for the subagent type being spawned.
  // Unconfigured agents are left untouched (frontmatter/inheritance fallback).
  pi.on("tool_call", (event) => {
    if (event.toolName !== "subagent") return;
    const input = event.input as { subagent_type?: unknown; model?: unknown; thinking?: unknown } | null;
    if (!input || typeof input.subagent_type !== "string") return;
    const pinned = config.get(input.subagent_type.toLowerCase());
    if (!pinned) return;
    if (pinned.model) input.model = pinned.model;
    if (pinned.thinking) input.thinking = pinned.thinking;
  });

  pi.registerCommand("subagent-model", {
    description: "Pin model/thinking per subagent",
    handler: async (_args, ctx) => {
      reloadConfig();
      const agentNames = listEnabledAgents(getAgentDir(), ctx.cwd);
      const available =
        ctx.modelRegistry.getAvailable?.() ?? ctx.modelRegistry.getAll();
      const canSearch =
        ctx.mode === "tui" && typeof (ctx.ui as { custom?: unknown }).custom === "function";
      await runSubagentModelUi({
        ui: {
          select: (title, options) => ctx.ui.select(title, options),
          // Searchable picker only in TUI (custom component); RPC/print fall back to select.
          selectSearchable: canSearch
            ? async (title, options) => {
                const { showSearchableSelect } = await import("./searchable-select.js");
                return showSearchableSelect(ctx.ui, title, options);
              }
            : undefined,
          notify: (message, level) => ctx.ui.notify(message, level),
        },
        agentDir: getAgentDir(),
        initialMap: new Map(config),
        agentNames,
        availableModels: available.map((m) => ({
          provider: m.provider,
          id: m.id,
          reasoning: m.reasoning,
          thinkingLevelMap: m.thinkingLevelMap,
        })),
        onSaved: (map) => {
          config = map;
        },
      });
    },
  });
}
