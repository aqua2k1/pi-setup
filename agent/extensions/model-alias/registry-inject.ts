import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { splitQualified, type AliasMap } from "./alias-map.js";

export function notify(
  ctx: Pick<ExtensionContext, "hasUI" | "ui">,
  message: string,
  type: "info" | "warning" | "error",
) {
  if (ctx.hasUI) {
    ctx.ui.notify(message, type);
    return;
  }
  process.stderr.write(`${message}\n`);
}

export interface InjectResult {
  registered: string[];
  skipped: string[];
}

function toModelConfig(model: any) {
  return {
    id: model.id,
    name: model.name,
    api: model.api,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    headers: model.headers,
    compat: model.compat,
    // Required so deepseek/xAI/etc keep their native thinking levels after re-registration.
    // Without this, getSupportedThinkingLevels falls back to generic off/minimal/low/medium/high
    // (no max), and model switches keep grok-style levels.
    thinkingLevelMap: model.thinkingLevelMap,
  };
}

/**
 * Register each alias as a synthetic model cloned from its concrete target,
 * grouped by provider, idempotently. Unresolvable targets warn and are skipped.
 */
export function injectAliases(
  pi: Pick<ExtensionAPI, "registerProvider">,
  ctx: Pick<ExtensionContext, "hasUI" | "ui" | "modelRegistry">,
  aliases: AliasMap,
): InjectResult {
  const registered: string[] = [];
  const skipped: string[] = [];
  const aliasNames = new Set(aliases.keys());
  const all = ctx.modelRegistry.getAll();

  const byProvider = new Map<string, Array<{ alias: string; model: any }>>();
  for (const [alias, target] of aliases) {
    const split = splitQualified(target);
    const model = split
      ? all.find((m) => m.provider === split[0] && m.id === split[1])
      : undefined;
    if (!model) {
      notify(
        ctx,
        `[model-alias] alias "${alias}" -> "${target}" not found in registry; skipping.`,
        "warning",
      );
      skipped.push(alias);
      continue;
    }
    const list = byProvider.get(model.provider) ?? [];
    list.push({ alias, model });
    byProvider.set(model.provider, list);
  }

  for (const [provider, entries] of byProvider) {
    const existing = all.filter((m) => m.provider === provider && !aliasNames.has(m.id));
    const aliasModels = entries.map((e) => ({
      ...toModelConfig(e.model),
      id: e.alias,
      name: `${e.model.name ?? e.model.id} (alias: ${e.alias})`,
    }));
    const baseUrl = entries[0].model.baseUrl ?? existing[0]?.baseUrl;
    pi.registerProvider(provider, {
      baseUrl,
      apiKey: "model-alias-placeholder",
      models: [...existing.map(toModelConfig), ...aliasModels],
    } as any);
    for (const e of entries) registered.push(e.alias);
  }

  return { registered, skipped };
}
