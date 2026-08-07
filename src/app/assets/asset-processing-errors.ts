import type { AssetProcessingErrorCode } from "../../schema/asset.js";

const PROCESSING_ERROR_MESSAGES: Record<AssetProcessingErrorCode, string> = {
  PROCESSING_MEDIA_NOT_FOUND: "元のメディアファイルが見つかりません。",
  PROCESSING_METADATA_FAILED: "メディア情報の解析に失敗しました。",
  PROCESSING_MEDIA_CORRUPTED:
    "メディアファイルが破損しているため解析できません。",
  PROCESSING_THUMBNAIL_FAILED: "サムネイルの生成に失敗しました。",
  PROCESSING_DATABASE_FAILED: "処理結果の保存に失敗しました。",
  PROCESSING_INTERNAL_FAILED: "素材処理で予期しないエラーが発生しました。"
};

// Error codes that indicate an unexpected local/system problem rather than a
// property of the uploaded media. They are logged for diagnostics while the
// media-derived codes are expected user-data outcomes.
const PROCESSING_UNEXPECTED_CODES = new Set<AssetProcessingErrorCode>([
  "PROCESSING_THUMBNAIL_FAILED",
  "PROCESSING_DATABASE_FAILED",
  "PROCESSING_INTERNAL_FAILED"
]);

export class AssetProcessingError extends Error {
  readonly code: AssetProcessingErrorCode;
  readonly shouldLog: boolean;

  constructor(
    code: AssetProcessingErrorCode,
    options: { cause?: unknown } = {}
  ) {
    super(
      PROCESSING_ERROR_MESSAGES[code],
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "AssetProcessingError";
    this.code = code;
    this.shouldLog = PROCESSING_UNEXPECTED_CODES.has(code);
  }
}
