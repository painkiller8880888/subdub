import type { ApiErrorDetail } from "../../schema/api.js";

export const VISUAL_ASSIGNMENT_ERROR_CODE = {
  projectPathInvalid: "VISUAL_ASSIGNMENT_PROJECT_PATH_INVALID",
  assetNotFound: "VISUAL_ASSIGNMENT_ASSET_NOT_FOUND",
  assetNotActive: "VISUAL_ASSIGNMENT_ASSET_NOT_ACTIVE",
  assetChecksumUnavailable: "VISUAL_ASSIGNMENT_ASSET_CHECKSUM_UNAVAILABLE",
  assetKindUnsupported: "VISUAL_ASSIGNMENT_ASSET_KIND_UNSUPPORTED",
  displayKindMismatch: "VISUAL_ASSIGNMENT_DISPLAY_KIND_MISMATCH",
  assignmentIdConflict: "VISUAL_ASSIGNMENT_ID_CONFLICT",
  libraryPathInvalid: "VISUAL_ASSIGNMENT_LIBRARY_PATH_INVALID",
  libraryFileNotFound: "VISUAL_ASSIGNMENT_LIBRARY_FILE_NOT_FOUND",
  mediaPathInvalid: "VISUAL_ASSIGNMENT_MEDIA_PATH_INVALID",
  mediaPathCheckFailed: "VISUAL_ASSIGNMENT_MEDIA_PATH_CHECK_FAILED",
  copyFailed: "VISUAL_ASSIGNMENT_COPY_FAILED",
  hashFailed: "VISUAL_ASSIGNMENT_HASH_FAILED",
  checksumMismatch: "VISUAL_ASSIGNMENT_CHECKSUM_MISMATCH",
  mediaPathConflict: "VISUAL_ASSIGNMENT_MEDIA_PATH_CONFLICT",
  renameFailed: "VISUAL_ASSIGNMENT_RENAME_FAILED",
  candidateInvalid: "VISUAL_ASSIGNMENT_CANDIDATE_INVALID",
  cleanupFailed: "VISUAL_ASSIGNMENT_CLEANUP_FAILED"
} as const;

export type VisualAssignmentErrorCode =
  (typeof VISUAL_ASSIGNMENT_ERROR_CODE)[keyof typeof VISUAL_ASSIGNMENT_ERROR_CODE];

export type VisualAssignmentErrorStatus = 400 | 404 | 409 | 422 | 500;

type VisualAssignmentErrorDetail = {
  readonly path: readonly (string | number)[];
  readonly message: string;
};

export class VisualAssignmentError extends Error {
  readonly code: VisualAssignmentErrorCode;
  readonly status: VisualAssignmentErrorStatus;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: VisualAssignmentErrorCode,
    status: VisualAssignmentErrorStatus,
    message: string,
    details: readonly VisualAssignmentErrorDetail[] = []
  ) {
    super(message);
    this.name = "VisualAssignmentError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}
