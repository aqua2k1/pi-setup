import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  getConfigPath,
  parseConfig,
  readConfig,
  resolveConfig,
  type WebSearchFileConfig,
} from "./config.ts";
import { WebSearchError } from "./core/errors.ts";
import { CODEX_DEFAULT_MODEL } from "./providers/codex/config.ts";
import { SEARXNG_DEFAULT_URL } from "./providers/searxng/config.ts";
import {
  DEFAULT_MAX_RESULTS,
  DEFAULT_SEARCH_TIMEOUT_MS,
} from "./shared/limits.ts";

function invalidConfig(error: unknown): boolean {
  return error instanceof WebSearchError && error.code === "invalid-config";
}

test("parseConfig: keeps JSON-owned fields and ignores unknown fields", () => {
  assert.deepEqual(
    parseConfig(
      JSON.stringify({
        routing: {
          provider: "codex-alpha-search",
          fallback: true,
          fallbackProvider: "searxng",
        },
        timeoutMs: 20_000,
        maxResults: 8,
        searxng: {
          bad: true,
        },
        codex: { model: "synthetic-model", bad: true },
        unknown: "ignored",
      }),
    ),
    {
      routing: {
        provider: "codex-alpha-search",
        fallback: true,
        fallbackProvider: "searxng",
      },
      timeoutMs: 20_000,
      maxResults: 8,
      codex: { model: "synthetic-model" },
    },
  );
  assert.throws(() => parseConfig("[]"), invalidConfig);
  assert.throws(
    () => parseConfig(JSON.stringify({ provider: "searxng" })),
    invalidConfig,
  );
});

test("parseConfig: rejects URL and API key fields in JSON", () => {
  for (const field of ["url", "apiKey"]) {
    assert.throws(
      () =>
        parseConfig(
          JSON.stringify({ searxng: { [field]: "synthetic-secret" } }),
        ),
      (error: unknown) =>
        invalidConfig(error) && !String(error).includes("synthetic-secret"),
    );
  }
});

test("parseConfig: rejects malformed JSON and known field types safely", () => {
  assert.throws(() => parseConfig("not-json"), invalidConfig);
  assert.throws(
    () => parseConfig(JSON.stringify({ timeoutMs: "not-a-number" })),
    (error: unknown) =>
      invalidConfig(error) && !String(error).includes("not-a-number"),
  );
  assert.throws(
    () => parseConfig(JSON.stringify({ searxng: "not-an-object" })),
    invalidConfig,
  );
  assert.throws(
    () => parseConfig(JSON.stringify({ codex: { model: 42 } })),
    invalidConfig,
  );
});

test("getConfigPath: uses web-search-config.json under the agent directory", () => {
  assert.equal(
    getConfigPath("/synthetic/agent"),
    "/synthetic/agent/web-search-config.json",
  );
});

test("resolveConfig: defaults to local SearXNG with fallback disabled", () => {
  const config = resolveConfig({}, {});
  assert.equal(config.provider, "searxng");
  assert.equal(config.fallback, false);
  assert.equal(config.fallbackProvider, undefined);
  assert.equal(config.searxngUrl, SEARXNG_DEFAULT_URL);
  assert.equal(config.searxngApiKey, undefined);
  assert.equal(config.timeoutMs, DEFAULT_SEARCH_TIMEOUT_MS);
  assert.equal(config.maxResults, DEFAULT_MAX_RESULTS);
  assert.equal(config.codexModel, CODEX_DEFAULT_MODEL);
});

test("resolveConfig: reads URL and API key only from environment", () => {
  const config = resolveConfig(
    {
      routing: {
        provider: "codex",
        fallback: true,
        fallbackProvider: "searxng",
      },
      timeoutMs: 5_000,
      maxResults: 2,
      codex: { model: "synthetic-config-model" },
    },
    {
      SEARXNG_URL: "https://env.example/search",
      SEARXNG_API_KEY: "synthetic-env-key",
    },
  );
  assert.deepEqual(config, {
    provider: "codex-alpha-search",
    fallback: true,
    fallbackProvider: "searxng",
    timeoutMs: 5_000,
    maxResults: 2,
    searxngUrl: "https://env.example/search",
    searxngApiKey: "synthetic-env-key",
    codexModel: "synthetic-config-model",
  });
});

test("resolveConfig: validates JSON-owned common values", () => {
  assert.throws(
    () => resolveConfig({ routing: { provider: "unknown" } }, {}),
    invalidConfig,
  );
  assert.throws(() => resolveConfig({ timeoutMs: 999 }, {}), invalidConfig);
  assert.throws(() => resolveConfig({ maxResults: 11 }, {}), invalidConfig);
  assert.throws(
    () => resolveConfig({ routing: { fallbackProvider: "unknown" } }, {}),
    invalidConfig,
  );
  assert.throws(
    () =>
      resolveConfig(
        {
          routing: {
            provider: "searxng",
            fallbackProvider: "searxng",
          },
        },
        {},
      ),
    invalidConfig,
  );
  assert.throws(
    () =>
      resolveConfig(
        { routing: { fallback: "true" } } as unknown as WebSearchFileConfig,
        {},
      ),
    invalidConfig,
  );
});

test("config file: missing is optional; other read failures are classified", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-search-read-"));
  try {
    const path = getConfigPath(directory);
    assert.deepEqual(await readConfig(path), {});
    assert.throws(() => parseConfig('{"routing":'), invalidConfig);
    await assert.rejects(readConfig(directory), (error: unknown) =>
      invalidConfig(error),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
