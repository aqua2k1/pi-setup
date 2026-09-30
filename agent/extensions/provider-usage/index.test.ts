import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { chatgptSource } from "./chatgpt.js";
import providerUsage from "./index.js";
import { INTERVAL_MS, WIDGET_ID } from "./source.js";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;
type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type Widget = Parameters<ExtensionContext["ui"]["setWidget"]>[1];
type WidgetOptions = Parameters<ExtensionContext["ui"]["setWidget"]>[2];
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

// The host double records only public Pi calls and network requests. It does
// not access closure state, private helpers, fetch generations or cache keys.
function host(t: TestContext) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const events = new Map<string, Handler[]>();
  const commands = new Map<string, Command>();
  const credentials: string[] = [];
  const requests: string[] = [];
  const notifications: string[] = [];
  let widget: Widget;
  let status = 200;
  let percent = 10;
  let authenticated = true;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: Parameters<typeof fetch>[0]) => {
      const url = new Request(input).url;
      requests.push(url);
      if (status !== 200) return new Response(null, { status });
      if (url === "https://api.deepseek.com/user/balance") {
        return Response.json({
          is_available: true,
          balance_infos: [{ currency: "CNY", total_balance: "110.00" }],
        });
      }
      assert.equal(url, "https://chatgpt.com/backend-api/wham/usage");
      return Response.json({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: percent,
            limit_window_seconds: 18_000,
            reset_at: 0,
          },
        },
      });
    },
  );
  const ctx = {
    mode: "tui",
    hasUI: true,
    ui: {
      setWidget: (id: string, content: Widget, options?: WidgetOptions) => {
        if (id !== WIDGET_ID) return;
        if (content !== undefined)
          assert.equal(options?.placement, "belowEditor");
        widget = content;
      },
      notify: (message: string) => notifications.push(message),
    },
    modelRegistry: {
      getApiKeyForProvider: async (provider: string) => {
        credentials.push(provider);
        return authenticated ? "fixture-token" : undefined;
      },
    },
  } as unknown as ExtensionContext;
  const result = providerUsage({
    on: (name: string, handler: Handler) => {
      events.set(name, [...(events.get(name) ?? []), handler]);
      return () => {};
    },
    registerCommand: (name: string, command: Command) =>
      commands.set(name, command),
  } as unknown as ExtensionAPI);
  assert.equal(result, undefined);

  async function emit(name: string, provider?: string) {
    const model = provider === undefined ? undefined : { provider };
    ctx.model = model as ExtensionContext["model"];
    for (const handler of events.get(name) ?? []) {
      await handler({ type: name, model }, ctx);
    }
    await flush();
  }
  t.after(() => emit("session_shutdown"));
  return {
    events,
    commands,
    credentials,
    requests,
    notifications,
    emit,
    setStatus: (value: number) => {
      status = value;
    },
    setPercent: (value: number) => {
      percent = value;
    },
    setAuthenticated: (value: boolean) => {
      authenticated = value;
    },
    async tick() {
      t.mock.timers.tick(INTERVAL_MS);
      await flush();
    },
    async usage() {
      const command = commands.get("usage");
      assert.ok(command);
      await command.handler("", ctx as ExtensionCommandContext);
      await flush();
    },
    text() {
      if (!widget) return "";
      if (Array.isArray(widget)) return widget.join("\n");
      const theme = { fg: (color: string, text: string) => `${color}:${text}` };
      const component = widget(
        {} as Parameters<typeof widget>[0],
        theme as Parameters<typeof widget>[1],
      );
      return component.render(200).join("\n");
    },
  };
}

test("extension factory registers its public lifecycle and command without starting I/O", async (t) => {
  const h = host(t);
  await flush();
  for (const event of ["session_start", "model_select", "session_shutdown"]) {
    assert.ok(h.events.has(event));
  }
  assert.ok(h.commands.has("usage"));
  assert.deepEqual(h.credentials, []);
  assert.deepEqual(h.requests, []);
});

test("session and model selection follow source providers and declared aliases", async (t) => {
  const h = host(t);
  for (const provider of [
    chatgptSource.provider,
    ...(chatgptSource.aliases ?? []),
  ]) {
    await h.emit("session_start", provider);
    assert.match(h.text(), /ChatGPT/);
    assert.equal(h.credentials.at(-1), chatgptSource.provider);
  }
  await h.emit("model_select", "deepseek");
  assert.match(h.text(), /DeepSeek/);
  assert.equal(h.credentials.at(-1), "deepseek");
  for (const provider of ["unsupported-provider", undefined]) {
    await h.emit("model_select", provider);
    assert.equal(h.text(), "");
  }
});

test("usage command refreshes and reports warning state through the public UI", async (t) => {
  const h = host(t);
  await h.emit("session_start", chatgptSource.provider);
  assert.match(h.text(), /10%/);
  assert.doesNotMatch(h.text(), /warning:/);
  h.setPercent(80);
  await h.usage();
  assert.match(h.text(), /warning:.*80%/);
  assert.match(h.notifications.at(-1) ?? "", /80%/);
});

test("failed refresh preserves successful usage as stale", async (t) => {
  const h = host(t);
  await h.emit("session_start", chatgptSource.provider);
  h.setStatus(503);
  await h.usage();
  assert.match(h.text(), /10%.*stale/);
  assert.match(h.notifications.at(-1) ?? "", /stale/);
});

test("failure without cached data displays the source placeholder and HTTP reason", async (t) => {
  const h = host(t);
  h.setStatus(503);
  await h.emit("session_start", chatgptSource.provider);
  assert.ok(h.text().includes(chatgptSource.placeholder));
  assert.match(h.text(), /503/);
});

test("missing credentials prevent unauthenticated network requests", async (t) => {
  const h = host(t);
  h.setAuthenticated(false);
  await h.emit("session_start", chatgptSource.provider);
  await h.usage();
  await h.tick();
  assert.deepEqual(h.requests, []);
});

test("polling follows the public interval and ends on session shutdown", async (t) => {
  const h = host(t);
  await h.emit("session_start", chatgptSource.provider);
  const before = h.requests.length;
  await h.tick();
  assert.ok(h.requests.length > before);
  await h.emit("session_shutdown");
  const stopped = h.requests.length;
  await h.tick();
  assert.equal(h.requests.length, stopped);
  assert.equal(h.text(), "");
});
