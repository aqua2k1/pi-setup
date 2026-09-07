import type { ResolvedWebFetchConfig } from "../config.ts";
import { MAX_URL_LENGTH } from "../shared/limits.ts";
import { assertNotCancelled, WebFetchError } from "./errors.ts";
import { GitHubHandler } from "./github.ts";
import { fetchDocument } from "./http.ts";
import { cleanupExpiredSpools } from "./spool.ts";
import type { FetchRequest, FetchResponse, FetchRuntime } from "./types.ts";

const githubHandlers = new Map<string, GitHubHandler>();

function githubHandlerFor(
  config: ResolvedWebFetchConfig,
  runtime: FetchRuntime,
): GitHubHandler {
  if (runtime.github) return runtime.github;
  // The default runtime is process-local, so clone cache entries survive
  // separate web_fetch calls. Injected runners are request-local in tests.
  if (runtime.command)
    return new GitHubHandler({ config: config.github, runtime });
  const key = JSON.stringify(config.github);
  const existing = githubHandlers.get(key);
  if (existing) return existing;
  const handler = new GitHubHandler({ config: config.github, runtime });
  githubHandlers.set(key, handler);
  return handler;
}

function parseHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new WebFetchError("invalid-url", "The fetch URL is invalid.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new WebFetchError("blocked-url", "The fetch URL is not supported.");
  }
  if (url.username || url.password) {
    throw new WebFetchError("blocked-url", "The fetch URL is not supported.");
  }
  return url;
}

export function normalizeFetchRequest(request: {
  url: string;
  raw?: boolean;
}): FetchRequest {
  const rawUrl = request.url.trim();
  if (!rawUrl || rawUrl.length > MAX_URL_LENGTH) {
    throw new WebFetchError("invalid-url", "The fetch URL is invalid.");
  }
  const url = parseHttpUrl(rawUrl);
  return { url, raw: request.raw ?? false };
}

export class WebFetchRouter {
  private readonly github: GitHubHandler;
  private readonly config: ResolvedWebFetchConfig;
  private readonly runtime: FetchRuntime;

  constructor(config: ResolvedWebFetchConfig, runtime: FetchRuntime = {}) {
    this.config = config;
    this.runtime = runtime;
    this.github = githubHandlerFor(config, runtime);
  }

  async fetch(
    request: FetchRequest,
    signal?: AbortSignal,
  ): Promise<FetchResponse> {
    assertNotCancelled(signal);
    const githubResponse = await this.github.fetch(request, signal);
    if (githubResponse) return githubResponse;

    return fetchDocument(
      request,
      {
        timeoutMs: this.config.timeoutMs,
        fetch: this.runtime.fetch,
      },
      signal,
    );
  }
}

export async function fetchWeb(
  request: { url: string; raw?: boolean },
  config: ResolvedWebFetchConfig,
  runtime: FetchRuntime = {},
  signal?: AbortSignal,
): Promise<FetchResponse> {
  void cleanupExpiredSpools();
  const normalized = normalizeFetchRequest(request);
  return new WebFetchRouter(config, runtime).fetch(normalized, signal);
}
