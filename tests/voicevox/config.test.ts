import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICEVOX_ENGINE_URL,
  VOICEVOX_ENGINE_URL_ENV,
  getVoicevoxEngineUrl,
  getVoicevoxSpeakersUrl
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
  });
});
