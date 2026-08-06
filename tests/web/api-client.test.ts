import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  approveProjectOutline,
  approveProjectScript,
  createProject,
  fetchModels,
  fetchProject,
  fetchProjects,
  fetchApi,
  generateProjectOutline,
  reviewProjectOutline,
  saveProjectOutline,
  fetchTerminology,
  createTerminology,
  updateTerminology,
  deactivateTerminology,
  activateTerminology,
  previewTerminology
} from "../../src/web/lib/api-client.js";
import {
  healthResponseSchema,
  projectListResponseSchema,
  terminologyPreviewResponseSchema,
  terminologyTermResponseSchema
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

  it("uses the shared mutation contract for outline mutations", async () => {
    const project = createEmptyVideoProject({
      projectId: "outline-client-project",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: project, revision: project.revision }, 200);
    };

    await expect(
      saveProjectOutline(project.metadata.id, {
        outline: project.outline,
        expectedRevision: project.revision
      })
    ).resolves.toEqual(project);
    await expect(
      generateProjectOutline(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).resolves.toEqual(project);
    await expect(
      approveProjectOutline(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).resolves.toEqual(project);
    await expect(
      reviewProjectOutline(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).resolves.toEqual(project);

    expect(calls.map((call) => call.input)).toEqual([
      "/api/projects/outline-client-project/outline",
      "/api/projects/outline-client-project/outline/generate",
      "/api/projects/outline-client-project/outline/approve",
      "/api/projects/outline-client-project/outline/review"
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      outline: project.outline,
      expectedRevision: project.revision
    });
    expect(JSON.parse(String(calls[2]?.init?.body))).toEqual({
      expectedRevision: project.revision
    });
  });

  it("uses the shared mutation contract for script approval", async () => {
    const project = createEmptyVideoProject({
      projectId: "script-client-project",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: project, revision: project.revision }, 200);
    };

    await expect(
      approveProjectScript(project.metadata.id, {
        expectedRevision: project.revision
      })
    ).resolves.toEqual(project);

    expect(calls.map((call) => call.input)).toEqual([
      "/api/projects/script-client-project/script/approve"
    ]);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      expectedRevision: project.revision
    });
  });

  it("uses shared terminology schemas and safely encodes search filters", async () => {
    const term = {
      termId: "client-term",
      surface: "A_%",
      normalizedSurface: "A_%",
      readingKatakana: "エー・パーセント",
      category: "other",
      priority: -2,
      notes: "client",
      status: "active" as const,
      createdAt: "2026-08-06T00:00:00.000Z",
      updatedAt: "2026-08-06T00:00:00.000Z"
    };
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).startsWith("/api/terminology?")) {
        return jsonResponse({ data: [term] }, 200);
      }
      return jsonResponse({ data: term }, 200);
    };

    await expect(
      fetchTerminology({ surface: "%_", reading: "エー", category: " other " })
    ).resolves.toEqual([term]);
    await expect(
      createTerminology({
        surface: term.surface,
        readingKatakana: term.readingKatakana,
        category: term.category,
        priority: term.priority,
        notes: term.notes
      })
    ).resolves.toEqual(term);
    await expect(
      updateTerminology(term.termId, {
        surface: term.surface,
        readingKatakana: term.readingKatakana,
        category: term.category,
        priority: term.priority,
        notes: term.notes
      })
    ).resolves.toEqual(term);
    await expect(deactivateTerminology(term.termId)).resolves.toEqual(term);
    await expect(activateTerminology(term.termId)).resolves.toEqual(term);

    expect(calls[0]?.input).toBe(
      "/api/terminology?surface=%25_&reading=%E3%82%A8%E3%83%BC&category=other"
    );
    expect(calls[1]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      surface: term.surface,
      readingKatakana: term.readingKatakana,
      category: term.category,
      priority: term.priority,
      notes: term.notes
    });
    expect(
      terminologyTermResponseSchema.safeParse({ data: term }).success
    ).toBe(true);
  });

  it("turns malformed terminology success responses into protocol errors", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: { termId: "not-valid" } }, 200);

    await expect(fetchTerminology()).rejects.toBeInstanceOf(
      ApiClientProtocolError
    );
  });

  it("sends the preview request and validates its response", async () => {
    const result = {
      resolvedSpokenText: "READ",
      appliedTerms: [
        {
          termId: "client-term",
          surface: "A",
          reading: "READ",
          termUpdatedAt: "2026-08-06T00:00:00.000Z"
        }
      ]
    };
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: result }, 200);
    };

    await expect(
      previewTerminology({
        spokenText: "A",
        pronunciation: {
          mode: "literal",
          excludedTermIds: ["client-term"]
        }
      })
    ).resolves.toEqual(result);
    expect(calls[0]?.input).toBe("/api/terminology/preview");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      spokenText: "A",
      pronunciation: {
        mode: "literal",
        excludedTermIds: ["client-term"]
      }
    });
    expect(
      terminologyPreviewResponseSchema.safeParse({ data: result }).success
    ).toBe(true);
  });

  it("rejects malformed preview responses and preserves ApiClientError", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: { resolvedSpokenText: "READ" } }, 200);
    await expect(
      previewTerminology({
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      })
    ).rejects.toBeInstanceOf(ApiClientProtocolError);

    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "REQUEST_VALIDATION_FAILED",
            message: "invalid",
            details: [],
            requestId: "preview-error"
          }
        },
        422
      );
    await expect(
      previewTerminology({
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      })
    ).rejects.toMatchObject({
      code: "REQUEST_VALIDATION_FAILED",
      requestId: "preview-error"
    });
  });
});
