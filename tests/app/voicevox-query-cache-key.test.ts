import { describe, expect, it } from "vitest";

import {
  createVoicevoxQueryCacheKey,
  type VoicevoxQueryCacheKeyInput
} from "../../src/app/voicevox/query-cache-key.js";

const characterVoice = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1
};

const baseInput: VoicevoxQueryCacheKeyInput = {
  resolvedSpokenText: " 日本語 ",
  speakerUuid: "speaker-uuid",
  styleName: "ノーマル",
  resolvedStyleId: 42,
  characterVoice,
  voiceOverrides: { speedScale: 1.1, pitchScale: 0 },
  appliedTerms: [
    {
      termId: "term-one",
      termUpdatedAt: "2026-08-06T00:00:00.000Z"
    },
    {
      termId: "term-one",
      termUpdatedAt: "2026-08-06T00:00:00.000Z"
    }
  ],
  voicevoxEngineVersion: "0.14.1"
};

function input(
  overrides: Partial<VoicevoxQueryCacheKeyInput> = {}
): VoicevoxQueryCacheKeyInput {
  return {
    ...baseInput,
    ...overrides,
    characterVoice: {
      ...baseInput.characterVoice,
      ...overrides.characterVoice
    },
    voiceOverrides: {
      ...baseInput.voiceOverrides,
      ...overrides.voiceOverrides
    },
    appliedTerms: overrides.appliedTerms ?? baseInput.appliedTerms
  };
}

describe("VOICEVOX query cache key", () => {
  it("is stable across object insertion order and equivalent omitted overrides", () => {
    const reordered: VoicevoxQueryCacheKeyInput = {
      voicevoxEngineVersion: baseInput.voicevoxEngineVersion,
      appliedTerms: [...baseInput.appliedTerms],
      voiceOverrides: { pitchScale: 0, speedScale: 1.1 },
      characterVoice: {
        postPhonemeLength: 0.1,
        prePhonemeLength: 0.1,
        volumeScale: 1,
        intonationScale: 1,
        pitchScale: 0,
        speedScale: 1
      },
      resolvedStyleId: baseInput.resolvedStyleId,
      styleName: baseInput.styleName,
      speakerUuid: baseInput.speakerUuid,
      resolvedSpokenText: baseInput.resolvedSpokenText
    };

    expect(createVoicevoxQueryCacheKey(baseInput)).toBe(
      createVoicevoxQueryCacheKey(reordered)
    );
    expect(
      createVoicevoxQueryCacheKey(
        input({ voiceOverrides: { speedScale: 1.1, pitchScale: 0 } })
      )
    ).toBe(
      createVoicevoxQueryCacheKey(
        input({ voiceOverrides: { speedScale: 1.1, pitchScale: 0 } })
      )
    );
  });

  it.each([
    ["resolved spoken text", { resolvedSpokenText: "別の文" }],
    ["resolved style ID", { resolvedStyleId: 43 }],
    ["speaker UUID", { speakerUuid: "other-speaker" }],
    ["style name", { styleName: "別スタイル" }],
    [
      "character speed",
      { characterVoice: { ...characterVoice, speedScale: 1.2 } }
    ],
    [
      "character pitch",
      { characterVoice: { ...characterVoice, pitchScale: 0.2 } }
    ],
    [
      "character intonation",
      { characterVoice: { ...characterVoice, intonationScale: 1.2 } }
    ],
    [
      "character volume",
      { characterVoice: { ...characterVoice, volumeScale: 0.8 } }
    ],
    [
      "character pre phoneme",
      { characterVoice: { ...characterVoice, prePhonemeLength: 0.2 } }
    ],
    [
      "character post phoneme",
      { characterVoice: { ...characterVoice, postPhonemeLength: 0.2 } }
    ],
    [
      "line override",
      { voiceOverrides: { ...baseInput.voiceOverrides, volumeScale: 0.8 } }
    ],
    [
      "term ID",
      {
        appliedTerms: [
          {
            termId: "term-two",
            termUpdatedAt: "2026-08-06T00:00:00.000Z"
          }
        ]
      }
    ],
    [
      "term update",
      {
        appliedTerms: [
          {
            termId: "term-one",
            termUpdatedAt: "2026-08-07T00:00:00.000Z"
          }
        ]
      }
    ],
    ["engine version", { voicevoxEngineVersion: "0.14.2" }]
  ] as const)("changes when only %s changes", (_label, changed) => {
    expect(createVoicevoxQueryCacheKey(baseInput)).not.toBe(
      createVoicevoxQueryCacheKey(input(changed))
    );
  });

  it("distinguishes character defaults from equivalent line overrides", () => {
    const characterDefault = input({
      characterVoice: { ...characterVoice, speedScale: 1.1 },
      voiceOverrides: {}
    });
    const lineOverride = input({
      characterVoice,
      voiceOverrides: { speedScale: 1.1 }
    });

    expect(createVoicevoxQueryCacheKey(characterDefault)).not.toBe(
      createVoicevoxQueryCacheKey(lineOverride)
    );
  });
});
