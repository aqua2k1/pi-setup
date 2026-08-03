import {
  supportedThinkingLevels,
  type ConfigMap,
  type SubagentConfig,
  writeConfigMap,
} from "./config.js";

const SAVE_LABEL = "Save";
const UNBOUND = "(unbound)";
const INHERIT_LABEL = "(inherit)";

/** Narrow UI surface used by /subagent-model. */
export interface SubagentModelUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  /**
   * Searchable model picker (type-to-filter, short visible window).
   * Falls back to select() when not provided (tests / non-TUI).
   */
  selectSearchable?(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

/** Top-level menu: one row per enabled agent with current pin, then Save. */
export function topMenuOptions(agentNames: string[], map: ConfigMap): string[] {
  const rows = agentNames.map((name) => {
    const config = map.get(name.toLowerCase());
    if (!config) return `${name} → ${UNBOUND}`;
    return config.thinking
      ? `${name} → ${config.model} (thinking: ${config.thinking})`
      : `${name} → ${config.model}`;
  });
  return [...rows, SAVE_LABEL];
}

/** Parse a top-menu row into the agent name it represents, or "save". */
export function parseTopMenuChoice(choice: string | undefined): string | "save" | undefined {
  if (!choice) return undefined;
  if (choice === SAVE_LABEL) return "save";
  const arrow = choice.indexOf(" → ");
  if (arrow <= 0) return undefined;
  return choice.slice(0, arrow);
}

/** Model picker labels: provider/id for concrete models only. */
export function modelPickerOptions(models: Array<{ provider: string; id: string }>): string[] {
  return models.map((m) => `${m.provider}/${m.id}`);
}

export interface RunSubagentModelUiOptions {
  ui: SubagentModelUi;
  agentDir: string;
  /** Working copy of the map; mutated when the user rebinds an agent. */
  initialMap: ConfigMap;
  /** Enabled agent type names (discovered by the caller). */
  agentNames: string[];
  /** Concrete models; reasoning/thinkingLevelMap drive the thinking picker options. */
  availableModels: Array<{
    provider: string;
    id: string;
    reasoning?: boolean;
    thinkingLevelMap?: Partial<Record<string, unknown>> | null;
  }>;
  /** Called after successful write — the new map is authoritative for tool_call. */
  onSaved: (map: ConfigMap) => void | Promise<void>;
}

/**
 * /subagent-model loop: top menu (agent rows + Save) → model picker → thinking
 * picker → back to top; Save writes the config file and invokes onSaved.
 */
export async function runSubagentModelUi(opts: RunSubagentModelUiOptions): Promise<void> {
  const draft: ConfigMap = new Map(opts.initialMap);
  const pickModel =
    opts.ui.selectSearchable?.bind(opts.ui) ?? opts.ui.select.bind(opts.ui);

  while (true) {
    const choice = await opts.ui.select(
      "Subagent models",
      topMenuOptions(opts.agentNames, draft),
    );
    const parsed = parseTopMenuChoice(choice);
    if (!parsed) return;

    if (parsed === "save") {
      // Warn about pins that the model cannot actually serve (e.g. hand-edited
      // JSON): the session will clamp them to the nearest supported level.
      const unsupported: string[] = [];
      for (const [name, config] of draft) {
        if (!config.thinking) continue;
        const model = opts.availableModels.find((m) => `${m.provider}/${m.id}` === config.model);
        if (!model) continue;
        if (!supportedThinkingLevels(model).includes(config.thinking)) {
          unsupported.push(`${name}: ${config.thinking}`);
        }
      }
      if (unsupported.length > 0) {
        opts.ui.notify(
          `[subagent-model] thinking not supported by model (will clamp to nearest): ${unsupported.join(", ")}`,
          "warning",
        );
      }
      writeConfigMap(opts.agentDir, draft);
      await opts.onSaved(draft);
      opts.ui.notify("Subagent models saved.", "info");
      return;
    }

    const models = modelPickerOptions(opts.availableModels);
    if (models.length === 0) {
      opts.ui.notify("No available models to bind.", "warning");
      continue;
    }
    const picked = await pickModel(`Bind ${parsed}`, models);
    if (!picked) continue;
    // Only offer levels the picked model actually supports; (inherit) clears the pin.
    const model = opts.availableModels.find((m) => `${m.provider}/${m.id}` === picked);
    const levels = supportedThinkingLevels(model ?? {});
    const level = await opts.ui.select(`Thinking for ${parsed}`, [INHERIT_LABEL, ...levels]);
    if (!level) continue; // cancel level → abort this rebind, keep previous binding

    const config: SubagentConfig = { model: picked };
    // The picker only offered supported levels, so the chosen one is always valid.
    if (level !== INHERIT_LABEL) config.thinking = level;
    draft.set(parsed.toLowerCase(), config);
  }
}
