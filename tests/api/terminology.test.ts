import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  terminologyListResponseSchema,
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

  it("returns not found and does not expose preview or usage APIs", async () => {
    const missingResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term"
    });
    expect(missingResponse.statusCode).toBe(404);
    expect(apiError(missingResponse).code).toBe("TERMINOLOGY_NOT_FOUND");

    const previewResponse = await server.app.inject({
      method: "POST",
      url: "/api/terminology/preview",
      payload: {}
    });
    expect(apiError(previewResponse).code).toBe("API_NOT_FOUND");

    const usagesResponse = await server.app.inject({
      method: "GET",
      url: "/api/terminology/missing-term/usages"
    });
    expect(apiError(usagesResponse).code).toBe("API_NOT_FOUND");
  });
});
