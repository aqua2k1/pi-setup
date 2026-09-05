# Pi web search extension

This extension provides one Pi tool, `web_search`, with two adapters:

- **SearXNG** (default): a self-hosted `GET /search?format=json` adapter.
- **Codex alpha/search** (opt-in): a fixed `POST https://chatgpt.com/backend-api/codex/alpha/search` adapter that reuses Pi's existing `openai-codex` OAuth.

This extension does not provide `web_fetch`; keep a separate fetch-capable extension if needed.

Detailed documentation:

- [Architecture and abstract method call chain](docs/architecture.md)
- [Configuration file and environment variables](docs/configuration.md)
- [Research and migration notes](docs/web-search-research.md)

## Architecture

The detailed layer map, abstract method call chain, provider branches and command
paths are documented in [docs/architecture.md](docs/architecture.md).

```text
index.ts / commands.ts       Pi tool schema, progress and read-only diagnostics
composition.ts               Lazy construction of concrete providers
config.ts                    JSON/env resolution (URL and key are env-only)
core/                        Search contracts, validation, routing and classified errors
providers/searxng/           SearXNG configuration and wire format
providers/codex/             Codex configuration, Pi OAuth adapter and wire format
shared/http.ts               Deadline, redirect policy and bounded JSON transport
shared/results.ts            Request-local redaction and result normalization
format.ts                    One safe response -> tool text and details
```

The router receives provider factories, not Pi context or credentials. No provider
imports another provider. Authentication stays in the Codex adapter; only the
selected provider (and an explicitly enabled fallback) is constructed. Providers
return sanitized data, so the router must never replace its query with raw input.
There is no plugin framework, base class, global secret registry or token cache.

## Load for development

```bash
pi --no-extensions -e ./agent/extensions/web-search/index.ts
```

The repository currently also has `@juicesharp/rpiv-web-tools` configured. It registers the same `web_search` name, so do not load both providers in the same Pi process. Remove or disable the old package before enabling this extension globally.

## Configuration

The complete file schema, environment boundary, provider setup and read
semantics are documented in [docs/configuration.md](docs/configuration.md).

Configuration is stored at:

```text
~/.pi/agent/web-search-config.json
```

`PI_CODING_AGENT_DIR` changes the agent directory used by Pi and this extension.
The previous `web-search.json` file is no longer read. The complete, copyable
non-secret example is [`web-search-config.example.json`](web-search-config.example.json).

URL and key values are intentionally environment-only:

| Variable | Meaning |
| --- | --- |
| `SEARXNG_URL` | SearXNG base URL; defaults to `http://localhost:8080` |
| `SEARXNG_API_KEY` | Optional Bearer key for a reverse-proxy-authenticated SearXNG |

Routing (`routing.provider`, `routing.fallback` and
`routing.fallbackProvider`), timeout, result limits and Codex model belong in
`web-search-config.json`; they are not overridden by environment
variables. Codex OAuth tokens are never accepted in the configuration file.

Both HTTP and HTTPS SearXNG endpoints are accepted, including ordinary
self-hosted endpoints such as `http://your-searxng-host`. When a Bearer key is
used over HTTP, the endpoint should be on a trusted network or provide HTTPS at
the reverse proxy. Both providers reject redirects; configure the final SearXNG
endpoint directly.

Only a missing configuration file is optional. Malformed/unreadable files fail
with a safe error instead of silently changing defaults. Provider-specific URL,
key and model validation happens when that provider is constructed. The
extension reads this file; it does not write configuration through Pi commands.

## Commands

```text
/web-search status
/web-search test searxng
/web-search test codex-alpha-search
```

`/web-search status` reports presence and configuration sources, not URL paths,
model values, keys, headers or arbitrary registry diagnostics. Configured Codex
authentication does not by itself prove OAuth is usable. `/web-search test` makes
a real request with fallback disabled and reports only success/failure and a
result count. `test codex` is an alias. Edit
`~/.pi/agent/web-search-config.json` directly when configuration changes.

## Codex authentication boundary

The extension does not implement OAuth, read `auth.json`, refresh tokens, or use
`@openai/codex-sdk`. It calls `ModelRegistry.getProviderAuth("openai-codex")` without
model discovery. Pi owns storage and refresh; its resolved `source: "OAuth"` is
required, and API-key auth is rejected. The access token is decoded only in memory
to obtain `chatgpt_account_id`; the remote service verifies the signature.

Only required headers are sent to the fixed Codex endpoint. Registry-provided
headers/base URLs are ignored and redirects are forbidden. The deadline starts
before auth and covers fetch and body consumption. Pi's current auth facade has
no cancellation parameter: cancellation stops this extension waiting and prevents
a late search request, but cannot stop a refresh already running inside Pi.

## Tool parameters

`web_search` accepts:

- `query`
- `provider` (per-call override)
- `max_results` (1–10)
- `domains` (up to 20 hostnames)
- `recency_days` (1–3,650; SearXNG maps this to its supported coarse time range)

SearXNG combines domain hints with OR; both providers enforce hostname restrictions
before deduplication and the result limit. Bare domains include subdomains;
`*.example.com` matches subdomains only. Recency remains approximate.

## Output and credential safety

- Request-local exact redaction covers the credentials actually used by that
  provider, common URI encodings and base64 reflections. Bearer/JWT patterns are
  additional protection, not a substitute for exact matching.
- Credential-bearing result URLs are rejected before fallback titles are built.
  Sensitive query/path components and fragments are removed or redacted, including
  links embedded in summaries, titles and snippets. Deeply encoded URLs fail closed.
- Progress never echoes the query. Errors are rebuilt from allowlisted codes and
  provider names, including safe per-attempt failure codes, never raw exception text.
- Each HTTP body is capped at 1 MiB while streaming. Fields are byte-bounded;
  combined tool text/details are capped at 50 KiB / 2,000 text lines, with explicit
  `truncated` metadata. Omitted data is not written to disk.
- Terminal controls are removed and display text is Markdown-escaped. Tool text
  and details use the same sanitized response, not independent sanitizer passes.

These protections cover the extension's outbound/output boundaries, not a
compromised host/provider or arbitrary secret obfuscation. Do not put credentials
in search queries: Pi may record tool arguments before the extension executes.
Environment keys are still available to the host process; `0600` is not encryption.

## Verification

Node >=22.19 is required for native TypeScript tests. Development dependencies are
locked and type resolution is local (no paths into a user's global installation).
The Pi SDK is pinned to the tested host version, 0.85.0; `pi-server` is a development
workaround for that SDK's unbundled entrypoint import, not an extension runtime dependency.

```bash
npm --prefix agent/extensions/web-search ci --ignore-scripts
npm --prefix agent/extensions/web-search test
npm --prefix agent/extensions/web-search run typecheck
npx biome check .
```

Tests use synthetic credentials and mocked transport, plus a numeric-loopback
redirect test. They do not read real auth/config files or make live search calls.
Run live `/web-search test` separately if desired; alpha/search is an external,
undocumented API and can change independently.

Only run `npx biome format --write .` after `npx biome check .` passes.
