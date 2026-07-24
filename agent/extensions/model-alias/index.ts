/**
 * Model Alias Extension
 *
 * Resolves fixed triad aliases (high / fast / cheap) to concrete
 * provider/model-id values via synthetic registry injection and session swap.
 * Map file: ~/.pi/agent/model-alias.json
 * Configure: /model-alias (two-level UI + hot-apply re-inject)
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  getAgentDir,
  readAliasMap,
  resolveAlias,
  splitQualified,
  type AliasMap,
} from "./alias-map.js";
import { injectAliases, notify } from "./registry-inject.js";
import { runModelAliasUi } from "./ui.js";

export default function (pi: ExtensionAPI) {
  let aliases: AliasMap = new Map();

  async function swapIfAlias(ctx: ExtensionContext, model: string | undefined): Promise<void> {
    const target = resolveAlias(model, aliases);
    if (!target) return;
    const split = splitQualified(target);
    const concrete: Model<any> | undefined = split
      ? ctx.modelRegistry.find(split[0], split[1])
      : undefined;
    if (!concrete) {
      notify(
        ctx,
        `[model-alias] cannot swap "${model}" -> "${target}" (concrete model not found).`,
        "warning",
      );
      return;
    }
    await pi.setModel(concrete);
  }

  /** Rebuild in-memory map + re-inject only (Q11 — no last-alias retarget). */
  function hotApply(ctx: ExtensionContext, map: AliasMap): void {
    aliases = new Map(map);
    if (aliases.size === 0) return;
    injectAliases(pi, ctx, aliases);
  }

  function loadAndInject(ctx: ExtensionContext): void {
    hotApply(ctx, readAliasMap(getAgentDir()));
  }

  // session_start: load map, inject synthetic models, swap if active id is an alias.
  // No last-alias session memory (Q11) — reload only swaps when ctx.model.id is still an alias.
  pi.on("session_start", async (_event, ctx) => {
    loadAndInject(ctx);
    await swapIfAlias(ctx, ctx.model?.id);
  });

  // model_select: swap alias → concrete (self-terminating; target is never an alias key).
  pi.on("model_select", async (event, ctx) => {
    await swapIfAlias(ctx, event.model?.id);
  });

  // tool_call: rewrite subagent model param; preserve :thinking-style suffix.
  pi.on("tool_call", (event) => {
    if (event.toolName === "subagent" && typeof (event.input as any)?.model === "string") {
      const raw = (event.input as any).model as string;
      const colon = raw.lastIndexOf(":");
      const base = colon > 0 ? raw.slice(0, colon) : raw;
      const suffix = colon > 0 ? raw.slice(colon) : "";
      const target = resolveAlias(base, aliases);
      if (target) (event.input as any).model = target + suffix;
    }
  });

  // before_agent_start: safety net for frontmatter / child startup ordering.
  pi.on("before_agent_start", async (_event, ctx) => {
    await swapIfAlias(ctx, ctx.model?.id);
  });

  pi.registerCommand("model-alias", {
    description: "Configure high/fast/cheap model aliases",
    handler: async (_args, ctx) => {
      const agentDir = getAgentDir();
      // Prefer in-memory map (may already be loaded); fall back to disk.
      const initialMap = aliases.size > 0 ? new Map(aliases) : readAliasMap(agentDir);
      const available =
        ctx.modelRegistry.getAvailable?.() ?? ctx.modelRegistry.getAll();
      const canSearch =
        ctx.mode === "tui" && typeof (ctx.ui as { custom?: unknown }).custom === "function";
      await runModelAliasUi({
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
        agentDir,
        initialMap,
        availableModels: available.map((m) => ({ provider: m.provider, id: m.id })),
        onHotApply: (map) => hotApply(ctx, map),
      });
    },
  });
}
