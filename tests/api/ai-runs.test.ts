import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { RunLogStoreError } from "../../src/app/run-log-store.js";
import { buildApp } from "../../src/api/app.js";
import { initializeServer } from "../../src/api/server.js";
import {
  aiRunSearchResponseSchema,
  apiErrorResponseSchema,
  type AiRunExportQuery,
  type AiRunSearchData,
  type AiRunSearchQuery
} from "../../src/schema/api.js";

describe("GET /api/ai-runs", () => {
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const workspaceRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(
      workspaceRoots
        .splice(0)
        .map((workspaceRoot) =>
          fs.rm(workspaceRoot, { recursive: true, force: true })
        )
    );
  });

  function emptyData(query: AiRunSearchQuery): AiRunSearchData {
    return {
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
      limit: query.limit,
      offset: query.offset,
      hasNextPage: false
    };
  }

  it("passes the strict, coerced query to the injected service", async () => {
    const search = vi.fn(async (query: AiRunSearchQuery) => emptyData(query));
    const exportJsonLines = vi.fn(async () => "");
    const app = buildApp({
      aiRunSearchService: { search, exportJsonLines }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs?from=2026-08-10T00:00:00.000Z&to=2026-08-12T00:00:00.000Z&taskKind=visual_search_intent&modelId=google%2Fgemma-4-31b-it&status=failed&decision=undecided&errorCode=OPENROUTER_TIMEOUT&limit=7&offset=14"
    });

    expect(response.statusCode).toBe(200);
    expect(aiRunSearchResponseSchema.parse(response.json()).data).toEqual(
      emptyData(search.mock.calls[0]![0])
    );
    expect(search).toHaveBeenCalledWith({
      from: "2026-08-10T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
      taskKind: "visual_search_intent",
      modelId: "google/gemma-4-31b-it",
      status: "failed",
      decision: "undecided",
      errorCode: "OPENROUTER_TIMEOUT",
      limit: 7,
      offset: 14
    });
  });

  it("rejects invalid enum, date range, and pagination query values", async () => {
    const search = vi.fn(async (query: AiRunSearchQuery) => emptyData(query));
    const exportJsonLines = vi.fn(async () => "");
    const app = buildApp({
      aiRunSearchService: { search, exportJsonLines }
    });
    apps.push(app);

    for (const url of [
      "/api/ai-runs?taskKind=unknown",
      "/api/ai-runs?from=2026-08-12T00:00:00.000Z&to=2026-08-11T00:00:00.000Z",
      "/api/ai-runs?limit=101",
      "/api/ai-runs?offset=-1"
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(422);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "REQUEST_VALIDATION_FAILED"
      );
    }
    expect(search).not.toHaveBeenCalled();
  });

  it("normalizes storage failures without exposing paths or log contents", async () => {
    const app = buildApp({
      aiRunSearchService: {
        search: async () => {
          throw new RunLogStoreError("RUN_LOG_INVALID", 500);
        },
        exportJsonLines: async () => {
          const error = new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
          error.message = "C:\\private\\projects\\secret-run.json";
          throw error;
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs"
    });

    expect(response.statusCode).toBe(500);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe("RUN_LOG_INVALID");
    expect(JSON.stringify(response.json())).not.toContain("projects");
    expect(JSON.stringify(response.json())).not.toContain("RUN_LOG_INVALID\n");
  });

  it("exports all applied filters without pagination and sets download headers", async () => {
    const search = vi.fn(async (query: AiRunSearchQuery) => emptyData(query));
    const exportJsonLines = vi.fn(
      async (query: AiRunExportQuery) =>
        `${JSON.stringify({ exportVersion: "1.0.0", taskKind: query.taskKind })}\n`
    );
    const app = buildApp({
      aiRunSearchService: { search, exportJsonLines }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs/export?from=2026-08-10T00:00:00.000Z&to=2026-08-12T00:00:00.000Z&taskKind=visual_search_intent&modelId=google%2Fgemma-4-31b-it&status=failed&decision=undecided&errorCode=OPENROUTER_TIMEOUT"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="subdub-ai-runs.jsonl"'
    );
    expect(response.body).toBe(
      '{"exportVersion":"1.0.0","taskKind":"visual_search_intent"}\n'
    );
    expect(exportJsonLines).toHaveBeenCalledWith({
      from: "2026-08-10T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
      taskKind: "visual_search_intent",
      modelId: "google/gemma-4-31b-it",
      status: "failed",
      decision: "undecided",
      errorCode: "OPENROUTER_TIMEOUT"
    });
  });

  it("rejects pagination, invalid enum, and invalid date range for export", async () => {
    const search = vi.fn(async (query: AiRunSearchQuery) => emptyData(query));
    const exportJsonLines = vi.fn(async () => "");
    const app = buildApp({
      aiRunSearchService: { search, exportJsonLines }
    });
    apps.push(app);

    for (const url of [
      "/api/ai-runs/export?taskKind=unknown",
      "/api/ai-runs/export?from=2026-08-12T00:00:00.000Z&to=2026-08-11T00:00:00.000Z",
      "/api/ai-runs/export?limit=100",
      "/api/ai-runs/export?offset=0"
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(422);
      expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
        "REQUEST_VALIDATION_FAILED"
      );
    }
    expect(exportJsonLines).not.toHaveBeenCalled();
  });

  it("returns an empty JSONL download when no runs match", async () => {
    const search = vi.fn(async (query: AiRunSearchQuery) => emptyData(query));
    const exportJsonLines = vi.fn(async () => "");
    const app = buildApp({
      aiRunSearchService: { search, exportJsonLines }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs/export"
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe(
      "application/x-ndjson; charset=utf-8"
    );
    expect(response.headers["content-disposition"]).toBe(
      'attachment; filename="subdub-ai-runs.jsonl"'
    );
    expect(response.body).toBe("");
  });

  it("normalizes export storage failures without exposing paths or log contents", async () => {
    const app = buildApp({
      aiRunSearchService: {
        search: async (query) => emptyData(query),
        exportJsonLines: async () => {
          const error = new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
          error.message = "C:\\private\\projects\\secret-run.json";
          throw error;
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs/export"
    });

    expect(response.statusCode).toBe(500);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe("RUN_LOG_READ_FAILED");
    expect(response.body).not.toContain("C:\\private");
    expect(response.body).not.toContain("secret-run");
  });

  it("is available through the real server initialization wiring", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-ai-runs-api-")
    );
    workspaceRoots.push(workspaceRoot);
    const server = await initializeServer({ workspaceRoot });
    apps.push(server.app);

    const response = await server.app.inject({
      method: "GET",
      url: "/api/ai-runs"
    });

    expect(response.statusCode).toBe(200);
    expect(
      aiRunSearchResponseSchema.parse(response.json()).data.summary
    ).toEqual({
      totalCount: 0,
      validationPassedCount: 0,
      validationEvaluatedCount: 0,
      validationPassRate: null,
      responseTimeMeasuredCount: 0,
      averageResponseTimeMs: null,
      modifiedRunCount: 0,
      modificationEvaluatedCount: 0
    });
  });
});
