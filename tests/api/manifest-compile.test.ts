import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  apiErrorResponseSchema,
  manifestCompileResponseSchema,
  type ManifestCompileData
} from "../../src/schema/api.js";
import { RenderManifestCompileService } from "../../src/app/rendering/render-manifest-compile-service.js";
import type { RenderManifestCacheResult } from "../../src/app/rendering/render-manifest-store.js";
import { RENDER_JOB_ERROR_CODE } from "../../src/app/rendering/render-job-errors.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import type { VideoProject } from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function createCompileService(
  project: VideoProject,
  invalidTemplateId: string,
  invalidTemplateStatus: "missing" | "inactive"
): {
  readonly service: RenderManifestCompileService;
  readonly compileAndStore: ReturnType<typeof vi.fn>;
} {
  const compileAndStore = vi.fn(async () => {
    throw new Error("manifest store should not be reached");
  });
  return {
    service: new RenderManifestCompileService({
      workspaceRoot: "C:\\workspace",
      projectRepository: { read: async () => project },
      screenTemplateCatalog: {
        findById: (templateId) => {
          if (templateId !== invalidTemplateId) {
            return createStandardScreenTemplate("2026-08-10T00:00:00.000Z");
          }
          if (invalidTemplateStatus === "missing") {
            return undefined;
          }
          const template = createStandardScreenTemplate(
            "2026-08-10T00:00:00.000Z"
          );
          template.templateId = invalidTemplateId;
          template.status = "inactive";
          return template;
        }
      },
      assetRepository: { findAssetDetail: () => undefined },
      characterVisualCatalogService: { verifyFiles: async () => [] },
      audioStore: { readIndex: async () => ({}) },
      manifestStore: { compileAndStore }
    }),
    compileAndStore
  };
}

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

  it.each([
    {
      name: "a missing section template",
      location: "section",
      status: "missing" as const
    },
    {
      name: "an inactive section template",
      location: "section",
      status: "inactive" as const
    },
    {
      name: "a missing line override",
      location: "line",
      status: "missing" as const
    },
    {
      name: "an inactive line override",
      location: "line",
      status: "inactive" as const
    }
  ])("blocks compilation for $name", async ({ location, status }) => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const invalidTemplateId = `invalid-${location}-template`;
    const section = project.script.sections[0];
    const line = section?.lines[0];
    if (section === undefined || line === undefined) {
      throw new Error("The compile fixture is missing its first line.");
    }
    if (location === "section") {
      section.screenTemplateId = invalidTemplateId;
    } else {
      line.screenTemplateId = invalidTemplateId;
    }

    const { service, compileAndStore } = createCompileService(
      project,
      invalidTemplateId,
      status
    );
    await app.close();
    app = buildApp({ manifestCompileService: service });

    const response = await app.inject({
      method: "POST",
      url: "/api/projects/manual-video-project/manifest/compile"
    });

    expect(response.statusCode).toBe(422);
    expect(apiErrorResponseSchema.parse(response.json()).error.code).toBe(
      RENDER_JOB_ERROR_CODE.screenTemplateReferenceInvalid
    );
    expect(compileAndStore).not.toHaveBeenCalled();
  });
});
