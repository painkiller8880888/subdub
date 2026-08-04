import { describe, expect, it, vi } from "vitest";

import { OpenRouterChatAdapter } from "../../src/openrouter/chat-adapter.js";
import { OpenRouterAdapterError } from "../../src/openrouter/errors.js";

const request = {
  modelId: "fixture/model",
  messages: [
    { role: "system" as const, content: "system" },
    { role: "user" as const, content: "user" }
  ],
  jsonSchema: { type: "object", additionalProperties: false },
  maxTokens: 100,
  zdr: true,
  dataCollection: "deny" as const,
  allowProviderFallbacks: true as const
};

function successResponse() {
  return new Response(
    JSON.stringify({
      model: "provider/model",
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"sections":[],"openQuestions":[]}' }
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      openrouter_metadata: {
        endpoints: { available: [{ provider: "Provider A", selected: true }] }
      }
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function embeddedErrorResponse(error: unknown, content = "partial JSON") {
  return new Response(
    JSON.stringify({
      model: "provider/model",
      choices: [
        {
          finish_reason: "error",
          message: { content },
          error
        }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("OpenRouterChatAdapter", () => {
  it("sends strict non-streaming JSON Schema and provider privacy settings", async () => {
    let body: Record<string, unknown> | undefined;
    const fetch = vi.fn(async (_input: string | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return successResponse();
    });
    const adapter = new OpenRouterChatAdapter({
      apiKey: "fixture-key",
      baseUrl: "https://fixture.test/api/v1",
      fetch: fetch as unknown as typeof globalThis.fetch
    });

    const result = await adapter.complete(request);

    expect(result).toMatchObject({
      responseModel: "provider/model",
      provider: "Provider A",
      attempts: 1,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
    });
    expect(body).toMatchObject({
      model: "fixture/model",
      max_tokens: 100,
      stream: false
    });
    expect(body?.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "subdub_outline_generation",
        strict: true,
        schema: request.jsonSchema
      }
    });
    expect(body?.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      allow_fallbacks: true,
      zdr: true
    });

    await adapter.complete({ ...request, zdr: false });
    expect(body?.provider).toEqual({
      require_parameters: true,
      data_collection: "deny",
      allow_fallbacks: true
    });
  });

  it("does not retry invalid content, empty content, or non-retryable status", async () => {
    const sleeps: number[] = [];
    const fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "{" } }] }),
          {
            status: 200
          }
        )
    );
    const adapter = new OpenRouterChatAdapter({
      apiKey: "fixture-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });
    await expect(adapter.complete(request)).rejects.toMatchObject({
      code: "OPENROUTER_RESPONSE_INVALID"
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);

    const unauthorized = new OpenRouterChatAdapter({
      apiKey: "fixture-key",
      fetch: vi.fn(
        async () => new Response("secret", { status: 401 })
      ) as unknown as typeof globalThis.fetch
    });
    await expect(unauthorized.complete(request)).rejects.toBeInstanceOf(
      OpenRouterAdapterError
    );
  });

  it.each([
    ["embedded 502", { code: 502 }, 502],
    [
      "embedded 503",
      { code: 500, metadata: { error_type: "provider_overloaded" } },
      503
    ],
    [
      "embedded 429",
      { code: 500, metadata: { error_type: "rate_limit_exceeded" } },
      429
    ]
  ])(
    "retries %s returned inside an HTTP 200 response",
    async (_name, error, status) => {
      const sleeps: number[] = [];
      const fetch = vi.fn(async () => embeddedErrorResponse(error));
      const adapter = new OpenRouterChatAdapter({
        apiKey: "fixture-key",
        fetch: fetch as unknown as typeof globalThis.fetch,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        }
      });

      await expect(adapter.complete(request)).rejects.toMatchObject({
        code: "OPENROUTER_UNAVAILABLE",
        upstreamStatus: status,
        attempts: 3
      });
      expect(fetch).toHaveBeenCalledTimes(3);
      expect(sleeps).toEqual([100, 200]);
    }
  );

  it("does not accept partial content after three embedded provider errors", async () => {
    const sleeps: number[] = [];
    const fetch = vi.fn(async () =>
      embeddedErrorResponse({
        code: 502,
        metadata: { error_type: "provider_unavailable" }
      })
    );
    const adapter = new OpenRouterChatAdapter({
      apiKey: "fixture-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      }
    });

    await expect(adapter.complete(request)).rejects.toMatchObject({
      code: "OPENROUTER_UNAVAILABLE",
      upstreamStatus: 502,
      attempts: 3
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 200]);
  });
});
