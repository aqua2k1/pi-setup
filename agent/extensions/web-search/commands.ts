import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { searchWeb } from "./composition.ts";
import {
  getConfigPath,
  normalizeProviderName,
  type ResolvedWebSearchConfig,
  readConfig,
  resolveConfig,
  type WebSearchFileConfig,
} from "./config.ts";
import { errorMessageForCode, toWebSearchError } from "./core/errors.ts";
import type { WebSearchProviderName } from "./core/types.ts";

const PROVIDER_LABELS: Record<WebSearchProviderName, string> = {
  searxng: "SearXNG",
  "codex-alpha-search": "Codex alpha/search",
};
const COMMAND_ARGUMENTS = [
  "status",
  "test searxng",
  "test codex-alpha-search",
  "test codex",
];
const DEFAULT_SEARCH_QUERY = "pi web search connectivity";

type ConfigSource = "env" | "config" | "default" | "none";

export interface WebSearchCommandDependencies {
  readConfig?: typeof readConfig;
  search?: typeof searchWeb;
  env?: NodeJS.ProcessEnv;
}

function commandErrorText(error: unknown): string {
  const classified = toWebSearchError(error);
  return `${errorMessageForCode(classified.code)} [${classified.code}]`;
}

function source(
  envValue: string | undefined,
  configValue: string | undefined,
  hasDefault: boolean,
): ConfigSource {
  if (envValue?.trim()) return "env";
  if (configValue?.trim()) return "config";
  return hasDefault ? "default" : "none";
}

function statusText(
  raw: WebSearchFileConfig,
  ctx: ExtensionCommandContext,
  env: NodeJS.ProcessEnv,
): string {
  const config = resolveConfig(raw, env);
  const fallbackSource =
    raw.routing?.fallback === undefined ? "default" : "config";
  const fallbackProvider =
    config.fallbackProvider ??
    (config.provider === "searxng" ? "codex-alpha-search" : "searxng");
  const fallbackProviderSource =
    raw.routing?.fallbackProvider === undefined ? "default" : "config";
  const keySource = source(env.SEARXNG_API_KEY, undefined, false);
  let auth = "unavailable";
  try {
    auth = ctx.modelRegistry.getProviderAuthStatus("openai-codex").configured
      ? "configured (OAuth required)"
      : "not configured";
  } catch {
    // Keep status useful when the host registry is unavailable.
  }
  return [
    "Web search configuration:",
    `  provider: ${PROVIDER_LABELS[config.provider]} (${source(undefined, raw.routing?.provider, true)})`,
    `  fallback: ${config.fallback ? "enabled" : "disabled"} (${fallbackSource})`,
    `  fallback provider: ${PROVIDER_LABELS[fallbackProvider]} (${fallbackProviderSource})`,
    `  timeout: ${config.timeoutMs} ms (config/default)`,
    `  default max results: ${config.maxResults} (config/default)`,
    `  SearXNG URL: configured (${source(env.SEARXNG_URL, undefined, true)})`,
    `  SearXNG Bearer key: ${keySource === "none" ? "not set" : `set (${keySource})`}`,
    `  Codex model: configured (${source(undefined, raw.codex?.model, true)})`,
    `  Codex authentication: ${auth}`,
    "",
    "SearXNG URL and credentials are read from environment variables; routing and other settings are read from web-search-config.json.",
    "Fallback is disabled by default; enabling it may send a query to ChatGPT.",
  ].join("\n");
}

async function testProvider(
  ctx: ExtensionCommandContext,
  provider: WebSearchProviderName,
  deps: Required<WebSearchCommandDependencies>,
): Promise<void> {
  const base = resolveConfig(await deps.readConfig(getConfigPath()), deps.env);
  const config: ResolvedWebSearchConfig = {
    ...base,
    provider,
    fallback: false,
  };
  const response = await deps.search(
    { query: DEFAULT_SEARCH_QUERY, maxResults: 1 },
    config,
    { modelRegistry: ctx.modelRegistry },
    ctx.signal,
  );
  const count = response.results.length;
  ctx.ui.notify(
    `${PROVIDER_LABELS[response.provider]} test succeeded (${count} result${count === 1 ? "" : "s"}).`,
    "info",
  );
}

export function registerWebSearchCommand(
  pi: ExtensionAPI,
  provided: WebSearchCommandDependencies = {},
): void {
  const deps: Required<WebSearchCommandDependencies> = {
    readConfig: provided.readConfig ?? readConfig,
    search: provided.search ?? searchWeb,
    env: provided.env ?? process.env,
  };
  pi.registerCommand("web-search", {
    description: "Inspect or test the web_search provider.",
    getArgumentCompletions: (prefix) => {
      const values = COMMAND_ARGUMENTS.filter((value) =>
        value.startsWith(prefix.trimStart()),
      );
      return values.length
        ? values.map((value) => ({ value, label: value }))
        : null;
    },
    handler: async (args, ctx) => {
      try {
        const [command, providerValue] = args.trim().split(/\s+/, 2);
        if (command === "status") {
          ctx.ui.notify(
            statusText(await deps.readConfig(getConfigPath()), ctx, deps.env),
            "info",
          );
        } else if (command === "test") {
          const provider = normalizeProviderName(providerValue);
          if (!provider) {
            ctx.ui.notify(
              "Choose a provider: searxng or codex-alpha-search.",
              "error",
            );
            return;
          }
          await testProvider(ctx, provider, deps);
        } else {
          ctx.ui.notify(
            "/web-search status\n/web-search test <searxng|codex-alpha-search|codex>",
            "info",
          );
        }
      } catch (error) {
        ctx.ui.notify(commandErrorText(error), "error");
      }
    },
  });
}
