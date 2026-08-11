import { describe, expect, it } from "vitest";

import {
  apiErrorResponseSchema,
  apiSuccessResponseSchema,
  aiRunExportRecordSchema,
  createApiErrorResponse,
  createApiSuccessResponse
} from "../../src/schema/api.js";

describe("shared API contract", () => {
  it("requires data and omits revision when it has no meaning", () => {
    const response = createApiSuccessResponse({ status: "ok" });

    expect(response).toEqual({ data: { status: "ok" } });
    expect(apiSuccessResponseSchema.safeParse(response).success).toBe(true);
    expect(apiSuccessResponseSchema.safeParse({}).success).toBe(false);
  });

  it("includes revision only when supplied", () => {
    const response = createApiSuccessResponse({ saved: true }, 12);

    expect(response).toEqual({ data: { saved: true }, revision: 12 });
    expect(apiSuccessResponseSchema.safeParse(response).success).toBe(true);
  });

  it("always emits an error details array and request ID", () => {
    const response = createApiErrorResponse(
      "REQUEST_VALIDATION_FAILED",
      "入力が不正です。",
      "req-test",
      [
        {
          path: ["sections", 0, "title"],
          message: "タイトルが必要です。"
        }
      ]
    );

    expect(
      apiErrorResponseSchema.parse(response)
    ).toEqual(response);
    expect(
      apiErrorResponseSchema.parse(
        createApiErrorResponse("API_NOT_FOUND", "見つかりません。", "req-test")
      ).error.details
    ).toEqual([]);
  });

  it("accepts only the explicit AI run export allowlist", () => {
    const record = {
      exportVersion: "1.0.0",
      runId: "run-example",
      projectId: "project-example",
      taskKind: "outline_generation",
      modelId: "google/gemma-4-31b-it",
      responseModel: "provider/gemma",
      status: "succeeded",
      queuedAt: "2026-08-11T00:00:00.000Z",
      finishedAt: "2026-08-11T00:00:01.000Z",
      schemaValidation: "passed",
      responseTimeMs: 100,
      errorCode: null,
      candidateCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      undecidedCount: 0,
      modified: null
    } as const;

    expect(aiRunExportRecordSchema.parse(record)).toEqual(record);
    expect(
      aiRunExportRecordSchema.safeParse({
        ...record,
        candidateJson: { secret: "must-not-export" }
      }).success
    ).toBe(false);
  });
});
