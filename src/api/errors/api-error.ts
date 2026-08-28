import { ZodError } from "zod";

import {
  ProjectRepositoryError,
  type ProjectRepositoryErrorCode
} from "../../app/projects/project-repository.js";
import {
  OpenRouterAdapterError,
  OPENROUTER_ERROR_CODE,
  type OpenRouterErrorCode
} from "../../openrouter/errors.js";
import { OutlineGenerationError } from "../../app/projects/outline-generation-errors.js";
import { OutlineApprovalError } from "../../app/projects/outline-approval.js";
import {
  ScriptApprovalError,
  ScriptInitializationError,
  ScriptValidationError
} from "../../app/projects/script-errors.js";
import type { ApiErrorDetail } from "../../schema/api.js";
import {
  TerminologyDuplicateError,
  TerminologyNotFoundError
} from "../../app/terminology/terminology-errors.js";
import { AssetError } from "../../app/assets/asset-errors.js";
import { VisualSuggestionError } from "../../app/projects/visual-suggestion-errors.js";
import {
  VISUAL_ASSIGNMENT_ERROR_CODE,
  VisualAssignmentError
} from "../../app/projects/visual-assignment-errors.js";
import {
  PROJECT_EDIT_ERROR_CODE,
  ProjectEditError
} from "../../app/projects/project-edit-errors.js";
import {
  VoicevoxAdapterError,
  VoicevoxResolutionError
} from "../../voicevox/errors.js";
import {
  VOICEVOX_GENERATION_ERROR_CODE,
  VoicevoxGenerationError
} from "../../app/voicevox/generation-service.js";
import {
  VOICEVOX_ADJUSTMENT_ERROR_CODE,
  VoicevoxAdjustmentError
} from "../../app/voicevox/adjustment-service.js";
import { VoicevoxAdjustmentStoreError } from "../../app/voicevox/adjustment-store.js";
import { VoicevoxPreviewStoreError } from "../../app/voicevox/preview-store.js";
import { ProjectFileServiceError } from "../../app/projects/project-file-service.js";
import { RenderJobError } from "../../app/rendering/render-job-errors.js";
import { RenderRunLogStoreError } from "../../app/rendering/render-run-log-store.js";
import { ImprovementLogError } from "../../app/projects/improvement-log-errors.js";
import { RunLogStoreError } from "../../app/run-log-store.js";
import {
  CharacterVisualApiError,
  CharacterVisualRepositoryError,
  CharacterVisualSeedConflictError,
  CharacterVisualValidationError
} from "../../app/character-visuals/character-visual-errors.js";
import {
  ScreenTemplateInactiveError,
  ScreenTemplateNotFoundError,
  ScreenTemplateRepositoryError,
  ScreenTemplateRevisionConflictError
} from "../../app/screen-templates/screen-template-errors.js";
import { ScreenTemplateValidationError } from "../../validation/screen-templates.js";
import {
  InsertTextTemplateNotFoundError,
  InsertTextTemplateRepositoryError,
  InsertTextTemplateRevisionConflictError
} from "../../app/insert-text-templates/insert-text-template-errors.js";
import { InsertTextTemplateValidationError } from "../../validation/insert-text-templates.js";

export class ApiResponseValidationError extends Error {
  constructor(cause: unknown) {
    super("The server produced an invalid API response.", { cause });
    this.name = "ApiResponseValidationError";
  }
}

