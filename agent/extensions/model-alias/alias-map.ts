import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Fixed triad of Model Alias names (v1). */
export const ALIAS_KEYS = ["high", "fast", "cheap"] as const;
export type AliasKey = (typeof ALIAS_KEYS)[number];

/** alias name -> concrete "provider/model-id" */
export type AliasMap = Map<string, string>;

const MAP_FILENAME = "model-alias.json";

/** Agent dir honouring PI_CODING_AGENT_DIR (same expansion as pi-subagents). */
export function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured === "~") return os.homedir();
  if (configured?.startsWith("~/")) return path.join(os.homedir(), configured.slice(2));
  return configured || path.join(os.homedir(), ".pi", "agent");
}

export function aliasMapPath(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, MAP_FILENAME);
}

/**
 * Build an Alias Map from a raw object. Only triad keys with non-empty string
 * targets are kept. Chained aliases (target is another alias key) are skipped.
 */
export function buildAliasMap(raw: Record<string, unknown>): AliasMap {
  const map: AliasMap = new Map();
  const triad = new Set<string>(ALIAS_KEYS);

  for (const key of ALIAS_KEYS) {
    const target = raw?.[key];
    if (typeof target !== "string") continue;
    const trimmed = target.trim();
    if (!trimmed) continue;
    map.set(key, trimmed);
  }

  // No chaining: only a bare target that is itself a triad key is rejected.
  // "provider/fast" is a concrete model id, not an alias chain.
  const chained: string[] = [];
  for (const [alias, target] of map) {
    if (triad.has(target)) {
      chained.push(alias);
      console.warn(
        `[model-alias] alias "${alias}" -> "${target}" targets another alias; skipping.`,
      );
    }
  }
  for (const alias of chained) map.delete(alias);

  return map;
}

/** Read Alias Map from agentDir/model-alias.json. Fail-soft → empty map. */
export function readAliasMap(agentDir: string = getAgentDir()): AliasMap {
  try {
    const raw = fs.readFileSync(aliasMapPath(agentDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return buildAliasMap(parsed as Record<string, unknown>);
  } catch {
    return new Map();
  }
}

/** Write Alias Map as flat triad JSON (only keys present in the map). */
export function writeAliasMap(agentDir: string, map: AliasMap): void {
  const out: Record<string, string> = {};
  for (const key of ALIAS_KEYS) {
    const v = map.get(key);
    if (v) out[key] = v;
  }
  fs.writeFileSync(aliasMapPath(agentDir), JSON.stringify(out, null, 2) + "\n", "utf8");
}

/** Concrete target if `model` is an alias key; otherwise undefined. */
export function resolveAlias(model: string | undefined, aliases: AliasMap): string | undefined {
  if (!model) return undefined;
  return aliases.get(model);
}

/** Split "provider/model-id" into [provider, modelId]. Undefined if not qualified. */
export function splitQualified(target: string): [string, string] | undefined {
  const i = target.indexOf("/");
  if (i <= 0 || i === target.length - 1) return undefined;
  return [target.slice(0, i), target.slice(i + 1)];
}
