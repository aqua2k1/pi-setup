import type { FetchLike } from "../shared/http.ts";

export type FetchSource = "native-http" | "github-gh" | "github-clone";

export interface FetchRequest {
  url: URL;
  raw: boolean;
}

export interface FetchTruncation {
  totalBytes: number;
  outputBytes: number;
  totalLines?: number;
  outputLines?: number;
}

export interface FetchResponse {
  text: string;
  title?: string;
  contentType?: string;
  contentLength?: number;
  finalUrl: string;
  source: FetchSource;
  fullOutputPath: string;
  repositoryPath?: string;
  truncation?: FetchTruncation;
  expiresAt?: string;
}

export interface FetchHandler {
  fetch(
    request: FetchRequest,
    signal?: AbortSignal,
  ): Promise<FetchResponse | null>;
}

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  notFound: boolean;
  timedOut: boolean;
  aborted: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface CommandRunner {
  run(
    command: string,
    args: readonly string[],
    options: {
      cwd?: string;
      env?: NodeJS.ProcessEnv;
      signal?: AbortSignal;
      timeoutMs: number;
      maxStdoutBytes: number;
      maxStderrBytes: number;
    },
  ): Promise<CommandResult>;
}

export interface FetchRuntime {
  fetch?: FetchLike;
  command?: CommandRunner;
  github?: import("./github.ts").GitHubHandler;
}