export const API_ERROR_CODE = {
  requestValidationFailed: "REQUEST_VALIDATION_FAILED",
  apiNotFound: "API_NOT_FOUND",
  requestBodyTooLarge: "REQUEST_BODY_TOO_LARGE",
  unsupportedMediaType: "UNSUPPORTED_MEDIA_TYPE",
  internalServerError: "INTERNAL_SERVER_ERROR",
  openRouterNotConfigured: OPENROUTER_ERROR_CODE.notConfigured,
  openRouterAuthFailed: OPENROUTER_ERROR_CODE.authFailed,
  openRouterPaymentRequired: OPENROUTER_ERROR_CODE.paymentRequired,
  openRouterRateLimited: OPENROUTER_ERROR_CODE.rateLimited,
  openRouterBadGateway: OPENROUTER_ERROR_CODE.badGateway,
  openRouterRequestFailed: OPENROUTER_ERROR_CODE.requestFailed,
  openRouterUnavailable: OPENROUTER_ERROR_CODE.unavailable,
  openRouterResponseInvalid: OPENROUTER_ERROR_CODE.responseInvalid,
  voicevoxUnavailable: "VOICEVOX_UNAVAILABLE",
  voiceAdjustmentInvalid: "VOICEVOX_ADJUSTMENT_INVALID",
  voiceAdjustmentStorageFailed: "VOICEVOX_ADJUSTMENT_STORAGE_FAILED",
  terminologyNotFound: "TERMINOLOGY_NOT_FOUND",
  terminologyDuplicate: "TERMINOLOGY_DUPLICATE",
  assetFileMissing: "ASSET_FILE_MISSING",
  assetFileEmpty: "ASSET_FILE_EMPTY",
  assetTooManyFiles: "ASSET_TOO_MANY_FILES",
  assetTooManyParts: "ASSET_TOO_MANY_PARTS",
  assetTooManyFields: "ASSET_TOO_MANY_FIELDS",
  assetFieldTooLarge: "ASSET_FIELD_TOO_LARGE",
  assetInvalidField: "ASSET_INVALID_FIELD",
  assetUnsupportedFormat: "ASSET_UNSUPPORTED_FORMAT",
  assetFormatMismatch: "ASSET_FORMAT_MISMATCH",
  assetFileTooLarge: "ASSET_FILE_TOO_LARGE",
  assetTagNotFound: "ASSET_TAG_NOT_FOUND",
  assetUploadInterrupted: "ASSET_UPLOAD_INTERRUPTED",
  assetStagingFailed: "ASSET_STAGING_FAILED",
  assetDatabaseFailed: "ASSET_DATABASE_FAILED",
  characterVisualNotFound: "CHARACTER_VISUAL_NOT_FOUND",
  characterVariantNotFound: "CHARACTER_VARIANT_NOT_FOUND",
  characterVisualUnsupportedFileType:
    "CHARACTER_VISUAL_UNSUPPORTED_FILE_TYPE",
  characterVisualInvalidPng: "CHARACTER_VISUAL_INVALID_PNG",
  characterVisualMissingSlot: "CHARACTER_VISUAL_MISSING_SLOT",
  characterVisualCanvasSizeMismatch: "CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH",
  characterVisualTooManyFiles: "CHARACTER_VISUAL_TOO_MANY_FILES",
  characterVisualFileTooLarge: "CHARACTER_VISUAL_FILE_TOO_LARGE",
  characterVisualUnsafePath: "CHARACTER_VISUAL_UNSAFE_PATH",
  characterVisualConflict: "CHARACTER_VISUAL_CONFLICT",
  characterVisualStorageFailed: "CHARACTER_VISUAL_STORAGE_FAILED",
  characterVisualUploadInterrupted: "CHARACTER_VISUAL_UPLOAD_INTERRUPTED",
  characterVisualDatabaseFailed: "CHARACTER_VISUAL_DATABASE_FAILED",
  screenTemplateNotFound: "SCREEN_TEMPLATE_NOT_FOUND",
  screenTemplateRevisionConflict: "SCREEN_TEMPLATE_REVISION_CONFLICT",
  screenTemplateInactive: "SCREEN_TEMPLATE_INACTIVE",
  screenTemplateValidationFailed: "SCREEN_TEMPLATE_VALIDATION_FAILED",
  screenTemplateConflict: "SCREEN_TEMPLATE_CONFLICT",
  screenTemplateDatabaseFailed: "SCREEN_TEMPLATE_DATABASE_FAILED",
  insertTextTemplateNotFound: "INSERT_TEXT_TEMPLATE_NOT_FOUND",
  insertTextTemplateRevisionConflict: "INSERT_TEXT_TEMPLATE_REVISION_CONFLICT",
  insertTextTemplateValidationFailed: "INSERT_TEXT_TEMPLATE_VALIDATION_FAILED",
  insertTextTemplateConflict: "INSERT_TEXT_TEMPLATE_CONFLICT",
  insertTextTemplateDatabaseFailed: "INSERT_TEXT_TEMPLATE_DATABASE_FAILED",
  visualAssignmentProjectPathInvalid:
    VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
  visualAssignmentAssetNotFound: VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound,
  visualAssignmentAssetNotActive: VISUAL_ASSIGNMENT_ERROR_CODE.assetNotActive,
  visualAssignmentAssetChecksumUnavailable:
    VISUAL_ASSIGNMENT_ERROR_CODE.assetChecksumUnavailable,
  visualAssignmentAssetMetadataUnavailable:
    VISUAL_ASSIGNMENT_ERROR_CODE.assetMetadataUnavailable,
  visualAssignmentAssetKindUnsupported:
    VISUAL_ASSIGNMENT_ERROR_CODE.assetKindUnsupported,
  visualAssignmentDisplayKindMismatch:
    VISUAL_ASSIGNMENT_ERROR_CODE.displayKindMismatch,
  visualAssignmentAssignmentIdConflict:
    VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdConflict,
  visualAssignmentAssignmentNotFound:
    VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound,
  visualAssignmentAssignmentIdMismatch:
    VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdMismatch,
  visualAssignmentAssignmentRangeInvalid:
    VISUAL_ASSIGNMENT_ERROR_CODE.assignmentRangeInvalid,
  visualAssignmentOverlap: VISUAL_ASSIGNMENT_ERROR_CODE.assignmentOverlap,
  visualAssignmentRangeShorteningConfirmationRequired:
    VISUAL_ASSIGNMENT_ERROR_CODE.rangeShorteningConfirmationRequired,
  visualAssignmentAssetReplacementUnsupported:
    VISUAL_ASSIGNMENT_ERROR_CODE.assignmentAssetReplacementUnsupported,
  visualAssignmentLibraryPathInvalid:
    VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
  visualAssignmentLibraryFileNotFound:
    VISUAL_ASSIGNMENT_ERROR_CODE.libraryFileNotFound,
  visualAssignmentMediaPathInvalid: VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
  visualAssignmentMediaPathCheckFailed:
    VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathCheckFailed,
  visualAssignmentCopyFailed: VISUAL_ASSIGNMENT_ERROR_CODE.copyFailed,
  visualAssignmentHashFailed: VISUAL_ASSIGNMENT_ERROR_CODE.hashFailed,
  visualAssignmentChecksumMismatch:
    VISUAL_ASSIGNMENT_ERROR_CODE.checksumMismatch,
  visualAssignmentMediaPathConflict:
    VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict,
  visualAssignmentRenameFailed: VISUAL_ASSIGNMENT_ERROR_CODE.renameFailed,
  visualAssignmentCandidateInvalid:
    VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
  visualAssignmentProjectMediaFileMissing:
    VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaFileMissing,
  visualAssignmentProjectMediaHashFailed:
    VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaHashFailed,
  visualAssignmentProjectMediaChecksumMismatch:
    VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaChecksumMismatch,
  visualAssignmentScriptNotApproved:
    VISUAL_ASSIGNMENT_ERROR_CODE.scriptNotApproved,
  visualAssignmentApprovalValidationFailed:
    VISUAL_ASSIGNMENT_ERROR_CODE.approvalValidationFailed,
  visualAssignmentCleanupFailed: VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed,
  projectEditProjectPathInvalid: PROJECT_EDIT_ERROR_CODE.projectPathInvalid,
  projectEditAssetNotFound: PROJECT_EDIT_ERROR_CODE.assetNotFound,
  projectEditAssetNotActive: PROJECT_EDIT_ERROR_CODE.assetNotActive,
  projectEditAssetKindMismatch: PROJECT_EDIT_ERROR_CODE.assetKindMismatch,
  projectEditAssetFormatMismatch: PROJECT_EDIT_ERROR_CODE.assetFormatMismatch,
  projectEditAssetChecksumUnavailable:
    PROJECT_EDIT_ERROR_CODE.assetChecksumUnavailable,
  projectEditLibraryPathInvalid: PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
  projectEditLibraryFileNotFound: PROJECT_EDIT_ERROR_CODE.libraryFileNotFound,
  projectEditMediaPathInvalid: PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
  projectEditMediaPathCheckFailed:
    PROJECT_EDIT_ERROR_CODE.mediaPathCheckFailed,
  projectEditCopyFailed: PROJECT_EDIT_ERROR_CODE.copyFailed,
  projectEditHashFailed: PROJECT_EDIT_ERROR_CODE.hashFailed,
  projectEditChecksumMismatch: PROJECT_EDIT_ERROR_CODE.checksumMismatch,
  projectEditMediaPathConflict: PROJECT_EDIT_ERROR_CODE.mediaPathConflict,
  projectEditRenameFailed: PROJECT_EDIT_ERROR_CODE.renameFailed,
  projectEditCandidateInvalid: PROJECT_EDIT_ERROR_CODE.candidateInvalid,
  projectEditCleanupFailed: PROJECT_EDIT_ERROR_CODE.cleanupFailed,
  improvementCandidateNotFound: "IMPROVEMENT_CANDIDATE_NOT_FOUND",
  improvementCandidateDuplicate: "IMPROVEMENT_CANDIDATE_DUPLICATE",
  improvementDecisionConflict: "IMPROVEMENT_DECISION_CONFLICT",
  improvementRelationInvalid: "IMPROVEMENT_RELATION_INVALID",
  improvementRejectionNotAllowed: "IMPROVEMENT_REJECTION_NOT_ALLOWED",
  improvementPayloadInvalid: "IMPROVEMENT_PAYLOAD_INVALID",
  improvementDatabaseFailed: "IMPROVEMENT_DATABASE_FAILED"
};

