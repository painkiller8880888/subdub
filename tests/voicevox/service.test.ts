import { describe, expect, it } from "vitest";

import {
  VoicevoxAdapterError,
  VOICEVOX_ERROR_CODE
} from "../../src/voicevox/errors.js";
import {
  VoicevoxStatusService,
  type VoicevoxClientPort
} from "../../src/voicevox/service.js";
import { createVoicevoxSpeakersFixture } from "../fixtures/voicevox.js";

function client(
  getSpeakers: VoicevoxClientPort["getSpeakers"]
): VoicevoxClientPort {
  return { getSpeakers };
}

describe("VoicevoxStatusService", () => {
  it("reports available only after both target speakers resolve", async () => {
    const speakers = createVoicevoxSpeakersFixture();
    const service = new VoicevoxStatusService({
      client: client(async () => speakers)
    });

    await expect(service.getStatus()).resolves.toEqual({
      available: true,
      speakers: [
        {
          speakerName: "四国めたん",
          speakerUuid: "metan-fixture-uuid",
          styleName: "ノーマル",
          resolvedStyleId: speakers[0]?.styles[0]?.id
        },
        {
          speakerName: "ずんだもん",
          speakerUuid: "zundamon-fixture-uuid",
          styleName: "ノーマル",
          resolvedStyleId: speakers[1]?.styles[0]?.id
        }
      ]
    });
  });

  it("reports unavailable without partial success when one target is missing", async () => {
    const speakers = createVoicevoxSpeakersFixture().filter(
      (speaker) => speaker.name === "四国めたん"
    );
    const service = new VoicevoxStatusService({
      client: client(async () => speakers)
    });

    await expect(service.getStatus()).resolves.toEqual({
      available: false,
      reason: VOICEVOX_ERROR_CODE.speakerNotFound
    });
  });

  it("reports adapter failures as unavailable state", async () => {
    const service = new VoicevoxStatusService({
      client: client(async () => {
        throw new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.connectionFailed);
      })
    });

    await expect(service.getStatus()).resolves.toEqual({
      available: false,
      reason: VOICEVOX_ERROR_CODE.connectionFailed
    });
  });
});
