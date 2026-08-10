import {
  getVoicevoxAudioQueryUrl,
  getVoicevoxEngineUrl,
  getVoicevoxSpeakersUrl,
  getVoicevoxSynthesisUrl,
  getVoicevoxVersionUrl
} from "./config.js";
import {
  VoicevoxAdapterError,
  VOICEVOX_ERROR_CODE,
  type VoicevoxAdapterErrorCode
} from "./errors.js";
import {
  voicevoxAudioQuerySchema,
  voicevoxEngineVersionSchema,
  voicevoxSpeakersResponseSchema,
  type VoicevoxAudioQuery,
  type VoicevoxSpeaker
} from "./schemas.js";
import { inspectVoicevoxWav } from "./wav.js";

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

  async synthesize(
    query: VoicevoxAudioQuery,
    resolvedStyleId: number
  ): Promise<Uint8Array> {
    const parsedQuery = voicevoxAudioQuerySchema.safeParse(query);
    if (!parsedQuery.success || !Number.isInteger(resolvedStyleId)) {
      throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalid);
    }

    const audio = await this.requestBody(
      getVoicevoxSynthesisUrl(this.engineUrl, resolvedStyleId),
      {
        method: "POST",
        headers: {
          Accept: "audio/wav",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parsedQuery.data)
      },
      (response) => response.arrayBuffer(),
      VOICEVOX_ERROR_CODE.synthesisResponseInvalid
    );
    const bytes = new Uint8Array(audio);
    if (bytes.byteLength === 0) {
      throw new VoicevoxAdapterError(
        VOICEVOX_ERROR_CODE.synthesisResponseInvalid
      );
    }

    try {
      inspectVoicevoxWav(bytes);
    } catch {
      throw new VoicevoxAdapterError(
        VOICEVOX_ERROR_CODE.synthesisResponseInvalid
      );
    }

    return bytes;
  }

  async synthesizeAudioQuery(
    query: VoicevoxAudioQuery,
    resolvedStyleId: number
  ): Promise<Uint8Array> {
    return this.synthesize(query, resolvedStyleId);
  }

  private async requestJson(url: string, init: RequestInit): Promise<unknown> {
    return this.requestBody(
      url,
      init,
      (response) => response.json(),
      VOICEVOX_ERROR_CODE.responseInvalidJson
    );
  }

  private async requestBody<T>(
    url: string,
    init: RequestInit,
    readBody: (response: Response) => Promise<T>,
    invalidBodyCode: VoicevoxAdapterErrorCode
  ): Promise<T> {
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

      let body: T;
      try {
        body = await readBody(response);
      } catch {
        if (controller.signal.aborted) {
          throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.timeout);
        }
        throw new VoicevoxAdapterError(invalidBodyCode);
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
