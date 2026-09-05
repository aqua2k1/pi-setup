# Web search adapter research and migration notes

## Scope

The Pi extension in `agent/extensions/web-search/` is a small HTTP adapter, not a replacement model provider. During development, load it with `pi --no-extensions -e ./agent/extensions/web-search/index.ts` so the legacy package does not register a duplicate `web_search` tool. It owns routing, configuration, result normalization, and safe errors. Pi continues to own OpenAI Codex OAuth and token refresh.

## Provider decisions

### SearXNG

SearXNG is the default provider because it can run locally and keeps ordinary searches under the operator's control.

- URL: `SEARXNG_URL`, then the built-in `http://localhost:8080` default
- Optional reverse-proxy authentication: `SEARXNG_API_KEY` only
- Non-secret routing and search settings live in `web-search-config.json`
- Request: `GET {baseUrl}/search?format=json&q=...`
- `domains` are expressed as `site:hostname` query filters.
- `recency_days` is mapped to SearXNG's coarse `time_range` values (`day`, `week`, `month`, `year`).
- Result URLs are restricted to HTTP(S), deduplicated, and normalized.

SearXNG itself does not define a universal API-key protocol. The Bearer header is intended for an instance protected by a reverse proxy.

### Codex alpha/search

The Codex adapter is experimental and disabled unless selected explicitly or enabled through fallback configuration.

The current Codex source defines `SearchRequest` with `id`, `model`, `commands`, and `settings`. A minimal request used by the adapter is:

```json
{
  "id": "generated-request-id",
  "model": "gpt-5.4",
  "commands": {
    "search_query": [
      {
        "q": "example query",
        "recency": 7,
        "domains": ["example.com"]
      }
    ]
  },
  "settings": {
    "allowed_callers": ["direct"],
    "external_web_access": true
  }
}
```

The adapter posts that shape to the fixed endpoint:

```text
https://chatgpt.com/backend-api/codex/alpha/search
```

It sends the already-resolved Pi OAuth identity as request headers. It does not accept a Codex token or endpoint from the web-search config file.

## Authentication boundary

`/login openai-codex` gives Pi an OAuth credential containing an access token, refresh token, expiry, and account identity. `ModelRegistry.getApiKeyAndHeaders()` resolves the current access token and lets Pi refresh it when needed. The extension uses that API rather than reading Pi's auth store or the standalone Codex CLI's auth store.

The public registry API currently does not expose the Codex account ID separately. The adapter therefore decodes the access-token payload in memory to read `https://api.openai.com/auth.chatgpt_account_id`. It does not verify or sign JWTs, persist the decoded payload, or print the token. The remote service remains responsible for authenticating the token.

If Pi later exposes the account ID as part of resolved OAuth metadata, the JWT payload fallback should be removed.

## Routing and fallback

The selected provider is resolved in this order:

1. per-call `provider` tool parameter;
2. `routing.provider` in `web-search-config.json`;
3. `searxng`.

Fallback is configured only by the JSON `routing.fallback` and
`routing.fallbackProvider` fields and is disabled by default. When explicitly
enabled, the configured fallback adapter is tried after a classified provider
failure. This is intentionally opt-in because fallback from local SearXNG to
Codex can disclose a query to ChatGPT.

## Error and security requirements

The extension classifies failures as:

- `invalid-config`
- `auth`
- `unsupported`
- `rate-limit`
- `network`
- `timeout`
- `invalid-response`
- `cancelled`
- `server`

HTTP response bodies are not copied into errors. Tool details contain only normalized results, query metadata, provider name, and result count. Token-like text is redacted as a defense against an upstream proxy echoing credentials.

## Migration status

The first phase registers only `web_search`. `@juicesharp/rpiv-web-tools` remains in `agent/settings.json` for its existing `web_fetch` behavior, so the old package must be removed or filtered before this extension is enabled globally. A later phase should either provide a compatible `web_fetch` implementation or keep the old package's fetch surface explicitly documented.

## Evidence

- Pi OAuth and model registry: `@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js`, `@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts`
- Codex endpoint path: `codex-rs/codex-api/src/endpoint/search.rs`
- Codex request and response types: `codex-rs/codex-api/src/search.rs`
- Codex login and credential persistence: `codex-rs/login/src/server.rs`, `codex-rs/login/src/auth/manager.rs`, `codex-rs/login/src/token_data.rs`
- SearXNG API: <https://docs.searxng.org/dev/search_api.html>
