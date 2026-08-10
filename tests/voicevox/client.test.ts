import { describe, expect, it, vi } from "vitest";

import {
  VOICEVOX_REQUEST_TIMEOUT_MS,
  VoicevoxClient
} from "../../src/voicevox/client.js";
import {
  VoicevoxAdapterError,
  VOICEVOX_ERROR_CODE
} from "../../src/voicevox/errors.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxSpeakersFixture,
  syntheticVoicevoxStyleId,
  voicevoxJsonResponse
} from "../fixtures/voicevox.js";

describe("VoicevoxClient", () => {
  it("fetches /speakers with a normalized URL and accepts added fields", async () => {
    const body = createVoicevoxSpeakersFixture();
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(String(input)).toBe("http://fixture.test/engine/speakers");
      expect(init?.method).toBe("GET");
      expect(init?.headers).toEqual({ Accept: "application/json" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return voicevoxJsonResponse(body);
    });
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test/engine///",
      fetch: fetch as unknown as typeof globalThis.fetch
    });

    await expect(client.getSpeakers()).resolves.toEqual(
      body.map((speaker) => ({
        name: speaker.name,
        speaker_uuid: speaker.speaker_uuid,
        styles: speaker.styles.map((style) => ({
          name: style.name,
          id: style.id
        }))
      }))
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fetches the engine version and audio query with encoded parameters", async () => {
    const query = createVoicevoxAudioQueryFixture();
    const text = " 日本語 空白&記号? ";
    const fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe(
        url.pathname.endsWith("/version")
          ? "/engine/version"
          : "/engine/audio_query"
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);

      if (url.pathname.endsWith("/version")) {
        expect(init?.method).toBe("GET");
        return voicevoxJsonResponse("0.14.1");
      }

      expect(init?.method).toBe("POST");
      expect(url.searchParams.get("text")).toBe(text);
      expect(url.searchParams.get("speaker")).toBe("42");
      return voicevoxJsonResponse(query);
    });
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test/engine///",
      fetch: fetch as unknown as typeof globalThis.fetch
    });

    await expect(client.getVersion()).resolves.toBe("0.14.1");
    await expect(client.getAudioQuery(text, 42)).resolves.toEqual(query);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps additional audio query fields for later synthesis", async () => {
    const body = createVoicevoxAudioQueryFixture();
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () =>
        voicevoxJsonResponse(body)
      ) as unknown as typeof globalThis.fetch
    });

    const query = await client.getAudioQuery("text", 7);

    expect(query.future_query_field).toEqual({ preserve: true });
    expect(query.accent_phrases[0]?.future_phrase_field).toEqual({
      preserve: true
    });
    expect(query.accent_phrases[0]?.moras[0]?.future_mora_field).toBe(
      "preserve"
    );
  });

  it("distinguishes HTTP failures without retaining the response body", async () => {
    const fetch = vi.fn(
      async () => new Response("upstream-secret-body", { status: 503 })
    );
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: fetch as unknown as typeof globalThis.fetch
    });

    const error = await client.getSpeakers().catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: VOICEVOX_ERROR_CODE.httpFailed,
      upstreamStatus: 503
    });
    expect(error).toBeInstanceOf(VoicevoxAdapterError);
    expect(error).not.toHaveProperty("responseBody");
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("upstream-secret-body");
  });

  it("distinguishes connection failures", async () => {
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () => {
        throw new Error("connection detail should not escape");
      }) as unknown as typeof globalThis.fetch
    });

    await expect(client.getSpeakers()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.connectionFailed
    });
    await expect(client.getSpeakers()).rejects.toBeInstanceOf(
      VoicevoxAdapterError
    );
  });

  it("distinguishes a finite timeout", async () => {
    const fetch = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          );
        })
    );
    const client = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: fetch as unknown as typeof globalThis.fetch,
      timeoutMs: 1
    });

    await expect(client.getSpeakers()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.timeout
    });
    expect(VOICEVOX_REQUEST_TIMEOUT_MS).toBeGreaterThan(1);
  });

  it("distinguishes malformed JSON from an invalid response structure", async () => {
    const invalidJsonClient = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(
        async () => new Response("not-json")
      ) as unknown as typeof globalThis.fetch
    });
    await expect(invalidJsonClient.getSpeakers()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.responseInvalidJson
    });

    const invalidShapeClient = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () =>
        voicevoxJsonResponse([
          {
            name: "四国めたん",
            speaker_uuid: "fixture-uuid",
            styles: [{ name: "ノーマル", id: "not-an-integer" }]
          }
        ])
      ) as unknown as typeof globalThis.fetch
    });
    await expect(invalidShapeClient.getSpeakers()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.responseInvalid
    });

    const missingFieldClient = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () =>
        voicevoxJsonResponse([
          {
            name: "四国めたん",
            styles: [{ name: "ノーマル", id: syntheticVoicevoxStyleId() }]
          }
        ])
      ) as unknown as typeof globalThis.fetch
    });
    await expect(missingFieldClient.getSpeakers()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.responseInvalid
    });

    const invalidVersionClient = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () =>
        voicevoxJsonResponse({ version: "0.14.1" })
      ) as unknown as typeof globalThis.fetch
    });
    await expect(invalidVersionClient.getVersion()).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.responseInvalid
    });

    const invalidQueryClient = new VoicevoxClient({
      engineUrl: "http://fixture.test",
      fetch: vi.fn(async () =>
        voicevoxJsonResponse({ speedScale: Infinity })
      ) as unknown as typeof globalThis.fetch
    });
    await expect(
      invalidQueryClient.getAudioQuery("text", 1)
    ).rejects.toMatchObject({
      code: VOICEVOX_ERROR_CODE.responseInvalid
    });
  });
});
