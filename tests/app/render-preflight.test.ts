import { describe, expect, it } from "vitest";

import { RenderPreflightService } from "../../src/app/rendering/render-preflight.js";
import { RENDER_JOB_ERROR_CODE } from "../../src/app/rendering/render-job-errors.js";
import type { ManifestPreviewData } from "../../src/schema/api.js";
import {
  renderManifestSchema,
  type RenderManifest,
  videoProjectSchema
} from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = "manual-video-project";
const project = videoProjectSchema.parse(videoProjectFixture);
const manifest = renderManifestSchema.parse(renderManifestFixture);

function preview(
  state: ManifestPreviewData["state"],
  currentManifest: RenderManifest | null,
  blockers: ManifestPreviewData["blockers"] = []
): ManifestPreviewData {
  return {
    project: {
      id: projectId,
      title: project.metadata.title
    },
    state,
    canPlay: state === "current" && currentManifest !== null,
    manifest: currentManifest,
    blockers
  };
}

describe("RenderPreflightService", () => {
  it("rejects stale or invalid manifests before a job can render", async () => {
    const stale = new RenderPreflightService({
      projectRepository: { read: async () => project },
      manifestPreviewService: {
        get: async () =>
          preview("stale", manifest, [
            {
              code: "MANIFEST_PROJECT_STALE",
              message: "stale",
              target: { kind: "manifest" }
            }
          ])
      }
    });
    await expect(stale.validate(projectId)).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.manifestStale,
      status: 422
    });

    const invalidManifest = { ...manifest, width: 1280 } as RenderManifest;
    const invalid = new RenderPreflightService({
      projectRepository: { read: async () => project },
      manifestPreviewService: {
        get: async () => preview("current", invalidManifest)
      }
    });
    await expect(invalid.validate(projectId)).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.manifestInvalid,
      status: 422
    });
  });

  it("rejects missing or mismatched source assets", async () => {
    const missing = new RenderPreflightService({
      projectRepository: { read: async () => project },
      manifestPreviewService: {
        get: async () =>
          preview("stale", manifest, [
            {
              code: "ASSET_MISSING",
              message: "missing",
              target: { kind: "asset", path: "media/missing.png" }
            }
          ])
      }
    });
    await expect(missing.validate(projectId)).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.sourceAssetMissing,
      status: 422
    });

    const mismatch = new RenderPreflightService({
      projectRepository: { read: async () => project },
      manifestPreviewService: {
        get: async () =>
          preview("stale", manifest, [
            {
              code: "ASSET_CHECKSUM_MISMATCH",
              message: "mismatch",
              target: { kind: "asset", path: "media/file.png" }
            }
          ])
      }
    });
    await expect(mismatch.validate(projectId)).rejects.toMatchObject({
      code: RENDER_JOB_ERROR_CODE.sourceAssetChecksumMismatch,
      status: 422
    });
  });
});
