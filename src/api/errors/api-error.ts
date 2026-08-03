import { ZodError } from "zod";

import {
  ProjectRepositoryError,
  type ProjectRepositoryErrorCode
} from "../../app/projects/project-repository.js";
import type { ApiErrorDetail } from "../../schema/api.js";

export const API_ERROR_CODE = {
  requestValidationFailed: "REQUEST_VALIDATION_FAILED",
  apiNotFound: "API_NOT_FOUND",
  requestBodyTooLarge: "REQUEST_BODY_TOO_LARGE",
  unsupportedMediaType: "UNSUPPORTED_MEDIA_TYPE",
  internalServerError: "INTERNAL_SERVER_ERROR"
};

export type ApiErrorStatus = 400 | 404 | 409 | 413 | 415 | 422 | 500;

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
const redactedPathSegment = "[redacted]";
const safeFieldPathSegmentPattern = /^[a-z][A-Za-z0-9_]{0,63}$/;

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
  PROJECT_ALREADY_EXISTS: "プロジェクトは既に存在します。",
  PROJECT_WRITE_FAILED: "プロジェクトを保存できませんでした。",
  PROJECT_RENAME_FAILED: "プロジェクトを保存できませんでした。"
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
  }
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isSupportedStatus(value: unknown): value is ApiErrorStatus {
  return (
    value === 400 ||
    value === 404 ||
    value === 409 ||
    value === 413 ||
    value === 415 ||
    value === 422 ||
    value === 500
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
  if (error instanceof ProjectRepositoryError) {
    const status = isSupportedStatus(error.status) ? error.status : 500;
    return {
      code: error.code,
      status,
      message: projectRepositoryMessages[error.code],
      details: mapProjectValidationDetails(error.code, error.issues),
      shouldLog: status >= 500
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
