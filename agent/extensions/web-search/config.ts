import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { errorMessageForCode, WebSearchError } from "./core/errors.ts";
import {
  WEB_SEARCH_PROVIDER_NAMES,
  type WebSearchProviderName,
} from "./core/types.ts";
import { CODEX_DEFAULT_MODEL } from "./providers/codex/config.ts";
import { SEARXNG_DEFAULT_URL } from "./providers/searxng/config.ts";
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
  MAX_MAX_RESULTS,
  MAX_SEARCH_TIMEOUT_MS,
  MIN_MAX_RESULTS,
  MIN_SEARCH_TIMEOUT_MS,
} from "./shared/limits.ts";
import { isRecord } from "./shared/results.ts";

export const WEB_SEARCH_CONFIG_FILE = "web-search-config.json";

export interface WebSearchRouteConfig {
  provider?: string;
  fallback?: boolean;
  fallbackProvider?: string;
}

export interface WebSearchFileConfig {
  routing?: WebSearchRouteConfig;
  timeoutMs?: number;
  maxResults?: number;
  codex?: { model?: string };
}

export interface ResolvedWebSearchConfig {
  provider: WebSearchProviderName;
  fallback: boolean;
  fallbackProvider?: WebSearchProviderName;
  timeoutMs: number;
  maxResults: number;
  searxngUrl: string;
  searxngApiKey?: string;
  codexModel: string;
}

const INVALID_CONFIG = errorMessageForCode("invalid-config");
type FieldKind = "string" | "boolean" | "number";

function invalid(message: string): never {
  throw new WebSearchError("invalid-config", message);
}

function invalidField(field: string): never {
  return invalid(`${INVALID_CONFIG} ${field} has an invalid type.`);
}

function readField<T>(
  record: Record<string, unknown>,
  field: string,
  kind: FieldKind,
): T | undefined {
  if (!Object.hasOwn(record, field)) return undefined;
  const value = record[field];
  if (typeof value !== kind || (kind === "number" && !Number.isFinite(value))) {
    invalidField(field);
  }
  return value as T;
}

export function parseConfig(text: string): WebSearchFileConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    return invalid("Web search configuration is not valid JSON.");
  }
  if (!isRecord(raw))
    return invalid("Web search configuration must be an object.");
  if (Object.hasOwn(raw, "provider") || Object.hasOwn(raw, "fallback")) {
    invalid("Routing settings must be nested under the routing object.");
  }

  const config: WebSearchFileConfig = {};
  const timeoutMs = readField<number>(raw, "timeoutMs", "number");
  const maxResults = readField<number>(raw, "maxResults", "number");
  if (timeoutMs !== undefined) config.timeoutMs = timeoutMs;
  if (maxResults !== undefined) config.maxResults = maxResults;

  if (Object.hasOwn(raw, "routing")) {
    if (!isRecord(raw.routing)) invalidField("routing");
    const source = raw.routing;
    const provider = readField<string>(source, "provider", "string");
    const fallback = readField<boolean>(source, "fallback", "boolean");
    const fallbackProvider = readField<string>(
      source,
      "fallbackProvider",
      "string",
    );
    config.routing = {
      ...(provider !== undefined ? { provider } : {}),
      ...(fallback !== undefined ? { fallback } : {}),
      ...(fallbackProvider !== undefined ? { fallbackProvider } : {}),
    };
  }

  if (Object.hasOwn(raw, "searxng")) {
    if (!isRecord(raw.searxng)) invalidField("searxng");
    const source = raw.searxng;
    if (Object.hasOwn(source, "url") || Object.hasOwn(source, "apiKey")) {
      invalid(
        "SearXNG URL and API key must be configured through SEARXNG_URL and SEARXNG_API_KEY.",
      );
    }
  }

  if (Object.hasOwn(raw, "codex")) {
    if (!isRecord(raw.codex)) invalidField("codex");
    const model = readField<string>(raw.codex, "model", "string");
    config.codex = model === undefined ? {} : { model };
  }
  return config;
}

export function getConfigPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, WEB_SEARCH_CONFIG_FILE);
}

export async function readConfig(
  path: string = getConfigPath(),
): Promise<WebSearchFileConfig> {
  try {
    return parseConfig(await readFile(path, "utf8"));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }
    if (error instanceof WebSearchError) throw error;
    return invalid("Web search configuration could not be read.");
  }
}

function parseInteger(
  value: number | string,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return invalid(
      `${INVALID_CONFIG} ${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

function stringValue(
  value: string | undefined,
  field: string,
): string | undefined {
  if (value !== undefined && typeof value !== "string") invalidField(field);
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function normalizeProviderName(
  value: string | undefined,
): WebSearchProviderName | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  const candidate = normalized === "codex" ? "codex-alpha-search" : normalized;
  return (WEB_SEARCH_PROVIDER_NAMES as readonly string[]).includes(candidate)
    ? (candidate as WebSearchProviderName)
    : undefined;
}

export function resolveConfig(
  config: WebSearchFileConfig = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedWebSearchConfig {
  if (config.routing !== undefined && !isRecord(config.routing)) {
    invalidField("routing");
  }
  const routing = (config.routing ?? {}) as WebSearchRouteConfig;
  if (routing.fallback !== undefined && typeof routing.fallback !== "boolean") {
    invalidField("routing.fallback");
  }
  const configuredProvider = stringValue(routing.provider, "routing.provider");
  const provider = configuredProvider
    ? normalizeProviderName(configuredProvider)
    : "searxng";
  if (!provider)
    return invalid(
      `${INVALID_CONFIG} routing.provider must be searxng or codex-alpha-search.`,
    );

  const configuredFallbackProvider = stringValue(
    routing.fallbackProvider,
    "routing.fallbackProvider",
  );
  const fallbackProvider = configuredFallbackProvider
    ? normalizeProviderName(configuredFallbackProvider)
    : undefined;
  if (configuredFallbackProvider && !fallbackProvider) {
    return invalid(
      `${INVALID_CONFIG} routing.fallbackProvider must be searxng or codex-alpha-search.`,
    );
  }
  if (fallbackProvider === provider) {
    return invalid(
      `${INVALID_CONFIG} routing.fallbackProvider must differ from routing.provider.`,
    );
  }

  const fallback = routing.fallback ?? false;
  const timeoutMs = parseInteger(
    config.timeoutMs ?? DEFAULT_SEARCH_TIMEOUT_MS,
    "timeoutMs",
    MIN_SEARCH_TIMEOUT_MS,
    MAX_SEARCH_TIMEOUT_MS,
  );
  const maxResults = parseInteger(
    config.maxResults ?? DEFAULT_MAX_RESULTS,
    "maxResults",
    MIN_MAX_RESULTS,
    MAX_MAX_RESULTS,
  );

  // URL and credentials are process-level secrets/configuration. They are never
  // read from web-search-config.json.
  const searxngUrl =
    stringValue(env.SEARXNG_URL, "SEARXNG_URL") ?? SEARXNG_DEFAULT_URL;
  const searxngApiKey = stringValue(env.SEARXNG_API_KEY, "SEARXNG_API_KEY");
  const codexModel =
    stringValue(config.codex?.model, "codex.model") ?? CODEX_DEFAULT_MODEL;

  return {
    provider,
    fallback,
    ...(fallbackProvider ? { fallbackProvider } : {}),
    timeoutMs,
    maxResults,
    searxngUrl,
    ...(searxngApiKey ? { searxngApiKey } : {}),
    codexModel,
  };
}
