import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ResolvedGitHubFetchConfig } from "../config.ts";
import {
  MAX_GITHUB_SESSION_CLONES,
  MAX_GITHUB_TREE_ENTRIES,
  TEMP_SPOOL_TTL_MS,
} from "../shared/limits.ts";
import { isBinaryFileName, limitReadme } from "./content.ts";
import { assertNotCancelled, WebFetchError } from "./errors.ts";
import { GhClient } from "./gh-client.ts";
import { generateCloneContent } from "./github-content.ts";
import {
  encodeGitHubPath,
  type GitHubUrlInfo,
  parseGitHubUrl,
} from "./github-url.ts";
import { createTempSpool } from "./spool.ts";
import type {
  FetchHandler,
  FetchRequest,
  FetchResponse,
  FetchRuntime,
} from "./types.ts";

const CLONE_CACHE_PREFIX = "pi-web-tools-clone-";
const CLONE_TEMP_PREFIX = ".pi-web-tools-clone-tmp-";
const GITHUB_SOURCE = "github-gh";
const CLONE_SOURCE = "github-clone";

interface ApiTreeEntry {
  path?: unknown;
  type?: unknown;
  size?: unknown;
}

function cacheKey(info: GitHubUrlInfo, ref?: string): string {
  return `${info.owner}/${info.repo}@${ref ?? "default"}`;
}

function cloneDirectory(basePath: string, key: string): string {
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 24);
  return join(basePath, `${CLONE_CACHE_PREFIX}${digest}`);
}

