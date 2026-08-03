import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  buildConfigMap,
  listEnabledAgents,
  readConfigMap,
  splitQualified,
  supportedThinkingLevels,
  writeConfigMap,
} from "./config.js";

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sm-cfg-"));
}

test("splitQualified: valid and invalid", () => {
  assert.deepEqual(splitQualified("openai/gpt-y"), ["openai", "gpt-y"]);
  assert.deepEqual(splitQualified("provider/a/b"), ["provider", "a/b"]);
  assert.equal(splitQualified("nostash"), undefined);
  assert.equal(splitQualified("/leading"), undefined);
  assert.equal(splitQualified("trailing/"), undefined);
});

test("buildConfigMap: keeps valid entries, lowercases names, trims model", () => {
  const map = buildConfigMap({
    Explore: { model: " opencode-go/deepseek-v4-flash ", thinking: "max" },
    commit: { model: "opencode-go/deepseek-v4-pro" },
    bad: { model: "notqualified" },
    worse: "opencode-go/deepseek-v4-flash", // string entry — skip
    "x/y": { model: "p/m", thinking: "bogus" }, // invalid thinking dropped
  });
  assert.deepEqual(map.get("explore"), { model: "opencode-go/deepseek-v4-flash", thinking: "max" });
  assert.deepEqual(map.get("commit"), { model: "opencode-go/deepseek-v4-pro" });
  assert.equal(map.has("bad"), false);
  assert.equal(map.has("worse"), false);
  assert.deepEqual(map.get("x/y"), { model: "p/m" });
});

test("readConfigMap: missing file / malformed JSON -> empty map", () => {
  assert.equal(readConfigMap(path.join(tmpDir(), "missing")).size, 0);
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "subagent-model.json"), "{not json");
  assert.equal(readConfigMap(dir).size, 0);
});

test("writeConfigMap: round-trip keeps model and thinking", () => {
  const dir = tmpDir();
  const map = buildConfigMap({
    Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" },
    commit: { model: "opencode-go/deepseek-v4-pro" },
  });
  writeConfigMap(dir, map);
  const raw = JSON.parse(fs.readFileSync(path.join(dir, "subagent-model.json"), "utf8"));
  assert.deepEqual(raw, {
    explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" },
    commit: { model: "opencode-go/deepseek-v4-pro" },
  });
  const reread = readConfigMap(dir);
  assert.deepEqual(reread.get("explore"), { model: "opencode-go/deepseek-v4-flash", thinking: "max" });
});

function agentsDir(base: string, files: Record<string, string>): string {
  const dir = path.join(base, "agents");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return base;
}

test("listEnabledAgents: built-ins plus global files, enabled filtering", () => {
  const dir = agentsDir(tmpDir(), {
    "Explore.md": "---\ndescription: x\n---\nbody",
    "review.md": "---\ndescription: y\nenabled: false\n---\nbody",
    "commit.md": "---\ndescription: z\n---\nbody",
    "notes.txt": "---\nenabled: false\n---\n", // not .md — ignored
  });
  const names = listEnabledAgents(dir, tmpDir());
  assert.ok(names.includes("general-purpose"));
  assert.ok(names.includes("Plan"));
  assert.ok(names.includes("Explore"));
  assert.ok(names.includes("commit"));
  assert.ok(!names.includes("review"), "enabled: false must be filtered");
  assert.ok(!names.includes("notes"));
});

test("listEnabledAgents: project dir overrides global, enabled in body ignored", () => {
  const root = tmpDir();
  const global = agentsDir(root, {
    "Explore.md": "---\ndescription: g\n---\nbody",
  });
  const projectRoot = path.join(root, "proj");
  agentsDir(projectRoot, {
    "Explore.md": "---\ndescription: p\n---\nbody",
  });
  const names = listEnabledAgents(global, projectRoot);
  assert.equal(names.filter((n) => n === "Explore").length, 1);
  // body mention of enabled: false must not disable
  const dir2 = agentsDir(tmpDir(), {
    "x.md": "---\ndescription: x\n---\nbody\nenabled: false",
  });
  assert.ok(listEnabledAgents(dir2, tmpDir()).includes("x"));
});

test("listEnabledAgents: built-in Plan disabled by same-named file", () => {
  const dir = agentsDir(tmpDir(), {
    "Plan.md": "---\nenabled: false\n---\n",
    "Explore.md": "---\ndescription: x\n---\nbody",
  });
  const names = listEnabledAgents(dir, tmpDir());
  assert.ok(names.includes("Explore"));
  assert.ok(names.includes("general-purpose"));
  assert.ok(!names.includes("Plan"), "built-in Plan must be filtered by enabled: false");
});

test("listEnabledAgents: project file re-enables a globally disabled built-in", () => {
  const root = tmpDir();
  const global = agentsDir(root, {
    "Plan.md": "---\nenabled: false\n---\n",
  });
  const projectRoot = path.join(root, "proj");
  agentsDir(path.join(projectRoot, ".pi"), {
    "Plan.md": "---\ndescription: p\n---\nbody",
  });
  const names = listEnabledAgents(global, projectRoot);
  assert.ok(names.includes("Plan"));
});

test("supportedThinkingLevels: mirrors pi rules", () => {
  assert.deepEqual(supportedThinkingLevels({}), ["off"]);
  assert.deepEqual(supportedThinkingLevels({ reasoning: true }), [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(
    supportedThinkingLevels({
      reasoning: true,
      thinkingLevelMap: { low: null, high: "high", xhigh: "xhigh", max: "max" },
    }),
    ["off", "minimal", "medium", "high", "xhigh", "max"],
  );
});
