import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  ALIAS_KEYS,
  buildAliasMap,
  readAliasMap,
  resolveAlias,
  splitQualified,
  writeAliasMap,
} from "./alias-map.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "model-alias-"));
}

test("ALIAS_KEYS is the fixed triad high, fast, cheap", () => {
  assert.deepEqual([...ALIAS_KEYS], ["high", "fast", "cheap"]);
});

test("readAliasMap: missing file -> empty map", () => {
  const map = readAliasMap(path.join(tmpDir(), "missing"));
  assert.equal(map.size, 0);
});

test("readAliasMap: malformed JSON -> empty map", () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "model-alias.json"), "{not json");
  assert.equal(readAliasMap(dir).size, 0);
});

test("readAliasMap: keeps only triad keys, trims values", () => {
  const dir = tmpDir();
  fs.writeFileSync(
    path.join(dir, "model-alias.json"),
    JSON.stringify({
      high: " deepseek/deepseek-v4-pro ",
      fast: "deepseek/deepseek-v4-flash",
      cheap: "opencode/mimo-v2.5-free",
      extra: "openai/gpt-4",
      empty: "   ",
    }),
  );
  const map = readAliasMap(dir);
  assert.equal(map.get("high"), "deepseek/deepseek-v4-pro");
  assert.equal(map.get("fast"), "deepseek/deepseek-v4-flash");
  assert.equal(map.get("cheap"), "opencode/mimo-v2.5-free");
  assert.equal(map.has("extra"), false);
  assert.equal(map.has("empty"), false);
});

test("buildAliasMap: skips targets that are other alias keys (no chaining)", () => {
  const warnMessages: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => warnMessages.push(args.join(" "));
  try {
    const map = buildAliasMap({ high: "fast", fast: "deepseek/x", cheap: "opencode/y" });
    assert.equal(map.has("high"), false, "chained high->fast must be skipped");
    assert.equal(map.get("fast"), "deepseek/x");
    assert.equal(map.get("cheap"), "opencode/y");
    assert.ok(warnMessages.some((m) => m.includes("high") && m.includes("fast")));
  } finally {
    console.warn = origWarn;
  }
});

test("buildAliasMap: concrete id ending with triad name is not chaining", () => {
  const map = buildAliasMap({
    high: "anthropic/fast",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  assert.equal(map.get("high"), "anthropic/fast");
});

test("resolveAlias: hit / miss / undefined", () => {
  const map = buildAliasMap({ high: "p/a", fast: "p/b", cheap: "p/c" });
  assert.equal(resolveAlias("high", map), "p/a");
  assert.equal(resolveAlias("gpt-x", map), undefined);
  assert.equal(resolveAlias(undefined, map), undefined);
});

test("splitQualified: valid and invalid", () => {
  assert.deepEqual(splitQualified("openai/gpt-y"), ["openai", "gpt-y"]);
  assert.deepEqual(splitQualified("provider/a/b"), ["provider", "a/b"]);
  assert.equal(splitQualified("nostash"), undefined);
  assert.equal(splitQualified("/leading"), undefined);
  assert.equal(splitQualified("trailing/"), undefined);
});

test("writeAliasMap: writes flat triad JSON", () => {
  const dir = tmpDir();
  const map = buildAliasMap({
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  writeAliasMap(dir, map);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "model-alias.json"), "utf8"));
  assert.deepEqual(raw, {
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
});
