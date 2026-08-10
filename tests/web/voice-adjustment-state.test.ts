import { describe, expect, it } from "vitest";

import { createVoicevoxAudioQueryFixture } from "../fixtures/voicevox.js";
import { syntheticVoicevoxStyleId } from "../fixtures/voicevox.js";
import {
  buildVoiceAdjustmentFile,
  createVoiceAdjustmentEditorState,
  isVoiceAdjustmentDirty,
  loadSavedVoiceAdjustment,
  resetVoiceAdjustmentAccent,
  resetVoiceAdjustmentEditing,
  resetVoiceAdjustmentMoraDetails,
  resetVoiceAdjustmentMoraItem,
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

  it("resets accent and mora details independently", () => {
    const initial = createVoiceAdjustmentEditorState(snapshot);
    const changedAccent = updateVoiceAdjustmentAccent(initial, 0, 0);
    const changedMora = updateVoiceAdjustmentMora(
      changedAccent,
      0,
      0,
      "pitch",
      8.8
    );
    const changedMoraWithDevoicing = updateVoiceAdjustmentMora(
      changedMora,
      0,
      0,
      "is_devoiced",
      true
    );
    const saved = buildVoiceAdjustmentFile(
      changedMoraWithDevoicing,
      snapshot,
      "2026-08-10T00:00:00.000Z"
    );

    expect(saved.scalarOverrides).toEqual({});
    expect(saved.accentPhrases).toHaveLength(1);
    expect(saved.accentPhrases?.[0]?.accent).toBe(0);
    expect(saved.accentPhrases?.[0]?.moras[0]?.pitch).toBe(8.8);
    expect(saved.accentPhrases?.[0]?.moras[0]?.is_devoiced).toBe(true);

    const resetAccent = resetVoiceAdjustmentAccent(changedMoraWithDevoicing);
    expect(resetAccent.query.accent_phrases[0]?.accent).toBe(
      initial.baseQuery.accent_phrases[0]?.accent
    );
    expect(resetAccent.query.accent_phrases[0]?.moras[0]?.pitch).toBe(8.8);
    expect(isVoiceAdjustmentDirty(resetAccent)).toBe(true);

    const resetDetails = resetVoiceAdjustmentMoraDetails(resetAccent);
    expect(resetDetails.query.accent_phrases[0]?.accent).toBe(
      initial.baseQuery.accent_phrases[0]?.accent
    );
    expect(resetDetails.query.accent_phrases[0]?.moras[0]?.pitch).toBe(5.5);
    expect(
      resetDetails.query.accent_phrases[0]?.moras[0]?.is_devoiced
    ).toBeUndefined();
    expect(isVoiceAdjustmentDirty(resetDetails)).toBe(false);

    const resetItem = resetVoiceAdjustmentMoraItem(
      changedMoraWithDevoicing,
      0,
      0
    );
    expect(resetItem.query.accent_phrases[0]?.accent).toBe(0);
    expect(resetItem.query.accent_phrases[0]?.moras[0]?.pitch).toBe(5.5);
    expect(
      resetItem.query.accent_phrases[0]?.moras[0]?.is_devoiced
    ).toBeUndefined();
  });

  it("loads stale values only after explicit re-edit selection", () => {
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
    const initial = createVoiceAdjustmentEditorState(staleSnapshot, {
      loadSaved: false
    });

    expect(initial.query.speedScale).toBe(initial.baseQuery.speedScale);
    expect(isVoiceAdjustmentDirty(initial)).toBe(false);

    const discardedBeforeSelection = resetVoiceAdjustmentEditing(
      updateVoiceAdjustmentScalar(initial, "speedScale", 1.8)
    );
    expect(discardedBeforeSelection.query.speedScale).toBe(
      initial.baseQuery.speedScale
    );

    const reedit = loadSavedVoiceAdjustment(initial);

    expect(reedit.query.speedScale).toBe(1.5);
    expect(isVoiceAdjustmentDirty(reedit)).toBe(false);
    const discarded = resetVoiceAdjustmentEditing(
      updateVoiceAdjustmentScalar(reedit, "speedScale", 1.8)
    );
    expect(discarded.query.speedScale).toBe(1.5);
    expect(discarded.savedAdjustment?.base.baseHash).toBe("a".repeat(64));
  });
});
