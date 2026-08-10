import type { ApiErrorDetail } from "../../schema/api.js";

export const VISUAL_SUGGESTION_ERROR_CODE = {
  modelNotSelected: "MODEL_NOT_SELECTED",
  modelNotFound: "MODEL_NOT_FOUND",
  modelTextOutputUnsupported: "MODEL_TEXT_OUTPUT_UNSUPPORTED",
  modelStructuredOutputUnsupported: "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED",
  modelExpired: "MODEL_EXPIRED",
  modelZdrUnavailable: "MODEL_ZDR_ENDPOINT_UNAVAILABLE",
  contextLengthExceeded: "OPENROUTER_CONTEXT_LENGTH_EXCEEDED",
  lineRangeInvalid: "VISUAL_SUGGESTION_LINE_RANGE_INVALID",
  sectionMismatch: "VISUAL_SUGGESTION_SECTION_MISMATCH",
  notAllowed: "VISUAL_SUGGESTION_NOT_ALLOWED",
  schemaInvalid: "VISUAL_SEARCH_INTENT_SCHEMA_INVALID"
} as const;

export type VisualSuggestionErrorCode =
  (typeof VISUAL_SUGGESTION_ERROR_CODE)[keyof typeof VISUAL_SUGGESTION_ERROR_CODE];

export class VisualSuggestionError extends Error {
  readonly code: VisualSuggestionErrorCode;
  readonly status: 409 | 422 | 502;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: VisualSuggestionErrorCode,
    status: 409 | 422 | 502,
    message: string,
    details: readonly ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "VisualSuggestionError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}
