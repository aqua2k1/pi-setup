import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAliasMap } from "./alias-map.js";
import { injectAliases } from "./registry-inject.js";

function makeCtx(models: Array<{ provider: string; id: string; name?: string; baseUrl?: string }>) {
  return {
    hasUI: false as const,
    ui: { notify() {} } as any,
    modelRegistry: { getAll: () => models, find: () => undefined } as any,
  };
}

function makePi() {
  const calls: Array<{ provider: string; config: any }> = [];
  return {
    pi: { registerProvider: (provider: string, config: any) => calls.push({ provider, config }) },
    calls,
  };
}

test("registers one provider call per provider with alias entries", () => {
  const ctx = makeCtx([
    { provider: "deepseek", id: "deepseek-v4-flash", baseUrl: "https://a", name: "Flash" },
    { provider: "opencode", id: "mimo-v2.5-free", baseUrl: "https://o", name: "Mimo" },
  ]);
  const { pi, calls } = makePi();
  const aliases = buildAliasMap({
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
    high: "deepseek/missing-pro",
  });
  const res = injectAliases(pi, ctx, aliases);

  assert.deepEqual(res.skipped, ["high"]);
  assert.deepEqual(res.registered.sort(), ["cheap", "fast"]);
  assert.equal(calls.length, 2);

  const deepseek = calls.find((c) => c.provider === "deepseek")!;
  assert.equal(deepseek.config.baseUrl, "https://a");
  assert.ok(deepseek.config.models.some((m: any) => m.id === "fast"));
  assert.ok(deepseek.config.models.some((m: any) => m.id === "deepseek-v4-flash"));

  const opencode = calls.find((c) => c.provider === "opencode")!;
  assert.ok(opencode.config.models.some((m: any) => m.id === "cheap"));
});

test("invalid alias is skipped with no provider call", () => {
  const ctx = makeCtx([{ provider: "deepseek", id: "deepseek-v4-flash" }]);
  const { pi, calls } = makePi();
  const res = injectAliases(pi, ctx, buildAliasMap({ high: "nope/missing" }));
  assert.deepEqual(res.skipped, ["high"]);
  assert.deepEqual(res.registered, []);
  assert.equal(calls.length, 0);
});

test("idempotent: existing alias entries are not duplicated", () => {
  const ctx = makeCtx([
    { provider: "deepseek", id: "deepseek-v4-flash" },
    { provider: "deepseek", id: "fast" },
  ]);
  const { pi, calls } = makePi();
  injectAliases(pi, ctx, buildAliasMap({ fast: "deepseek/deepseek-v4-flash" }));
  const models = calls[0].config.models as any[];
  assert.equal(models.filter((m) => m.id === "fast").length, 1);
});

test("preserves thinkingLevelMap when re-registering concrete and alias models", () => {
  const thinkingLevelMap = {
    minimal: null,
    low: null,
    medium: null,
    high: "high",
    max: "max",
  };
  const ctx = makeCtx([
    {
      provider: "deepseek",
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      baseUrl: "https://api.deepseek.com",
      thinkingLevelMap,
      compat: { thinkingFormat: "deepseek" },
    } as any,
  ]);
  const { pi, calls } = makePi();
  injectAliases(pi, ctx, buildAliasMap({ high: "deepseek/deepseek-v4-pro" }));

  const models = calls[0].config.models as any[];
  const concrete = models.find((m) => m.id === "deepseek-v4-pro");
  const alias = models.find((m) => m.id === "high");

  assert.deepEqual(concrete?.thinkingLevelMap, thinkingLevelMap);
  assert.deepEqual(alias?.thinkingLevelMap, thinkingLevelMap);
  assert.deepEqual(alias?.compat, { thinkingFormat: "deepseek" });
});
