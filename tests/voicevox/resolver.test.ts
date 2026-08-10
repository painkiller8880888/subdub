import { describe, expect, it } from "vitest";

import {
  VoicevoxResolutionError,
  VOICEVOX_ERROR_CODE
} from "../../src/voicevox/errors.js";
import {
  resolveVoicevoxSpeaker,
  resolveVoicevoxSpeakers
} from "../../src/voicevox/resolver.js";
import {
  createVoicevoxSpeakersFixture,
  syntheticVoicevoxStyleId
} from "../fixtures/voicevox.js";

describe("VOICEVOX speaker and style resolution", () => {
  it("resolves both target speakers and preserves response style IDs", () => {
    const speakers = createVoicevoxSpeakersFixture();
    const resolved = resolveVoicevoxSpeakers(speakers, [
      { speakerName: "四国めたん", styleName: "ノーマル" },
      { speakerName: "ずんだもん", styleName: "ノーマル" }
    ]);

    expect(resolved).toEqual([
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
    ]);
  });

  it("prioritizes a specified UUID and does not fall back to the name", () => {
    const speakers = createVoicevoxSpeakersFixture();
    expect(
      resolveVoicevoxSpeaker(speakers, {
        speakerName: "四国めたん",
        speakerUuid: "zundamon-fixture-uuid",
        styleName: "ノーマル"
      })
    ).toMatchObject({ speakerName: "ずんだもん" });

    expect(() =>
      resolveVoicevoxSpeaker(speakers, {
        speakerName: "ずんだもん",
        speakerUuid: "missing-fixture-uuid",
        styleName: "ノーマル"
      })
    ).toThrowError(
      new VoicevoxResolutionError(VOICEVOX_ERROR_CODE.speakerNotFound)
    );
  });

  it("rejects missing and duplicate speakers", () => {
    const speakers = createVoicevoxSpeakersFixture();
    expect(() =>
      resolveVoicevoxSpeaker(speakers, {
        speakerName: "存在しない話者",
        styleName: "ノーマル"
      })
    ).toThrowError(VOICEVOX_ERROR_CODE.speakerNotFound);

    expect(() =>
      resolveVoicevoxSpeaker([...speakers, { ...speakers[0] }], {
        speakerName: "四国めたん",
        styleName: "ノーマル"
      })
    ).toThrowError(VOICEVOX_ERROR_CODE.speakerAmbiguous);
  });

  it("rejects missing, duplicate, and fallback styles", () => {
    const speakers = createVoicevoxSpeakersFixture();
    const noNormal = speakers.map((speaker) =>
      speaker.name === "四国めたん"
        ? {
            ...speaker,
            styles: [{ name: "別スタイル", id: syntheticVoicevoxStyleId() }]
          }
        : speaker
    );
    expect(() =>
      resolveVoicevoxSpeaker(noNormal, {
        speakerName: "四国めたん",
        styleName: "ノーマル"
      })
    ).toThrowError(VOICEVOX_ERROR_CODE.styleNotFound);

    const duplicateNormal = speakers.map((speaker) =>
      speaker.name === "四国めたん"
        ? {
            ...speaker,
            styles: [
              ...speaker.styles,
              { name: "ノーマル", id: syntheticVoicevoxStyleId() }
            ]
          }
        : speaker
    );
    expect(() =>
      resolveVoicevoxSpeaker(duplicateNormal, {
        speakerName: "四国めたん",
        styleName: "ノーマル"
      })
    ).toThrowError(VOICEVOX_ERROR_CODE.styleAmbiguous);
  });
});
