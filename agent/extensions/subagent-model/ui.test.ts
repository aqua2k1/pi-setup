import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildConfigMap, readConfigMap } from "./config.js";
import {
  modelPickerOptions,
  parseTopMenuChoice,
  runSubagentModelUi,
  topMenuOptions,
  type SubagentModelUi,
} from "./ui.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sm-ui-"));
}

test("topMenuOptions lists each enabled agent with current pin plus Save", () => {
  const map = buildConfigMap({
    Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" },
    commit: { model: "opencode-go/deepseek-v4-pro" },
  });
  assert.deepEqual(topMenuOptions(["Explore", "commit"], map), [
    "Explore → opencode-go/deepseek-v4-flash (thinking: max)",
    "commit → opencode-go/deepseek-v4-pro",
    "Save",
  ]);
});

test("topMenuOptions shows (unbound) for agents without a pin", () => {
  const map = buildConfigMap({ Explore: { model: "p/a" } });
  assert.deepEqual(topMenuOptions(["Explore", "Plan"], map), [
    "Explore → p/a",
    "Plan → (unbound)",
    "Save",
  ]);
});

test("parseTopMenuChoice maps rows to agent names or save", () => {
  assert.equal(parseTopMenuChoice("Explore → p/a (thinking: max)"), "Explore");
  assert.equal(parseTopMenuChoice("commit → (unbound)"), "commit");
  assert.equal(parseTopMenuChoice("Save"), "save");
  assert.equal(parseTopMenuChoice(undefined), undefined);
  assert.equal(parseTopMenuChoice("nope"), undefined);
});

test("modelPickerOptions lists concrete models", () => {
  assert.deepEqual(
    modelPickerOptions([
      { provider: "deepseek", id: "deepseek-v4-pro" },
      { provider: "opencode-go", id: "deepseek-v4-flash" },
    ]),
    ["deepseek/deepseek-v4-pro", "opencode-go/deepseek-v4-flash"],
  );
});

test("runSubagentModelUi: rebind one agent, Save writes config and calls onSaved", async () => {
  const dir = tmpDir();
  const initial = buildConfigMap({ Explore: { model: "opencode-go/deepseek-v4-pro" } });
  const available = [
    { provider: "opencode-go", id: "deepseek-v4-flash", reasoning: true },
    { provider: "opencode-go", id: "deepseek-v4-pro", reasoning: true },
  ];
  let selectCalls = 0;
  let saved: Map<string, { model: string; thinking?: string }> | undefined;
  const ui: SubagentModelUi = {
    select: async (title, options) => {
      selectCalls++;
      if (selectCalls === 1) {
        assert.equal(title, "Subagent models");
        assert.ok(options.some((o) => o.startsWith("Explore →")));
        return options.find((o) => o.startsWith("Explore →"))!;
      }
      if (selectCalls === 2) {
        assert.equal(title, "Bind Explore");
        assert.ok(options.includes("opencode-go/deepseek-v4-flash"));
        return "opencode-go/deepseek-v4-flash";
      }
      if (selectCalls === 3) {
        // reasoning model without map: off..high (no xhigh/max)
        assert.equal(title, "Thinking for Explore");
        assert.ok(options.includes("(inherit)"));
        assert.ok(options.includes("high"));
        assert.ok(!options.includes("max"));
        return "high";
      }
      if (selectCalls === 4) {
        assert.ok(options.some((o) => o === "Explore → opencode-go/deepseek-v4-flash (thinking: high)"));
        return "Save";
      }
      return undefined;
    },
    notify: () => {},
  };

  await runSubagentModelUi({
    ui,
    agentDir: dir,
    initialMap: initial,
    agentNames: ["Explore", "commit"],
    availableModels: available,
    onSaved: async (map) => {
      saved = map;
    },
  });

  const written = readConfigMap(dir);
  assert.deepEqual(written.get("explore"), {
    model: "opencode-go/deepseek-v4-flash",
    thinking: "high",
  });
  assert.deepEqual(saved?.get("explore"), {
    model: "opencode-go/deepseek-v4-flash",
    thinking: "high",
  });
});

