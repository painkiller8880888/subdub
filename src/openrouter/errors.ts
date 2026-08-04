export const OPENROUTER_ERROR_CODE = {
  notConfigured: "OPENROUTER_NOT_CONFIGURED",
  authFailed: "OPENROUTER_AUTH_FAILED",
  unavailable: "OPENROUTER_UNAVAILABLE",
  responseInvalid: "OPENROUTER_RESPONSE_INVALID"
} as const;

export type OpenRouterErrorCode =
  (typeof OPENROUTER_ERROR_CODE)[keyof typeof OPENROUTER_ERROR_CODE];

export type OpenRouterAdapterErrorOptions = {
  readonly upstreamStatus?: number;
  readonly retryAfterMs?: number;
};

export class OpenRouterAdapterError extends Error {
  readonly code: OpenRouterErrorCode;
  readonly upstreamStatus: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: OpenRouterErrorCode,
    options: OpenRouterAdapterErrorOptions = {}
  ) {
    super(code);
    this.name = "OpenRouterAdapterError";
    this.code = code;
    this.upstreamStatus = options.upstreamStatus;
    this.retryAfterMs = options.retryAfterMs;
  }
}
