import { ZodError } from "zod";

import {
  ProjectRepositoryError,
  type ProjectRepositoryErrorCode
} from "../../app/projects/project-repository.js";
import type { ApiErrorDetail } from "../../schema/api.js";

export const API_ERROR_CODE = {
  requestValidationFailed: "REQUEST_VALIDATION_FAILED",
  apiNotFound: "API_NOT_FOUND",
  internalServerError: "INTERNAL_SERVER_ERROR"
};

export type ApiErrorStatus = 400 | 404 | 409 | 422 | 500;

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
  readonly validation: readonly FastifyValidationIssue[];
  readonly validationContext?: unknown;
  readonly statusCode?: unknown;
};

const genericValidationMessage = "リクエストの入力内容が不正です。";
const genericInternalMessage = "サーバーで予期しないエラーが発生しました。";

const projectRepositoryMessages: Record<
  ProjectRepositoryErrorCode,
  string
> = {
  PROJECT_ID_INVALID: "プロジェクトIDが不正です。",
  PROJECT_PATH_INVALID: "プロジェクトの保存先が不正です。",
  PROJECT_NOT_FOUND: "プロジェクトが見つかりません。",
  PROJECT_READ_FAILED: "プロジェクトを読み込めませんでした。",
  PROJECT_JSON_PARSE_FAILED: "プロジェクトデータを読み込めませんでした。",
  PROJECT_CURRENT_VALIDATION_FAILED:
    "現在のプロジェクトデータが不正です。",
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
  PROJECT_WRITE_FAILED: "プロジェクトを保存できませんでした。",
  PROJECT_RENAME_FAILED: "プロジェクトを保存できませんでした。"
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isPathSegment(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}

function isSupportedStatus(value: unknown): value is ApiErrorStatus {
  return (
    value === 400 ||
    value === 404 ||
    value === 409 ||
    value === 422 ||
    value === 500
  );
}

function sanitizeDetailMessage(message: string): string {
  if (
    /(?:api[_ -]?key|authorization|cookie|bearer|openrouter_api_key)/i.test(
      message
    ) ||
    /(?:[A-Za-z]:[\\/]|(?:^|[\s("'])\/(?:Users|home|private|tmp|var|workspace)(?:[\\/]|\b))/i.test(
      message
    )
  ) {
    return "入力内容を確認してください。";
  }

  return message;
}

function mapValidationDetails(
  issues: readonly { path: readonly unknown[]; message: string }[]
): ApiErrorDetail[] {
  return issues.map((issue) => ({
    path: issue.path.filter(isPathSegment),
    message: sanitizeDetailMessage(issue.message)
  }));
}

function isFastifyValidationError(
  error: unknown
): error is FastifyValidationError {
  if (!isRecord(error) || !Array.isArray(error.validation)) {
    return false;
  }

  return error.validation.every(isRecord);
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
    path: getValidationPath(issue, error.validationContext),
    message:
      typeof issue.message === "string"
        ? sanitizeDetailMessage(issue.message)
        : genericValidationMessage
  }));
}

export function mapApiError(error: unknown): MappedApiError {
  if (error instanceof ProjectRepositoryError) {
    return {
      code: error.code,
      status: isSupportedStatus(error.status) ? error.status : 500,
      message: projectRepositoryMessages[error.code],
      details: mapValidationDetails(error.issues),
      shouldLog: false
    };
  }

  if (error instanceof ZodError) {
    return {
      code: API_ERROR_CODE.requestValidationFailed,
      status: 422,
      message: genericValidationMessage,
      details: mapValidationDetails(error.issues),
      shouldLog: false
    };
  }

  if (isFastifyValidationError(error)) {
    return {
      code: API_ERROR_CODE.requestValidationFailed,
      status: isSupportedStatus(error.statusCode)
        ? error.statusCode
        : 400,
      message: genericValidationMessage,
      details: mapFastifyValidationDetails(error),
      shouldLog: false
    };
  }

  if (
    isRecord(error) &&
    error.code === "FST_ERR_CTP_INVALID_JSON_BODY"
  ) {
    return {
      code: API_ERROR_CODE.requestValidationFailed,
      status: 400,
      message: genericValidationMessage,
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
