import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  createProject,
  fetchModels,
  fetchProject,
  fetchProjects,
  fetchApi
} from "../../src/web/api/client.js";
import {
  healthResponseSchema,
  projectListResponseSchema
} from "../../src/schema/api.js";

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

  it("uses a protocol error when a model success response is malformed", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: { models: [], cached: false } }, 200);

    await expect(fetchModels()).rejects.toBeInstanceOf(ApiClientProtocolError);
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

  it("uses the shared project response schemas for list, create, and detail", async () => {
    const project = createEmptyVideoProject({
      projectId: "client-project",
      title: "クライアントテスト",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input) === "/api/projects") {
        if (init?.method === "POST") {
          return jsonResponse({ data: project, revision: 0 }, 200);
        }
        return jsonResponse(
          {
            data: [
              {
                id: project.metadata.id,
                title: project.metadata.title,
                department: project.metadata.department,
                manualVersion: project.metadata.manualVersion,
                revision: project.revision,
                createdAt: project.metadata.createdAt,
                updatedAt: project.metadata.updatedAt
              }
            ]
          },
          200
        );
      }

      return jsonResponse({ data: project }, 200);
    };

    await expect(fetchProjects()).resolves.toHaveLength(1);
    await expect(
      createProject({ title: "クライアントテスト" })
    ).resolves.toEqual(project);
    await expect(fetchProject(project.metadata.id)).resolves.toEqual(project);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(calls[1]?.init?.headers).toEqual({
      "content-type": "application/json"
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      title: "クライアントテスト"
    });
    expect(projectListResponseSchema.safeParse({ data: [] }).success).toBe(
      true
    );
  });
});
