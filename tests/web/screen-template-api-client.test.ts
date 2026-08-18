import { afterEach, describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import { screenTemplateContentHash } from "../../src/app/screen-templates/screen-template-hash.js";
import {
  activateScreenTemplate,
  createScreenTemplate,
  deactivateScreenTemplate,
  fetchScreenTemplate,
  fetchScreenTemplates,
  updateScreenTemplate
} from "../../src/web/lib/api-client.js";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200
  });
}

describe("ScreenTemplate web API client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps preview-only values out of create and update payloads", async () => {
    const template = createStandardScreenTemplate("2026-08-18T00:00:00.000Z");
    const detail = {
      ...template,
      contentHash: screenTemplateContentHash(template)
    };
    const calls: Array<{ input: string; init: RequestInit | undefined }> = [];
    globalThis.fetch = async (input, init) => {
      calls.push({ input: String(input), init });
      return jsonResponse({ data: detail });
    };

    await createScreenTemplate({
      baseTemplateId: template.templateId,
      description: "copy",
      name: "Copy"
    });
    await updateScreenTemplate(template.templateId, {
      description: "updated",
      elements: template.elements,
      expectedRevision: template.revision,
      name: "Updated"
    });

    const createBody = JSON.parse(String(calls[0]?.init?.body));
    const updateBody = JSON.parse(String(calls[1]?.init?.body));
    expect(createBody).toEqual({
      baseTemplateId: template.templateId,
      description: "copy",
      name: "Copy"
    });
    expect(updateBody).not.toHaveProperty("visualId");
    expect(updateBody).not.toHaveProperty("variantId");
    expect(updateBody).not.toHaveProperty("assetId");
  });

  it("serializes list, detail, and revision-aware status endpoints", async () => {
    const template = createStandardScreenTemplate("2026-08-18T00:00:00.000Z");
    const detail = {
      ...template,
      contentHash: screenTemplateContentHash(template)
    };
    const summary = {
      canvasHeight: template.canvasHeight,
      canvasWidth: template.canvasWidth,
      contentHash: detail.contentHash,
      description: template.description,
      elementSummary: {
        byType: {
          "character-visual": 2,
          "content-slot": 1,
          "dialogue-window": 1,
          "section-title": 1
        },
        total: 5
      },
      name: template.name,
      revision: template.revision,
      status: template.status,
      templateId: template.templateId,
      updatedAt: template.updatedAt
    };
    const calls: string[] = [];
    globalThis.fetch = async (input) => {
      calls.push(String(input));
      return jsonResponse({ data: calls.length === 1 ? [summary] : detail });
    };

    await expect(fetchScreenTemplates({ status: "inactive" })).resolves.toEqual(
      [summary]
    );
    await expect(fetchScreenTemplate(template.templateId)).resolves.toEqual(
      detail
    );
    await expect(
      activateScreenTemplate(template.templateId, 1)
    ).resolves.toEqual(detail);
    await expect(
      deactivateScreenTemplate(template.templateId, 1)
    ).resolves.toEqual(detail);
    expect(calls).toEqual([
      "/api/screen-templates?status=inactive",
      "/api/screen-templates/screen-template-standard",
      "/api/screen-templates/screen-template-standard/activate",
      "/api/screen-templates/screen-template-standard/deactivate"
    ]);
  });
});
