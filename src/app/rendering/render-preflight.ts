import type { ManifestPreviewService } from "./manifest-preview-service.js";
import { RENDER_JOB_ERROR_CODE, RenderJobError } from "./render-job-errors.js";
import type { RenderManifest, VideoProject } from "../../schema/index.js";
import type { ProjectRepository } from "../projects/project-repository.js";

export type RenderPreflightResult = {
  readonly project: VideoProject;
  readonly manifest: RenderManifest;
};

export type RenderPreflightServicePort = {
  validate(projectId: string): Promise<RenderPreflightResult>;
};

export type RenderPreflightServiceOptions = {
  readonly projectRepository: Pick<ProjectRepository, "read">;
  readonly manifestPreviewService: Pick<ManifestPreviewService, "get">;
};

function blockerCodes(
  blockers: readonly { readonly code: string }[]
): Set<string> {
  return new Set(blockers.map((blocker) => blocker.code));
}

export class RenderPreflightService implements RenderPreflightServicePort {
  private readonly projectRepository: Pick<ProjectRepository, "read">;
  private readonly manifestPreviewService: Pick<ManifestPreviewService, "get">;

  constructor(options: RenderPreflightServiceOptions) {
    this.projectRepository = options.projectRepository;
    this.manifestPreviewService = options.manifestPreviewService;
  }

  async validate(projectId: string): Promise<RenderPreflightResult> {
    const project = await this.projectRepository.read(projectId);
    const preview = await this.manifestPreviewService.get(projectId);

    if (preview.state !== "current" || preview.manifest === null) {
      const codes = blockerCodes(preview.blockers);
      if (
        codes.has("ASSET_MISSING") ||
        codes.has("AUDIO_INDEX_ENTRY_MISSING")
      ) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.sourceAssetMissing,
          422,
          "A required render asset is missing."
        );
      }
      if (codes.has("SCREEN_TEMPLATE_REFERENCE_INVALID")) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.screenTemplateReferenceInvalid,
          422,
          "A selected screen template is missing or inactive."
        );
      }
      if (codes.has("ASSET_CHECKSUM_MISMATCH")) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.sourceAssetChecksumMismatch,
          422,
          "A render asset checksum does not match."
        );
      }
      if (codes.has("ASSET_PATH_INVALID")) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.sourceAssetPathInvalid,
          422,
          "A render asset path is invalid."
        );
      }
      if (codes.has("ASSET_UNREADABLE")) {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.sourceAssetUnreadable,
          422,
          "A render asset could not be read."
        );
      }
      if (codes.has("MANIFEST_PROJECT_STALE") || preview.state === "stale") {
        throw new RenderJobError(
          RENDER_JOB_ERROR_CODE.manifestStale,
          422,
          "The render manifest is stale."
        );
      }
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.manifestInvalid,
        422,
        "The render manifest is missing or invalid."
      );
    }

    const manifest = preview.manifest;
    const outputSettings = project.metadata.outputSettings;
    if (
      manifest.fps !== outputSettings.fps ||
      manifest.width !== outputSettings.width ||
      manifest.height !== outputSettings.height ||
      manifest.durationInFrames <= 0
    ) {
      throw new RenderJobError(
        RENDER_JOB_ERROR_CODE.manifestInvalid,
        422,
        "The render manifest dimensions or duration are invalid."
      );
    }

    return { project, manifest };
  }
}
