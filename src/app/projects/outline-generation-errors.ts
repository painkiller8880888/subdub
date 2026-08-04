import type { ApiErrorDetail } from "../../schema/api.js";

export const OUTLINE_GENERATION_ERROR_CODE = {
  modelNotSelected: "MODEL_NOT_SELECTED",
  modelNotFound: "MODEL_NOT_FOUND",
  modelTextOutputUnsupported: "MODEL_TEXT_OUTPUT_UNSUPPORTED",
  modelStructuredOutputUnsupported: "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED",
  modelExpired: "MODEL_EXPIRED",
  modelZdrUnavailable: "MODEL_ZDR_ENDPOINT_UNAVAILABLE",
  contextLengthExceeded: "OPENROUTER_CONTEXT_LENGTH_EXCEEDED",
  alreadyExists: "OUTLINE_ALREADY_EXISTS",
  schemaInvalid: "OUTLINE_GENERATION_SCHEMA_INVALID",
  orderInvalid: "OUTLINE_GENERATION_ORDER_INVALID",
  sourceReferenceInvalid: "OUTLINE_GENERATION_SOURCE_REFERENCE_INVALID"
} as const;

export type OutlineGenerationErrorCode =
  (typeof OUTLINE_GENERATION_ERROR_CODE)[keyof typeof OUTLINE_GENERATION_ERROR_CODE];

export class OutlineGenerationError extends Error {
  readonly code: OutlineGenerationErrorCode;
  readonly status: 409 | 422 | 502;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: OutlineGenerationErrorCode,
    status: 409 | 422 | 502,
    message: string,
    details: readonly ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "OutlineGenerationError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