export type ApiErrorStatus =
  | 400
  | 404
  | 402
  | 409
  | 413
  | 415
  | 422
  | 429
  | 500
  | 502
  | 503;

export type MappedApiError = {
  readonly code: string;
  readonly status: ApiErrorStatus;
  readonly message: string;
  readonly details: readonly ApiErrorDetail[];
  readonly shouldLog: boolean;
};

type UnknownRecord = Record<string, unknown>;

type FastifyValidationIssue = UnknownRecord;

type FastifyValidationError = {
  readonly code: "FST_ERR_VALIDATION";
  readonly validation: readonly FastifyValidationIssue[];
  readonly validationContext: FastifyValidationContext;
  readonly statusCode: 400;
};

type FastifyValidationContext =
  | "body"
  | "headers"
  | "params"
  | "querystring";

type FastifyRequestErrorMapping = {
  readonly code: string;
  readonly status: ApiErrorStatus;
  readonly message: string;
};

const genericValidationMessage = "リクエストの入力内容が不正です。";
const genericInternalMessage = "サーバーで予期しないエラーが発生しました。";
const openRouterMessages: Readonly<
  Record<OpenRouterErrorCode, { status: 402 | 429 | 502 | 503; message: string }>
> = {
  [OPENROUTER_ERROR_CODE.notConfigured]: {
    status: 503,
    message: "OpenRouter is not configured."
  },
  [OPENROUTER_ERROR_CODE.authFailed]: {
    status: 502,
    message: "OpenRouter authentication failed."
  },
  [OPENROUTER_ERROR_CODE.paymentRequired]: {
    status: 402,
    message: "OpenRouter balance is insufficient."
  },
  [OPENROUTER_ERROR_CODE.rateLimited]: {
    status: 429,
    message: "OpenRouter rate limit was reached."
  },
  [OPENROUTER_ERROR_CODE.badGateway]: {
    status: 502,
    message: "OpenRouter returned a bad gateway response."
  },
  [OPENROUTER_ERROR_CODE.requestFailed]: {
    status: 502,
    message: "OpenRouter rejected the request."
  },
  [OPENROUTER_ERROR_CODE.unavailable]: {
    status: 503,
    message: "OpenRouter is temporarily unavailable."
  },
  [OPENROUTER_ERROR_CODE.responseInvalid]: {
    status: 502,
    message: "OpenRouter returned an invalid response."
  }
};
const redactedPathSegment = "[redacted]";
const safeFieldPathSegmentPattern = /^[a-z][A-Za-z0-9_]{0,63}$/;

