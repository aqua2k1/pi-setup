import { ALIAS_KEYS, type AliasKey, type AliasMap, writeAliasMap } from "./alias-map.js";

const SAVE_LABEL = "Save";
const UNBOUND = "(unbound)";
const ALIAS_IDS: Set<string> = new Set(ALIAS_KEYS);

/** Narrow UI surface used by /model-alias. */
export interface ModelAliasUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  /**
   * Searchable model picker (type-to-filter, short visible window).
   * Falls back to select() when not provided (tests / non-TUI).
   */
  selectSearchable?(title: string, options: string[]): Promise<string | undefined>;
  notify(message: string, level: "info" | "warning" | "error"): void;
}

/** Top-level menu: one row per alias with current target, then Save. */
export function topMenuOptions(map: AliasMap): string[] {
  const rows = ALIAS_KEYS.map((key) => {
    const target = map.get(key) ?? UNBOUND;
    return `${key} → ${target}`;
  });
  return [...rows, SAVE_LABEL];
}

/** Parse a top-menu selection into an alias key, "save", or undefined (cancel/unknown). */
export function parseTopMenuChoice(choice: string | undefined): AliasKey | "save" | undefined {
  if (!choice) return undefined;
  if (choice === SAVE_LABEL) return "save";
  for (const key of ALIAS_KEYS) {
    if (choice.startsWith(`${key} → `) || choice === key) return key;
  }
  return undefined;
}

/** Model picker labels: provider/id for concrete models only (skip synthetic alias ids). */
export function modelPickerOptions(
  models: Array<{ provider: string; id: string }>,
  aliasIds: Set<string> = ALIAS_IDS,
): string[] {
  return models
    .filter((m) => !aliasIds.has(m.id))
    .map((m) => `${m.provider}/${m.id}`);
}

export interface RunModelAliasUiOptions {
  ui: ModelAliasUi;
  agentDir: string;
  /** Working copy of the map; mutated when user rebinds an alias. */
  initialMap: AliasMap;
  availableModels: Array<{ provider: string; id: string }>;
  /** Called after successful write — re-inject only (no last-alias retarget). */
  onHotApply: (map: AliasMap) => void | Promise<void>;
}

/**
 * Two-level /model-alias loop:
 * top menu (alias rows + Save) → searchable model picker for one alias → back to top;
 * Save writes the map and invokes onHotApply.
 */
export async function runModelAliasUi(opts: RunModelAliasUiOptions): Promise<void> {
  const draft: AliasMap = new Map(opts.initialMap);
  const pickModel =
    opts.ui.selectSearchable?.bind(opts.ui) ?? opts.ui.select.bind(opts.ui);

  while (true) {
    const choice = await opts.ui.select("Model aliases", topMenuOptions(draft));
    const parsed = parseTopMenuChoice(choice);
    if (!parsed) return;

    if (parsed === "save") {
      writeAliasMap(opts.agentDir, draft);
      await opts.onHotApply(draft);
      opts.ui.notify("Model aliases saved.", "info");
      return;
    }

    const models = modelPickerOptions(opts.availableModels);
    if (models.length === 0) {
      opts.ui.notify("No available models to bind.", "warning");
      continue;
    }
    const picked = await pickModel(`Bind ${parsed}`, models);
    if (!picked) continue;
    draft.set(parsed, picked);
  }
}

export { SAVE_LABEL };
