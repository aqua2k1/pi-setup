import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import type { ResolvedGitHubFetchConfig } from "../config.ts";
import { GitHubHandler } from "./github.ts";
import type { CommandResult, CommandRunner } from "./types.ts";

function result(overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    code: 0,
    signal: null,
    stdout: "",
    stderr: "",
    notFound: false,
    timedOut: false,
    aborted: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  };
}

function config(
  clonePath: string,
  overrides: Partial<ResolvedGitHubFetchConfig> = {},
): ResolvedGitHubFetchConfig {
  return {
    enabled: true,
    mode: "auto",
    maxRepoSizeMB: 350,
    cloneTimeoutSeconds: 30,
    clonePath,
    ...overrides,
  };
}

async function cleanupResult(path: string): Promise<void> {
  await rm(path.substring(0, path.lastIndexOf("/")), {
    recursive: true,
    force: true,
  });
}

test("GitHubHandler shallow-clones a small repository and saves content locally", async () => {
  const clonePath = `/tmp/pi-web-tools-github-test-${Date.now()}-clone`;
  let cloneCalls = 0;
  const command: CommandRunner = {
    async run(commandName, args) {
      if (commandName === "gh" && args[0] === "--version") {
        return result({ stdout: "gh version 2\n" });
      }
      if (commandName === "gh" && args[0] === "api") {
        return result({
          stdout: JSON.stringify({ default_branch: "main", size: 12 }),
        });
      }
      if (commandName === "gh" && args[0] === "repo") {
        cloneCalls++;
        const destination = args[3] as string;
        await mkdir(`${destination}/src`, { recursive: true });
        await writeFile(`${destination}/README.md`, "# Example\n");
        await writeFile(`${destination}/src/index.ts`, "export const x = 1;\n");
        return result();
      }
      return result({ code: 1 });
    },
  };
  const handler = new GitHubHandler({
    config: config(clonePath),
    runtime: { command },
  });

  const first = await handler.fetch({
    url: new URL("https://github.com/acme/project/blob/main/src/index.ts"),
    raw: false,
  });
  assert.ok(first);
  assert.equal(first.source, "github-clone");
  assert.equal(first.repositoryPath !== undefined, true);
  assert.match(first.text, /export const x = 1/);
  assert.equal(cloneCalls, 1);
  assert.equal(
    await readFile(first.fullOutputPath, "utf8").then((text) =>
      text.includes("export const x = 1"),
    ),
    true,
  );

  const second = await handler.fetch({
    url: new URL("https://github.com/acme/project"),
    raw: false,
  });
  assert.ok(second);
  assert.equal(cloneCalls, 1);
  await cleanupResult(first.fullOutputPath);
  await cleanupResult(second.fullOutputPath);
  await rm(clonePath, { recursive: true, force: true });
});

test("GitHubHandler uses gh api in api mode", async () => {
  const seen: string[][] = [];
  const command: CommandRunner = {
    async run(commandName, args) {
      seen.push([commandName, ...args]);
      if (args[0] === "--version") return result({ stdout: "gh version 2\n" });
      if (
        args[0] === "api" &&
        String(args.at(-1)).startsWith("repos/acme/project")
      ) {
        const endpoint = String(args.at(-1));
        if (endpoint.includes("contents")) {
          return result({
            stdout: JSON.stringify({
              type: "file",
              encoding: "base64",
              content: Buffer.from("hello from api\n").toString("base64"),
            }),
          });
        }
        return result({
          stdout: JSON.stringify({ default_branch: "main", size: 1 }),
        });
      }
      return result({ code: 1 });
    },
  };
  const handler = new GitHubHandler({
    config: config("/tmp/pi-web-tools-api-test", { mode: "api" }),
    runtime: { command },
  });
  const response = await handler.fetch({
    url: new URL("https://github.com/acme/project/blob/main/README.md"),
    raw: false,
  });
  assert.ok(response);
  assert.equal(response.source, "github-gh");
  assert.match(response.text, /hello from api/);
  assert.equal(
    seen.some((call) => call[0] === "gh" && call[1] === "api"),
    true,
  );
  await cleanupResult(response.fullOutputPath);
});

test("GitHubHandler falls back to public git when gh is unavailable", async () => {
  const clonePath = `/tmp/pi-web-tools-git-test-${Date.now()}`;
  const command: CommandRunner = {
    async run(commandName, args) {
      if (commandName === "gh") return result({ notFound: true, code: null });
      if (commandName === "git") {
        const destination = args.at(-1) as string;
        await mkdir(destination, { recursive: true });
        await writeFile(`${destination}/README.md`, "public repo");
        return result();
      }
      return result({ notFound: true, code: null });
    },
  };
  const handler = new GitHubHandler({
    config: config(clonePath),
    runtime: { command },
  });
  const response = await handler.fetch({
    url: new URL("https://github.com/acme/project"),
    raw: false,
  });
  assert.ok(response);
  assert.equal(response.source, "github-clone");
  assert.match(response.text, /public repo/);
  await cleanupResult(response.fullOutputPath);
  await rm(clonePath, { recursive: true, force: true });
});
