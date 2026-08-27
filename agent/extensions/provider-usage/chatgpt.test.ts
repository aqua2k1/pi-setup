import assert from "node:assert/strict";
import { test } from "node:test";
import { chatgptSource } from "./chatgpt.js";

test("chatgpt usage combines reset countdowns for every window", async () => {
  const now = 1_700_000_000_000;
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const resetAt = (milliseconds: number) => (now + milliseconds) / 1000;

  Date.now = () => now;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 5 * 60 * 60,
            reset_at: resetAt(2 * 60 * 60 * 1000),
          },
          secondary_window: {
            used_percent: 20,
            limit_window_seconds: 7 * 24 * 60 * 60,
            reset_at: resetAt(3 * 24 * 60 * 60 * 1000),
          },
          monthly_window: {
            used_percent: 30,
            limit_window_seconds: 30 * 24 * 60 * 60,
            reset_at: resetAt(24 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const result = await chatgptSource.fetch(
      "token",
      new AbortController().signal,
    );
    assert.equal(
      result?.line,
      "ChatGPT plus · 5h: 10% · weekly: 20% · monthly: 30% · resets in 2h/3d/24d",
    );
  } finally {
    Date.now = originalNow;
    globalThis.fetch = originalFetch;
  }
});
