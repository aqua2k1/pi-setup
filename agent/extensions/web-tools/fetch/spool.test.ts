import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { MAX_FETCH_CONTENT_BYTES } from "../shared/limits.ts";
import { WebFetchError } from "./errors.ts";
import {
  cleanupExpiredSpools,
  createTempSpool,
  limitUtf8Text,
} from "./spool.ts";

function fixtureDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

test("createTempSpool writes bounded response and final content files", async () => {
  const base = await fixtureDirectory("pi-web-tools-spool-");
  const spool = await createTempSpool(base);
  try {
    await spool.write(new TextEncoder().encode("raw response"));
    await spool.close();
    const result = await spool.saveText("final content");
    assert.equal(result.text, "final content");
    assert.equal(await readFile(spool.contentPath, "utf8"), "final content");
    await assert.rejects(stat(spool.responsePath));
    const directoryMode = (await stat(spool.directory)).mode & 0o777;
    const contentMode = (await stat(spool.contentPath)).mode & 0o777;
    assert.equal(directoryMode, 0o700);
    assert.equal(contentMode, 0o600);
  } finally {
    await spool.cleanup();
    await rm(base, { recursive: true, force: true });
  }
});

test("createTempSpool rejects a response over 1 MiB", async () => {
  const base = await fixtureDirectory("pi-web-tools-spool-limit-");
  const spool = await createTempSpool(base);
  try {
    await assert.rejects(
      spool.write(new Uint8Array(MAX_FETCH_CONTENT_BYTES + 1)),
      (error: unknown) =>
        error instanceof WebFetchError && error.code === "invalid-response",
    );
  } finally {
    await spool.cleanup();
    await rm(base, { recursive: true, force: true });
  }
});

test("limitUtf8Text does not split a UTF-8 code point", () => {
  const result = limitUtf8Text("😀😀", 5);
  assert.equal(result.truncated, true);
  assert.equal(result.text, "😀");
  assert.equal(result.outputBytes, 4);
});

test("cleanupExpiredSpools removes old fetch directories", async () => {
  const base = await fixtureDirectory("pi-web-tools-cleanup-");
  const old = join(base, "pi-web-fetch-old");
  await mkdir(old, { recursive: true });
  await writeFile(join(old, "content.txt"), "old");
  await chmod(old, 0o700);
  const oldTime = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000);
  const { utimes } = await import("node:fs/promises");
  await utimes(old, oldTime, oldTime);
  await cleanupExpiredSpools(base);
  await assert.rejects(stat(old));
  await rm(base, { recursive: true, force: true });
});
