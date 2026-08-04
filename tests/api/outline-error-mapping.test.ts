import { describe, expect, it } from "vitest";

import { mapApiError } from "../../src/api/errors/api-error.js";
import { OpenRouterAdapterError } from "../../src/openrouter/errors.js";

describe("outline generation OpenRouter error mapping", () => {
  it("keeps authentication, balance, and retryable upstream failures distinct", () => {
    expect(
      mapApiError(
        new OpenRouterAdapterError("OPENROUTER_AUTH_FAILED", {
          upstreamStatus: 401
        })
      )
    ).toMatchObject({ code: "OPENROUTER_AUTH_FAILED", status: 502 });
    expect(
      mapApiError(
        new OpenRouterAdapterError("OPENROUTER_PAYMENT_REQUIRED", {
          upstreamStatus: 402
        })
      )
    ).toMatchObject({ code: "OPENROUTER_PAYMENT_REQUIRED", status: 402 });
    expect(
      mapApiError(
        new OpenRouterAdapterError("OPENROUTER_UNAVAILABLE", {
          upstreamStatus: 429
        })
      )
    ).toMatchObject({ code: "OPENROUTER_RATE_LIMITED", status: 429 });
    expect(
      mapApiError(
        new OpenRouterAdapterError("OPENROUTER_UNAVAILABLE", {
          upstreamStatus: 502
        })
      )
    ).toMatchObject({ code: "OPENROUTER_BAD_GATEWAY", status: 502 });
    expect(
      mapApiError(
        new OpenRouterAdapterError("OPENROUTER_UNAVAILABLE", {
          upstreamStatus: 503
        })
      )
    ).toMatchObject({ code: "OPENROUTER_UNAVAILABLE", status: 503 });
  });
});
