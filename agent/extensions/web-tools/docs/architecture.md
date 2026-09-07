# Web-tools architecture

`web-tools` owns two independent capabilities:

```text
web_search
  -> SearXNG or Codex alpha/search

web_fetch
  -> native HTTP for ordinary URLs
  -> GitHub API or shallow clone for GitHub repository URLs
  -> bounded temp file
  -> text preview and fullOutputPath
```

Search and fetch share the extension process and configuration file, but they do
not share provider routers, authentication, or network fallbacks.

## Layer map

```text
Pi host
└── index.ts
    ├── web_search tool
    ├── web_fetch tool
    └── /web-tools command

Boundary
├── config.ts       -> web-tools-config.json, split into search/fetch
├── composition.ts  -> lazy search/fetch assembly
└── fetch/format.ts -> bounded preview and local path metadata

Search
├── core/            -> contracts, normalization, routing, classified errors
├── providers/searxng/
└── providers/codex/ -> Codex OAuth and alpha/search wire format

Fetch
├── fetch/router.ts          -> GitHub then native HTTP dispatch
├── fetch/http.ts            -> Node fetch, timeout and streamed body
├── fetch/content.ts         -> HTML/text decoding
├── fetch/spool.ts           -> bounded temporary result files
├── fetch/github-url.ts      -> GitHub URL parsing
├── fetch/github.ts          -> clone/API strategy
├── fetch/gh-client.ts       -> gh/git process execution
└── fetch/github-content.ts  -> local repository tree/file rendering

Shared
├── shared/http.ts     -> existing search JSON transport
├── shared/results.ts  -> search result normalization
└── shared/limits.ts   -> search, fetch and GitHub limits
```

## Fetch call chain

```text
web_fetch(url, raw)
├─ readConfig()
├─ resolveConfig(raw, env)
├─ fetchWeb(request, config.fetch, runtime, signal)
│  └─ WebFetchRouter.fetch()
│     ├─ normalizeFetchRequest()
│     ├─ GitHubHandler.fetch()
│     │  ├─ parseGitHubUrl()
│     │  ├─ mode=api -> gh api
│     │  ├─ mode=auto -> repository-size probe
│     │  ├─ small repository -> CloneManager -> gh repo clone/git clone
│     │  └─ large/failing clone -> gh api
│     └─ fetchDocument()
│        ├─ Node fetch()
│        ├─ follow redirects
│        ├─ stream response into bounded spool
│        └─ decodeDocument()
├─ save final logical text as content.txt
├─ buildFetchOutput()
└─ return content + details
```

## Native HTTP

Native HTTP uses the Node global `fetch`, not a shell command. It sends a GET
request with fixed `User-Agent` and `Accept` headers, follows normal HTTP
redirects, checks the status, and streams the response body to a temporary
file. A response body larger than 1 MiB is cancelled.

The body is decoded as text, JSON, XML or HTML. HTML extraction removes script,
style, noscript and template blocks, extracts the title, converts block tags to
line breaks, and decodes entities. JavaScript is never executed.

## Temporary content

A successful text operation creates:

```text
/tmp/pi-web-fetch-<random>/content.txt
```

The file contains the final logical content that corresponds to the tool result.
`raw: true` stores raw decoded text; normal HTML fetches store extracted text.
The model receives a small inline result for short content and a preview plus
`fullOutputPath` for larger content.

The raw response is first streamed through a bounded `response.bin` and is then
converted to `content.txt`; the intermediate file is removed. Failed or
cancelled operations remove the directory.

## GitHub strategy

Supported code URLs are:

```text
https://github.com/{owner}/{repo}
https://github.com/{owner}/{repo}/blob/{ref}/{path}
https://github.com/{owner}/{repo}/tree/{ref}/{path}
```

Issue, pull request, release, action, wiki and other UI pages use native HTTP.

`mode=auto` resolves repository metadata through `gh api`. Small repositories
use a shallow, single-branch clone. The clone is cached under a hashed key so
owner, repository and ref cannot create arbitrary local paths. The repository
path is returned as `repositoryPath`; generated tree or file content is also
saved to `content.txt`.

The clone does not recurse into submodules, install dependencies, run hooks,
or execute repository files. A clone timeout, missing command or failed clone
can fall back to API access. `mode=api` never clones.

`gh` owns GitHub authentication. The extension invokes `gh` and `git` with
argument arrays and `shell: false`; tokens are not placed in arguments.

## Configuration and boundaries

The single configuration file is:

```text
~/.pi/agent/web-tools-config.json
```

Persistent settings are namespaced under `search` and `fetch`. SearXNG URL/key
and GitHub credentials stay outside JSON: SearXNG uses environment variables,
and GitHub uses the local `gh` credential store.

The implementation assumes a trusted, single-user local agent. It rejects
non-HTTP(S) URLs, bounds response and command output, and uses basic temporary
file permissions, but it does not attempt to be a complete SSRF sandbox or
protect against a host-level bash escape.

## Codex boundary

Codex is only a search provider. Its Rust `web.run(open)` implementation sends
an `open` command to a remote Codex `alpha/search` service through a Rust HTTP
client. This extension deliberately does not implement or call that path for
`web_fetch`.
