import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { searchWeb } from "./composition.ts";
import { WebSearchError } from "./core/errors.ts";
import webSearchExtension, { registerWebSearchTool } from "./index.ts";

const key = "fixture-api-42/Plus+=value!";
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account-123" } })}.signature`;
const context = {
  modelRegistry: {
    getProviderAuth: async () => ({ auth: { apiKey: token }, source: "OAuth" }),
  },
} as unknown as ExtensionContext;

function capture(
  dependencies: Parameters<typeof registerWebSearchTool>[1] = {},
) {
  const tools: ToolDefinition[] = [];
  registerWebSearchTool(
    {
      registerTool: (tool: ToolDefinition) => tools.push(tool),
    } as unknown as ExtensionAPI,
    { env: {}, ...dependencies },
  );
  assert.equal(tools.length, 1);
  return tools[0];
}

test("the extension entrypoint registers only the search tool and command", () => {
  const names: string[] = [];
  webSearchExtension({
    registerTool: (tool: ToolDefinition) => names.push(tool.name),
    registerCommand: (name: string) => names.push(name),
  } as unknown as ExtensionAPI);
  assert.deepEqual(names, ["web_search", "web-search"]);
});

test("web_search registers the actual public parameter schema", () => {
  const tool = capture();
  assert.equal(tool.name, "web_search");
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.deepEqual(schema.required, ["query"]);
  assert.deepEqual(schema.properties.provider.enum, [
    "searxng",
    "codex-alpha-search",
  ]);
  assert.equal(schema.properties.query.maxLength, 2_000);
  assert.equal(schema.properties.max_results.maximum, 10);
  assert.equal(schema.properties.domains.maxItems, 20);
  assert.equal(schema.properties.recency_days.maximum, 3_650);
});

for (const provider of ["searxng", "codex-alpha-search"] as const) {
  test(`${provider}: real composition-to-tool path does not leak credentials in updates, text or details`, async () => {
    const credential = provider === "searxng" ? key : token;
    const reflection = `${credential} ${encodeURIComponent(credential)} ${Buffer.from(credential).toString("base64")} fixture-account-123`;
    const tool = capture({
      readConfig: async () => ({}),
      ...(provider === "searxng"
        ? {
            env: {
              SEARXNG_URL: "https://search.example",
              SEARXNG_API_KEY: key,
            },
          }
        : {}),
      search: (request, config, runtime, signal) =>
        searchWeb(
          request,
          config,
          {
            ...runtime,
            fetch: async (_url, init) => {
              assert.equal(init?.redirect, "error");
              assert.equal(
                new Headers(init?.headers).get("authorization"),
                `Bearer ${credential}`,
              );
              return Response.json({
                output: `Summary ${reflection} [signed](https://example.com/?access_token=unknown-secret#fragment-secret)`,
                results: [
                  { url: "https://user:password-secret@example.com/" },
                  {
                    title: reflection,
                    url: `https://example.com/${encodeURIComponent(credential)}?sig=signature-secret#fragment-secret`,
                    content: reflection,
                    snippet: reflection,
                  },
                ],
              });
            },
          },
          signal,
        ),
    });
    const updates: unknown[] = [];
    const output = await tool.execute(
      "test-call",
      { query: credential, provider, max_results: 1 },
      undefined,
      (update) => updates.push(update),
      context,
    );
    const serialized = JSON.stringify({ updates, output });
    for (const secret of [
      credential,
      encodeURIComponent(credential),
      Buffer.from(credential).toString("base64"),
      "unknown-secret",
      "password-secret",
      "signature-secret",
      "fragment-secret",
      ...(provider === "codex-alpha-search" ? ["fixture-account-123"] : []),
    ])
      assert.ok(!serialized.includes(secret), secret);
    assert.ok(serialized.includes("redacted"));
    assert.equal((output.details as { resultCount: number }).resultCount, 1);
  });
}

test("tool catches config failures before any progress update or provider request", async () => {
  const tool = capture({
    readConfig: async () => {
      throw new Error(key);
    },
  });
  const updates: unknown[] = [];
  await assert.rejects(
    tool.execute(
      "test",
      { query: "test" },
      undefined,
      (update) => updates.push(update),
      context,
    ),
    (error: unknown) => {
      assert.ok(error instanceof WebSearchError);
      assert.ok(!String(error.stack).includes(key));
      return true;
    },
  );
  assert.deepEqual(updates, []);
});

test("tool error surfaces never contain HTTP bodies, transport messages or OAuth errors", async () => {
  for (const fetcher of [
    async () => Response.json({ error: key }, { status: 401 }),
    async () => {
      throw new Error(key);
    },
    async () => {
      throw new WebSearchError("network", key, { provider: key });
    },
  ]) {
    const tool = capture({
      readConfig: async () => ({}),
      env: {
        SEARXNG_URL: "https://search.example",
        SEARXNG_API_KEY: key,
      },
      search: (request, config, runtime, signal) =>
        searchWeb(request, config, { ...runtime, fetch: fetcher }, signal),
    });
    await assert.rejects(
      tool.execute("test", { query: "test" }, undefined, undefined, context),
      (error: unknown) => {
        assert.ok(error instanceof WebSearchError);
        assert.ok(!`${error.stack} ${JSON.stringify(error)}`.includes(key));
        return true;
      },
    );
  }
});
