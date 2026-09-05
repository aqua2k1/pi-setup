import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  registerWebSearchCommand,
  type WebSearchCommandDependencies,
} from "./commands.ts";
import type { WebSearchFileConfig } from "./config.ts";

interface CapturedCommand {
  getArgumentCompletions?: (
    prefix: string,
  ) => Array<{ value: string; label: string }> | null;
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

function capture(
  dependencies: WebSearchCommandDependencies = {},
): CapturedCommand {
  let command: CapturedCommand | undefined;
  const pi = {
    registerCommand(_name: string, options: CapturedCommand) {
      command = options;
    },
  } as unknown as ExtensionAPI;
  registerWebSearchCommand(pi, { env: {}, ...dependencies });
  assert.ok(command);
  return command;
}

function context(): {
  ctx: ExtensionCommandContext;
  notifications: string[];
} {
  const notifications: string[] = [];
  const ctx = {
    signal: undefined,
    modelRegistry: {
      getProviderAuthStatus: () => ({
        configured: true,
        source: "synthetic-source",
      }),
    },
    ui: {
      notify(text: string) {
        notifications.push(text);
      },
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notifications };
}

function currentConfig(): WebSearchFileConfig {
  return {
    routing: {
      provider: "codex-alpha-search",
      fallback: true,
      fallbackProvider: "searxng",
    },
    timeoutMs: 5_000,
    maxResults: 2,
    codex: { model: "synthetic-codex-model" },
  };
}

test("registerWebSearchCommand: exposes status and full test arguments only", () => {
  const command = capture();
  assert.deepEqual(
    command.getArgumentCompletions?.("")?.map((completion) => completion.value),
    ["status", "test searxng", "test codex-alpha-search", "test codex"],
  );
  assert.deepEqual(
    command
      .getArgumentCompletions?.("test se")
      ?.map((completion) => completion.value),
    ["test searxng"],
  );
  assert.deepEqual(command.getArgumentCompletions?.("configure"), null);
});

test("/web-search status: reads non-secret settings from JSON and URL/key from env", async () => {
  const command = capture({
    readConfig: async () => currentConfig(),
    env: {
      SEARXNG_URL: "http://search.example/private/path",
      SEARXNG_API_KEY: "synthetic-api-key",
    },
  });
  const { ctx, notifications } = context();

  await command.handler("status", ctx);

  assert.equal(notifications.length, 1);
  const status = notifications[0] ?? "";
  assert.match(status, /provider: Codex alpha\/search \(config\)/);
  assert.match(status, /fallback: enabled \(config\)/);
  assert.match(status, /fallback provider: SearXNG \(config\)/);
  assert.match(status, /timeout: 5000 ms/);
  assert.match(status, /default max results: 2/);
  assert.match(status, /Codex authentication: configured \(OAuth required\)/);
  assert.match(status, /SearXNG URL: configured \(env\)/);
  assert.match(status, /SearXNG Bearer key: set \(env\)/);
  assert.doesNotMatch(
    status,
    /private\/path|synthetic-api-key|synthetic-codex-model/,
  );
});

test("/web-search configure: is intentionally unavailable", async () => {
  const command = capture();
  const { ctx, notifications } = context();

  await command.handler("configure", ctx);

  assert.deepEqual(notifications, [
    "/web-search status\n/web-search test <searxng|codex-alpha-search|codex>",
  ]);
});

test("/web-search test codex: accepts the alias and injects the runtime", async () => {
  let observedProvider = "";
  let observedFallback = true;
  let observedRegistry: unknown;
  const command = capture({
    readConfig: async () => currentConfig(),
    search: async (_request, config, runtime) => {
      observedProvider = config.provider;
      observedFallback = config.fallback;
      observedRegistry = runtime?.modelRegistry;
      return {
        query: "synthetic-query",
        results: [
          {
            title: "Synthetic result",
            url: "https://example.test/result",
            snippet: "Synthetic snippet",
          },
        ],
        provider: "codex-alpha-search",
      };
    },
  });
  const { ctx, notifications } = context();

  await command.handler("test codex", ctx);

  assert.equal(observedProvider, "codex-alpha-search");
  assert.equal(observedFallback, false);
  assert.equal(observedRegistry, ctx.modelRegistry);
  assert.deepEqual(notifications, [
    "Codex alpha/search test succeeded (1 result).",
  ]);
});

test("/web-search command errors remain classified and safe", async () => {
  const command = capture({
    readConfig: async () => {
      throw new Error("synthetic-raw-config-error");
    },
  });
  const { ctx, notifications } = context();

  await command.handler("status", ctx);

  assert.equal(notifications.length, 1);
  assert.match(notifications[0] ?? "", /\[network\]/);
  assert.doesNotMatch(notifications[0] ?? "", /synthetic-raw-config-error/);
});
