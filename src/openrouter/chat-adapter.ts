import { getOpenRouterApiKey, type Environment } from "./config.js";
import { OpenRouterAdapterError, OPENROUTER_ERROR_CODE } from "./errors.js";
import { OpenRouterHttpClient, type Sleep } from "./http-client.js";
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
};

export type ChatTokenUsage = {
  readonly promptTokens: number | null;
  readonly completionTokens: number | null;
  readonly totalTokens: number | null;
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

function invalidResponse(): OpenRouterAdapterError {
  return new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid);
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
        timeoutMs: options.timeoutMs
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
        name: "subdub_outline_generation",
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
      throw invalidResponse();
    }

    const parsed = openRouterChatCompletionResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse();
    }

    const choice = parsed.data.choices[0];
    const content = choice?.message.content;
    if (typeof content !== "string" || content.trim().length === 0) {
      throw invalidResponse();
    }
    if (choice.finish_reason === "error") {
      throw invalidResponse();
    }

    let candidate: unknown;
    try {
      candidate = JSON.parse(content);
    } catch {
      throw invalidResponse();
    }

    return {
      candidate,
      responseModel: parsed.data.model ?? null,
      provider: getProvider(parsed.data.openrouter_metadata),
      usage: {
        promptTokens: parsed.data.usage?.prompt_tokens ?? null,
        completionTokens: parsed.data.usage?.completion_tokens ?? null,
        totalTokens: parsed.data.usage?.total_tokens ?? null
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
