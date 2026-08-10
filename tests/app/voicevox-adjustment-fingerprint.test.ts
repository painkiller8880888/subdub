import { describe, expect, it } from "vitest";

import { createVoicevoxAdjustmentBaseHash } from "../../src/app/voicevox/adjustment-fingerprint.js";
import type { Voice } from "../../src/schema/common.js";
import { syntheticVoicevoxStyleId } from "../fixtures/voicevox.js";

const characterVoice: Voice = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1
};
const fixtureStyleId = syntheticVoicevoxStyleId();
const changedStyleId = syntheticVoicevoxStyleId();

const baseInput = {
  resolvedSpokenText: "テストです。",
  speakerUuid: "speaker-fixture-uuid",
  styleName: "ノーマル",
  resolvedStyleId: fixtureStyleId,
  voicevoxEngineVersion: "engine-fixture-1",
  characterVoice,
  voiceOverrides: { speedScale: 1.2, volumeScale: 0.8 }
};

describe("createVoicevoxAdjustmentBaseHash", () => {
  it("is deterministic and independent of object key order", () => {
    const first = createVoicevoxAdjustmentBaseHash(baseInput);
    const second = createVoicevoxAdjustmentBaseHash({
      ...baseInput,
      characterVoice: {
        postPhonemeLength: 0.1,
        prePhonemeLength: 0.1,
        volumeScale: 1,
        intonationScale: 1,
        pitchScale: 0,
        speedScale: 1
      },
      voiceOverrides: { volumeScale: 0.8, speedScale: 1.2 }
    });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toBe(first);
  });

  it.each([
    ["spoken text", { resolvedSpokenText: "別の文。" }],
    ["speaker UUID", { speakerUuid: "another-speaker" }],
    ["style name", { styleName: "別スタイル" }],
    ["style ID", { resolvedStyleId: changedStyleId }],
    ["engine version", { voicevoxEngineVersion: "engine-fixture-2" }],
    [
      "character defaults",
      { characterVoice: { ...characterVoice, pitchScale: 0.1 } }
    ],
    ["line override", { voiceOverrides: { speedScale: 1.3 } }]
  ])("changes when %s changes", (_label, change) => {
    expect(createVoicevoxAdjustmentBaseHash(baseInput)).not.toBe(
      createVoicevoxAdjustmentBaseHash({ ...baseInput, ...change })
    );
  });

  it("normalizes resolved text before hashing", () => {
    expect(createVoicevoxAdjustmentBaseHash(baseInput)).toBe(
      createVoicevoxAdjustmentBaseHash({
        ...baseInput,
        resolvedSpokenText: "テストて\u3099す。"
      })
    );
  });
});
