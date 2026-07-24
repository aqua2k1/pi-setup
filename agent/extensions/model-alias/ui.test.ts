import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAliasMap, readAliasMap } from "./alias-map.js";
import {
  modelPickerOptions,
  parseTopMenuChoice,
  runModelAliasUi,
  topMenuOptions,
  type ModelAliasUi,
} from "./ui.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ma-ui-"));
}

test("topMenuOptions lists each triad alias with current target plus Save", () => {
  const map = buildAliasMap({
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  assert.deepEqual(topMenuOptions(map), [
    "high → deepseek/deepseek-v4-pro",
    "fast → deepseek/deepseek-v4-flash",
    "cheap → opencode/mimo-v2.5-free",
    "Save",
  ]);
});

test("topMenuOptions shows (unbound) when an alias has no target", () => {
  const map = buildAliasMap({ high: "deepseek/deepseek-v4-pro" });
  const opts = topMenuOptions(map);
  assert.equal(opts[0], "high → deepseek/deepseek-v4-pro");
  assert.equal(opts[1], "fast → (unbound)");
  assert.equal(opts[2], "cheap → (unbound)");
  assert.equal(opts[3], "Save");
});

test("parseTopMenuChoice maps row labels to alias keys or save", () => {
  assert.equal(parseTopMenuChoice("high → deepseek/deepseek-v4-pro"), "high");
  assert.equal(parseTopMenuChoice("fast → (unbound)"), "fast");
  assert.equal(parseTopMenuChoice("cheap → opencode/mimo-v2.5-free"), "cheap");
  assert.equal(parseTopMenuChoice("Save"), "save");
  assert.equal(parseTopMenuChoice(undefined), undefined);
  assert.equal(parseTopMenuChoice("nope"), undefined);
});

test("modelPickerOptions lists available concrete models, excluding alias ids", () => {
  const models = [
    { provider: "deepseek", id: "deepseek-v4-pro" },
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "deepseek", id: "high" }, // synthetic alias — exclude
    { provider: "opencode", id: "mimo-v2.5-free" },
  ];
  assert.deepEqual(modelPickerOptions(models, new Set(["high", "fast", "cheap"])), [
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash",
    "opencode/mimo-v2.5-free",
  ]);
});

test("runModelAliasUi: rebind one alias, Save writes map and hot-applies without retarget swap", async () => {
  const dir = tmpDir();
  const initial = buildAliasMap({
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  const available = [
    { provider: "deepseek", id: "deepseek-v4-pro" },
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "opencode", id: "mimo-v2.5-free" },
    { provider: "opencode", id: "other-cheap" },
  ];
  let selectCalls = 0;
  const hotApplies: Array<{ map: Map<string, string> }> = [];
  const ui: ModelAliasUi = {
    select: async (title, options) => {
      selectCalls++;
      if (selectCalls === 1) {
        assert.equal(title, "Model aliases");
        assert.ok(options.some((o) => o.startsWith("cheap →")));
        return options.find((o) => o.startsWith("cheap →"))!;
      }
      if (selectCalls === 2) {
        assert.equal(title, "Bind cheap");
        assert.ok(options.includes("opencode/other-cheap"));
        return "opencode/other-cheap";
      }
      if (selectCalls === 3) {
        // After rebind, top menu should show new target; pick Save
        assert.ok(options.some((o) => o === "cheap → opencode/other-cheap"));
        return "Save";
      }
      return undefined;
    },
    notify: () => {},
  };

  await runModelAliasUi({
    ui,
    agentDir: dir,
    initialMap: initial,
    availableModels: available,
    onHotApply: async (map) => {
      hotApplies.push({ map: new Map(map) });
    },
  });

  const written = readAliasMap(dir);
  assert.equal(written.get("cheap"), "opencode/other-cheap");
  assert.equal(written.get("high"), "deepseek/deepseek-v4-pro");
  assert.equal(hotApplies.length, 1);
  assert.equal(hotApplies[0].map.get("cheap"), "opencode/other-cheap");
});

test("runModelAliasUi: cancel top menu does not write or hot-apply", async () => {
  const dir = tmpDir();
  const initial = buildAliasMap({ high: "deepseek/deepseek-v4-pro" });
  let hot = 0;
  await runModelAliasUi({
    ui: {
      select: async () => undefined,
      notify: () => {},
    },
    agentDir: dir,
    initialMap: initial,
    availableModels: [{ provider: "deepseek", id: "deepseek-v4-pro" }],
    onHotApply: async () => {
      hot++;
    },
  });
  assert.equal(hot, 0);
  assert.equal(fs.existsSync(path.join(dir, "model-alias.json")), false);
});

test("runModelAliasUi: no free-form fourth alias in top menu", async () => {
  const map = buildAliasMap({
    high: "a/b",
    fast: "c/d",
    cheap: "e/f",
  });
  const opts = topMenuOptions(map);
  assert.equal(opts.filter((o) => o !== "Save").length, 3);
  assert.ok(!opts.some((o) => o.startsWith("medium") || o.startsWith("custom")));
});

test("runModelAliasUi: uses selectSearchable for model picker when provided", async () => {
  const dir = tmpDir();
  const initial = buildAliasMap({
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  const available = [
    { provider: "deepseek", id: "deepseek-v4-pro" },
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "opencode", id: "other-cheap" },
  ];
  let selectCalls = 0;
  let searchableCalls = 0;
  const ui: ModelAliasUi = {
    select: async (title, options) => {
      selectCalls++;
      if (selectCalls === 1) {
        assert.equal(title, "Model aliases");
        return options.find((o) => o.startsWith("cheap →"))!;
      }
      // Save after rebind
      return "Save";
    },
    selectSearchable: async (title, options) => {
      searchableCalls++;
      assert.equal(title, "Bind cheap");
      assert.ok(options.includes("opencode/other-cheap"));
      // Full list is passed; UI is responsible for filtering/viewport.
      assert.equal(options.length, 3);
      return "opencode/other-cheap";
    },
    notify: () => {},
  };

  await runModelAliasUi({
    ui,
    agentDir: dir,
    initialMap: initial,
    availableModels: available,
    onHotApply: async () => {},
  });

  assert.equal(searchableCalls, 1);
  assert.equal(readAliasMap(dir).get("cheap"), "opencode/other-cheap");
});
