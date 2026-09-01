import { afterEach, describe, expect, it } from "vitest";

import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  approveProjectOutline,
  rejectProjectOutline,
  approveProjectScript,
  assignProjectVisual,
  splitProjectVisualAssignment,
  createProject,
  compileProjectManifest,
  fetchModels,
  fetchProject,
  fetchProjects,
  fetchApi,
  generateProjectOutline,
  reviewProjectOutline,
  saveProjectOutline,
  rejectProjectVisualSuggestionCandidate,
  searchAssets,
  fetchTerminology,
  createTerminology,
  updateTerminology,
  deactivateTerminology,
  activateTerminology,
  previewTerminology,
  exportAiRuns,
  searchAiRuns,
  enqueueProjectPreviewRender,
  fetchProjectRenderStatus,
  projectPreviewDownloadUrl
} from "../../src/web/lib/api-client.js";
import {
  aiRunSearchResponseSchema,
  healthResponseSchema,
  projectListResponseSchema,
  manifestCompileResponseSchema,
  terminologyPreviewResponseSchema,
  terminologyTermResponseSchema,
  previewRenderAcceptedResponseSchema,
  renderRunStatusResponseSchema
} from "../../src/schema/api.js";
import { legacyVideoProjectFixture } from "../fixtures/video-project.js";

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

  it("serializes AI run filters and validates the response schema", async () => {
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return jsonResponse(
        {
          data: {
            items: [],
            summary: {
              totalCount: 0,
              validationPassedCount: 0,
              validationEvaluatedCount: 0,
              validationPassRate: null,
              responseTimeMeasuredCount: 0,
              averageResponseTimeMs: null,
              modifiedRunCount: 0,
              modificationEvaluatedCount: 0
            },
            limit: 7,
            offset: 14,
            hasNextPage: false
          }
        },
        200
      );
    };

    await expect(
      searchAiRuns({
        from: "2026-08-10T00:00:00.000Z",
        to: "2026-08-12T00:00:00.000Z",
        taskKind: "visual_search_intent",
        modelId: "google/gemma-4-31b-it",
        status: "failed",
        decision: "undecided",
        errorCode: "OPENROUTER_TIMEOUT",
        limit: 7,
        offset: 14
      })
    ).resolves.toMatchObject({ offset: 14 });

    const query = new URLSearchParams(requestUrl.split("?", 2)[1]);
    expect(query.get("from")).toBe("2026-08-10T00:00:00.000Z");
    expect(query.get("to")).toBe("2026-08-12T00:00:00.000Z");
    expect(query.get("taskKind")).toBe("visual_search_intent");
    expect(query.get("modelId")).toBe("google/gemma-4-31b-it");
    expect(query.get("status")).toBe("failed");
    expect(query.get("decision")).toBe("undecided");
    expect(query.get("errorCode")).toBe("OPENROUTER_TIMEOUT");
    expect(query.get("limit")).toBe("7");
    expect(query.get("offset")).toBe("14");
    expect(
      aiRunSearchResponseSchema.safeParse({
        data: {
          items: [],
          summary: {},
          limit: 7,
          offset: 14,
          hasNextPage: false
        }
      }).success
    ).toBe(false);
  });

  it("exports applied AI run filters without pagination and reads the filename", async () => {
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return new Response('{"exportVersion":"1.0.0"}\n', {
        status: 200,
        headers: {
          "content-type": "application/x-ndjson; charset=utf-8",
          "content-disposition": 'attachment; filename="subdub-ai-runs.jsonl"'
        }
      });
    };

    const result = await exportAiRuns({
      from: "2026-08-10T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
      taskKind: "visual_search_intent",
      modelId: "google/gemma-4-31b-it",
      status: "failed",
      decision: "undecided",
      errorCode: "OPENROUTER_TIMEOUT"
    });

    expect(result.filename).toBe("subdub-ai-runs.jsonl");
    expect(await result.blob.text()).toBe('{"exportVersion":"1.0.0"}\n');
    const queryString = requestUrl.split("?", 2)[1] ?? "";
    const query = new URLSearchParams(queryString);
    expect(query.get("from")).toBe("2026-08-10T00:00:00.000Z");
    expect(query.get("to")).toBe("2026-08-12T00:00:00.000Z");
    expect(query.get("taskKind")).toBe("visual_search_intent");
    expect(query.get("modelId")).toBe("google/gemma-4-31b-it");
    expect(query.get("status")).toBe("failed");
    expect(query.get("decision")).toBe("undecided");
    expect(query.get("errorCode")).toBe("OPENROUTER_TIMEOUT");
    expect(query.has("limit")).toBe(false);
    expect(query.has("offset")).toBe(false);
  });

  it("supports an empty export body and the default filename", async () => {
    globalThis.fetch = async () =>
      new Response("", {
        status: 200,
        headers: { "content-type": "application/x-ndjson; charset=utf-8" }
      });

    const result = await exportAiRuns();

    expect(result.filename).toBe("subdub-ai-runs.jsonl");
    expect(result.blob.size).toBe(0);
  });

  it("preserves the common error contract for export failures", async () => {
    globalThis.fetch = async () =>
      jsonResponse(
        {
          error: {
            code: "RUN_LOG_READ_FAILED",
            message: "サーバーで予期しないエラーが発生しました。",
            details: [],
            requestId: "req-export-error"
          }
        },
        500
      );

    await expect(exportAiRuns()).rejects.toMatchObject({
      code: "RUN_LOG_READ_FAILED",
      requestId: "req-export-error"
    });
  });

  it("uses a protocol error when a model success response is malformed", async () => {
    globalThis.fetch = async () =>
      jsonResponse({ data: { models: [], cached: false } }, 200);

    await expect(fetchModels()).rejects.toBeInstanceOf(ApiClientProtocolError);
  });

  it("passes normal asset tag filters through to the asset search API", async () => {
    let requestUrl = "";
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return jsonResponse(
        {
          data: {
            items: [],
            page: 1,
            pageSize: 12,
            total: 0,
            hasNextPage: false
          }
        },
        200
      );
    };

    await expect(
      searchAssets({
        q: "申請フロー",
        department: "総務部",
        system: "申請システム",
        status: "inactive",
        tagIds: ["tag-application", "tag-confirm"],
        pageSize: 12
      })
    ).resolves.toMatchObject({ total: 0 });

    const queryString = requestUrl.split("?", 2)[1] ?? "";
    const query = new URLSearchParams(queryString);
    expect(query.getAll("tagIds")).toEqual(["tag-application", "tag-confirm"]);
    expect(query.get("q")).toBe("申請フロー");
    expect(query.get("department")).toBe("総務部");
    expect(query.get("system")).toBe("申請システム");
    expect(query.get("status")).toBe("inactive");
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
        outline: legacyVideoProjectFixture.outline,
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
      outline: legacyVideoProjectFixture.outline,
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

  it("sends AI candidate metadata only when assigning a suggested visual", async () => {
    const project = createEmptyVideoProject({
      projectId: "visual-assignment-client-project",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: project, revision: project.revision }, 200);
    };
    const assignment = {
      id: "assignment-client",
      startLineId: "line-start",
      endLineId: "line-end",
      assetId: "asset-photo"
    };

    await assignProjectVisual(project.metadata.id, {
      expectedRevision: project.revision,
      assignment,
      suggestionRunId: "suggestion-client",
      reason: "candidate reason"
    });
    await assignProjectVisual(project.metadata.id, {
      expectedRevision: project.revision,
      assignment
    });

    expect(calls.map((call) => call.input)).toEqual([
      "/api/projects/visual-assignment-client-project/visual-assignments",
      "/api/projects/visual-assignment-client-project/visual-assignments"
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      expectedRevision: project.revision,
      assignment,
      suggestionRunId: "suggestion-client",
      reason: "candidate reason"
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      expectedRevision: project.revision,
      assignment
    });
  });

  it("encodes the visual assignment split endpoint and its asset version", async () => {
    const project = createEmptyVideoProject({
      projectId: "visual-split-client-project",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: project, revision: 7 }, 200);
    };

    await expect(
      splitProjectVisualAssignment(project.metadata.id, "assignment-old", {
        expectedRevision: 6,
        selectedLineId: "line-three",
        assetVersion: 3,
        assignment: {
          id: "assignment-new",
          assetId: "asset-photo"
        }
      })
    ).resolves.toEqual(project);

    expect(calls[0]?.input).toBe(
      "/api/projects/visual-split-client-project/visual-assignments/assignment-old/split"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toEqual({
      "content-type": "application/json"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      expectedRevision: 6,
      selectedLineId: "line-three",
      assetVersion: 3,
      removeOutsidePlaybackCues: false,
      assignment: {
        id: "assignment-new",
        assetId: "asset-photo"
      }
    });
  });

  it("encodes outline and visual candidate rejection endpoints with validated bodies", async () => {
    const project = createEmptyVideoProject({
      projectId: "decision-client-project",
      createdAt: "2026-08-04T00:00:00.000Z"
    });
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).includes("candidates")) {
        return jsonResponse(
          {
            data: {
              decisionId: "decision-client",
              candidateId: "candidate-client",
              decision: "rejected",
              createdAt: "2026-08-04T00:00:00.000Z"
            },
            revision: 3
          },
          200
        );
      }
      return jsonResponse({ data: project, revision: 2 }, 200);
    };

    await expect(
      rejectProjectOutline(project.metadata.id, {
        expectedRevision: 1,
        reason: " "
      })
    ).resolves.toEqual(project);
    await expect(
      rejectProjectVisualSuggestionCandidate(
        project.metadata.id,
        "suggestion-run",
        "asset-photo",
        { expectedRevision: 2, reason: "候補不一致" }
      )
    ).resolves.toMatchObject({ revision: 3 });

    expect(calls.map((call) => call.input)).toEqual([
      "/api/projects/decision-client-project/outline/reject",
      "/api/projects/decision-client-project/visual-suggestions/suggestion-run/candidates/asset-photo/reject"
    ]);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      expectedRevision: 1,
      reason: " "
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      expectedRevision: 2,
      reason: "候補不一致"
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

  it("sends the manifest compile request and preserves diagnostics", async () => {
    const result = {
      status: "failed" as const,
      reused: false,
      manifest: null,
      diagnostics: [
        {
          code: "CHARACTER_VARIANT_UNSELECTED",
          path: ["script", "sections", 0, "lines", 0, "characterVariantId"],
          message: "a physical character variant is required",
          lineId: "line-one"
        }
      ],
      warnings: [],
      runId: "manifest-run-one"
    };
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: result }, 200);
    };

    await expect(
      compileProjectManifest("manual-video-project")
    ).resolves.toEqual(result);
    expect(calls[0]?.input).toBe(
      "/api/projects/manual-video-project/manifest/compile"
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(
      manifestCompileResponseSchema.safeParse({ data: result }).success
    ).toBe(true);
  });

  it("queues a preview render, polls its status, and builds a managed download URL", async () => {
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      if (String(input).includes("/preview/render")) {
        return jsonResponse(
          {
            data: {
              runId: "preview-run",
              status: "queued",
              kind: "preview",
              previewPreset: "sd"
            }
          },
          202
        );
      }
      return jsonResponse(
        {
          data: {
            runId: "preview-run",
            projectId: "manual-video-project",
            kind: "mp4",
            renderProfile: { kind: "preview", previewPreset: "sd" },
            projectRevision: 1,
            queuedAt: "2026-08-11T00:00:00.000Z",
            status: "succeeded",
            startedAt: "2026-08-11T00:00:01.000Z",
            completedAt: "2026-08-11T00:00:02.000Z",
            outputPath: "output/previews/preview-run-sd.mp4",
            outputChecksum: "a".repeat(64)
          }
        },
        200
      );
    };

    await expect(
      enqueueProjectPreviewRender("manual-video-project", "sd")
    ).resolves.toMatchObject({
      runId: "preview-run",
      kind: "preview",
      previewPreset: "sd"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      previewPreset: "sd"
    });

    await expect(
      fetchProjectRenderStatus("manual-video-project", "preview-run")
    ).resolves.toMatchObject({
      status: "succeeded",
      outputPath: "output/previews/preview-run-sd.mp4",
      renderProfile: { kind: "preview", previewPreset: "sd" }
    });
    expect(
      projectPreviewDownloadUrl(
        "manual-video-project",
        "output/previews/preview-run-sd.mp4"
      )
    ).toBe(
      "/api/projects/manual-video-project/files/output/previews/preview-run-sd.mp4"
    );
    expect(
      previewRenderAcceptedResponseSchema.safeParse({
        data: {
          runId: "preview-run",
          status: "queued",
          kind: "preview",
          previewPreset: "sd"
        }
      }).success
    ).toBe(true);
    expect(
      renderRunStatusResponseSchema.safeParse({
        data: {
          runId: "preview-run",
          projectId: "manual-video-project",
          kind: "mp4",
          renderProfile: { kind: "preview", previewPreset: "sd" },
          projectRevision: 1,
          queuedAt: "2026-08-11T00:00:00.000Z",
          status: "succeeded",
          startedAt: "2026-08-11T00:00:01.000Z",
          completedAt: "2026-08-11T00:00:02.000Z",
          outputPath: "output/previews/preview-run-sd.mp4",
          outputChecksum: "a".repeat(64)
        }
      }).success
    ).toBe(true);
    expect(() =>
      projectPreviewDownloadUrl(
        "manual-video-project",
        "output/previews/../render-run.mp4"
      )
    ).toThrow();
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
