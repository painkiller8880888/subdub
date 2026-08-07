import type { ApiErrorDetail } from "../../schema/api.js";

export type AssetErrorCode =
  | "ASSET_FILE_MISSING"
  | "ASSET_FILE_EMPTY"
  | "ASSET_TOO_MANY_FILES"
  | "ASSET_TOO_MANY_PARTS"
  | "ASSET_TOO_MANY_FIELDS"
  | "ASSET_FIELD_TOO_LARGE"
  | "ASSET_INVALID_FIELD"
  | "ASSET_UNSUPPORTED_FORMAT"
  | "ASSET_FORMAT_MISMATCH"
  | "ASSET_FILE_TOO_LARGE"
  | "ASSET_TAG_NOT_FOUND"
  | "ASSET_UPLOAD_INTERRUPTED"
  | "ASSET_STAGING_FAILED"
  | "ASSET_DATABASE_FAILED";

export type AssetErrorStatus = 400 | 413 | 422 | 500;

export class AssetError extends Error {
  readonly code: AssetErrorCode;
  readonly status: AssetErrorStatus;
  readonly shouldLog: boolean;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: AssetErrorCode,
    status: AssetErrorStatus,
    message: string,
    options: {
      shouldLog?: boolean;
      details?: readonly ApiErrorDetail[];
      cause?: unknown;
    } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "AssetError";
    this.code = code;
    this.status = status;
    this.shouldLog = options.shouldLog ?? status >= 500;
    this.details = options.details ?? [];
  }
}

export class AssetFileMissingError extends AssetError {
  constructor() {
    super("ASSET_FILE_MISSING", 422, "アップロードファイルがありません。");
    this.name = "AssetFileMissingError";
  }
}

export class AssetFileEmptyError extends AssetError {
  constructor() {
    super("ASSET_FILE_EMPTY", 422, "アップロードファイルが空です。");
    this.name = "AssetFileEmptyError";
  }
}

export class AssetTooManyFilesError extends AssetError {
  constructor() {
    super(
      "ASSET_TOO_MANY_FILES",
      413,
      "アップロードできるファイルは1つまでです。"
    );
    this.name = "AssetTooManyFilesError";
  }
}

export class AssetTooManyPartsError extends AssetError {
  constructor() {
    super("ASSET_TOO_MANY_PARTS", 413, "アップロード項目が多すぎます。");
    this.name = "AssetTooManyPartsError";
  }
}

export class AssetTooManyFieldsError extends AssetError {
  constructor() {
    super("ASSET_TOO_MANY_FIELDS", 413, "アップロードフィールドが多すぎます。");
    this.name = "AssetTooManyFieldsError";
  }
}

export class AssetFieldTooLargeError extends AssetError {
  constructor() {
    super(
      "ASSET_FIELD_TOO_LARGE",
      422,
      "アップロードフィールドが大きすぎます。"
    );
    this.name = "AssetFieldTooLargeError";
  }
}

export class AssetInvalidFieldError extends AssetError {
  constructor() {
    super("ASSET_INVALID_FIELD", 400, "アップロード項目が不正です。");
    this.name = "AssetInvalidFieldError";
  }
}

export class AssetUnsupportedFormatError extends AssetError {
  constructor() {
    super(
      "ASSET_UNSUPPORTED_FORMAT",
      422,
      "サポートされていないファイル形式です。"
    );
    this.name = "AssetUnsupportedFormatError";
  }
}

export class AssetFormatMismatchError extends AssetError {
  constructor() {
    super(
      "ASSET_FORMAT_MISMATCH",
      422,
      "ファイル形式と指定された種類またはMIME typeが一致しません。"
    );
    this.name = "AssetFormatMismatchError";
  }
}

export class AssetFileTooLargeError extends AssetError {
  constructor() {
    super("ASSET_FILE_TOO_LARGE", 413, "アップロードファイルが大きすぎます。");
    this.name = "AssetFileTooLargeError";
  }
}

export class AssetTagNotFoundError extends AssetError {
  constructor() {
    super("ASSET_TAG_NOT_FOUND", 422, "指定されたタグが見つかりません。");
    this.name = "AssetTagNotFoundError";
  }
}

export class AssetUploadInterruptedError extends AssetError {
  constructor() {
    super(
      "ASSET_UPLOAD_INTERRUPTED",
      400,
      "アップロードが途中で中断されました。"
    );
    this.name = "AssetUploadInterruptedError";
  }
}

export class AssetStagingFailedError extends AssetError {
  constructor(cause?: unknown) {
    super("ASSET_STAGING_FAILED", 500, "アップロードの保存に失敗しました。", {
      cause
    });
    this.name = "AssetStagingFailedError";
  }
}

export class AssetDatabaseError extends AssetError {
  constructor(cause?: unknown) {
    super("ASSET_DATABASE_FAILED", 500, "素材データの保存に失敗しました。", {
      cause
    });
    this.name = "AssetDatabaseError";
  }
}