async function cleanupExpiredClones(
  basePath: string,
  now: number,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(basePath);
  } catch {
    return;
  }
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.startsWith(CLONE_CACHE_PREFIX) ||
          entry.startsWith(CLONE_TEMP_PREFIX),
      )
      .map(async (entry) => {
        const path = join(basePath, entry);
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

function titleFor(info: GitHubUrlInfo): string {
  return info.path
    ? `${info.owner}/${info.repo} - ${info.path}`
    : `${info.owner}/${info.repo}`;
}

function decodeBase64(value: string): Buffer {
  return Buffer.from(value.replace(/\s+/g, ""), "base64");
}

function isBinaryBytes(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

function formatSize(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

export interface GitHubHandlerOptions {
  config: ResolvedGitHubFetchConfig;
  runtime?: FetchRuntime;
}

export class GitHubHandler implements FetchHandler {
  private readonly config: ResolvedGitHubFetchConfig;
  private readonly gh: GhClient;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly clones = new Map<string, Promise<string | null>>();
  private cloneCount = 0;

  constructor(options: GitHubHandlerOptions) {
    this.config = { ...options.config };
    this.now = options.runtime?.now ?? Date.now;
    this.uuid = options.runtime?.uuid ?? randomUUID;
    this.gh = new GhClient({
      command: options.runtime?.command,
      timeoutMs: options.config.cloneTimeoutSeconds * 1_000,
    });
  }

  async fetch(
    request: FetchRequest,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    const stableRequest: FetchRequest = {
      url: new URL(request.url.toString()),
      raw: request.raw,
    };
    if (!this.config.enabled) return null;
    const info = parseGitHubUrl(stableRequest.url);
    if (!info) return null;
    assertNotCancelled(signal);

    await cleanupExpiredClones(this.config.clonePath, this.now());
    const metadata = await this.gh.repoMetadata(info.owner, info.repo, signal);
    const ref = info.ref ?? metadata?.defaultBranch;
    if (info.refIsFullSha || this.config.mode === "api") {
      return (await this.fetchViaApi(stableRequest, info, ref, signal)) ?? null;
    }

    if (
      this.config.mode === "auto" &&
      metadata?.sizeMB !== undefined &&
      metadata.sizeMB > this.config.maxRepoSizeMB
    ) {
      const apiResult = await this.fetchViaApi(
        stableRequest,
        info,
        ref,
        signal,
      );
      if (apiResult) return apiResult;
    }

    let cloned: string | null;
    try {
      cloned = await this.getOrClone(info, ref, signal);
    } catch (error) {
      if (
        error instanceof WebFetchError &&
        ["request", "timeout", "tool-unavailable"].includes(error.code)
      ) {
        const apiResult = await this.fetchViaApi(
          stableRequest,
          info,
          ref,
          signal,
        );
        if (apiResult) return apiResult;
        return null;
      }
      throw error;
    }
    if (cloned) {
      const content = await generateCloneContent(cloned, info);
      return this.storeResponse(
        stableRequest,
        content.text,
        content.title,
        content.contentType,
        content.contentLength,
        CLONE_SOURCE,
        cloned,
        content.truncated ?? false,
      );
    }

    return this.fetchViaApi(stableRequest, info, ref, signal);
  }

  private async getOrClone(
    info: GitHubUrlInfo,
    ref: string | undefined,
    signal?: AbortSignal,
  ): Promise<string | null> {
    assertNotCancelled(signal);
    const key = cacheKey(info, ref);
    const cached = this.clones.get(key);
    if (cached) {
      let existing: string | null;
      try {
        existing = await cached;
      } catch (error) {
        this.clones.delete(key);
        throw error;
      }
      if (existing) {
        try {
          await stat(existing);
          return existing;
        } catch {
          this.clones.delete(key);
        }
      } else {
        this.clones.delete(key);
        return null;
      }
    }
    if (this.cloneCount >= MAX_GITHUB_SESSION_CLONES) return null;

    const path = cloneDirectory(this.config.clonePath, key);
    const promise = this.clone(info, ref, path, signal);
    this.clones.set(key, promise);
    const result = await promise;
    if (!result) this.clones.delete(key);
    return result;
  }

  private async clone(
    info: GitHubUrlInfo,
    ref: string | undefined,
    finalPath: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const parent = this.config.clonePath;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700).catch(() => {});
    const temporaryPath = join(parent, `${CLONE_TEMP_PREFIX}${this.uuid()}`);
    await rm(finalPath, { recursive: true, force: true });
    await rm(temporaryPath, { recursive: true, force: true });
    try {
      const cloned = await this.gh.clone({
        owner: info.owner,
        repo: info.repo,
        ref,
        destination: temporaryPath,
        timeoutMs: this.config.cloneTimeoutSeconds * 1_000,
        signal,
      });
      if (!cloned) {
        await rm(temporaryPath, { recursive: true, force: true });
        return null;
      }
      await chmod(temporaryPath, 0o700).catch(() => {});
      await rename(temporaryPath, finalPath);
      this.cloneCount++;
      return finalPath;
    } catch (error) {
      await rm(temporaryPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  private async fetchViaApi(
    request: FetchRequest,
    info: GitHubUrlInfo,
    ref: string | undefined,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null> {
    if (!ref) return null;
    const encodedRef = encodeURIComponent(ref);
    if (info.type === "blob" && info.path) {
      const endpoint = `repos/${info.owner}/${info.repo}/contents/${encodeGitHubPath(info.path)}?ref=${encodedRef}`;
      const result = await this.gh.apiJson(endpoint, signal);
      if (
        !result ||
        typeof result.value !== "object" ||
        result.value === null
      ) {
        return null;
      }
      const value = result.value as Record<string, unknown>;
      if (value.type !== "file" || typeof value.content !== "string")
        return null;
      const bytes = decodeBase64(value.content);
      const binary = isBinaryFileName(info.path) || isBinaryBytes(bytes);
      const text = binary
        ? `Binary file (${formatSize(bytes.byteLength)}). Use a local clone to inspect it.`
        : new TextDecoder("utf-8", { fatal: false }).decode(bytes);
      return this.storeResponse(
        request,
        text,
        titleFor(info),
        binary ? "text/plain" : "text/plain",
        bytes.byteLength,
        GITHUB_SOURCE,
        undefined,
        false,
      );
    }

    const treeResult = await this.gh.apiJson(
      `repos/${info.owner}/${info.repo}/git/trees/${encodedRef}?recursive=1`,
      signal,
    );
    if (!treeResult) return null;
    const tree =
      treeResult &&
      typeof treeResult.value === "object" &&
      treeResult.value !== null
        ? (treeResult.value as Record<string, unknown>)
        : undefined;
    const entries = Array.isArray(tree?.tree)
      ? (tree.tree as ApiTreeEntry[])
          .filter((entry) => typeof entry.path === "string")
          .map((entry) => ({
            path: entry.path as string,
            type: typeof entry.type === "string" ? entry.type : "",
            size: typeof entry.size === "number" ? entry.size : undefined,
          }))
      : [];
    const prefix = info.path ? `${info.path.replace(/\/$/, "")}/` : "";
    const filtered = entries
      .filter(
        (entry) =>
          !prefix || entry.path === info.path || entry.path.startsWith(prefix),
      )
      .slice(0, MAX_GITHUB_TREE_ENTRIES);
    const lines = [
      `Repository API view: ${info.owner}/${info.repo}@${ref}`,
      "",
      "## Structure",
    ];
    if (filtered.length) {
      lines.push(
        ...filtered.map((entry) =>
          entry.type === "tree"
            ? `${entry.path}/`
            : `${entry.path}${entry.size === undefined ? "" : ` (${formatSize(entry.size)})`}`,
        ),
      );
    } else {
      lines.push("(no entries found)");
    }
    if (tree?.truncated === true || entries.length > MAX_GITHUB_TREE_ENTRIES) {
      lines.push("... (tree listing truncated)");
    }

    if (info.type === "root") {
      const readme = await this.fetchReadme(info, ref, signal);
      if (readme !== undefined) lines.push("", "## README.md", readme);
    }
    lines.push(
      "",
      "This is an API-only view. Use clone mode for local repository exploration.",
    );
    return this.storeResponse(
      request,
      lines.join("\n"),
      titleFor(info),
      "text/plain",
      Buffer.byteLength(lines.join("\n"), "utf8"),
      GITHUB_SOURCE,
      undefined,
      false,
    );
  }

  private async fetchReadme(
    info: GitHubUrlInfo,
    ref: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    const result = await this.gh.apiJson(
      `repos/${info.owner}/${info.repo}/readme?ref=${encodeURIComponent(ref)}`,
      signal,
    );
    if (!result || typeof result.value !== "object" || result.value === null) {
      return undefined;
    }
    const content = (result.value as Record<string, unknown>).content;
    if (typeof content !== "string") return undefined;
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
      decodeBase64(content),
    );
    return limitReadme(decoded);
  }

  private async storeResponse(
    request: FetchRequest,
    text: string,
    title: string,
    contentType: string,
    contentLength: number | undefined,
    source: "github-gh" | "github-clone",
    repositoryPath: string | undefined,
    alreadyTruncated: boolean,
  ): Promise<FetchResponse> {
    const spool = await createTempSpool();
    try {
      const bounded = await spool.saveText(text);
      const truncated = alreadyTruncated || bounded.truncated;
      return {
        text: bounded.text,
        title,
        contentType,
        contentLength,
        finalUrl: request.url.toString(),
        source,
        expiresAt: new Date(this.now() + TEMP_SPOOL_TTL_MS).toISOString(),
        fullOutputPath: spool.contentPath,
        ...(repositoryPath ? { repositoryPath } : {}),
        ...(truncated
          ? {
              truncation: {
                totalBytes: contentLength ?? bounded.totalBytes,
                outputBytes: bounded.outputBytes,
              },
            }
          : {}),
      };
    } catch (error) {
      await spool.cleanup();
      throw error;
    }
  }
}
