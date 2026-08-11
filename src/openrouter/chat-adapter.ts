import { getOpenRouterApiKey, type Environment } from "./config.js";
import { OpenRouterAdapterError, OPENROUTER_ERROR_CODE } from "./errors.js";
import {
  OpenRouterHttpClient,
  parseRetryAfter,
  type Sleep
} from "./http-client.js";
import { openRouterChatCompletionResponseSchema } from "./schemas.js";

export type OutlineChatMessage = {
  readonly role: "system" | "user";
  readonly content: string;
};

export type OutlineChatRequest = {
  readonly modelId: string;
  readonly messages: readonly OutlineChatMessage[];
  readonly jsonSchema: Record<string, unknown>;
  readonly maxTokens: number;
  readonly zdr: boolean;
  readonly dataCollection: "deny";
  readonly allowProviderFallbacks: true;
  readonly schemaName?: string;
};

export type ChatTokenUsage = {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
  readonly costCredits?: number | null;
};

export type OutlineChatResult = {
  readonly candidate: unknown;
  readonly responseModel: string | null;
  readonly provider: string | null;
  readonly usage: ChatTokenUsage;
  readonly attempts: number;
};

export type OpenRouterChatAdapterOptions = {
  readonly apiKey?: string;
  readonly env?: Environment;
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  readonly baseUrl?: string;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCostCredits(value: unknown): number | null {
  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numericValue) && numericValue >= 0
    ? numericValue
    : null;
}

function getProvider(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.endpoints)) {
    return null;
  }
  const available = value.endpoints.available;
  if (!Array.isArray(available)) {
    return null;
  }
  const selected = available.find(
    (endpoint) => isRecord(endpoint) && endpoint.selected === true
  );
  return isRecord(selected) && typeof selected.provider === "string"
    ? selected.provider
    : null;
}

function invalidResponse(attempts?: number): OpenRouterAdapterError {
  return new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid, {
    attempts
  });
}

function embeddedErrorStatus(value: unknown): 429 | 502 | 503 | undefined {
  if (typeof value === "number") {
    return value === 429 || value === 502 || value === 503 ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "429" || normalized.includes("rate_limit")) {
    return 429;
  }
  if (
    normalized === "502" ||
    normalized === "provider_unavailable" ||
    normalized.includes("bad_gateway")
  ) {
    return 502;
  }
  if (
    normalized === "503" ||
    normalized === "provider_overloaded" ||
    normalized.includes("service_unavailable")
  ) {
    return 503;
  }
  return undefined;
}

function embeddedErrorStatusFromBody(
  body: unknown
): 429 | 502 | 503 | undefined {
  if (!isRecord(body)) {
    return undefined;
  }

  const errors: unknown[] = [];
  if (Array.isArray(body.choices)) {
    const firstChoice = body.choices[0];
    if (isRecord(firstChoice)) {
      errors.push(firstChoice.error);
    }
  }
  errors.push(body.error);

  for (const error of errors) {
    if (!isRecord(error)) {
      continue;
    }
    const metadata = isRecord(error.metadata) ? error.metadata : undefined;
    const status =
      embeddedErrorStatus(error.code) ??
      embeddedErrorStatus(metadata?.error_type);
    if (status !== undefined) {
      return status;
    }
  }
  return undefined;
}

export class OpenRouterChatAdapter {
  private readonly apiKey: string | undefined;
  private readonly httpClient: OpenRouterHttpClient | undefined;

  constructor(options: OpenRouterChatAdapterOptions = {}) {
    this.apiKey =
      options.apiKey === undefined
        ? getOpenRouterApiKey(options.env)
        : options.apiKey.trim().length > 0
          ? options.apiKey.trim()
          : undefined;
    if (this.apiKey !== undefined) {
      this.httpClient = new OpenRouterHttpClient({
        apiKey: this.apiKey,
        baseUrl: options.baseUrl ?? "https://openrouter.ai/api/v1",
        fetch: options.fetch,
        sleep: options.sleep,
        now: options.now,
        timeoutMs: options.timeoutMs,
        retryOnResponse: async (response) => {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            return { retry: false };
          }

          const upstreamStatus = embeddedErrorStatusFromBody(body);
          if (upstreamStatus === undefined) {
            return { retry: false };
          }

          return {
            retry: true,
            upstreamStatus,
            retryAfterMs: parseRetryAfter(
              response.headers.get("retry-after"),
              (options.now ?? (() => new Date()))().getTime()
            )
          };
        }
      });
    }
  }

  async complete(input: OutlineChatRequest): Promise<OutlineChatResult> {
    if (this.apiKey === undefined || this.httpClient === undefined) {
      throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.notConfigured);
    }

    const provider: Record<string, unknown> = {
      require_parameters: true,
      data_collection: input.dataCollection,
      allow_fallbacks: input.allowProviderFallbacks
    };
    if (input.zdr) {
      provider.zdr = true;
    }

    const responseFormat = {
      type: "json_schema",
      json_schema: {
        name: input.schemaName ?? "subdub_outline_generation",
        strict: true,
        schema: input.jsonSchema
      }
    };
    const { response, attempts } = await this.httpClient.request(
      "/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-OpenRouter-Metadata": "enabled"
        },
        body: JSON.stringify({
          model: input.modelId,
          messages: input.messages,
          max_tokens: input.maxTokens,
          stream: false,
          response_format: responseFormat,
          provider
        })
      }
    );

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidResponse(attempts);
    }

    const parsed = openRouterChatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse(attempts);
    }

    const choice = parsed.data.choices[0];
    if (choice?.error !== undefined || choice?.finish_reason === "error") {
      throw invalidResponse(attempts);
    }

    const content = choice?.message?.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw invalidResponse(attempts);
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch {
      throw invalidResponse(attempts);
    }

    return {
      candidate,
      responseModel: parsed.data.model ?? null,
      provider: getProvider(parsed.data.openrouter_metadata),
      usage: {
        promptTokens: parsed.data.usage?.prompt_tokens ?? null,
        completionTokens: parsed.data.usage?.completion_tokens ?? null,
        totalTokens: parsed.data.usage?.total_tokens ?? null,
        costCredits: parseCostCredits(parsed.data.usage?.cost)
      },
      attempts
    };
  }
}

export function createOpenRouterChatAdapter(
  options: OpenRouterChatAdapterOptions = {}
): OpenRouterChatAdapter {
  return new OpenRouterChatAdapter(options);
}
