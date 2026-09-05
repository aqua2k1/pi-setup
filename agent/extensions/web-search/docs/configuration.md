# Web search configuration

The extension has one read-only JSON configuration file. Use environment
variables for SearXNG URLs and keys; keep all other persistent web-search
settings in JSON. Pi remains the owner of Codex OAuth credentials.

## File location

The file is:

```text
~/.pi/agent/web-search-config.json
```

The extension uses Pi's agent directory (`getAgentDir()`). Set
`PI_CODING_AGENT_DIR` when the agent directory is elsewhere; the file name
remains `web-search-config.json`.

Copy [`web-search-config.example.json`](../web-search-config.example.json) to
this location and edit it as needed. The extension never writes this file. A
missing file is equivalent to an empty configuration and uses the defaults
below. A malformed or unreadable file is an error; it is not silently replaced
with defaults.

The previous `web-search.json` path is no longer read. When migrating, copy only
`routing`, `timeoutMs`, `maxResults` and `codex.model` into the new file. Move
any old SearXNG URL/key values to
`SEARXNG_URL` and `SEARXNG_API_KEY` instead of copying them into JSON.

## Complete JSON example

`agent/extensions/web-search/web-search-config.example.json` contains all
JSON-owned settings and deliberately contains no URL or key:

```json
{
  "routing": {
    "provider": "searxng",
    "fallback": false,
    "fallbackProvider": "codex-alpha-search"
  },
  "timeoutMs": 15000,
  "maxResults": 5,
  "codex": {
    "model": "gpt-5.4"
  }
}
```

Install it with:

```bash
mkdir -p ~/.pi/agent
cp agent/extensions/web-search/web-search-config.example.json \
  ~/.pi/agent/web-search-config.json
```

### JSON fields

| Path | Type | Default | Description and validation |
| --- | --- | --- | --- |
| `routing.provider` | string | `searxng` | Primary provider: `searxng` or `codex-alpha-search`. `codex` is accepted as a normalization alias. |
| `routing.fallback` | boolean | `false` | Enable trying the configured fallback provider after an eligible classified provider failure. |
| `routing.fallbackProvider` | string | other provider | Provider to try when fallback is enabled. It must differ from `routing.provider`. |
| `timeoutMs` | integer | `15000` | One deadline for a provider attempt, including Codex auth, fetch and response-body consumption. Range: `1000`–`120000`. |
| `maxResults` | integer | `5` | Default result count for calls that omit `max_results`. Range: `1`–`10`. |
| `codex.model` | string | `gpt-5.4` | Model sent to Codex `alpha/search`. It must be 1–128 characters containing only letters, digits, `.`, `_` or `-`. |

URL and key fields under `searxng` are not part of the JSON schema. If a file
contains `searxng.url` or `searxng.apiKey`, parsing fails with an instruction to
use the environment variables instead. Unknown fields are otherwise ignored;
known fields with the wrong JSON type are rejected.

## Environment variables

Only URL and key values use environment variables:

| Variable | Used for | Default / behavior |
| --- | --- | --- |
| `SEARXNG_URL` | SearXNG base URL | `http://localhost:8080` when unset. Must be HTTP(S), without URL credentials, query or fragment. |
| `SEARXNG_API_KEY` | Optional SearXNG Bearer key | Unset by default. Used for a reverse-proxy-authenticated SearXNG. |

`PI_CODING_AGENT_DIR` selects the parent agent directory; it is not a
web-search setting. `WEB_SEARCH_PROVIDER`, `WEB_SEARCH_FALLBACK`,
`WEB_SEARCH_TIMEOUT_MS`, `WEB_SEARCH_MAX_RESULTS` and `CODEX_SEARCH_MODEL` are
not configuration inputs. Put those settings in `web-search-config.json`.

The effective values are resolved as follows:

```text
SearXNG URL:       SEARXNG_URL -> http://localhost:8080
SearXNG API key:   SEARXNG_API_KEY -> unset
Routing:           web-search-config.json:routing -> built-in route defaults
JSON settings:     web-search-config.json -> built-in defaults
Per-call provider: web_search.provider -> routing.provider
Per-call limit:    web_search.max_results -> maxResults -> default
```

`domains` and `recency_days` are request-only tool parameters and are not stored
in this file. The per-call `provider` and `max_results` overrides are transient;
they do not modify the JSON file.

## Provider-specific setup

### SearXNG

The adapter requests:

```text
GET {SEARXNG_URL}/search?format=json&q=...
```

For an unauthenticated local instance, leave `SEARXNG_URL` unset or set it in
the environment:

```bash
export SEARXNG_URL="http://localhost:8080"
```

For a reverse-proxy-authenticated instance, set both values in the environment:

```bash
export SEARXNG_URL="https://search.example"
export SEARXNG_API_KEY="<set in the host environment>"
```

An API key causes the adapter to send `Authorization: Bearer <key>`. SearXNG
does not define one universal API-key protocol; this option is intended for an
operator-controlled reverse proxy. Both HTTP and HTTPS SearXNG endpoints are
accepted, including ordinary self-hosted endpoints such as
`http://your-searxng-host`. If a Bearer key is used over HTTP, keep the endpoint
on a trusted network or provide HTTPS at the reverse proxy.

### Codex alpha/search

Select the experimental adapter in the JSON file:

```json
{
  "routing": {
    "provider": "codex-alpha-search",
    "fallback": false,
    "fallbackProvider": "searxng"
  },
  "codex": {
    "model": "gpt-5.4"
  }
}
```

Before using it, authenticate Pi with:

```text
/login openai-codex
```

The adapter calls `ModelRegistry.getProviderAuth("openai-codex")`, requires
Pi-resolved OAuth (`source: "OAuth"`), derives `chatgpt_account_id` in memory,
and posts to the fixed endpoint:

```text
https://chatgpt.com/backend-api/codex/alpha/search
```

It does not read or write OAuth storage and rejects API-key auth. The alpha/search
service is external and undocumented; its behavior may change independently of
this extension.

## Fallback and data boundaries

Fallback is disabled unless `routing.fallback` is enabled in the JSON file. When enabled,
`routing.fallbackProvider` is tried only for classified provider failures such as
authentication, rate limiting, network, timeout, invalid response or server
errors. Invalid configuration/request errors and cancellation do not trigger
fallback.

Enabling fallback from a local SearXNG instance can send the query to ChatGPT.
Use per-call `provider` to choose an adapter for one request, or use
`/web-search test <provider>` to test an adapter without fallback; `test codex`
is an alias.

The providers share an output boundary that:

- accepts only HTTP(S) result URLs and rejects URL userinfo;
- removes or redacts sensitive URL parameters, fragments and credential-like
  reflections;
- filters result hostnames before deduplication and the result limit;
- bounds query, title, snippet, summary and response-body sizes; and
- returns only normalized data to Pi.

Do not place credentials in a search query. Pi may record tool arguments before
the extension runs, and environment variables are visible to the host process.

## Diagnostic commands

The extension keeps read-only diagnostic commands; they do not edit the file:

```text
/web-search status
/web-search test searxng
/web-search test codex-alpha-search
```

`/web-search status` reports safe presence/source information and configured
authentication state. It intentionally omits URL paths, model values, keys,
headers and arbitrary registry diagnostics. `/web-search test` makes a real
request with fallback disabled and reports only success/failure and a result
count.

There is no `/web-search configure` command. Edit
`~/.pi/agent/web-search-config.json` directly and set `SEARXNG_URL`/
`SEARXNG_API_KEY` in the host environment when required.
