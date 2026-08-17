import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  screenTemplateDetailSchema,
  screenTemplateListResponseSchema,
  screenTemplateResponseSchema
} from "../../src/schema/api.js";

describe("screen template API", () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-screen-template-api-")
    );
    server = await initializeServer({ workspaceRoot });
  });

  afterEach(async () => {
    await server?.app.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function apiError(response: { statusCode: number; json(): unknown }) {
    expect(response.statusCode).not.toBe(200);
    return apiErrorResponseSchema.parse(response.json()).error;
  }

  async function getTemplate(templateId: string) {
    const response = await server.app.inject({
      method: "GET",
      url: `/api/screen-templates/${templateId}`
    });
    expect(response.statusCode).toBe(200);
    return screenTemplateResponseSchema.parse(response.json()).data;
  }

  it("lists, details, creates, updates, deactivates, and activates templates", async () => {
    const initialList = await server.app.inject({
      method: "GET",
      url: "/api/screen-templates"
    });
    const standard = screenTemplateListResponseSchema.parse(initialList.json())
      .data[0]!;
    expect(initialList.statusCode).toBe(200);
    expect(standard).toMatchObject({
      templateId: "screen-template-standard",
      status: "active",
      canvasWidth: 1920,
      canvasHeight: 1080,
      elementSummary: {
        total: 5,
        byType: {
          "dialogue-window": 1,
          "section-title": 1,
          "character-visual": 2,
          "content-slot": 1
        }
      }
    });
    expect(standard.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const standardDetail = await getTemplate(standard.templateId);
    expect(standardDetail.elements).toHaveLength(5);
    expect(standardDetail.contentHash).toBe(standard.contentHash);

    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/screen-templates",
      payload: {
        name: "  Custom template  ",
        description: "  Copied from standard  "
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const created = screenTemplateResponseSchema.parse(
      createResponse.json()
    ).data;
    expect(created.name).toBe("Custom template");
    expect(created.description).toBe("Copied from standard");
    expect(created.status).toBe("active");
    expect(created.elements.map((element) => element.elementId)).not.toEqual(
      standardDetail.elements.map((element) => element.elementId)
    );

    const updatedElements = created.elements.map((element) =>
      element.type === "content-slot"
        ? {
            ...element,
            transform: {
              ...element.transform,
              rect: { ...element.transform.rect, width: 0.81 }
            }
          }
        : element
    );
    const updateResponse = await server.app.inject({
      method: "PUT",
      url: `/api/screen-templates/${created.templateId}`,
      payload: {
        name: created.name,
        description: created.description,
        elements: updatedElements,
        expectedRevision: created.revision
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = screenTemplateResponseSchema.parse(
      updateResponse.json()
    ).data;
    expect(updated.revision).toBe(created.revision + 1);
    expect(updated.contentHash).not.toBe(created.contentHash);

    const staleResponse = await server.app.inject({
      method: "PUT",
      url: `/api/screen-templates/${created.templateId}`,
      payload: {
        name: updated.name,
        description: updated.description,
        elements: updated.elements,
        expectedRevision: created.revision
      }
    });
    expect(staleResponse.statusCode).toBe(409);
    expect(apiError(staleResponse).code).toBe(
      "SCREEN_TEMPLATE_REVISION_CONFLICT"
    );

    const deactivateResponse = await server.app.inject({
      method: "POST",
      url: `/api/screen-templates/${created.templateId}/deactivate`
    });
    expect(deactivateResponse.statusCode).toBe(200);
    const inactive = screenTemplateResponseSchema.parse(
      deactivateResponse.json()
    ).data;
    expect(inactive.status).toBe("inactive");
    expect(inactive.revision).toBe(updated.revision + 1);

    const activeList = await server.app.inject({
      method: "GET",
      url: "/api/screen-templates?status=active"
    });
    expect(
      screenTemplateListResponseSchema.parse(activeList.json()).data
    ).not.toContainEqual(
      expect.objectContaining({ templateId: created.templateId })
    );

    const inactiveUpdate = await server.app.inject({
      method: "PUT",
      url: `/api/screen-templates/${created.templateId}`,
      payload: {
        name: inactive.name,
        description: inactive.description,
        elements: inactive.elements,
        expectedRevision: inactive.revision
      }
    });
    expect(inactiveUpdate.statusCode).toBe(409);
    expect(apiError(inactiveUpdate).code).toBe("SCREEN_TEMPLATE_INACTIVE");

    const activateResponse = await server.app.inject({
      method: "POST",
      url: `/api/screen-templates/${created.templateId}/activate`
    });
    expect(activateResponse.statusCode).toBe(200);
    expect(
      screenTemplateResponseSchema.parse(activateResponse.json()).data
    ).toMatchObject({
      templateId: created.templateId,
      status: "active",
      revision: inactive.revision + 1
    });
  });

  it("accepts a complete element set and keeps invalid updates atomic", async () => {
    const standard = await getTemplate("screen-template-standard");
    const elements = standard.elements.map((element, index) => ({
      ...element,
      elementId: `complete-template-element-${index + 1}`
    }));
    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/screen-templates",
      payload: {
        name: "Complete template",
        description: "",
        elements
      }
    });
    expect(createResponse.statusCode).toBe(200);
    const created = screenTemplateResponseSchema.parse(
      createResponse.json()
    ).data;

    const invalidElements = created.elements.filter(
      (element) => element.type !== "dialogue-window"
    );
    const invalidResponse = await server.app.inject({
      method: "PUT",
      url: `/api/screen-templates/${created.templateId}`,
      payload: {
        name: created.name,
        description: created.description,
        elements: invalidElements,
        expectedRevision: created.revision
      }
    });
    expect(invalidResponse.statusCode).toBe(422);
    expect(apiError(invalidResponse).code).toBe(
      "SCREEN_TEMPLATE_VALIDATION_FAILED"
    );
    expect(await getTemplate(created.templateId)).toEqual(created);
  });

  it("rejects unknown request keys, invalid queries, and missing templates safely", async () => {
    const unknownKeyResponse = await server.app.inject({
      method: "POST",
      url: "/api/screen-templates",
      payload: {
        name: "Invalid",
        unknown: true
      }
    });
    expect(unknownKeyResponse.statusCode).toBe(422);
    expect(apiError(unknownKeyResponse).code).toBe("REQUEST_VALIDATION_FAILED");

    const unknownQueryResponse = await server.app.inject({
      method: "GET",
      url: "/api/screen-templates?unknown=true"
    });
    expect(unknownQueryResponse.statusCode).toBe(422);
    expect(apiError(unknownQueryResponse).code).toBe(
      "REQUEST_VALIDATION_FAILED"
    );

    const missingBaseResponse = await server.app.inject({
      method: "POST",
      url: "/api/screen-templates",
      payload: {
        name: "Missing base",
        baseTemplateId: "does-not-exist"
      }
    });
    expect(missingBaseResponse.statusCode).toBe(404);
    expect(apiError(missingBaseResponse).code).toBe(
      "SCREEN_TEMPLATE_NOT_FOUND"
    );

    const missingDetailResponse = await server.app.inject({
      method: "GET",
      url: "/api/screen-templates/does-not-exist"
    });
    expect(missingDetailResponse.statusCode).toBe(404);
    expect(apiError(missingDetailResponse).code).toBe(
      "SCREEN_TEMPLATE_NOT_FOUND"
    );
  });

  it("keeps detail responses strict and does not expose database internals", async () => {
    const response = await server.app.inject({
      method: "GET",
      url: "/api/screen-templates/screen-template-standard"
    });
    const detail = screenTemplateResponseSchema.parse(response.json()).data;
    expect(screenTemplateDetailSchema.parse(detail)).toEqual(detail);
    expect(response.body).not.toContain("SQLITE");
    expect(response.body).not.toContain("absolute");
  });
});
