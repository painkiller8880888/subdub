import type { ApiErrorDetail } from "../../schema/api.js";

export const PROJECT_EDIT_ERROR_CODE = {
  projectPathInvalid: "PROJECT_EDIT_PROJECT_PATH_INVALID",
  assetNotFound: "PROJECT_EDIT_ASSET_NOT_FOUND",
  assetNotActive: "PROJECT_EDIT_ASSET_NOT_ACTIVE",
  assetKindMismatch: "PROJECT_EDIT_ASSET_KIND_MISMATCH",
  assetFormatMismatch: "PROJECT_EDIT_ASSET_FORMAT_MISMATCH",
  assetChecksumUnavailable: "PROJECT_EDIT_ASSET_CHECKSUM_UNAVAILABLE",
  libraryPathInvalid: "PROJECT_EDIT_LIBRARY_PATH_INVALID",
  libraryFileNotFound: "PROJECT_EDIT_LIBRARY_FILE_NOT_FOUND",
  mediaPathInvalid: "PROJECT_EDIT_MEDIA_PATH_INVALID",
  mediaPathCheckFailed: "PROJECT_EDIT_MEDIA_PATH_CHECK_FAILED",
  copyFailed: "PROJECT_EDIT_COPY_FAILED",
  hashFailed: "PROJECT_EDIT_HASH_FAILED",
  checksumMismatch: "PROJECT_EDIT_CHECKSUM_MISMATCH",
  mediaPathConflict: "PROJECT_EDIT_MEDIA_PATH_CONFLICT",
  renameFailed: "PROJECT_EDIT_RENAME_FAILED",
  candidateInvalid: "PROJECT_EDIT_CANDIDATE_INVALID",
  cleanupFailed: "PROJECT_EDIT_CLEANUP_FAILED"
} as const;

export type ProjectEditErrorCode =
  (typeof PROJECT_EDIT_ERROR_CODE)[keyof typeof PROJECT_EDIT_ERROR_CODE];

export type ProjectEditErrorStatus = 400 | 404 | 409 | 422 | 500;

export class ProjectEditError extends Error {
  readonly code: ProjectEditErrorCode;
  readonly status: ProjectEditErrorStatus;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: ProjectEditErrorCode,
    status: ProjectEditErrorStatus,
    message: string,
    details: readonly ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "ProjectEditError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
