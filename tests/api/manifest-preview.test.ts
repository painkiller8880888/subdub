import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  manifestPreviewResponseSchema,
  type ManifestPreviewData
} from "../../src/schema/api.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";

describe("GET /api/projects/:projectId/manifest", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it("uses an injected preview service and validates the strict response", async () => {
    const data: ManifestPreviewData = {
      project: {
        id: "manual-video-project",
        title: "Preview fixture"
      },
      state: "current",
      canPlay: true,
      manifest: renderManifestFixture,
      blockers: []
    };
    await app.close();
    app = buildApp({
      manifestPreviewService: {
        get: async () => data
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/manual-video-project/manifest"
    });

    expect(response.statusCode).toBe(200);
    const parsed = manifestPreviewResponseSchema.parse(response.json());
    expect(parsed.data.project.id).toBe("manual-video-project");
    expect(parsed.data.manifest).toEqual(renderManifestFixture);
  });

  it("rejects an invalid project id through the route contract", async () => {
    await app.close();
    app = buildApp({
      manifestPreviewService: { get: async () => ({}) as never }
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/../manifest"
    });

    expect(response.statusCode).not.toBe(200);
  });

  it("does not accept extra response fields", () => {
    expect(() =>
      manifestPreviewResponseSchema.parse({
        data: {
          project: { id: "manual-video-project", title: "Preview fixture" },
          state: "missing",
          canPlay: false,
          manifest: null,
          blockers: []
        },
        extra: true
      })
    ).toThrow();
  });
});
