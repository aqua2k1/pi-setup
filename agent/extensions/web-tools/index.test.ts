import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { searchWeb } from "./composition.ts";
import { WebSearchError } from "./core/errors.ts";
import type { FetchResponse } from "./fetch/types.ts";
import webToolsExtension, {
  registerWebFetchTool,
  registerWebSearchTool,
} from "./index.ts";

const key = "fixture-api-42/Plus+=value!";
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = `${encode({ alg: "none" })}.${encode({ "https://api.openai.com/auth": { chatgpt_account_id: "fixture-account-123" } })}.signature`;
const context = {
  modelRegistry: {
    getProviderAuth: async () => ({ auth: { apiKey: token }, source: "OAuth" }),
  },
} as unknown as ExtensionContext;

function captureSearch(
  dependencies: Parameters<typeof registerWebSearchTool>[1] = {},
): ToolDefinition {
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

function captureFetch(
  dependencies: Parameters<typeof registerWebFetchTool>[1] = {},
): ToolDefinition {
  const tools: ToolDefinition[] = [];
  registerWebFetchTool(
    {
      registerTool: (tool: ToolDefinition) => tools.push(tool),
    } as unknown as ExtensionAPI,
    { env: {}, ...dependencies },
  );
  assert.equal(tools.length, 1);
  return tools[0];
}

test("the extension entrypoint registers search, fetch and the web-tools command", () => {
  const names: string[] = [];
  webToolsExtension({
    registerTool: (tool: ToolDefinition) => names.push(tool.name),
    registerCommand: (name: string) => names.push(name),
  } as unknown as ExtensionAPI);
  assert.deepEqual(names, ["web_search", "web_fetch", "web-tools"]);
});

test("web_search registers the public parameter schema", () => {
  const tool = captureSearch();
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

test("web_fetch registers the URL and raw schema", () => {
  const tool = captureFetch();
  assert.equal(tool.name, "web_fetch");
  const schema = JSON.parse(JSON.stringify(tool.parameters));
  assert.deepEqual(schema.required, ["url"]);
  assert.equal(schema.properties.url.maxLength, 8_192);
  assert.equal(schema.properties.raw.type, "boolean");
});

for (const provider of ["searxng", "codex-alpha-search"] as const) {
  test(`${provider}: search composition does not leak credentials`, async () => {
    const credential = provider === "searxng" ? key : token;
    const reflection = `${credential} ${encodeURIComponent(credential)} ${Buffer.from(credential).toString("base64")} fixture-account-123`;
    const tool = captureSearch({
      readConfig: async () => ({ search: {}, fetch: {} }),
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
    ]) {
      assert.ok(!serialized.includes(secret), secret);
    }
    assert.ok(serialized.includes("redacted"));
    assert.equal((output.details as { resultCount: number }).resultCount, 1);
  });
}

test("web_fetch uses the fetch composition and reports a temp path", async () => {
  const response: FetchResponse = {
    text: "first line\nsecond line",
    title: "Synthetic page",
    contentType: "text/plain",
    contentLength: 22,
    finalUrl: "https://example.com/page",
    source: "native-http",
    fullOutputPath: "/tmp/pi-web-fetch-test/content.txt",
  };
  const tool = captureFetch({
    readConfig: async () => ({ search: {}, fetch: {} }),
    fetch: async () => response,
  });
  const updates: unknown[] = [];
  const output = await tool.execute(
    "fetch-call",
    { url: "https://example.com/page?secret=hidden" },
    undefined,
    (update) => updates.push(update),
    context,
  );
  assert.equal(updates.length, 1);
  assert.equal(JSON.stringify(updates[0]).includes("secret=hidden"), false);
  assert.match(JSON.stringify(output), /fullOutputPath|content\.txt/);
  const content = output.content[0];
  assert.equal(content?.type, "text");
  if (content?.type === "text") assert.match(content.text, /Synthetic page/);
});

test("web_fetch uses the real native composition when a fetch runtime is injected", async () => {
  const tool = captureFetch({
    readConfig: async () => ({
      search: {},
      fetch: { github: { enabled: false } },
    }),
    fetchRuntime: {
      fetch: async () =>
        new Response("<title>Fixture</title><p>hello</p>", {
          headers: { "content-type": "text/html" },
        }),
    },
  });
  const output = await tool.execute(
    "fetch-call",
    { url: "https://example.com/page" },
    undefined,
    undefined,
    context,
  );
  const details = output.details as { fullOutputPath: string };
  assert.match(
    output.content[0]?.type === "text" ? output.content[0].text : "",
    /hello/,
  );
  assert.match(details.fullOutputPath, /pi-web-fetch-/);
  await rm(
    details.fullOutputPath.substring(
      0,
      details.fullOutputPath.lastIndexOf("/"),
    ),
    {
      recursive: true,
      force: true,
    },
  );
});

test("tool catches config failures before any progress update", async () => {
  const tool = captureSearch({
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

test("web_fetch errors do not expose raw configuration exceptions", async () => {
  const tool = captureFetch({
    readConfig: async () => {
      throw new Error(key);
    },
  });
  await assert.rejects(
    tool.execute(
      "test",
      { url: "https://example.com" },
      undefined,
      undefined,
      context,
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(!`${error.stack} ${JSON.stringify(error)}`.includes(key));
      return true;
    },
  );
});
