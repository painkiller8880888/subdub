import {
  OpenRouterAdapterError,
  OPENROUTER_ERROR_CODE,
  type OpenRouterErrorCode
} from "./errors.js";

export const MAX_OPENROUTER_HTTP_ATTEMPTS = 3;
export const OPENROUTER_RETRY_BASE_DELAY_MS = 100;
export const OPENROUTER_RETRY_MAX_DELAY_MS = 1000;
export const OPENROUTER_RETRY_AFTER_MAX_DELAY_MS = 60_000;

export type Sleep = (milliseconds: number) => Promise<void>;

export type OpenRouterResponseRetryDecision = {
  readonly retry: boolean;
  readonly upstreamStatus?: 429 | 502 | 503;
  readonly retryAfterMs?: number;
};

export type OpenRouterResponseRetryDecider = (
  response: Response
) => OpenRouterResponseRetryDecision | Promise<OpenRouterResponseRetryDecision>;

export type OpenRouterHttpClientOptions = {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxAttempts?: number;
  readonly retryBaseDelayMs?: number;
  readonly retryMaxDelayMs?: number;
  readonly retryAfterMaxDelayMs?: number;
  readonly retryOnResponse?: OpenRouterResponseRetryDecider;
};

export type OpenRouterHttpResponse = {
  readonly response: Response;
  readonly attempts: number;
};

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export function parseRetryAfter(
  value: string | null,
  nowMs: number
): number | undefined {
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const retryAtMs = Date.parse(value);
  if (Number.isNaN(retryAtMs)) {
    return undefined;
  }

  return Math.max(0, retryAtMs - nowMs);
}

function retryErrorCode(status: number): OpenRouterErrorCode {
  // Keep the P1-03 adapter error compatibility code. The API boundary uses
  // upstreamStatus to expose 429/502/503 separately.
  if (status === 429 || status === 502 || status === 503) {
    return OPENROUTER_ERROR_CODE.unavailable;
  }
  return OPENROUTER_ERROR_CODE.requestFailed;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503;
}

function boundedExponentialDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
}

function retryDelay(
  retryAfterMs: number | undefined,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  retryAfterMaxDelayMs: number
): number {
  if (retryAfterMs !== undefined) {
    return Math.min(retryAfterMaxDelayMs, retryAfterMs);
  }

  return boundedExponentialDelay(attempt, baseDelayMs, maxDelayMs);
}

export class OpenRouterHttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: Sleep;
  private readonly now: () => Date;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly retryAfterMaxDelayMs: number;
  private readonly retryOnResponse: OpenRouterResponseRetryDecider | undefined;

  constructor(options: OpenRouterHttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.now = options.now ?? (() => new Date());
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxAttempts = Math.max(
      1,
      Math.min(options.maxAttempts ?? MAX_OPENROUTER_HTTP_ATTEMPTS, 3)
    );
    this.retryBaseDelayMs = Math.max(
      0,
      options.retryBaseDelayMs ?? OPENROUTER_RETRY_BASE_DELAY_MS
    );
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      options.retryMaxDelayMs ?? OPENROUTER_RETRY_MAX_DELAY_MS
    );
    this.retryAfterMaxDelayMs = Math.max(
      0,
      options.retryAfterMaxDelayMs ?? OPENROUTER_RETRY_AFTER_MAX_DELAY_MS
    );
    this.retryOnResponse = options.retryOnResponse;
  }

  async request(
    path: string,
    init: Omit<RequestInit, "signal" | "headers"> & {
      readonly headers?: Record<string, string>;
    } = {}
  ): Promise<OpenRouterHttpResponse> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response;

      try {
        response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          ...init,
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
            ...init.headers
          }
        });
      } catch {
        throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.unavailable, {
          attempts: attempt
        });
      } finally {
        clearTimeout(timeout);
      }

      if (response.ok) {
        let retryDecision: OpenRouterResponseRetryDecision | undefined;
        if (this.retryOnResponse !== undefined) {
          try {
            retryDecision = await this.retryOnResponse(response.clone());
          } catch {
            retryDecision = undefined;
          }
        }

        if (retryDecision?.retry === true) {
          const upstreamStatus = retryDecision.upstreamStatus ?? 503;
          if (attempt >= this.maxAttempts) {
            throw new OpenRouterAdapterError(retryErrorCode(upstreamStatus), {
              upstreamStatus,
              retryAfterMs: retryDecision.retryAfterMs,
              attempts: attempt
            });
          }

          await this.sleep(
            retryDelay(
              retryDecision.retryAfterMs,
              attempt,
              this.retryBaseDelayMs,
              this.retryMaxDelayMs,
              this.retryAfterMaxDelayMs
            )
          );
          continue;
        }

        return { response, attempts: attempt };
      }

      if (response.status === 401 || response.status === 403) {
        throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.authFailed, {
          upstreamStatus: response.status,
          attempts: attempt
        });
      }

      if (response.status === 402) {
        throw new OpenRouterAdapterError(
          OPENROUTER_ERROR_CODE.paymentRequired,
          { upstreamStatus: response.status, attempts: attempt }
        );
      }

      const retryAfterMs =
        response.status === 429 || response.status === 503
          ? parseRetryAfter(
              response.headers.get("retry-after"),
              this.now().getTime()
            )
          : undefined;
      if (!isRetryableStatus(response.status) || attempt >= this.maxAttempts) {
        throw new OpenRouterAdapterError(retryErrorCode(response.status), {
          upstreamStatus: response.status,
          retryAfterMs,
          attempts: attempt
        });
      }
      const delayMs = retryDelay(
        retryAfterMs,
        attempt,
        this.retryBaseDelayMs,
        this.retryMaxDelayMs,
        this.retryAfterMaxDelayMs
      );
      await this.sleep(delayMs);
    }

    throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.unavailable);
  }
}
