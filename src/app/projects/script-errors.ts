import type { ApiErrorDetail } from "../../schema/api.js";

export const SCRIPT_INITIALIZATION_ERROR_CODE =
  "SCRIPT_INITIALIZATION_NOT_ALLOWED" as const;

export class ScriptInitializationError extends Error {
  readonly code = SCRIPT_INITIALIZATION_ERROR_CODE;
  readonly status = 422 as const;
  readonly details: readonly ApiErrorDetail[];

  constructor(details: readonly ApiErrorDetail[]) {
    super("台本の編集を開始できません。構成案を確認してください。");
    this.name = "ScriptInitializationError";
    this.stack = undefined;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}

export const SCRIPT_APPROVAL_ERROR_CODE =
  "SCRIPT_APPROVAL_VALIDATION_FAILED" as const;

export class ScriptApprovalError extends Error {
  readonly code = SCRIPT_APPROVAL_ERROR_CODE;
  readonly status = 422 as const;
  readonly details: readonly ApiErrorDetail[];

  constructor(details: readonly ApiErrorDetail[]) {
    super("台本を承認できません。構成案と台本の状態を確認してください。");
    this.name = "ScriptApprovalError";
    this.stack = undefined;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}

export const SCRIPT_VALIDATION_ERROR_CODE = "SCRIPT_VALIDATION_FAILED" as const;

export class ScriptValidationError extends Error {
  readonly code = SCRIPT_VALIDATION_ERROR_CODE;
  readonly status = 422 as const;
  readonly details: readonly ApiErrorDetail[];

  constructor(details: readonly ApiErrorDetail[]) {
    super("台本の内容を確認してください。");
    this.name = "ScriptValidationError";
    this.stack = undefined;
    this.details = details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }));
  }
}
