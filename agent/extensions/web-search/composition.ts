import type { ResolvedWebSearchConfig } from "./config.ts";
import { WebSearchRouter } from "./core/router.ts";
import type { RoutedSearchResponse, SearchRequest } from "./core/types.ts";
import {
  type CodexModelRegistry,
  resolveCodexAuth,
} from "./providers/codex/auth.ts";
import { createCodexProvider } from "./providers/codex/provider.ts";
import { createSearxngProvider } from "./providers/searxng/provider.ts";
import type { FetchLike } from "./shared/http.ts";

export interface SearchRuntime {
  modelRegistry?: CodexModelRegistry;
  fetch?: FetchLike;
}

/** The only place that assembles concrete providers; unused providers stay untouched. */
export function searchWeb(
  request: SearchRequest,
  config: ResolvedWebSearchConfig,
  runtime: SearchRuntime = {},
  signal?: AbortSignal,
): Promise<RoutedSearchResponse> {
  const router = new WebSearchRouter({
    searxng: () =>
      createSearxngProvider({
        baseUrl: config.searxngUrl,
        apiKey: config.searxngApiKey,
        timeoutMs: config.timeoutMs,
        fetch: runtime.fetch,
      }),
    "codex-alpha-search": () =>
      createCodexProvider({
        model: config.codexModel,
        timeoutMs: config.timeoutMs,
        fetch: runtime.fetch,
        resolveAuth: () => resolveCodexAuth(runtime.modelRegistry),
      }),
  });
  return router.search(
    request,
    {
      provider: config.provider,
      fallback: config.fallback,
      fallbackProvider: config.fallbackProvider,
    },
    signal,
  );
}
