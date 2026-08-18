export const RENDER_JOB_ERROR_CODE = {
  projectIdInvalid: "RENDER_PROJECT_ID_INVALID",
  projectNotFound: "RENDER_PROJECT_NOT_FOUND",
  runIdInvalid: "RENDER_RUN_ID_INVALID",
  runNotFound: "RENDER_RUN_NOT_FOUND",
  manifestInvalid: "RENDER_MANIFEST_INVALID",
  manifestStale: "RENDER_MANIFEST_STALE",
  sourceAssetMissing: "RENDER_SOURCE_ASSET_MISSING",
  sourceAssetUnreadable: "RENDER_SOURCE_ASSET_UNREADABLE",
  sourceAssetPathInvalid: "RENDER_SOURCE_ASSET_PATH_INVALID",
  sourceAssetChecksumMismatch: "RENDER_SOURCE_ASSET_CHECKSUM_MISMATCH",
  screenTemplateReferenceInvalid: "RENDER_SCREEN_TEMPLATE_REFERENCE_INVALID",
  bundleFailed: "RENDER_BUNDLE_FAILED",
  compositionSelectionFailed: "RENDER_COMPOSITION_SELECTION_FAILED",
  mp4RenderFailed: "MP4_RENDER_FAILED",
  thumbnailRenderFailed: "THUMBNAIL_RENDER_FAILED",
  temporaryOutputWriteFailed: "RENDER_TEMPORARY_OUTPUT_WRITE_FAILED",
  finalOutputWriteFailed: "RENDER_FINAL_OUTPUT_WRITE_FAILED",
  runLogReadFailed: "RENDER_RUN_LOG_READ_FAILED",
  runLogWriteFailed: "RENDER_RUN_LOG_WRITE_FAILED",
  workerStopped: "RENDER_WORKER_STOPPED",
  enqueueFailed: "RENDER_ENQUEUE_FAILED"
} as const;

export type RenderJobErrorCode =
  (typeof RENDER_JOB_ERROR_CODE)[keyof typeof RENDER_JOB_ERROR_CODE];

export type RenderJobErrorStatus = 400 | 404 | 422 | 500 | 503;

export class RenderJobError extends Error {
  readonly code: RenderJobErrorCode;
  readonly status: RenderJobErrorStatus;

  constructor(
    code: RenderJobErrorCode,
    status: RenderJobErrorStatus,
    message: string = code
  ) {
    super(message);
    this.name = "RenderJobError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
  }
}
