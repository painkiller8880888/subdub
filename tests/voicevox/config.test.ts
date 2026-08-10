import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICEVOX_ENGINE_URL,
  VOICEVOX_ENGINE_URL_ENV,
  getVoicevoxAudioQueryUrl,
  getVoicevoxEngineUrl,
  getVoicevoxSpeakersUrl,
  getVoicevoxVersionUrl
} from "../../src/voicevox/config.js";

describe("VOICEVOX configuration", () => {
  it("uses the documented default when the environment value is missing", () => {
    expect(getVoicevoxEngineUrl({})).toBe(DEFAULT_VOICEVOX_ENGINE_URL);
    expect(getVoicevoxEngineUrl({ [VOICEVOX_ENGINE_URL_ENV]: "   " })).toBe(
      DEFAULT_VOICEVOX_ENGINE_URL
    );
  });

  it("uses an injected environment value and joins /speakers safely", () => {
    const engineUrl = getVoicevoxEngineUrl({
      [VOICEVOX_ENGINE_URL_ENV]: "  http://fixture.test/voicevox///  "
    });

    expect(engineUrl).toBe("http://fixture.test/voicevox///");
    expect(getVoicevoxSpeakersUrl(engineUrl)).toBe(
      "http://fixture.test/voicevox/speakers"
    );
    expect(getVoicevoxSpeakersUrl("http://fixture.test")).toBe(
      "http://fixture.test/speakers"
    );
    expect(getVoicevoxVersionUrl(engineUrl)).toBe(
      "http://fixture.test/voicevox/version"
    );
  });

  it("encodes audio query text and style IDs as URL parameters", () => {
    const url = new URL(
      getVoicevoxAudioQueryUrl(
        "http://fixture.test/voicevox///",
        " 日本語 空白&記号? ",
        42
      )
    );

    expect(url.pathname).toBe("/voicevox/audio_query");
    expect(url.searchParams.get("text")).toBe(" 日本語 空白&記号? ");
    expect(url.searchParams.get("speaker")).toBe("42");
  });
});
