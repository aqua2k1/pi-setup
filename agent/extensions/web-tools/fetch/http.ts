import { readFile } from "node:fs/promises";
import type { FetchLike } from "../shared/http.ts";
import {
  MAX_FETCH_CONTENT_BYTES,
  TEMP_SPOOL_TTL_MS,
} from "../shared/limits.ts";
import { decodeDocument, isSupportedTextType } from "./content.ts";
import {
  assertNotCancelled,
  errorFromStatus,
  toWebFetchError,
  WebFetchError,
} from "./errors.ts";
import { createTempSpool } from "./spool.ts";
import type { FetchRequest, FetchResponse } from "./types.ts";

const USER_AGENT = "pi-web-tools/1.0";
const ACCEPT =
  "text/html,application/xhtml+xml,application/xml,text/plain,application/json;q=0.9,*/*;q=0.1";

export interface FetchDocumentOptions {
  timeoutMs: number;
  fetch?: FetchLike;
}

function contentLength(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => {});
}

async function readResponseToSpool(
  response: Response,
  signal: AbortSignal,
  spool: Awaited<ReturnType<typeof createTempSpool>>,
): Promise<void> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) return;
      await spool.write(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function withFetchDeadline<T>(
  timeoutMs: number,
  parent: AbortSignal | undefined,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertNotCancelled(parent);
  const controller = new AbortController();
  let timeoutTimer: NodeJS.Timeout | undefined;
  let onParentAbort = () => {};
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(controller.signal.reason);
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
  onParentAbort = () =>
    controller.abort(
      new WebFetchError("cancelled", "Web fetch was cancelled."),
    );
  parent?.addEventListener("abort", onParentAbort, { once: true });
  if (parent?.aborted) onParentAbort();
  timeoutTimer = setTimeout(
    () =>
      controller.abort(
        new WebFetchError("timeout", "The fetch request timed out."),
      ),
    timeoutMs,
  );
  try {
    if (controller.signal.aborted) {
      throw controller.signal.reason;
    }
    return await Promise.race([run(controller.signal), aborted]);
  } catch (error) {
    if (controller.signal.aborted)
      throw toWebFetchError(controller.signal.reason);
    throw toWebFetchError(error);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    parent?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

export async function fetchDocument(
  request: FetchRequest,
  options: FetchDocumentOptions,
  parentSignal?: AbortSignal,
): Promise<FetchResponse> {
  assertFetchTimeout(options.timeoutMs);
  const fetcher = options.fetch ?? globalThis.fetch;
  return withFetchDeadline(options.timeoutMs, parentSignal, async (signal) => {
    const url = request.url.toString();
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: ACCEPT,
      },
      signal,
    });
    if (!response.ok) {
      await cancelBody(response);
      throw errorFromStatus(response.status, "native-http");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!isSupportedTextType(contentType)) {
      await cancelBody(response);
      throw new WebFetchError(
        "unsupported",
        "The requested content is not supported.",
        { source: "native-http" },
      );
    }
    const declaredLength = contentLength(response);
    if (
      declaredLength !== undefined &&
      declaredLength > MAX_FETCH_CONTENT_BYTES
    ) {
      await cancelBody(response);
      throw new WebFetchError(
        "invalid-response",
        "The fetch response exceeds the 1 MiB limit.",
        { source: "native-http" },
      );
    }

    const spool = await createTempSpool();
    try {
      await readResponseToSpool(response, signal, spool);
      signal.throwIfAborted();
      const body = await readFile(spool.responsePath);
      const document = decodeDocument(body, contentType, request.raw);
      const bounded = await spool.saveText(document.text);
      return {
        text: bounded.text,
        title: document.title,
        contentType: document.contentType,
        contentLength: declaredLength ?? spool.bytes,
        finalUrl: response.url || url,
        source: "native-http",
        fullOutputPath: spool.contentPath,
        expiresAt: new Date(Date.now() + TEMP_SPOOL_TTL_MS).toISOString(),
        ...(document.truncated || bounded.truncated
          ? {
              truncation: {
                totalBytes: declaredLength ?? spool.bytes,
                outputBytes: bounded.outputBytes,
              },
            }
          : {}),
      };
    } catch (error) {
      await spool.cleanup();
      throw error;
    }
  });
}

export function assertFetchTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new WebFetchError(
      "invalid-config",
      "Web tools fetch configuration is invalid.",
    );
  }
}
