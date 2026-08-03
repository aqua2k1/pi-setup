/**
 * subagent-model configuration: per-subagent model + thinking pins.
 *
 * Config file: <agentDir>/subagent-model.json
 *   { "Explore": { "model": "opencode-go/deepseek-v4-flash", "thinking": "max" } }
 *
 * Agent discovery mirrors @gotgenes/pi-subagents' custom-agents.ts:
 *   - 3 built-in agents (general-purpose, Explore, Plan)
 *   - global  <agentDir>/agents/*.md
 *   - project <cwd>/.pi/agents/*.md  (overrides global on name clash)
 *   - frontmatter `enabled: false` hides an agent
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Pi thinking levels a pin can use (mirrors VALID_THINKING_LEVELS). */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** Built-in agents shipped by pi-subagents (always enabled, name only). */
const BUILTIN_AGENT_NAMES = ["general-purpose", "Explore", "Plan"] as const;

const CONFIG_FILENAME = "subagent-model.json";

/** Per-agent pin. `model` must be a concrete "provider/model-id". */
export interface SubagentConfig {
  model: string;
  thinking?: string;
}

/** lowercased agent type name -> config */
export type ConfigMap = Map<string, SubagentConfig>;

/** Agent dir honouring PI_CODING_AGENT_DIR (same expansion as pi-subagents). */
export function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR;
  if (configured === "~") return os.homedir();
  if (configured?.startsWith("~/")) return path.join(os.homedir(), configured.slice(2));
  return configured || path.join(os.homedir(), ".pi", "agent");
}

export function configPath(agentDir: string = getAgentDir()): string {
  return path.join(agentDir, CONFIG_FILENAME);
}

/** Split "provider/model-id" into [provider, modelId]. Undefined if not qualified. */
export function splitQualified(target: string): [string, string] | undefined {
  const i = target.indexOf("/");
  if (i <= 0 || i === target.length - 1) return undefined;
  return [target.slice(0, i), target.slice(i + 1)];
}

/** Parse config file raw object. Invalid entries are skipped. */
export function buildConfigMap(raw: Record<string, unknown>): ConfigMap {
  const map: ConfigMap = new Map();
  const validLevels = new Set<string>(THINKING_LEVELS);
  for (const [name, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;
    const { model, thinking } = entry as { model?: unknown; thinking?: unknown };
    if (typeof model !== "string" || !splitQualified(model.trim())) continue;
    const config: SubagentConfig = { model: model.trim() };
    if (typeof thinking === "string" && validLevels.has(thinking)) config.thinking = thinking;
    map.set(name.trim().toLowerCase(), config);
  }
  return map;
}

/** Read config from disk. Fail-soft → empty map. */
export function readConfigMap(agentDir: string = getAgentDir()): ConfigMap {
  try {
    const raw = fs.readFileSync(configPath(agentDir), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    return buildConfigMap(parsed as Record<string, unknown>);
  } catch {
    return new Map();
  }
}

/** Write config as flat JSON: agent name -> { model, thinking? }. */
export function writeConfigMap(agentDir: string, map: ConfigMap): void {
  const out: Record<string, { model: string; thinking?: string }> = {};
  for (const [name, config] of map) {
    out[name] = config.thinking ? { ...config } : { model: config.model };
  }
  fs.writeFileSync(configPath(agentDir), JSON.stringify(out, null, 2) + "\n", "utf8");
}

/** Agent names discovered from built-ins + global + project dirs (enabled only). */
export function listEnabledAgents(agentDir: string, cwd: string): string[] {
  const names = new Map<string, string>(); // name -> canonical case
  const disabled = new Set<string>(); // enabled: false anywhere (project can re-enable)
  const addDir = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      return;
    }
    for (const file of files) {
      const name = path.basename(file, ".md");
      let enabled: boolean;
      try {
        enabled = isAgentEnabled(fs.readFileSync(path.join(dir, file), "utf8"));
      } catch {
        continue;
      }
      const key = name.toLowerCase();
      if (!enabled) {
        disabled.add(key);
        names.delete(key); // a higher-priority dir may re-enable later
        continue;
      }
      names.set(key, name);
      disabled.delete(key);
    }
  };
  addDir(path.join(agentDir, "agents")); // global, lower priority
  addDir(path.join(cwd, ".pi", "agents")); // project, higher priority
  // Built-ins join unless a same-named file disabled them (or already re-enabled).
  for (const name of BUILTIN_AGENT_NAMES) {
    const key = name.toLowerCase();
    if (!disabled.has(key) && !names.has(key)) names.set(key, name);
  }
  return [...names.values()];
}

/** frontmatter `enabled: false` disables an agent (default enabled). */
function isAgentEnabled(content: string): boolean {
  const fm = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  const line = fm.match(/^enabled:\s*(true|false)\s*$/m);
  return line ? line[1] === "true" : true;
}

/**
 * Available thinking levels for a model, mirroring pi's getSupportedThinkingLevels:
 * no reasoning → only "off"; xhigh/max require an explicit thinkingLevelMap entry;
 * a null entry hides a level.
 */
export function supportedThinkingLevels(model: {
  reasoning?: boolean;
  thinkingLevelMap?: Partial<Record<string, unknown>> | null;
}): string[] {
  if (!model.reasoning) return ["off"];
  return THINKING_LEVELS.filter((level) => {
    const mapped = model.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}
