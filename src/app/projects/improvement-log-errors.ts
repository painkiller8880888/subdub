import type { ApiErrorDetail } from "../../schema/api.js";

export const IMPROVEMENT_LOG_ERROR_CODE = {
  candidateNotFound: "IMPROVEMENT_CANDIDATE_NOT_FOUND",
  candidateDuplicate: "IMPROVEMENT_CANDIDATE_DUPLICATE",
  decisionConflict: "IMPROVEMENT_DECISION_CONFLICT",
  relationInvalid: "IMPROVEMENT_RELATION_INVALID",
  rejectionNotAllowed: "IMPROVEMENT_REJECTION_NOT_ALLOWED",
  payloadInvalid: "IMPROVEMENT_PAYLOAD_INVALID",
  databaseFailed: "IMPROVEMENT_DATABASE_FAILED"
} as const;

export type ImprovementLogErrorCode =
  (typeof IMPROVEMENT_LOG_ERROR_CODE)[keyof typeof IMPROVEMENT_LOG_ERROR_CODE];

export class ImprovementLogError extends Error {
  readonly code: ImprovementLogErrorCode;
  readonly status: 404 | 409 | 422 | 500;
  readonly details: readonly ApiErrorDetail[];

  constructor(
    code: ImprovementLogErrorCode,
    status: 404 | 409 | 422 | 500,
    message: string,
    details: readonly ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "ImprovementLogError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}
