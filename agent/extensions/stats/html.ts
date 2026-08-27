import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { modelKeys, type StatsSnapshot, type UsageTotals } from "./core.ts";

const TEMPLATE_URL = new URL("./template.html", import.meta.url);
const DATA_PLACEHOLDER = '"{{STATS_DATA}}"';

export interface StatsHtmlModel {
  model: string;
  totalTokens: number;
  cost: number;
}

export interface StatsHtmlDate {
  day: string;
  models: StatsHtmlModel[];
}

export interface StatsHtmlData {
  generatedAt: string;
  total: UsageTotals;
  models: StatsHtmlModel[];
  dates: StatsHtmlDate[];
}

function modelData(model: string, totals: UsageTotals): StatsHtmlModel {
  return {
    model,
    totalTokens: totals.totalTokens,
    cost: totals.cost,
  };
}

export function serializeStatsSnapshot(
  snapshot: StatsSnapshot,
  generatedAt = new Date(),
): StatsHtmlData {
  const models = modelKeys(snapshot).map((model) =>
    modelData(
      model,
      snapshot.byModel.get(model) ?? { totalTokens: 0, cost: 0 },
    ),
  );
  const dates = [...snapshot.byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, modelTotals]) => ({
      day,
      models: [...modelTotals.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([model, totals]) => modelData(model, totals)),
    }));

  return {
    generatedAt: generatedAt.toISOString(),
    total: { ...snapshot.total },
    models,
    dates,
  };
}

function escapeJsonForHtml(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderStatsHtml(
  snapshot: StatsSnapshot,
  generatedAt = new Date(),
): string {
  const data = escapeJsonForHtml(
    JSON.stringify(serializeStatsSnapshot(snapshot, generatedAt)),
  );
  const template = readFileSync(TEMPLATE_URL, "utf8");
  if (!template.includes(DATA_PLACEHOLDER)) {
    throw new Error("Stats HTML template is missing its data placeholder");
  }
  return template.replace(DATA_PLACEHOLDER, data);
}

export async function writeStatsHtmlSnapshot(
  snapshot: StatsSnapshot,
  generatedAt = new Date(),
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pi-stats-"));
  const filePath = path.join(directory, "stats.html");
  try {
    await writeFile(filePath, renderStatsHtml(snapshot, generatedAt), {
      encoding: "utf8",
      mode: 0o600,
    });
    return filePath;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

function openBrowser(target: string): void {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [target]]
      : process.platform === "win32"
        ? ["rundll32", ["url.dll,FileProtocolHandler", target]]
        : ["xdg-open", [target]];

  spawn(command, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}

export async function openStatsHtml(snapshot: StatsSnapshot): Promise<string> {
  const filePath = await writeStatsHtmlSnapshot(snapshot);
  openBrowser(filePath);
  return filePath;
}
