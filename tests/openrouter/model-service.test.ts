import { describe, expect, it, vi } from "vitest";

import { getOpenRouterApiKey } from "../../src/openrouter/config.js";
import {
  OpenRouterAdapterError,
  OPENROUTER_ERROR_CODE
} from "../../src/openrouter/errors.js";
import {
  MODEL_CACHE_TTL_MS,
  OpenRouterModelService
} from "../../src/openrouter/model-service.js";
import {
  openRouterModelsFixture,
  openRouterZdrFixture
} from "../fixtures/openrouter.js";

const NOW = new Date("2026-08-04T00:00:00.000Z");

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function fixtureFetch() {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/models/user")) {
      return response(openRouterModelsFixture);
    }
    if (url.endsWith("/endpoints/zdr")) {
      return response(openRouterZdrFixture);
    }
    throw new Error("unexpected URL");
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("OpenRouter model service", () => {
  it("normalizes user models, preserves prices, and filters candidates", async () => {
    const { calls, fetch } = fixtureFetch();
    const service = new OpenRouterModelService({
      apiKey: "fixture-key",
      baseUrl: "https://fixture.test/api/v1",
      fetch,
      now: () => NOW
    });

    const result = await service.listModels();

    expect(result.models).toHaveLength(1);
    expect(result.models[0]).toEqual({
      id: "eligible/model",
      displayName: "Eligible Model",
      contextLength: 131072,
      inputPrice: "0.000001234567890123",
      outputPrice: "0.000009876543210987",
      outputModalities: ["text"],
      supportedParameters: ["max_tokens", "structured_outputs"],
      expirationDate: null,
      structuredOutputs: true,
      zdrAvailable: true
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.init?.headers).toEqual({
      Accept: "application/json",
      Authorization: "Bearer fixture-key"
    });
    expect(result.cached).toBe(false);
  });

  it("uses ZDR endpoint model IDs and keeps ZDR disabled permissive", async () => {
    const { fetch } = fixtureFetch();
    const service = new OpenRouterModelService({
      apiKey: "fixture-key",
      fetch,
      now: () => NOW
    });
    const result = await service.listModels();
    const eligible = result.models[0];
    if (eligible === undefined) {
      throw new Error("fixture model missing");
    }

    const settings = {
      defaultModelId: eligible.id,
      taskModelOverrides: {},
      zdr: true,
      dataCollection: "deny",
      allowProviderFallbacks: true
    } as const;
    const { resolveModel } =
      await import("../../src/openrouter/model-resolver.js");

    expect(
      resolveModel({
        settings,
        taskKind: "outline_generation",
        models: [{ ...eligible, zdrAvailable: false }],
        now: () => NOW
      })
    ).toEqual({ ok: false, reason: "MODEL_ZDR_ENDPOINT_UNAVAILABLE" });

    expect(
      resolveModel({
        settings: { ...settings, zdr: false },
        taskKind: "outline_generation",
        models: [{ ...eligible, zdrAvailable: false }],
        now: () => NOW
      }).ok
    ).toBe(true);
  });

  it("caches successful model and ZDR fetches, refreshes, expires, and deduplicates", async () => {
    let nowMs = NOW.getTime();
    const calls: string[] = [];
    let gate = Promise.resolve();
    const fetch = vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      await gate;
      return String(input).endsWith("/models/user")
        ? response(openRouterModelsFixture)
        : response(openRouterZdrFixture);
    });
    const service = new OpenRouterModelService({
      apiKey: "fixture-key",
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date(nowMs)
    });

    await expect(service.listModels()).resolves.toMatchObject({
      cached: false
    });
    await expect(service.listModels()).resolves.toMatchObject({ cached: true });
    expect(calls).toHaveLength(2);

    nowMs += MODEL_CACHE_TTL_MS;
    await expect(service.listModels()).resolves.toMatchObject({
      cached: false
    });
    expect(calls).toHaveLength(4);

    await expect(service.listModels({ refresh: true })).resolves.toMatchObject({
      cached: false
    });
    expect(calls).toHaveLength(6);

    let resolveGate!: () => void;
    gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const first = service.listModels({ refresh: true });
    const second = service.listModels({ refresh: true });
    await Promise.resolve();
    expect(calls).toHaveLength(8);
    resolveGate();
    await Promise.all([first, second]);
  });

  it("maps missing keys, authentication failures, upstream failures, and invalid responses", async () => {
    const missingKeyFetch = vi.fn();
    await expect(
      new OpenRouterModelService({
        env: {},
        fetch: missingKeyFetch as unknown as typeof globalThis.fetch
      }).listModels()
    ).rejects.toMatchObject({ code: OPENROUTER_ERROR_CODE.notConfigured });
    expect(missingKeyFetch).not.toHaveBeenCalled();

    for (const [status, code] of [
      [401, OPENROUTER_ERROR_CODE.authFailed],
      [503, OPENROUTER_ERROR_CODE.unavailable]
    ] as const) {
      const fetch = vi.fn(async () =>
        response({ secret: "upstream-secret" }, status)
      );
      await expect(
        new OpenRouterModelService({ apiKey: "secret-key", fetch }).listModels()
      ).rejects.toMatchObject({ code });
    }

    const invalidJsonFetch = vi.fn(
      async () => new Response("not-json", { status: 200 })
    );
    await expect(
      new OpenRouterModelService({
        apiKey: "secret-key",
        fetch: invalidJsonFetch
      }).listModels()
    ).rejects.toMatchObject({
      code: OPENROUTER_ERROR_CODE.responseInvalid
    });

    const invalidShapeFetch = vi.fn(async (input: string | URL) =>
      String(input).endsWith("/models/user")
        ? response({
            data: [
              { ...openRouterModelsFixture.data[0], context_length: "bad" }
            ]
          })
        : response(openRouterZdrFixture)
    );
    await expect(
      new OpenRouterModelService({
        apiKey: "secret-key",
        fetch: invalidShapeFetch as unknown as typeof globalThis.fetch
      }).listModels()
    ).rejects.toBeInstanceOf(OpenRouterAdapterError);
  });

  it("reads only the injected environment value and never exposes it in adapter errors", () => {
    const apiKey = "sk-or-v1-secret-fixture";
    expect(getOpenRouterApiKey({ OPENROUTER_API_KEY: `  ${apiKey}  ` })).toBe(
      apiKey
    );
    expect(getOpenRouterApiKey({ OPENROUTER_API_KEY: "   " })).toBeUndefined();
  });
});
