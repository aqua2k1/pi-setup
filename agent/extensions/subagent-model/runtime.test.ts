import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import subagentModelExtension from "./index.js";

const REG = [
  { provider: "opencode-go", id: "deepseek-v4-flash", name: "Flash" },
  { provider: "opencode-go", id: "deepseek-v4-pro", name: "Pro" },
];

function settingsDir(replacements: Record<string, unknown>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-rt-"));
  fs.writeFileSync(path.join(dir, "subagent-model.json"), JSON.stringify(replacements));
  return dir;
}

function harness() {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { description?: string; handler: Function }>();
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerCommand: (name: string, opts: { description?: string; handler: Function }) =>
      commands.set(name, opts),
  };
  subagentModelExtension(pi);
  const ctx: any = {
    hasUI: false,
    cwd: os.tmpdir(),
    ui: { notify() {}, select: async () => undefined },
    model: undefined,
    modelRegistry: {
      getAll: () => REG,
      getAvailable: () => REG,
      find: (provider: string, id: string) =>
        REG.find((m) => m.provider === provider && m.id === id),
    },
  };
  return { handlers, commands, ctx };
}

async function loadConfig(h: ReturnType<typeof harness>, dir: string) {
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await h.commands.get("subagent-model")!.handler("", { ...h.ctx });
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
}

test("tool_call: injects pinned model and thinking for configured agent", async () => {
  const h = harness();
  await loadConfig(h, settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" } }));
  const event: any = { type: "tool_call", toolName: "subagent", input: { subagent_type: "Explore" } };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.deepEqual(event.input, {
    subagent_type: "Explore",
    model: "opencode-go/deepseek-v4-flash",
    thinking: "max",
  });
});

test("tool_call: agent type matching is case-insensitive", async () => {
  const h = harness();
  await loadConfig(h, settingsDir({ explore: { model: "opencode-go/deepseek-v4-flash" } }));
  const event: any = { type: "tool_call", toolName: "subagent", input: { subagent_type: "EXPLORE" } };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "opencode-go/deepseek-v4-flash");
  assert.equal(event.input.thinking, undefined);
});

test("tool_call: unconfigured agent left untouched (frontmatter fallback)", async () => {
  const h = harness();
  await loadConfig(h, settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash" } }));
  const event: any = {
    type: "tool_call",
    toolName: "subagent",
    input: { subagent_type: "commit", model: "opencode-go/deepseek-v4-pro" },
  };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.deepEqual(event.input, {
    subagent_type: "commit",
    model: "opencode-go/deepseek-v4-pro",
  });
});

test("tool_call: explicit LLM params are overwritten by config (JSON wins)", async () => {
  const h = harness();
  await loadConfig(h, settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "high" } }));
  const event: any = {
    type: "tool_call",
    toolName: "subagent",
    input: { subagent_type: "Explore", model: "opencode-go/deepseek-v4-pro", thinking: "low" },
  };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "opencode-go/deepseek-v4-flash");
  assert.equal(event.input.thinking, "high");
});

test("tool_call: non-subagent tool or missing subagent_type untouched", async () => {
  const h = harness();
  await loadConfig(h, settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash" } }));
  const bash: any = { type: "tool_call", toolName: "bash", input: { model: "x" } };
  h.handlers.get("tool_call")!(bash, h.ctx);
  assert.equal(bash.input.model, "x");
  const noType: any = { type: "tool_call", toolName: "subagent", input: { model: "x" } };
  h.handlers.get("tool_call")!(noType, h.ctx);
  assert.equal(noType.input.model, "x");
});

test("registers /subagent-model command", () => {
  const h = harness();
  assert.ok(h.commands.has("subagent-model"));
  assert.match(h.commands.get("subagent-model")!.description ?? "", /subagent/i);
});
