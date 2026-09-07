import { chmod, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_FETCH_CONTENT_BYTES,
  TEMP_SPOOL_TTL_MS,
} from "../shared/limits.ts";
import { WebFetchError } from "./errors.ts";

const FETCH_TEMP_PREFIX = "pi-web-fetch-";
const RESPONSE_FILE = "response.bin";
const CONTENT_FILE = "content.txt";

export interface BoundedText {
  text: string;
  truncated: boolean;
  totalBytes: number;
  outputBytes: number;
}

export interface TempSpool {
  readonly directory: string;
  readonly responsePath: string;
  readonly contentPath: string;
  readonly bytes: number;
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  saveText(text: string): Promise<BoundedText>;
  cleanup(): Promise<void>;
}

export function limitUtf8Text(
  text: string,
  maxBytes = MAX_FETCH_CONTENT_BYTES,
): BoundedText {
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return {
      text,
      truncated: false,
      totalBytes: encoded.byteLength,
      outputBytes: encoded.byteLength,
    };
  }

  let end = maxBytes;
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--;
  const bounded = encoded.subarray(0, end).toString("utf8");
  return {
    text: bounded,
    truncated: true,
    totalBytes: encoded.byteLength,
    outputBytes: Buffer.byteLength(bounded, "utf8"),
  };
}

export async function createTempSpool(
  baseDir = tmpdir(),
  prefix = FETCH_TEMP_PREFIX,
): Promise<TempSpool> {
  const directory = await mkdtemp(join(baseDir, prefix));
  const responsePath = join(directory, RESPONSE_FILE);
  const contentPath = join(directory, CONTENT_FILE);
  await chmod(directory, 0o700);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(responsePath, "wx", 0o600);
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  let bytes = 0;
  let closed = false;
  let finalized = false;

  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };

  const cleanup = async () => {
    await close().catch(() => {});
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  };

  return {
    directory,
    responsePath,
    contentPath,
    get bytes() {
      return bytes;
    },
    async write(chunk: Uint8Array) {
      if (finalized) {
        throw new WebFetchError(
          "invalid-response",
          "The fetch response has already been finalized.",
        );
      }
      if (bytes + chunk.byteLength > MAX_FETCH_CONTENT_BYTES) {
        throw new WebFetchError(
          "invalid-response",
          "The fetch response exceeds the 1 MiB limit.",
        );
      }
      await handle.write(chunk);
      bytes += chunk.byteLength;
    },
    close,
    async saveText(text: string) {
      await close();
      const bounded = limitUtf8Text(text);
      await writeFile(contentPath, bounded.text, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      await rm(responsePath, { force: true });
      finalized = true;
      return bounded;
    },
    cleanup,
  };
}

export async function cleanupExpiredSpools(
  baseDir = tmpdir(),
  now = Date.now(),
): Promise<void> {
  // Deliberately keep this best-effort: a missing or unreadable temp directory
  // must not prevent the extension from starting.
  const { readdir, stat } = await import("node:fs/promises");
  let entries: string[];
  try {
    entries = await readdir(baseDir);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter((entry) => entry.startsWith(FETCH_TEMP_PREFIX))
      .map(async (entry) => {
        const path = join(baseDir, entry);
        try {
          const info = await stat(path);
          if (now - info.mtimeMs > TEMP_SPOOL_TTL_MS) {
            await rm(path, { recursive: true, force: true });
          }
        } catch {
          // Ignore races with another cleanup or the operating system.
        }
      }),
  );
}
