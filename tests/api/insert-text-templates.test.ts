import { tmpdir } from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initializeServer } from "../../src/api/server.js";
import {
  apiErrorResponseSchema,
  insertTextTemplateListResponseSchema,
  insertTextTemplateResponseSchema
} from "../../src/schema/api.js";

describe("insert text template API", { timeout: 30_000 }, () => {
  let workspaceRoot: string;
  let server: Awaited<ReturnType<typeof initializeServer>>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-insert-text-template-api-")
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

  function templatePayload(name = "Intro overlay") {
    return {
      name,
      description: "Reusable intro text",
      status: "active" as const,
      textRect: { x: 0.1, y: 0.72, width: 0.8, height: 0.16 },
      rotationDeg: 1.5,
      fontSize: 58,
      fontWeight: 700,
      textColor: "#12abef",
      textAlign: "center" as const,
      verticalAlign: "center" as const
    };
  }

  it("lists, creates, updates, and filters active templates without ScreenTemplate coupling", async () => {
    const initial = await server.app.inject({
      method: "GET",
      url: "/api/insert-text-templates"
    });
    expect(initial.statusCode).toBe(200);
    expect(
      insertTextTemplateListResponseSchema.parse(initial.json()).data
    ).toEqual([]);

    const createResponse = await server.app.inject({
      method: "POST",
      url: "/api/insert-text-templates",
      payload: templatePayload("  Intro overlay  ")
    });
    expect(createResponse.statusCode).toBe(200);
    const created = insertTextTemplateResponseSchema.parse(
      createResponse.json()
    ).data;
    expect(created).toMatchObject({
      name: "Intro overlay",
      canvasWidth: 1920,
      canvasHeight: 1080,
      revision: 1,
      status: "active"
    });
    expect(created.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const updateResponse = await server.app.inject({
      method: "PUT",
      url: `/api/insert-text-templates/${created.templateId}`,
      payload: {
        ...templatePayload(created.name),
        status: "inactive",
        textRect: { ...created.textRect, y: 0.64 },
        expectedRevision: created.revision
      }
    });
    expect(updateResponse.statusCode).toBe(200);
    const updated = insertTextTemplateResponseSchema.parse(
      updateResponse.json()
    ).data;
    expect(updated).toMatchObject({
      status: "inactive",
      revision: 2,
      textRect: { y: 0.64 }
    });
    expect(updated.contentHash).not.toBe(created.contentHash);

    const active = await server.app.inject({
      method: "GET",
      url: "/api/insert-text-templates?status=active"
    });
    expect(
      insertTextTemplateListResponseSchema.parse(active.json()).data
    ).toEqual([]);

    const inactive = await server.app.inject({
      method: "GET",
      url: "/api/insert-text-templates?status=inactive"
    });
    expect(
      insertTextTemplateListResponseSchema.parse(inactive.json()).data
    ).toEqual([expect.objectContaining({ templateId: created.templateId })]);

    const stale = await server.app.inject({
      method: "PUT",
      url: `/api/insert-text-templates/${created.templateId}`,
      payload: {
        ...templatePayload(created.name),
        expectedRevision: created.revision
      }
    });
    expect(stale.statusCode).toBe(409);
    expect(apiError(stale).code).toBe("INSERT_TEXT_TEMPLATE_REVISION_CONFLICT");

    const activate = await server.app.inject({
      method: "POST",
      url: `/api/insert-text-templates/${created.templateId}/activate`,
      payload: { expectedRevision: updated.revision }
    });
    expect(activate.statusCode).toBe(200);
    expect(
      insertTextTemplateResponseSchema.parse(activate.json()).data
    ).toMatchObject({ status: "active", revision: 3 });
  });

  it("rejects invalid template values and unknown references", async () => {
    const invalid = await server.app.inject({
      method: "POST",
      url: "/api/insert-text-templates",
      payload: {
        ...templatePayload(),
        textColor: "#fff"
      }
    });
    expect(invalid.statusCode).toBe(422);
    expect(apiError(invalid).code).toBe("REQUEST_VALIDATION_FAILED");

    const missing = await server.app.inject({
      method: "GET",
      url: "/api/insert-text-templates/does-not-exist"
    });
    expect(missing.statusCode).toBe(404);
    expect(apiError(missing).code).toBe("INSERT_TEXT_TEMPLATE_NOT_FOUND");
  });
});
