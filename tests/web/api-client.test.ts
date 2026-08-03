import { afterEach, describe, expect, it } from "vitest";

import {
  ApiClientError,
  ApiClientProtocolError,
  fetchApi
} from "../../src/web/api/client.js";
import { healthResponseSchema } from "../../src/schema/api.js";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

describe("web API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("preserves the common error contract for non-2xx responses", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "PROJECT_REVISION_CONFLICT",
            message: "プロジェクトが別の内容へ更新されています。",
            details: [
              {
                path: ["project", "revision"],
                message: "revisionを確認してください。"
              }
            ],
            requestId: "req-client-error"
          }
        },
        409
      );

    let caught: unknown;
    try {
      await fetchApi("/api/project", healthResponseSchema);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    if (!(caught instanceof ApiClientError)) {
      throw new Error("expected ApiClientError");
    }

    expect(caught.data).toEqual({
      status: 409,
      code: "PROJECT_REVISION_CONFLICT",
      message: "プロジェクトが別の内容へ更新されています。",
      details: [
        {
          path: ["project", "revision"],
          message: "revisionを確認してください。"
        }
      ],
      requestId: "req-client-error"
    });
    expect(caught.status).toBe(409);
    expect(caught.code).toBe("PROJECT_REVISION_CONFLICT");
    expect(caught.requestId).toBe("req-client-error");
  });

  it("returns validated success data", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          data: {
            status: "ok"
          }
        },
        200
      );

    await expect(
      fetchApi("/api/health", healthResponseSchema)
    ).resolves.toEqual({
      data: {
        status: "ok"
      }
    });
  });

  it("uses a protocol error when an error response is not the common shape", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "INCOMPLETE"
          }
        },
        500
      );

    let caught: unknown;
    try {
      await fetchApi("/api/health", healthResponseSchema);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientProtocolError);
  });
});
