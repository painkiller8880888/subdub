import { describe, expect, it } from "vitest";

import { createVoicevoxAudioQueryFixture } from "../fixtures/voicevox.js";
import { syntheticVoicevoxStyleId } from "../fixtures/voicevox.js";
import {
  buildVoiceAdjustmentFile,
  createVoiceAdjustmentEditorState,
  isVoiceAdjustmentDirty,
  resetVoiceAdjustmentAccent,
  resetVoiceAdjustmentEditing,
  updateVoiceAdjustmentAccent,
  updateVoiceAdjustmentMora,
  updateVoiceAdjustmentScalar
} from "../../src/web/voice-adjustment-state.js";

const query = createVoicevoxAudioQueryFixture();
const fixtureStyleId = syntheticVoicevoxStyleId();
const snapshot = {
  lineId: "line-one",
  status: "current" as const,
  query,
  adjustment: null,
  currentBase: {
    baseHash: "a".repeat(64),
    resolvedSpokenText: "テストです。",
    speakerUuid: "speaker-fixture-uuid",
    styleName: "ノーマル",
    resolvedStyleId: fixtureStyleId,
    voicevoxEngineVersion: "engine-fixture-1"
  }
};

describe("voice adjustment editor state", () => {
  it("stores scalar-only changes with a null accent snapshot", () => {
    const initial = createVoiceAdjustmentEditorState(snapshot);
    const changed = updateVoiceAdjustmentScalar(initial, "speedScale", 1.25);
    const saved = buildVoiceAdjustmentFile(
      changed,
      snapshot,
      "2026-08-10T00:00:00.000Z"
    );

    expect(saved.scalarOverrides).toEqual({ speedScale: 1.25 });
    expect(saved.accentPhrases).toBeNull();
    expect(isVoiceAdjustmentDirty(changed)).toBe(true);
  });

  it("stores accent and mora changes as a snapshot and can reset them", () => {
    const initial = createVoiceAdjustmentEditorState(snapshot);
    const changedAccent = updateVoiceAdjustmentAccent(initial, 0, 0);
    const changedMora = updateVoiceAdjustmentMora(
      changedAccent,
      0,
      0,
      "pitch",
      8.8
    );
    const saved = buildVoiceAdjustmentFile(
      changedMora,
      snapshot,
      "2026-08-10T00:00:00.000Z"
    );

    expect(saved.scalarOverrides).toEqual({});
    expect(saved.accentPhrases).toHaveLength(1);
    expect(saved.accentPhrases?.[0]?.accent).toBe(0);
    expect(saved.accentPhrases?.[0]?.moras[0]?.pitch).toBe(8.8);

    const reset = resetVoiceAdjustmentAccent(changedMora);
    expect(isVoiceAdjustmentDirty(reset)).toBe(false);
  });

  it("loads stale values only as an explicit re-edit draft", () => {
    const staleSnapshot = {
      ...snapshot,
      status: "needs_review" as const,
      adjustment: {
        adjustmentVersion: "1.0.0" as const,
        lineId: "line-one",
        base: snapshot.currentBase,
        scalarOverrides: { speedScale: 1.5 },
        accentPhrases: null,
        editedAt: "2026-08-10T00:00:00.000Z"
      }
    };
    const reedit = createVoiceAdjustmentEditorState(staleSnapshot);

    expect(reedit.query.speedScale).toBe(1.5);
    expect(isVoiceAdjustmentDirty(reedit)).toBe(false);
    const discarded = resetVoiceAdjustmentEditing(
      updateVoiceAdjustmentScalar(reedit, "speedScale", 1.8)
    );
    expect(discarded.query.speedScale).toBe(1.5);
    expect(discarded.savedAdjustment?.base.baseHash).toBe("a".repeat(64));
  });
});
