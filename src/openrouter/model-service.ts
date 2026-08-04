import { getOpenRouterApiKey, type Environment } from "./config.js";
import { OpenRouterAdapterError, OPENROUTER_ERROR_CODE } from "./errors.js";
import { OpenRouterHttpClient, type Sleep } from "./http-client.js";
import {
  openRouterModelsResponseSchema,
  openRouterZdrEndpointsResponseSchema,
  type OpenRouterModelResponse,
  type OpenRouterZdrEndpoint
} from "./schemas.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;
export const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
export const OPENROUTER_REQUEST_TIMEOUT_MS = 10 * 1000;

export type OpenRouterModelCapabilities = {
  readonly id: string;
  readonly displayName: string;
  readonly contextLength: number;
  readonly inputPrice: string;
  readonly outputPrice: string;
  readonly outputModalities: readonly string[];
  readonly supportedParameters: readonly string[];
  readonly expirationDate: string | null;
  readonly structuredOutputs: boolean;
  readonly zdrAvailable: boolean;
};

export type ModelListResult = {
  readonly models: readonly OpenRouterModelCapabilities[];
  readonly fetchedAt: string;
  readonly cached: boolean;
};

type CacheEntry<T> = {
  readonly value: T;
  readonly fetchedAtMs: number;
  readonly fetchedAt: string;
};

export type OpenRouterModelServiceOptions = {
  readonly apiKey?: string;
  readonly env?: Environment;
  readonly fetch?: typeof fetch;
  readonly sleep?: Sleep;
  readonly baseUrl?: string;
  readonly now?: () => Date;
  readonly cacheTtlMs?: number;
  readonly timeoutMs?: number;
};

function isCacheFresh(
  entry: CacheEntry<unknown> | undefined,
  nowMs: number,
  ttlMs: number
): entry is CacheEntry<unknown> {
  return entry !== undefined && nowMs - entry.fetchedAtMs < ttlMs;
}

function isExpired(expirationDate: string | null, nowMs: number): boolean {
  return expirationDate !== null && Date.parse(expirationDate) <= nowMs;
}

export function isSelectableModel(
  model: OpenRouterModelCapabilities,
  now = new Date()
): boolean {
  return (
    model.outputModalities.includes("text") &&
    model.structuredOutputs &&
    !isExpired(model.expirationDate, now.getTime())
  );
}

export function filterSelectableModels(
  models: readonly OpenRouterModelCapabilities[],
  now = new Date()
): readonly OpenRouterModelCapabilities[] {
  return models.filter((model) => isSelectableModel(model, now));
}

function toCapabilities(
  model: OpenRouterModelResponse,
  zdrStructuredOutputModelIds: ReadonlySet<string>
): OpenRouterModelCapabilities {
  const pricing = Array.isArray(model.pricing)
    ? model.pricing[0]
    : model.pricing;

  if (pricing === undefined) {
    throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid);
  }

  return {
    id: model.id,
    displayName: model.name,
    contextLength: model.context_length,
    inputPrice: pricing.prompt,
    outputPrice: pricing.completion,
    outputModalities: [...model.architecture.output_modalities],
    supportedParameters: [...model.supported_parameters],
    expirationDate: model.expiration_date,
    structuredOutputs:
      model.supported_parameters.includes("structured_outputs"),
    zdrAvailable: zdrStructuredOutputModelIds.has(model.id)
  };
}

export class OpenRouterModelService {
  private readonly apiKey: string | undefined;
  private readonly httpClient: OpenRouterHttpClient | undefined;
  private readonly now: () => Date;
  private readonly cacheTtlMs: number;
  private modelCache:
    CacheEntry<readonly OpenRouterModelResponse[]> | undefined;
  private zdrCache: CacheEntry<readonly OpenRouterZdrEndpoint[]> | undefined;
  private modelInFlight:
    Promise<CacheEntry<readonly OpenRouterModelResponse[]>> | undefined;
  private zdrInFlight:
    Promise<CacheEntry<readonly OpenRouterZdrEndpoint[]>> | undefined;

  constructor(options: OpenRouterModelServiceOptions = {}) {
    this.apiKey =
      options.apiKey === undefined
        ? getOpenRouterApiKey(options.env)
        : options.apiKey.trim().length > 0
          ? options.apiKey.trim()
          : undefined;
    this.now = options.now ?? (() => new Date());
    this.cacheTtlMs = options.cacheTtlMs ?? MODEL_CACHE_TTL_MS;
    if (this.apiKey !== undefined) {
      this.httpClient = new OpenRouterHttpClient({
        apiKey: this.apiKey,
        baseUrl: options.baseUrl ?? OPENROUTER_BASE_URL,
        fetch: options.fetch,
        sleep: options.sleep,
        now: this.now,
        timeoutMs: options.timeoutMs ?? OPENROUTER_REQUEST_TIMEOUT_MS
      });
    }
  }

