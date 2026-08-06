import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  terminologyListResponseSchema,
  terminologyPreviewResponseSchema,
  terminologyTermResponseSchema
} from "../../src/schema/api.js";

describe("terminology API", () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-terminology-api-")
    );
    server = await initializeServer({ workspaceRoot });
  });

  afterEach(async () => {
    await server.app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function apiError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).not.toBe(200);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  it("supports list, create, detail, edit, deactivate, and activate", async () => {
    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload: {
        surface: " SubDub ",
        readingKatakana: "サブダブ",
        category: " system ",
        priority: 2,
        notes: "メモ"
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const created = terminologyTermResponseSchema.parse(
      createResponse.json()
    ).data;
    expect(created.surface).toBe("SubDub");
    expect(created.category).toBe("system");
    expect(created.status).toBe("active");

    const listResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology?surface=Sub&reading=%E3%82%B5%E3%83%96&category=system&status=active"
    });
    expect(
      terminologyListResponseSchema.parse(listResponse.json()).data
    ).toEqual([created]);

    const detailResponse = await server.app.inject({
      method: "GET",
      url: `/api/terminology/${created.termId}`
    });
    expect(
      terminologyTermResponseSchema.parse(detailResponse.json()).data
    ).toEqual(created);

    const updateResponse = await server.app.inject({
      method: "PUT",
      url: `/api/terminology/${created.termId}`,
      payload: {
        surface: "SubDub Updated",
        readingKatakana: "サブダブ・アップデート",
        category: "product",
        priority: -1,
        notes: "更新済み"
      }
    });
    const updated = terminologyTermResponseSchema.parse(
      updateResponse.json()
    ).data;
    expect(updated).toMatchObject({
      termId: created.termId,
      status: "active",
      category: "product",
      priority: -1
    });
    expect(updated.createdAt).toBe(created.createdAt);

    const deactivateResponse = await server.app.inject({
      method: "POST",
      url: `/api/terminology/${created.termId}/deactivate`
    });
    expect(
      terminologyTermResponseSchema.parse(deactivateResponse.json()).data.status
    ).toBe("inactive");
    const inactiveList = await server.app.inject({
      method: "GET",
      url: "/api/terminology?status=inactive"
    });
    expect(
      terminologyListResponseSchema.parse(inactiveList.json()).data
    ).toHaveLength(1);

    const activateResponse = await server.app.inject({
      method: "POST",
      url: `/api/terminology/${created.termId}/activate`
    });
    expect(
      terminologyTermResponseSchema.parse(activateResponse.json()).data
    ).toMatchObject({
      termId: created.termId,
      status: "active"
    });
  });

  it("re-registers an inactive duplicate instead of creating a new ID", async () => {
    const firstResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload: {
        surface: "再登録",
        readingKatakana: "サイ・トウロク",
        category: "other"
      }
    });
    const first = terminologyTermResponseSchema.parse(
      firstResponse.json()
    ).data;
    await server.app.inject({
      method: "POST",
      url: `/api/terminology/${first.termId}/deactivate`
    });

    const secondResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload: {
        surface: " 再登録 ",
        readingKatakana: "サイ・トウロク",
        category: "operation",
        priority: 4,
        notes: "復帰"
      }
    });
    const second = terminologyTermResponseSchema.parse(
      secondResponse.json()
    ).data;
    expect(second.termId).toBe(first.termId);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.status).toBe("active");
    expect(second.category).toBe("operation");
  });

  it("rejects duplicate and invalid requests without exposing SQL details", async () => {
    const payload = {
      surface: "Duplicate",
      readingKatakana: "デュプリケート",
      category: "other"
    };
    await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload
    });
    const duplicateResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload
    });
    const duplicateError = apiError(duplicateResponse);
    expect(duplicateResponse.statusCode).toBe(409);
    expect(duplicateError.code).toBe("TERMINOLOGY_DUPLICATE");
    expect(duplicateResponse.body).not.toContain("SQLITE");
    expect(duplicateResponse.body).not.toContain("UNIQUE constraint");

    const invalidResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology",
      payload: {
        ...payload,
        readingKatakana: "ひらがな",
        unknown: true
      }
    });
    const invalidError = apiError(invalidResponse);
    expect(invalidResponse.statusCode).toBe(422);
    expect(invalidError.code).toBe("REQUEST_VALIDATION_FAILED");

    const queryErrorResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology?unknown=value"
    });
    expect(apiError(queryErrorResponse).code).toBe("REQUEST_VALIDATION_FAILED");
  });

  it("previews dictionary and literal text without exposing usage APIs", async () => {
    const create = async (surface: string, readingKatakana: string) => {
      const response = await server.app.inject({
        method: "POST",
        url: "/api/terminology",
        payload: { surface, readingKatakana, category: "other" }
      });
      return terminologyTermResponseSchema.parse(response.json()).data;
    };
    const longTerm = await create("AB", "エービー");
    const shortTerm = await create("A", "エー");
    const inactiveTerm = await create("C", "シー");
    await server.app.inject({
      method: "POST",
      url: `/api/terminology/${inactiveTerm.termId}/deactivate`
    });

    const previewResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {
        spokenText: "ABC AB",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      }
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = terminologyPreviewResponseSchema.parse(
      previewResponse.json()
    );
    expect(preview).not.toHaveProperty("revision");
    expect(preview.data).toEqual({
      resolvedSpokenText: "エービーC エービー",
      appliedTerms: [
        {
          termId: longTerm.termId,
          surface: "AB",
          reading: "エービー",
          termUpdatedAt: longTerm.updatedAt
        },
        {
          termId: longTerm.termId,
          surface: "AB",
          reading: "エービー",
          termUpdatedAt: longTerm.updatedAt
        }
      ]
    });
    expect(shortTerm.status).toBe("active");

    const excludedResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {
        spokenText: "AB",
        pronunciation: {
          mode: "dictionary",
          excludedTermIds: [longTerm.termId, longTerm.termId, "missing-term"]
        }
      }
    });
    expect(
      terminologyPreviewResponseSchema.parse(excludedResponse.json()).data
    ).toEqual({
      resolvedSpokenText: "エーB",
      appliedTerms: [
        {
          termId: shortTerm.termId,
          surface: "A",
          reading: "エー",
          termUpdatedAt: shortTerm.updatedAt
        }
      ]
    });

    const literalResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {
        spokenText: "ABC",
        pronunciation: {
          mode: "literal",
          excludedTermIds: [longTerm.termId]
        }
      }
    });
    expect(
      terminologyPreviewResponseSchema.parse(literalResponse.json()).data
    ).toEqual({ resolvedSpokenText: "ABC", appliedTerms: [] });

    for (const payload of [
      {
        spokenText: " ",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      },
      {
        spokenText: "A",
        pronunciation: { mode: "invalid", excludedTermIds: [] }
      },
      {
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: ["not_valid"] }
      },
      {
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: "term" }
      },
      {
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: [] },
        unknown: true
      }
    ]) {
      const invalidResponse = await server.app.inject({
        method: "POST",
        url: "/api/terminology/preview",
        payload
      });
      expect(invalidResponse.statusCode).toBe(422);
      expect(apiError(invalidResponse).code).toBe("REQUEST_VALIDATION_FAILED");
    }

    const missingResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term"
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(apiError(missingResponse).code).toBe("TERMINOLOGY_NOT_FOUND");

    const usagesResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term/usages"
    });
    expect(apiError(usagesResponse).code).toBe("API_NOT_FOUND");
  });

  it("does not expose preview internals for unexpected errors", async () => {
    const previewError = new Error(
      "SQLITE failure at C:\\secret\\workspace\\subdub.db"
    );
    const failingApp = (await import("../../src/api/app.js")).buildApp({
      terminologyService: {
        list: () => [],
        create: () => {
          throw previewError;
        },
        get: () => {
          throw previewError;
        },
        update: () => {
          throw previewError;
        },
        deactivate: () => {
          throw previewError;
        },
        activate: () => {
          throw previewError;
        },
        preview: () => {
          throw previewError;
        }
      } as never
    });
    const response = await failingApp.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      }
    });

    expect(response.statusCode).toBe(500);
    expect(apiError(response).code).toBe("INTERNAL_SERVER_ERROR");
    expect(response.body).not.toContain("SQLITE");
    expect(response.body).not.toContain("C:\\secret");
    expect(response.body).not.toContain("Error: ");
    await failingApp.close();
  });

  it("maps invalid preview service results to a safe 500 error", async () => {
    const invalidResultApp = (await import("../../src/api/app.js")).buildApp({
      terminologyService: {
        list: () => [],
        create: () => {
          throw new Error("not used");
        },
        get: () => {
          throw new Error("not used");
        },
        update: () => {
          throw new Error("not used");
        },
        deactivate: () => {
          throw new Error("not used");
        },
        activate: () => {
          throw new Error("not used");
        },
        preview: () => ({
          resolvedSpokenText: "A",
          appliedTerms: [
            {
              termId: "term-a",
              surface: "A",
              reading: "READ",
              termUpdatedAt: "not-an-iso-date"
            }
          ]
        })
      } as never
    });

    const response = await invalidResultApp.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {
        spokenText: "A",
        pronunciation: { mode: "dictionary", excludedTermIds: [] }
      }
    });

    expect(response.statusCode).toBe(500);
    const error = apiError(response);
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.details).toEqual([]);
    expect(response.body).not.toContain("REQUEST_VALIDATION_FAILED");
    expect(response.body).not.toContain("not-an-iso-date");
    expect(response.body).not.toContain("ZodError");
    await invalidResultApp.close();
  });

  it("returns not found for unknown terminology detail", async () => {
    const missingResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term"
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(apiError(missingResponse).code).toBe("TERMINOLOGY_NOT_FOUND");

    const usagesResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term/usages"
    });
    expect(apiError(usagesResponse).code).toBe("API_NOT_FOUND");
  });
});
