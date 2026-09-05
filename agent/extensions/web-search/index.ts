import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerWebSearchCommand } from "./commands.ts";
import { searchWeb } from "./composition.ts";
import { readConfig, resolveConfig } from "./config.ts";
import { toWebSearchError } from "./core/errors.ts";
import { WEB_SEARCH_PROVIDER_NAMES } from "./core/types.ts";
import { buildSearchOutput } from "./format.ts";
import {
  DEFAULT_MAX_RESULTS,
  MAX_DOMAIN_COUNT,
  MAX_DOMAIN_LENGTH,
  MAX_MAX_RESULTS,
  MAX_QUERY_LENGTH,
  MAX_RECENCY_DAYS,
  MIN_MAX_RESULTS,
} from "./shared/limits.ts";

const SearchParameters = Type.Object({
  query: Type.String({
    minLength: 1,
    maxLength: MAX_QUERY_LENGTH,
    description: "The search query. Be specific and use natural language.",
  }),
  provider: Type.Optional(
    StringEnum(WEB_SEARCH_PROVIDER_NAMES, {
      description:
        "Provider for this call only. Omit to use the configured provider.",
    }),
  ),
  max_results: Type.Optional(
    Type.Integer({
      minimum: MIN_MAX_RESULTS,
      maximum: MAX_MAX_RESULTS,
      default: DEFAULT_MAX_RESULTS,
      description: "Maximum number of results to return (1-10).",
    }),
  ),
  domains: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: MAX_DOMAIN_LENGTH }), {
      maxItems: MAX_DOMAIN_COUNT,
      description: "Optional domains to restrict the search to.",
    }),
  ),
  recency_days: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_RECENCY_DAYS,
      description:
        "Only include results from approximately this many recent days.",
    }),
  ),
});

interface ToolDependencies {
  readConfig?: typeof readConfig;
  search?: typeof searchWeb;
  env?: NodeJS.ProcessEnv;
}

export function registerWebSearchTool(
  pi: ExtensionAPI,
  dependencies: ToolDependencies = {},
): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current information. Returns normalized titles, URLs, and snippets. Use for recent events, current documentation, and other information beyond the model's knowledge. Output is limited to 50 KB / 2000 lines; omitted data is not saved.",
    promptSnippet: "Search the web for up-to-date information",
    promptGuidelines: [
      "Use web_search for information beyond your training data, including recent events, current library versions, and live API documentation.",
      "After answering with search results, include a Sources section with markdown links. Do not claim a search succeeded when the tool returned an error.",
      "Domain filtering and approximate recency filtering are supported.",
    ],
    parameters: SearchParameters,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      try {
        const raw = await (dependencies.readConfig ?? readConfig)();
        const config = resolveConfig(raw, dependencies.env);
        if (params.provider) config.provider = params.provider;
        // Progress never echoes queries or credentials, even before authentication resolves.
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${config.provider}...` }],
          details: undefined,
        });
        const response = await (dependencies.search ?? searchWeb)(
          {
            query: params.query,
            maxResults: params.max_results ?? config.maxResults,
            domains: params.domains,
            recencyDays: params.recency_days,
          },
          config,
          { modelRegistry: ctx.modelRegistry },
          signal,
        );
        return buildSearchOutput(response);
      } catch (error) {
        // Includes config/auth/transport failures; no raw exception/body reaches Pi.
        throw toWebSearchError(error);
      }
    },
  });
}

export default function webSearchExtension(pi: ExtensionAPI): void {
  registerWebSearchTool(pi);
  registerWebSearchCommand(pi);
}
