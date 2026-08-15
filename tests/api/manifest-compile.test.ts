import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  manifestCompileResponseSchema,
  type ManifestCompileData
} from "../../src/schema/api.js";
import type { RenderManifestCacheResult } from "../../src/app/rendering/render-manifest-store.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";

describe("POST /api/projects/:projectId/manifest/compile", () => {
  let app = buildApp();

  afterEach(async () => {
    await app.close();
    app = buildApp();
  });

  it("delegates to the compile service and validates the response", async () => {
    const data: ManifestCompileData = {
      status: "compiled",
      reused: false,
      manifest: renderManifestFixture,
      diagnostics: [],
      warnings: [],
      runId: "manifest-run-1"
    };
    await app.close();
    app = buildApp({
      manifestCompileService: {
        compile: async (projectId) => {
          expect(projectId).toBe("manual-video-project");
          return data as RenderManifestCacheResult;
        }
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/manual-video-project/manifest/compile"
    });

    expect(response.statusCode).toBe(200);
    expect(manifestCompileResponseSchema.parse(response.json()).data).toEqual(
      data
    );
  });

  it("rejects an invalid project id through the route contract", async () => {
    await app.close();
    app = buildApp({
      manifestCompileService: { compile: async () => ({}) as never }
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/../manifest/compile"
    });

    expect(response.statusCode).not.toBe(200);
  });
});