const projectRepositoryMessages: Partial<Record<
  ProjectRepositoryErrorCode,
  string
>> = {
  PROJECT_ID_INVALID: "プロジェクトIDが不正です。",
  PROJECT_PATH_INVALID: "プロジェクトの保存先が不正です。",
  PROJECT_NOT_FOUND: "プロジェクトが見つかりません。",
  PROJECT_READ_FAILED: "プロジェクトを読み込めませんでした。",
  PROJECT_JSON_PARSE_FAILED: "プロジェクトデータを読み込めませんでした。",
  PROJECT_CURRENT_VALIDATION_FAILED:
    "現在のプロジェクトデータが不正です。",
  PROJECT_MIGRATION_PREREQUISITE_FAILED:
    "プロジェクトの移行に必要な画面テンプレートがありません。",
  PROJECT_CANDIDATE_VALIDATION_FAILED:
    "保存するプロジェクトデータが不正です。",
  PROJECT_CURRENT_ID_MISMATCH:
    "プロジェクトデータの識別子が一致しません。",
  PROJECT_CANDIDATE_ID_MISMATCH:
    "保存するプロジェクトデータの識別子が一致しません。",
  PROJECT_UPDATED_VALIDATION_FAILED:
    "更新後のプロジェクトデータを検証できませんでした。",
  PROJECT_EXPECTED_REVISION_INVALID: "expectedRevisionが不正です。",
  PROJECT_REVISION_CONFLICT: "プロジェクトが別の内容へ更新されています。",
  PROJECT_ALREADY_EXISTS: "プロジェクトは既に存在します。",
  PROJECT_WRITE_FAILED: "プロジェクトを保存できませんでした。",
  PROJECT_RENAME_FAILED: "プロジェクトを保存できませんでした。",
  PROJECT_RUN_LOG_INVALID: "AI実行ログが不正です。",
  PROJECT_RUN_LOG_WRITE_FAILED: "AI実行ログを保存できませんでした。"
};

const fastifyRequestErrorMappings: Readonly<
  Record<string, FastifyRequestErrorMapping>
