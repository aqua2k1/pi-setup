import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSearchableOptions } from "./filter-options.js";

const MODELS = [
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "opencode/mimo-v2.5-free",
  "anthropic/claude-sonnet-4-5",
  "openai/gpt-5.2-codex",
];

test("filterSearchableOptions: empty query returns all options in order", () => {
  assert.deepEqual(filterSearchableOptions(MODELS, ""), MODELS);
  assert.deepEqual(filterSearchableOptions(MODELS, "   "), MODELS);
});

test("filterSearchableOptions: substring/fuzzy match reduces the set", () => {
  const hit = filterSearchableOptions(MODELS, "deepseek");
  assert.ok(hit.every((m) => m.includes("deepseek")));
  assert.equal(hit.length, 2);
});

test("filterSearchableOptions: provider/model tokens match regardless of order", () => {
  const a = filterSearchableOptions(MODELS, "v4 deepseek");
  const b = filterSearchableOptions(MODELS, "deepseek v4");
  assert.ok(a.length >= 1);
  assert.ok(a.every((m) => m.includes("deepseek") && m.includes("v4")));
  // Same models matched either token order
  assert.deepEqual(new Set(a), new Set(b));
});

test("filterSearchableOptions: no match returns empty", () => {
  assert.deepEqual(filterSearchableOptions(MODELS, "zzzz-not-a-model"), []);
});