  async listModels(
    options: { readonly refresh?: boolean } = {}
  ): Promise<ModelListResult> {
    this.requireApiKey();
    const refresh = options.refresh ?? false;
    const [models, zdrEndpoints] = await Promise.all([
      this.getUserModels(refresh),
      this.getZdrEndpoints(refresh)
    ]);
    const zdrStructuredOutputModelIds = new Set(
      zdrEndpoints.value
        .filter((endpoint) =>
          endpoint.supported_parameters.includes("structured_outputs")
        )
        .map((endpoint) => endpoint.model_id)
    );
    const capabilities = models.value.map((model) =>
      toCapabilities(model, zdrStructuredOutputModelIds)
    );

    return {
      models: capabilities,
      fetchedAt: new Date(
        Math.max(models.fetchedAtMs, zdrEndpoints.fetchedAtMs)
      ).toISOString(),
      cached: models.cached && zdrEndpoints.cached
    };
  }

  private requireApiKey(): string {
    if (this.apiKey === undefined) {
      throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.notConfigured);
    }

    return this.apiKey;
  }

  private getNowMs(): number {
    return this.now().getTime();
  }

  private async getUserModels(
    refresh: boolean
  ): Promise<
    CacheEntry<readonly OpenRouterModelResponse[]> & { cached: boolean }
  > {
    const nowMs = this.getNowMs();
    if (!refresh && isCacheFresh(this.modelCache, nowMs, this.cacheTtlMs)) {
      return { ...this.modelCache, cached: true };
    }

    if (this.modelInFlight !== undefined) {
      const result = await this.modelInFlight;
      return { ...result, cached: false };
    }

    const request = this.fetchJson("/models/user").then((body) => {
      const parsed = openRouterModelsResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid);
      }

      const fetchedAtMs = this.getNowMs();
      const entry = {
        value: parsed.data.data,
        fetchedAtMs,
        fetchedAt: new Date(fetchedAtMs).toISOString()
      } satisfies CacheEntry<readonly OpenRouterModelResponse[]>;
      this.modelCache = entry;
      return entry;
    });
    this.modelInFlight = request;

    try {
      const result = await request;
      return { ...result, cached: false };
    } finally {
      if (this.modelInFlight === request) {
        this.modelInFlight = undefined;
      }
    }
  }

  private async getZdrEndpoints(
    refresh: boolean
  ): Promise<
    CacheEntry<readonly OpenRouterZdrEndpoint[]> & { cached: boolean }
  > {
    const nowMs = this.getNowMs();
    if (!refresh && isCacheFresh(this.zdrCache, nowMs, this.cacheTtlMs)) {
      return { ...this.zdrCache, cached: true };
    }

    if (this.zdrInFlight !== undefined) {
      const result = await this.zdrInFlight;
      return { ...result, cached: false };
    }

    const request = this.fetchJson("/endpoints/zdr").then((body) => {
      const parsed = openRouterZdrEndpointsResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid);
      }

      const fetchedAtMs = this.getNowMs();
      const entry = {
        value: parsed.data.data,
        fetchedAtMs,
        fetchedAt: new Date(fetchedAtMs).toISOString()
      } satisfies CacheEntry<readonly OpenRouterZdrEndpoint[]>;
      this.zdrCache = entry;
      return entry;
    });
    this.zdrInFlight = request;

    try {
      const result = await request;
      return { ...result, cached: false };
    } finally {
      if (this.zdrInFlight === request) {
        this.zdrInFlight = undefined;
      }
    }
  }

  private async fetchJson(path: string): Promise<unknown> {
    this.requireApiKey();
    if (this.httpClient === undefined) {
      throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.notConfigured);
    }

    const { response } = await this.httpClient.request(path, { method: "GET" });
    try {
      return await response.json();
    } catch {
      throw new OpenRouterAdapterError(OPENROUTER_ERROR_CODE.responseInvalid);
    }
  }
}

export function createOpenRouterModelService(
  options: OpenRouterModelServiceOptions = {}
): OpenRouterModelService {
  return new OpenRouterModelService(options);
}