> = {
  FST_ERR_CTP_BODY_TOO_LARGE: {
    code: API_ERROR_CODE.requestBodyTooLarge,
    status: 413,
    message: "リクエスト本文が大きすぎます。"
  },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: {
    code: API_ERROR_CODE.unsupportedMediaType,
    status: 415,
    message: "サポートされていないメディアタイプです。"
  },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: {
    code: API_ERROR_CODE.requestValidationFailed,
    status: 400,
    message: genericValidationMessage
  },
  FST_ERR_CTP_EMPTY_JSON_BODY: {
    code: API_ERROR_CODE.requestValidationFailed,
    status: 400,
    message: genericValidationMessage
  },
  FST_ERR_CTP_INVALID_JSON_BODY: {
    code: API_ERROR_CODE.requestValidationFailed,
    status: 400,
    message: genericValidationMessage
  },
  FST_PARTS_LIMIT: {
    code: API_ERROR_CODE.assetTooManyParts,
    status: 413,
    message: "アップロード項目が多すぎます。"
  },
  FST_FILES_LIMIT: {
    code: API_ERROR_CODE.assetTooManyFiles,
    status: 413,
    message: "アップロードできるファイルは1つまでです。"
  },
  FST_FIELDS_LIMIT: {
    code: API_ERROR_CODE.assetTooManyFields,
    status: 413,
    message: "アップロードフィールドが多すぎます。"
  },
  FST_REQ_FILE_TOO_LARGE: {
    code: API_ERROR_CODE.assetFileTooLarge,
    status: 413,
    message: "アップロードファイルが大きすぎます。"
  },
  FST_PROTO_VIOLATION: {
    code: API_ERROR_CODE.assetInvalidField,
    status: 400,
    message: "アップロード項目が不正です。"
  },
  FST_INVALID_MULTIPART_CONTENT_TYPE: {
    code: API_ERROR_CODE.assetInvalidField,
    status: 400,
    message: "アップロード項目が不正です。"
  },
  FST_MP_PREMATURE_CLOSE: {
    code: API_ERROR_CODE.assetUploadInterrupted,
    status: 400,
    message: "アップロードが途中で中断されました。"
  }
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isSupportedStatus(value: unknown): value is ApiErrorStatus {
  return (
    value === 400 ||
    value === 404 ||
    value === 402 ||
    value === 409 ||
    value === 413 ||
    value === 415 ||
    value === 422 ||
    value === 429 ||
    value === 500 ||
    value === 502 ||
    value === 503
  );
}

function sanitizePath(path: readonly unknown[]): Array<string | number> {
  return path.map((segment) => {
    if (
      typeof segment === "number" &&
      Number.isSafeInteger(segment) &&
      segment >= 0
    ) {
      return segment;
    }

    if (
      typeof segment === "string" &&
      safeFieldPathSegmentPattern.test(segment)
    ) {
      return segment;
    }

    return redactedPathSegment;
  });
}

function getZodValidationMessage(code: string): string {
  switch (code) {
    case "invalid_type":
    case "invalid_format":
    case "invalid_key":
    case "invalid_element":
      return "入力形式が不正です。";
    case "too_small":
      return "入力値が小さすぎます。";
    case "too_big":
      return "入力値が大きすぎます。";
    case "unrecognized_keys":
      return "未定義の項目があります。";
    case "invalid_union":
      return "入力値の選択肢が不正です。";
    case "not_multiple_of":
    case "invalid_value":
    case "custom":
    default:
      return genericValidationMessage;
  }
}

function getFastifyValidationMessage(keyword: unknown): string {
  switch (keyword) {
    case "required":
      return "必須項目です。";
    case "additionalProperties":
      return "未定義の項目です。";
    case "minLength":
    case "minItems":
    case "minimum":
      return "入力値が小さすぎます。";
    case "maxLength":
    case "maxItems":
    case "maximum":
      return "入力値が大きすぎます。";
    case "format":
    case "type":
      return "入力形式が不正です。";
    default:
      return genericValidationMessage;
  }
}

function getProjectValidationMessage(
  code: ProjectRepositoryErrorCode
): string {
  switch (code) {
    case "PROJECT_CURRENT_VALIDATION_FAILED":
      return "現在のプロジェクトデータが不正です。";
    case "PROJECT_CANDIDATE_VALIDATION_FAILED":
      return "保存するプロジェクトデータが不正です。";
    case "PROJECT_UPDATED_VALIDATION_FAILED":
      return "更新後のプロジェクトデータが不正です。";
    default:
      return "プロジェクトデータを確認してください。";
  }
}

function mapZodValidationDetails(
  issues: readonly { path: readonly unknown[]; code: string }[]
): ApiErrorDetail[] {
  return issues.map((issue) => ({
    path: sanitizePath(issue.path),
    message: getZodValidationMessage(issue.code)
  }));
}

function mapProjectValidationDetails(
  code: ProjectRepositoryErrorCode,
  issues: readonly { path: readonly unknown[] }[]
): ApiErrorDetail[] {
  const message = getProjectValidationMessage(code);
  return issues.map((issue) => ({
    path: sanitizePath(issue.path),
    message
  }));
}

function isFastifyValidationError(
  error: unknown
): error is FastifyValidationError {
  if (
    !isRecord(error) ||
    error.code !== "FST_ERR_VALIDATION" ||
    error.statusCode !== 400 ||
    !isFastifyValidationContext(error.validationContext) ||
    !Array.isArray(error.validation) ||
    error.validation.length === 0
  ) {
    return false;
  }

  return error.validation.every(isRecord);
}

function isFastifyValidationContext(
  value: unknown
): value is FastifyValidationContext {
  return (
    value === "body" ||
    value === "headers" ||
    value === "params" ||
    value === "querystring"
  );
}

function getFastifyRequestErrorMapping(
  error: unknown
): FastifyRequestErrorMapping | undefined {
  if (!isRecord(error) || typeof error.code !== "string") {
    return undefined;
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      fastifyRequestErrorMappings,
      error.code
    )
  ) {
    return undefined;
  }

  return fastifyRequestErrorMappings[error.code];
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function toPathSegment(segment: string): string | number {
  if (/^(0|[1-9]\d*)$/.test(segment)) {
    const numericSegment = Number(segment);
    if (Number.isSafeInteger(numericSegment)) {
      return numericSegment;
    }
  }

  return segment;
}

function parseJsonPointer(pointer: string): Array<string | number> {
  if (pointer === "") {
    return [];
  }

  const segments = pointer.startsWith("/")
    ? pointer.split("/").slice(1)
    : [pointer];
  return segments.map((segment) =>
    toPathSegment(decodeJsonPointerSegment(segment))
  );
}

function parseLegacyDataPath(dataPath: string): Array<string | number> {
  const segments: Array<string | number> = [];
  const segmentPattern = /(?:^|\.)([^.[\]]+)|\[([^\]]+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = segmentPattern.exec(dataPath)) !== null) {
    const segment = match[1] ?? match[2];
    if (segment !== undefined) {
      segments.push(toPathSegment(segment.replace(/^['"]|['"]$/g, "")));
    }
  }

  return segments;
}

function getValidationPath(
  issue: FastifyValidationIssue,
  validationContext: unknown
): Array<string | number> {
  const instancePath =
    typeof issue.instancePath === "string"
      ? parseJsonPointer(issue.instancePath)
      : typeof issue.dataPath === "string"
        ? parseLegacyDataPath(issue.dataPath)
        : [];
  const params = isRecord(issue.params) ? issue.params : undefined;
  const keyword = typeof issue.keyword === "string" ? issue.keyword : "";

  if (params !== undefined && keyword === "required") {
    const missingProperty = params.missingProperty;
    if (typeof missingProperty === "string") {
      instancePath.push(missingProperty);
    }
  } else if (params !== undefined && keyword === "additionalProperties") {
    const additionalProperty = params.additionalProperty;
    if (typeof additionalProperty === "string") {
      instancePath.push(additionalProperty);
    }
  } else if (instancePath.length === 0 && typeof issue.propertyName === "string") {
    instancePath.push(issue.propertyName);
  }

  if (typeof validationContext === "string" && validationContext.length > 0) {
    return [validationContext, ...instancePath];
  }

  return instancePath;
}

function mapFastifyValidationDetails(
  error: FastifyValidationError
): ApiErrorDetail[] {
  return error.validation.map((issue) => ({
    path: sanitizePath(getValidationPath(issue, error.validationContext)),
    message: getFastifyValidationMessage(issue.keyword)
  }));
}

export function mapApiError(error: unknown): MappedApiError {
  if (error instanceof ApiResponseValidationError) {
    return {
      code: API_ERROR_CODE.internalServerError,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof TerminologyNotFoundError) {
    return {
      code: error.code,
      status: error.status,
      message: "用語が見つかりません。",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof TerminologyDuplicateError) {
    return {
      code: error.code,
      status: error.status,
      message: "同じ表記の用語が既に存在します。",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof AssetError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: error.shouldLog
    };
  }

  if (error instanceof CharacterVisualApiError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: [],
      shouldLog: error.shouldLog
    };
  }

  if (error instanceof CharacterVisualRepositoryError) {
    return {
      code:
        error.constraint === "unknown"
          ? API_ERROR_CODE.characterVisualDatabaseFailed
          : "CHARACTER_VISUAL_CONFLICT",
      status: error.constraint === "unknown" ? 500 : 409,
      message:
        error.constraint === "unknown"
          ? genericInternalMessage
          : "The character visual registration conflicts with existing data.",
      details: [],
      shouldLog: error.constraint === "unknown"
    };
  }

  if (error instanceof ScreenTemplateNotFoundError) {
    return {
      code: API_ERROR_CODE.screenTemplateNotFound,
      status: 404,
      message: "ScreenTemplateが見つかりません。",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof ScreenTemplateRevisionConflictError) {
    return {
      code: API_ERROR_CODE.screenTemplateRevisionConflict,
      status: 409,
      message: "ScreenTemplateが別の内容へ更新されています。",
      details: [
        {
          path: ["expectedRevision"],
          message: "現在のrevisionと一致しません。"
        },
        {
          path: ["revision"],
          message: "最新のScreenTemplateを再取得してください。"
        }
      ],
      shouldLog: false
    };
  }

  if (error instanceof ScreenTemplateInactiveError) {
    return {
      code: API_ERROR_CODE.screenTemplateInactive,
      status: 409,
      message: "利用停止中のScreenTemplateは更新できません。",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof ScreenTemplateValidationError) {
    return {
      code: API_ERROR_CODE.screenTemplateValidationFailed,
      status: 422,
      message: genericValidationMessage,
      details: error.issues.map((issue) => ({
        path: [...issue.path],
        message: issue.message
      })),
      shouldLog: false
    };
  }

  if (error instanceof ScreenTemplateRepositoryError) {
    if (error.constraint !== "unknown") {
      return {
        code: API_ERROR_CODE.screenTemplateConflict,
        status: 409,
        message: "ScreenTemplateの保存内容が既存データと競合しました。",
        details: [],
        shouldLog: false
      };
    }
    return {
      code: API_ERROR_CODE.screenTemplateDatabaseFailed,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof InsertTextTemplateNotFoundError) {
    return {
      code: API_ERROR_CODE.insertTextTemplateNotFound,
      status: 404,
      message: "InsertTextTemplateが見つかりません。",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof InsertTextTemplateRevisionConflictError) {
    return {
      code: API_ERROR_CODE.insertTextTemplateRevisionConflict,
      status: 409,
      message: "InsertTextTemplateが別の内容へ更新されています。",
      details: [
        {
          path: ["expectedRevision"],
          message: "現在のrevisionと一致しません。"
        },
        {
          path: ["revision"],
          message: "最新のInsertTextTemplateを再取得してください。"
        }
      ],
      shouldLog: false
    };
  }

  if (error instanceof InsertTextTemplateValidationError) {
    return {
      code: API_ERROR_CODE.insertTextTemplateValidationFailed,
      status: 422,
      message: genericValidationMessage,
      details: error.issues.map((issue) => ({
        path: [...issue.path],
        message: issue.message
      })),
      shouldLog: false
    };
  }

  if (error instanceof InsertTextTemplateRepositoryError) {
    if (error.constraint !== "unknown") {
      return {
        code: API_ERROR_CODE.insertTextTemplateConflict,
        status: 409,
        message: "InsertTextTemplateの保存内容が既存データと競合しました。",
        details: [],
        shouldLog: false
      };
    }
    return {
      code: API_ERROR_CODE.insertTextTemplateDatabaseFailed,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (
    error instanceof CharacterVisualValidationError ||
    error instanceof CharacterVisualSeedConflictError
  ) {
    return {
      code:
        error instanceof CharacterVisualSeedConflictError
          ? "CHARACTER_VISUAL_CONFLICT"
          : "REQUEST_VALIDATION_FAILED",
      status: error instanceof CharacterVisualSeedConflictError ? 409 : 422,
      message:
        error instanceof CharacterVisualSeedConflictError
          ? "The character visual registration conflicts with existing data."
          : genericValidationMessage,
      details: [],
      shouldLog: false
    };
  }

  if (
    error instanceof ScriptInitializationError ||
    error instanceof ScriptApprovalError ||
    error instanceof ScriptValidationError
  ) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: false
    };
  }

  if (error instanceof OutlineApprovalError) {
    return {
      code: error.code,
      status: error.status,
      message: "構成案が承認条件を満たしていません。",
      details: error.details,
      shouldLog: false
    };
  }

  if (error instanceof OutlineGenerationError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: false
    };
  }

  if (error instanceof VisualSuggestionError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: false
    };
  }

  if (error instanceof VisualAssignmentError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof ProjectEditError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof ImprovementLogError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: error.details,
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof OpenRouterAdapterError) {
    const code =
      error.upstreamStatus === 429
        ? OPENROUTER_ERROR_CODE.rateLimited
        : error.upstreamStatus === 502
          ? OPENROUTER_ERROR_CODE.badGateway
          : error.code;
    const mapped = openRouterMessages[code];
    return {
      code,
      status: mapped.status,
      message: mapped.message,
      details: [],
      shouldLog: error.code !== OPENROUTER_ERROR_CODE.notConfigured
    };
  }

  if (
    error instanceof VoicevoxAdapterError ||
    error instanceof VoicevoxResolutionError
  ) {
    return {
      code: API_ERROR_CODE.voicevoxUnavailable,
      status: 503,
      message: "VOICEVOX audio is unavailable.",
      details: [],
      shouldLog: false
    };
  }

  if (error instanceof VoicevoxAdjustmentError) {
    if (error.code === VOICEVOX_ADJUSTMENT_ERROR_CODE.unavailable) {
      return {
        code: API_ERROR_CODE.voicevoxUnavailable,
        status: 503,
        message: "VOICEVOX audio is unavailable.",
        details: [],
        shouldLog: false
      };
    }
    if (error.code === VOICEVOX_ADJUSTMENT_ERROR_CODE.lineNotFound) {
      return {
        code: error.code,
        status: 404,
        message: "指定されたセリフが見つかりません。",
        details: [],
        shouldLog: false
      };
    }
    if (error.code === VOICEVOX_ADJUSTMENT_ERROR_CODE.baseStale) {
      return {
        code: error.code,
        status: 409,
        message: "現在の読み上げ条件が変わったため、調整を再確認してください。",
        details: [],
        shouldLog: false
      };
    }
    if (error.code === VOICEVOX_ADJUSTMENT_ERROR_CODE.previewNotFound) {
      return {
        code: error.code,
        status: 404,
        message: "試聴データが見つかりません。",
        details: [],
        shouldLog: false
      };
    }
    return {
      code: API_ERROR_CODE.internalServerError,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof VoicevoxAdjustmentStoreError) {
    if (
      error.code === "VOICEVOX_ADJUSTMENT_STORE_JSON_INVALID" ||
      error.code === "VOICEVOX_ADJUSTMENT_STORE_SCHEMA_INVALID" ||
      error.code === "VOICEVOX_ADJUSTMENT_STORE_LINE_ID_MISMATCH"
    ) {
      return {
        code: API_ERROR_CODE.voiceAdjustmentInvalid,
        status: 422,
        message: "音声調整データが不正です。",
        details: [],
        shouldLog: false
      };
    }
    return {
      code: API_ERROR_CODE.voiceAdjustmentStorageFailed,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof VoicevoxPreviewStoreError) {
    return {
      code: API_ERROR_CODE.internalServerError,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof VoicevoxGenerationError) {
    if (error.code === VOICEVOX_GENERATION_ERROR_CODE.unavailable) {
      return {
        code: API_ERROR_CODE.voicevoxUnavailable,
        status: 503,
        message: "VOICEVOX audio is unavailable.",
        details: [],
        shouldLog: false
      };
    }
    if (error.code === VOICEVOX_GENERATION_ERROR_CODE.lineNotFound) {
      return {
        code: error.code,
        status: 404,
        message: "指定されたセリフが見つかりません。",
        details: [],
        shouldLog: false
      };
    }
    return {
      code: API_ERROR_CODE.internalServerError,
      status: 500,
      message: genericInternalMessage,
      details: [],
      shouldLog: true
    };
  }

  if (error instanceof ProjectRepositoryError) {
    const status = isSupportedStatus(error.status) ? error.status : 500;
    return {
      code: error.code,
      status,
      message:
        error.publicMessage ??
        projectRepositoryMessages[error.code] ??
        genericInternalMessage,
      details: mapProjectValidationDetails(error.code, error.issues),
      shouldLog: status >= 500
    };
  }

  if (error instanceof RunLogStoreError) {
    const status = isSupportedStatus(error.status) ? error.status : 500;
    return {
      code: error.code,
      status,
      message:
        error.code === "RUN_LOG_PROJECT_ID_INVALID"
          ? "プロジェクトIDが不正です。"
          : error.code === "RUN_LOG_ID_INVALID"
            ? "実行ログIDが不正です。"
            : error.code === "RUN_LOG_NOT_FOUND"
              ? "実行ログが見つかりません。"
              : genericInternalMessage,
      details: [],
      shouldLog: status >= 500
    };
  }

  if (error instanceof RenderJobError) {
    return {
      code: error.code,
      status: error.status,
      message: error.message,
      details: [],
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof RenderRunLogStoreError) {
    return {
      code: error.code,
      status: error.status,
      message:
        error.code === "RENDER_RUN_NOT_FOUND"
          ? "The render run does not exist."
          : error.code === "RENDER_PROJECT_ID_INVALID"
            ? "The project ID is invalid."
            : error.code === "RENDER_RUN_ID_INVALID"
              ? "The render run ID is invalid."
              : genericInternalMessage,
      details: [],
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof ProjectFileServiceError) {
    return {
      code: error.code,
      status: error.status,
      message:
        error.code === "PROJECT_FILE_NOT_FOUND"
          ? "プロジェクト素材が見つかりません。"
          : error.code === "PROJECT_FILE_PATH_INVALID"
            ? "プロジェクト素材の参照先が不正です。"
            : error.code === "PROJECT_FILE_PROJECT_ID_INVALID"
              ? "プロジェクトIDが不正です。"
              : genericInternalMessage,
      details: [],
      shouldLog: error.status >= 500
    };
  }

  if (error instanceof ZodError) {
    return {
      code: API_ERROR_CODE.requestValidationFailed,
      status: 422,
      message: genericValidationMessage,
      details: mapZodValidationDetails(error.issues),
      shouldLog: false
    };
  }

  const fastifyRequestError = getFastifyRequestErrorMapping(error);
  if (fastifyRequestError !== undefined) {
    return {
      ...fastifyRequestError,
      details: [],
      shouldLog: false
    };
  }

  if (isFastifyValidationError(error)) {
    return {
      code: API_ERROR_CODE.requestValidationFailed,
      status: 400,
      message: genericValidationMessage,
      details: mapFastifyValidationDetails(error),
      shouldLog: false
    };
  }

  return {
    code: API_ERROR_CODE.internalServerError,
    status: 500,
    message: genericInternalMessage,
    details: [],
    shouldLog: true
  };
}
