import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentModelExtension from "./index.js";

const REG = [
	{ provider: "opencode-go", id: "deepseek-v4-flash", name: "Flash" },
	{ provider: "opencode-go", id: "deepseek-v4-pro", name: "Pro" },
];

interface ToolCallEvent {
	type: string;
	toolName: string;
	input: Record<string, unknown>;
}

type ToolCallHandler = (event: ToolCallEvent, ctx: unknown) => void;
type CommandHandler = (args: string, ctx: unknown) => Promise<void> | void;

interface Command {
	description?: string;
	handler: CommandHandler;
}

function settingsDir(replacements: Record<string, unknown>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sm-rt-"));
	fs.writeFileSync(
		path.join(dir, "subagent-model.json"),
		JSON.stringify(replacements),
	);
	return dir;
}

function harness() {
	const handlers = new Map<string, ToolCallHandler>();
	const commands = new Map<string, Command>();
	const pi = {
		on: (event: string, handler: ToolCallHandler) =>
			handlers.set(event, handler),
		registerCommand: (name: string, opts: Command) => commands.set(name, opts),
	};
	subagentModelExtension(pi as unknown as ExtensionAPI);
	const ctx = {
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
		const cmd = h.commands.get("subagent-model");
		assert.ok(cmd);
		await cmd.handler("", { ...h.ctx });
	} finally {
		if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prev;
	}
}

test("tool_call: injects pinned model and thinking for configured agent", async () => {
	const h = harness();
	await loadConfig(
		h,
		settingsDir({
			Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "max" },
		}),
	);
	const event: ToolCallEvent = {
		type: "tool_call",
		toolName: "subagent",
		input: { subagent_type: "Explore" },
	};
	const handler = h.handlers.get("tool_call");
	assert.ok(handler);
	handler(event, h.ctx);
	assert.deepEqual(event.input, {
		subagent_type: "Explore",
		model: "opencode-go/deepseek-v4-flash",
		thinking: "max",
	});
});

test("tool_call: agent type matching is case-insensitive", async () => {
	const h = harness();
	await loadConfig(
		h,
		settingsDir({ explore: { model: "opencode-go/deepseek-v4-flash" } }),
	);
	const event: ToolCallEvent = {
		type: "tool_call",
		toolName: "subagent",
		input: { subagent_type: "EXPLORE" },
	};
	const handler = h.handlers.get("tool_call");
	assert.ok(handler);
	handler(event, h.ctx);
	assert.equal(event.input.model, "opencode-go/deepseek-v4-flash");
	assert.equal(event.input.thinking, undefined);
});

test("tool_call: unconfigured agent left untouched (frontmatter fallback)", async () => {
	const h = harness();
	await loadConfig(
		h,
		settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash" } }),
	);
	const event: ToolCallEvent = {
		type: "tool_call",
		toolName: "subagent",
		input: { subagent_type: "commit", model: "opencode-go/deepseek-v4-pro" },
	};
	const handler = h.handlers.get("tool_call");
	assert.ok(handler);
	handler(event, h.ctx);
	assert.deepEqual(event.input, {
		subagent_type: "commit",
		model: "opencode-go/deepseek-v4-pro",
	});
});

test("tool_call: explicit LLM params are overwritten by config (JSON wins)", async () => {
	const h = harness();
	await loadConfig(
		h,
		settingsDir({
			Explore: { model: "opencode-go/deepseek-v4-flash", thinking: "high" },
		}),
	);
	const event: ToolCallEvent = {
		type: "tool_call",
		toolName: "subagent",
		input: {
			subagent_type: "Explore",
			model: "opencode-go/deepseek-v4-pro",
			thinking: "low",
		},
	};
	const handler = h.handlers.get("tool_call");
	assert.ok(handler);
	handler(event, h.ctx);
	assert.equal(event.input.model, "opencode-go/deepseek-v4-flash");
	assert.equal(event.input.thinking, "high");
});

test("tool_call: non-subagent tool or missing subagent_type untouched", async () => {
	const h = harness();
	await loadConfig(
		h,
		settingsDir({ Explore: { model: "opencode-go/deepseek-v4-flash" } }),
	);
	const bash: ToolCallEvent = {
		type: "tool_call",
		toolName: "bash",
		input: { model: "x" },
	};
	const handler = h.handlers.get("tool_call");
	assert.ok(handler);
	handler(bash, h.ctx);
	assert.equal(bash.input.model, "x");
	const noType: ToolCallEvent = {
		type: "tool_call",
		toolName: "subagent",
		input: { model: "x" },
	};
	handler(noType, h.ctx);
	assert.equal(noType.input.model, "x");
});

test("registers /subagent-model command", () => {
	const h = harness();
	assert.ok(h.commands.has("subagent-model"));
	const cmd = h.commands.get("subagent-model");
	assert.ok(cmd);
	assert.match(cmd.description ?? "", /subagent/i);
});
