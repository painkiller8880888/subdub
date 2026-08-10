import {
  getVoicevoxAudioQueryUrl,
  getVoicevoxEngineUrl,
  getVoicevoxSpeakersUrl,
  getVoicevoxVersionUrl
} from "./config.js";
import { VoicevoxAdapterError, VOICEVOX_ERROR_CODE } from "./errors.js";
import {
  voicevoxAudioQuerySchema,
  voicevoxEngineVersionSchema,
  voicevoxSpeakersResponseSchema,
  type VoicevoxAudioQuery,
  type VoicevoxSpeaker
} from "./schemas.js";

export const VOICEVOX_REQUEST_TIMEOUT_MS = 5_000;

export type VoicevoxClientOptions = {
  readonly engineUrl?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
};

export class VoicevoxClient {
  private readonly engineUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: VoicevoxClientOptions = {}) {
    this.engineUrl = options.engineUrl ?? getVoicevoxEngineUrl(options.env);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = Math.max(
      1,
      options.timeoutMs ?? VOICEVOX_REQUEST_TIMEOUT_MS
    );
  }

  async getSpeakers(): Promise<readonly VoicevoxSpeaker[]> {
    const body = await this.requestJson(
      getVoicevoxSpeakersUrl(this.engineUrl),
      {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      }
    );
    const parsed = voicevoxSpeakersResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalid);
    }

    return parsed.data;
  }

  async getVersion(): Promise<string> {
    const body = await this.requestJson(getVoicevoxVersionUrl(this.engineUrl), {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
    const parsed = voicevoxEngineVersionSchema.safeParse(body);
    if (!parsed.success) {
      throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalid);
    }

    return parsed.data;
  }

  async getAudioQuery(
    text: string,
    resolvedStyleId: number
  ): Promise<VoicevoxAudioQuery> {
    const body = await this.requestJson(
      getVoicevoxAudioQueryUrl(this.engineUrl, text, resolvedStyleId),
      {
        method: "POST",
        headers: {
          Accept: "application/json"
        }
      }
    );
    const parsed = voicevoxAudioQuerySchema.safeParse(body);
    if (!parsed.success) {
      throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalid);
    }

    return parsed.data;
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.timeout);
      }
      throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.connectionFailed);
    }

    try {
      if (controller.signal.aborted) {
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.timeout);
      }

      if (!response.ok) {
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.httpFailed, {
          upstreamStatus: response.status
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        if (controller.signal.aborted) {
          throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.timeout);
        }
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalidJson);
      }

      if (controller.signal.aborted) {
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.timeout);
      }

      return body;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createVoicevoxClient(
  options: VoicevoxClientOptions = {}
): VoicevoxClient {
  return new VoicevoxClient(options);
}
