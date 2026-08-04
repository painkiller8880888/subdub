import { describe, expect, it, vi } from "vitest";

import {
  OpenRouterHttpClient,
  parseRetryAfter
} from "../../src/openrouter/http-client.js";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function client(responses: Response[], sleeps: number[], now = () => NOW) {
  let index = 0;
  const fetch = vi.fn(async () => {
    const response = responses[index];
    index += 1;
    if (response === undefined) {
      throw new Error("fixture response exhausted");
    }
    return response;
  });
  return {
    fetch,
    client: new OpenRouterHttpClient({
      apiKey: "fixture-key",
      baseUrl: "https://fixture.test/api/v1",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      now
    })
  };
}

describe("OpenRouterHttpClient", () => {
  it("parses delta-seconds and HTTP-date Retry-After values", () => {
    expect(parseRetryAfter("0.25", NOW.getTime())).toBe(250);
    expect(
      parseRetryAfter(
        new Date(NOW.getTime() + 750).toUTCString(),
        NOW.getTime()
      )
    ).toBeGreaterThanOrEqual(0);
    expect(parseRetryAfter("invalid", NOW.getTime())).toBeUndefined();
  });

  it("prioritizes Retry-After for 429 and 503, then stops after three attempts", async () => {
    const sleeps: number[] = [];
    const fixture = client(
      [
        new Response("rate", {
          status: 429,
          headers: { "retry-after": "0.25" }
        }),
        new Response("busy", {
          status: 503,
          headers: { "retry-after": "0.5" }
        }),
        new Response("still busy", { status: 503 })
      ],
      sleeps
    );

    await expect(
      fixture.client.request("/chat/completions")
    ).rejects.toMatchObject({
      upstreamStatus: 503,
      attempts: 3
    });
    expect(fixture.fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([250, 500]);
  });

  it("uses bounded exponential backoff for 502 and does not retry auth or balance errors", async () => {
    const sleeps: number[] = [];
    const gateway = client(
      [
        new Response("gateway", { status: 502 }),
        new Response("gateway", { status: 502 }),
        new Response("ok", { status: 200 })
      ],
      sleeps
    );
    await expect(gateway.client.request("/models/user")).resolves.toMatchObject(
      {
        attempts: 3
      }
    );
    expect(sleeps).toEqual([100, 200]);

    const authSleeps: number[] = [];
    const auth = client(
      [new Response("unauthorized", { status: 401 })],
      authSleeps
    );
    await expect(auth.client.request("/models/user")).rejects.toMatchObject({
      code: "OPENROUTER_AUTH_FAILED",
      attempts: 1
    });
    expect(auth.fetch).toHaveBeenCalledTimes(1);
    expect(authSleeps).toEqual([]);

    const payment = client([new Response("balance", { status: 402 })], []);
    await expect(payment.client.request("/models/user")).rejects.toMatchObject({
      code: "OPENROUTER_PAYMENT_REQUIRED"
    });
  });

  it("creates a fresh timeout signal for each attempt", async () => {
    const signals: AbortSignal[] = [];
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      if (init?.signal != null) {
        signals.push(init.signal);
      }
      return new Response("gateway", { status: 502 });
    });
    const sleeps: number[] = [];
    const http = new OpenRouterHttpClient({
      apiKey: "fixture-key",
      baseUrl: "https://fixture.test/api/v1",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
      timeoutMs: 1000
    });

    await expect(http.request("/models/user")).rejects.toMatchObject({
      upstreamStatus: 502,
      attempts: 3
    });
    expect(signals).toHaveLength(3);
    expect(new Set(signals).size).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });
});
