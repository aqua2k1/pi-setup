import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import modelAliasExtension from "./index.js";

const REG = [
  { provider: "deepseek", id: "deepseek-v4-flash", name: "Flash" },
  { provider: "deepseek", id: "deepseek-v4-pro", name: "Pro" },
  { provider: "opencode", id: "mimo-v2.5-free", name: "Mimo" },
];

function settingsDir(replacements: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ma-rt-"));
  fs.writeFileSync(path.join(dir, "model-alias.json"), JSON.stringify(replacements));
  return dir;
}

function harness(modelRegistryModels: typeof REG = REG) {
  const handlers = new Map<string, Function>();
  const commands = new Map<string, { description?: string; handler: Function }>();
  const setModelCalls: any[] = [];
  const registerCalls: any[] = [];
  const pi: any = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    registerProvider: (provider: string, config: any) => registerCalls.push({ provider, config }),
    registerCommand: (name: string, opts: { description?: string; handler: Function }) =>
      commands.set(name, opts),
    setModel: async (m: any) => {
      setModelCalls.push(m);
      return true;
    },
  };
  modelAliasExtension(pi);
  const ctx: any = {
    hasUI: false,
    ui: { notify() {}, select: async () => undefined },
    model: undefined,
    modelRegistry: {
      getAll: () => modelRegistryModels,
      getAvailable: () => modelRegistryModels,
      find: (provider: string, id: string) =>
        modelRegistryModels.find((m) => m.provider === provider && m.id === id),
    },
  };
  return { handlers, commands, setModelCalls, registerCalls, ctx };
}

async function loadAliases(h: ReturnType<typeof harness>, dir: string) {
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await h.handlers.get("session_start")!({ type: "session_start" }, h.ctx);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
}

test("model_select with alias swaps to concrete model exactly once", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ fast: "deepseek/deepseek-v4-flash" }));
  h.setModelCalls.length = 0;
  await h.handlers.get("model_select")!(
    { type: "model_select", model: { provider: "deepseek", id: "fast" } },
    h.ctx,
  );
  assert.equal(h.setModelCalls.length, 1);
  assert.deepEqual(h.setModelCalls[0], {
    provider: "deepseek",
    id: "deepseek-v4-flash",
    name: "Flash",
  });
});

test("model_select with concrete (non-alias) id does not swap (no loop)", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ fast: "deepseek/deepseek-v4-flash" }));
  h.setModelCalls.length = 0;
  await h.handlers.get("model_select")!(
    {
      type: "model_select",
      model: { provider: "deepseek", id: "deepseek-v4-flash" },
    },
    h.ctx,
  );
  assert.equal(h.setModelCalls.length, 0);
});

test("before_agent_start swaps active alias model", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  h.setModelCalls.length = 0;
  h.ctx.model = { provider: "deepseek", id: "high" };
  await h.handlers.get("before_agent_start")!({ type: "before_agent_start" }, h.ctx);
  assert.equal(h.setModelCalls.length, 1);
  assert.equal(h.setModelCalls[0].id, "deepseek-v4-pro");
});

test("session_start injects synthetic models", async () => {
  const h = harness();
  await loadAliases(
    h,
    settingsDir({
      high: "deepseek/deepseek-v4-pro",
      fast: "deepseek/deepseek-v4-flash",
      cheap: "opencode/mimo-v2.5-free",
    }),
  );
  assert.ok(h.registerCalls.length >= 1);
  const deepseek = h.registerCalls.find((c) => c.provider === "deepseek");
  assert.ok(deepseek?.config.models.some((m: any) => m.id === "fast"));
  assert.ok(deepseek?.config.models.some((m: any) => m.id === "high"));
});

test("subagent tool_call: alias model is rewritten to concrete", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  const event: any = { type: "tool_call", toolName: "subagent", input: { model: "high" } };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "deepseek/deepseek-v4-pro");
});