test("runSubagentModelUi: (inherit) clears a previous pin", async () => {
  const dir = tmpDir();
  const initial = buildConfigMap({
    Explore: { model: "opencode-go/deepseek-v4-pro", thinking: "max" },
  });
  let selectCalls = 0;
  const ui: SubagentModelUi = {
    select: async (_title, options) => {
      selectCalls++;
      if (selectCalls === 1) return options.find((o) => o.startsWith("Explore →"))!;
      if (selectCalls === 2) return "opencode-go/deepseek-v4-pro";
      if (selectCalls === 3) return "(inherit)";
      return "Save";
    },
    notify: () => {},
  };

  await runSubagentModelUi({
    ui,
    agentDir: dir,
    initialMap: initial,
    agentNames: ["Explore"],
    availableModels: [{ provider: "opencode-go", id: "deepseek-v4-pro" }],
    onSaved: async () => {},
  });

  const written = readConfigMap(dir);
  assert.deepEqual(written.get("explore"), { model: "opencode-go/deepseek-v4-pro" });
});

test("runSubagentModelUi: warns about hand-edited pins the model cannot support", async () => {
  const dir = tmpDir();
  const initial = buildConfigMap({
    Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "low" }, // unsupported (map has low: null)
    commit: { model: "opencode-go/deepseek-v4-flash", thinking: "high" }, // supported
  });
  const notices: Array<{ message: string; level: string }> = [];
  const ui: SubagentModelUi = {
    select: async (_title, options) => {
      const save = options.find((o) => o === "Save");
      return save ?? undefined;
    },
    notify: (message, level) => notices.push({ message, level }),
  };

  await runSubagentModelUi({
    ui,
    agentDir: dir,
    initialMap: initial,
    agentNames: ["Explore", "commit"],
    availableModels: [
      { provider: "opencode-go", id: "deepseek-v4-flash", reasoning: true, thinkingLevelMap: { low: null, high: "high", max: "max" } },
    ],
    onSaved: async () => {},
  });

  const warning = notices.find((n) => n.level === "warning");
  assert.ok(warning, "expected a warning");
  assert.ok(warning!.message.includes("explore") && warning!.message.includes("low"));
  assert.ok(!warning!.message.includes("commit"), "supported pin must not be flagged");
});

test("runSubagentModelUi: no warning when all pins are supported", async () => {
  const dir = tmpDir();
  const initial = buildConfigMap({
    Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" },
  });
  const notices: Array<{ message: string; level: string }> = [];
  await runSubagentModelUi({
    ui: {
      select: async (_title, options) => options.find((o) => o === "Save"),
      notify: (message, level) => notices.push({ message, level }),
    },
    agentDir: dir,
    initialMap: initial,
    agentNames: ["Explore"],
    availableModels: [
      { provider: "opencode-go", id: "deepseek-v4-flash", reasoning: true, thinkingLevelMap: { high: "high", max: "max" } },
    ],
    onSaved: async () => {},
  });
  assert.ok(!notices.some((n) => n.level === "warning"));
});

test("runSubagentModelUi: cancel top menu does not write", async () => {
  const dir = tmpDir();
  let saved = 0;
  await runSubagentModelUi({
    ui: { select: async () => undefined, notify: () => {} },
    agentDir: dir,
    initialMap: new Map(),
    agentNames: ["Explore"],
    availableModels: [{ provider: "p", id: "a" }],
    onSaved: async () => {
      saved++;
    },
  });
  assert.equal(saved, 0);
  assert.equal(fs.existsSync(path.join(dir, "subagent-model.json")), false);
});

test("runSubagentModelUi: cancel thinking picker aborts rebind", async () => {
  const dir = tmpDir();
  const initial = buildConfigMap({ Explore: { model: "p/a" } });
  let selectCalls = 0;
  await runSubagentModelUi({
    ui: {
      select: async (_title, options) => {
        selectCalls++;
        if (selectCalls === 1) return options.find((o) => o.startsWith("Explore →"))!;
        if (selectCalls === 2) return "p/b";
        return undefined; // thinking picker cancelled
      },
      notify: () => {},
    },
    agentDir: dir,
    initialMap: initial,
    agentNames: ["Explore"],
    availableModels: [
      { provider: "p", id: "a" },
      { provider: "p", id: "b" },
    ],
    onSaved: async () => {},
  });
  assert.equal(readConfigMap(dir).size, 0); // nothing written
});
