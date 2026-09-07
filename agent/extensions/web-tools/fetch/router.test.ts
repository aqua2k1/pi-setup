import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { test } from "node:test";
import { resolveConfig } from "../config.ts";
import { WebFetchError } from "./errors.ts";
import { fetchWeb, normalizeFetchRequest } from "./router.ts";

async function cleanup(path: string): Promise<void> {
  await rm(path.substring(0, path.lastIndexOf("/")), {
    recursive: true,
    force: true,
  });
}

test("normalizeFetchRequest accepts HTTP(S) and rejects unsafe schemes", () => {
  assert.equal(
    normalizeFetchRequest({ url: "https://example.com/a", raw: true }).url
      .hostname,
    "example.com",
  );
  assert.throws(
    () => normalizeFetchRequest({ url: "file:///etc/passwd" }),
    (error: unknown) =>
      error instanceof WebFetchError && error.code === "blocked-url",
  );
  assert.throws(
    () => normalizeFetchRequest({ url: "https://user:pass@example.com" }),
    (error: unknown) =>
      error instanceof WebFetchError && error.code === "blocked-url",
  );
});

test("fetchWeb uses native HTTP for ordinary URLs and saves full text", async () => {
  const config = resolveConfig({}, {}).fetch;
  const response = await fetchWeb({ url: "https://example.com/page" }, config, {
    fetch: async () =>
      new Response("hello world", {
        headers: { "content-type": "text/plain" },
      }),
  });
  try {
    assert.equal(response.source, "native-http");
    assert.equal(response.text, "hello world");
    assert.equal(
      await readFile(response.fullOutputPath, "utf8"),
      "hello world",
    );
    assert.equal(await stat(response.fullOutputPath).then(() => true), true);
  } finally {
    await cleanup(response.fullOutputPath);
  }
});