test("subagent tool_call: non-alias model unchanged", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  const event: any = {
    type: "tool_call",
    toolName: "subagent",
    input: { model: "openai/gpt-real" },
  };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "openai/gpt-real");
});

test("subagent tool_call: missing model does not throw", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  const event: any = { type: "tool_call", toolName: "subagent", input: {} };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.deepEqual(event.input, {});
});

test("non-subagent tool_call: model param untouched", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  const event: any = { type: "tool_call", toolName: "bash", input: { model: "high" } };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "high");
});

test("subagent tool_call: suffixed alias resolves base and re-attaches suffix", async () => {
  const h = harness();
  await loadAliases(h, settingsDir({ high: "deepseek/deepseek-v4-pro" }));
  const event: any = {
    type: "tool_call",
    toolName: "subagent",
    input: { model: "high:thinking" },
  };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "deepseek/deepseek-v4-pro:thinking");
});

test("hot-apply re-inject does not retarget active concrete from remembered alias", async () => {
  // Q11: no last-alias persistence. Changing map + re-running session_start(reload)
  // with concrete active model must NOT auto-swap to a new target.
  const h = harness();
  await loadAliases(h, settingsDir({ fast: "deepseek/deepseek-v4-flash" }));
  h.setModelCalls.length = 0;
  h.ctx.model = { provider: "deepseek", id: "deepseek-v4-flash" }; // already concrete

  const dirB = settingsDir({ fast: "deepseek/deepseek-v4-pro" });
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dirB;
  try {
    await h.handlers.get("session_start")!({ type: "session_start", reason: "reload" }, h.ctx);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }

  // Active model is concrete, not an alias key → no setModel
  assert.equal(h.setModelCalls.length, 0);
  // But re-inject should have run with the new map (fast now points at pro)
  const lastDeepseek = [...h.registerCalls].reverse().find((c) => c.provider === "deepseek");
  const fastEntry = lastDeepseek?.config.models.find((m: any) => m.id === "fast");
  // Synthetic clone is from deepseek-v4-pro now (name includes pro)
  assert.ok(fastEntry, "fast synthetic re-injected");
});

test("registers /model-alias command", () => {
  const h = harness();
  assert.ok(h.commands.has("model-alias"));
  assert.match(h.commands.get("model-alias")!.description ?? "", /alias/i);
});

test("/model-alias save hot-applies re-inject and updates subagent rewrite without setModel on concrete session", async () => {
  const h = harness([
    ...REG,
    { provider: "opencode", id: "other-cheap", name: "Other" },
  ]);
  const dir = settingsDir({
    high: "deepseek/deepseek-v4-pro",
    fast: "deepseek/deepseek-v4-flash",
    cheap: "opencode/mimo-v2.5-free",
  });
  await loadAliases(h, dir);
  h.setModelCalls.length = 0;
  h.registerCalls.length = 0;
  h.ctx.model = { provider: "deepseek", id: "deepseek-v4-flash" }; // concrete — must not retarget

  let selectCalls = 0;
  h.ctx.hasUI = true;
  h.ctx.ui = {
    notify() {},
    select: async (_title: string, options: string[]) => {
      selectCalls++;
      if (selectCalls === 1) return options.find((o) => o.startsWith("cheap →"))!;
      if (selectCalls === 2) return "opencode/other-cheap";
      return "Save";
    },
  };

  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    await h.commands.get("model-alias")!.handler("", h.ctx);
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }

  // File updated
  const written = JSON.parse(fs.readFileSync(path.join(dir, "model-alias.json"), "utf8"));
  assert.equal(written.cheap, "opencode/other-cheap");

  // Re-inject ran; no swap of active concrete model
  assert.ok(h.registerCalls.length >= 1);
  assert.equal(h.setModelCalls.length, 0);

  // Next subagent tool call with cheap uses the new target
  const event: any = { type: "tool_call", toolName: "subagent", input: { model: "cheap" } };
  h.handlers.get("tool_call")!(event, h.ctx);
  assert.equal(event.input.model, "opencode/other-cheap");
});
