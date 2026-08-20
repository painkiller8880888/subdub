import { describe, expect, it } from "vitest";

import {
  orderVisualPlaybackCues,
  resolveVisualPlaybackState,
  validateVisualPlaybackSequence,
  type VisualPlaybackAssignment,
  type VisualPlaybackScript
} from "../../src/timeline/index.js";

const script: VisualPlaybackScript = {
  sections: [
    {
      id: "section-one",
      lines: [
        { id: "line-one", pauseBeforeMs: 0, pauseAfterMs: 200 },
        { id: "line-two", pauseBeforeMs: 100, pauseAfterMs: 300 },
        { id: "line-three", pauseBeforeMs: 0, pauseAfterMs: 0 }
      ]
    },
    {
      id: "section-two",
      lines: [{ id: "line-four", pauseBeforeMs: 0, pauseAfterMs: 0 }]
    }
  ]
};

function assignment(
  startLineId = "line-one",
  endLineId = "line-three",
  playbackCues: VisualPlaybackAssignment["display"]["playbackCues"] = []
): VisualPlaybackAssignment {
  return {
    id: "visual-video",
    startLineId,
    endLineId,
    display: { kind: "video", playbackCues }
  };
}

describe("visual playback cue resolver", () => {
  it("canonicalizes cue order from script line and edge order", () => {
    const cues = [
      { lineId: "line-two", edge: "after" as const, action: "resume" as const },
      { lineId: "line-one", edge: "after" as const, action: "pause" as const }
    ];
    const result = validateVisualPlaybackSequence(
      assignment("line-one", "line-two", cues),
      script
    );

    expect(result).toEqual({
      success: true,
      orderedCues: [cues[1], cues[0]],
      finalState: "playing"
    });
    expect(
      orderVisualPlaybackCues(assignment("line-one", "line-two", cues), script)
    ).toEqual([cues[1], cues[0]]);
  });

  it("enforces range and alternating state transitions", () => {
    const outside = validateVisualPlaybackSequence(
      assignment("line-two", "line-two", [
        { lineId: "line-one", edge: "before", action: "pause" }
      ]),
      script
    );
    expect(outside.success).toBe(false);
    if (!outside.success) {
      expect(outside.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "cue-outside-assignment-range" })
        ])
      );
    }

    const pauseTwice = validateVisualPlaybackSequence(
      assignment("line-one", "line-two", [
        { lineId: "line-one", edge: "before", action: "pause" },
        { lineId: "line-two", edge: "before", action: "pause" }
      ]),
      script
    );
    expect(pauseTwice.success).toBe(false);
    if (!pauseTwice.success) {
      expect(pauseTwice.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "pause-while-paused" })
        ])
      );
    }

    const resumeWhilePlaying = validateVisualPlaybackSequence(
      assignment("line-one", "line-one", [
        { lineId: "line-one", edge: "after", action: "resume" }
      ]),
      script
    );
    expect(resumeWhilePlaying.success).toBe(false);
    if (!resumeWhilePlaying.success) {
      expect(resumeWhilePlaying.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "resume-while-playing" })
        ])
      );
    }
  });

  it("rejects duplicate and same-boundary ambiguous cues", () => {
    const duplicate = validateVisualPlaybackSequence(
      assignment("line-one", "line-two", [
        { lineId: "line-one", edge: "after", action: "pause" },
        { lineId: "line-one", edge: "after", action: "pause" }
      ]),
      script
    );
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "cue-duplicate" })
        ])
      );
    }

    const ambiguous = validateVisualPlaybackSequence(
      assignment("line-one", "line-two", [
        { lineId: "line-one", edge: "after", action: "pause" },
        { lineId: "line-one", edge: "after", action: "resume" }
      ]),
      script
    );
    expect(ambiguous.success).toBe(false);
    if (!ambiguous.success) {
      expect(ambiguous.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "cue-ambiguous" })
        ])
      );
    }
  });

  it("resolves visibility and state at BEFORE/AFTER boundaries", () => {
    const video = assignment("line-one", "line-three", [
      { lineId: "line-one", edge: "after", action: "pause" },
      { lineId: "line-two", edge: "after", action: "resume" }
    ]);

    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-one", edge: "before" }
      })
    ).toMatchObject({ visible: true, playbackState: "playing" });
    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-one", edge: "after" }
      })
    ).toMatchObject({ visible: true, playbackState: "paused" });
    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-two", edge: "before" }
      })
    ).toMatchObject({ visible: true, playbackState: "paused" });
    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-two", edge: "after" }
      })
    ).toMatchObject({ visible: true, playbackState: "playing" });
    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-three", edge: "before" }
      })
    ).toMatchObject({ visible: true, playbackState: "playing" });
    expect(
      resolveVisualPlaybackState({
        assignment: video,
        script,
        boundary: { lineId: "line-three", edge: "after" }
      })
    ).toMatchObject({ visible: false, playbackState: "hidden" });
  });

  it("allows an assignment to end while paused", () => {
    const result = validateVisualPlaybackSequence(
      assignment("line-one", "line-two", [
        { lineId: "line-two", edge: "after", action: "pause" }
      ]),
      script
    );

    expect(result).toMatchObject({
      success: true,
      finalState: "paused"
    });
    expect(
      resolveVisualPlaybackState({
        assignment: assignment("line-one", "line-two", [
          { lineId: "line-two", edge: "after", action: "pause" }
        ]),
        script,
        boundary: { lineId: "line-two", edge: "after" }
      })
    ).toMatchObject({ visible: false, playbackState: "hidden" });
  });
});
