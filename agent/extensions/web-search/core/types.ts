export const WEB_SEARCH_PROVIDER_NAMES = [
  "searxng",
  "codex-alpha-search",
] as const;

export type WebSearchProviderName = (typeof WEB_SEARCH_PROVIDER_NAMES)[number];

export interface SearchRequest {
  query: string;
  maxResults: number;
  domains?: string[];
  recencyDays?: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/** Providers return sanitized, bounded data, never their raw wire response. */
export interface SearchResponse {
  query: string;
  results: SearchResult[];
  summary?: string;
  truncated?: boolean;
}

/** The router passes a normalized request to each provider. */
export interface SearchProvider {
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResponse>;
}

export interface RoutedSearchResponse extends SearchResponse {
  provider: WebSearchProviderName;
}
