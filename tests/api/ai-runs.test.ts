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
    const app = buildApp({ aiRunSearchService: { search } });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/ai-runs?from=2026-08-10T00:00:00.000Z&to=2026-08-12T00:00:00.000Z&taskKind=outline_generation&modelId=google%2Fgemma-4-31b-it&status=failed&decision=undecided&errorCode=OPENROUTER_TIMEOUT&limit=7&offset=14"
    });

    expect(response.statusCode).toBe(200);
    expect(aiRunSearchResponseSchema.parse(response.json()).data).toEqual(
      emptyData(search.mock.calls[0]![0])
    );
    expect(search).toHaveBeenCalledWith({
      from: "2026-08-10T00:00:00.000Z",
      to: "2026-08-12T00:00:00.000Z",
      taskKind: "outline_generation",
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
    const app = buildApp({ aiRunSearchService: { search } });
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
