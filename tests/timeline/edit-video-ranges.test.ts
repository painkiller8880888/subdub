import { describe, expect, it } from "vitest";

import { calculateEditVideoTimeline } from "../../src/timeline/index.js";

describe("edit video timeline calculation", () => {
  it("orders same-boundary cutins by EditPlan order and shifts later sections", () => {
    const result = calculateEditVideoTimeline(
      [
        {
          id: "intro",
          role: "intro",
          placement: { kind: "before_first_section" },
          volume: 1,
          projectMediaPath: "media/intro.mp4",
          durationInFrames: 10,
          inputIndex: 0
        },
        {
          id: "cutin-order-one",
          role: "cutin",
          placement: {
            kind: "before_section",
            sectionId: "section-main",
            order: 1
          },
          volume: 0.25,
          projectMediaPath: "media/cutin-one.mp4",
          durationInFrames: 5,
          inputIndex: 1
        },
        {
          id: "cutin-order-zero",
          role: "cutin",
          placement: {
            kind: "before_section",
            sectionId: "section-main",
            order: 0
          },
          volume: 0,
          projectMediaPath: "media/cutin-zero.mp4",
          durationInFrames: 7,
          inputIndex: 2
        },
        {
          id: "outro",
          role: "outro",
          placement: { kind: "after_last_section" },
          volume: 1,
          projectMediaPath: "media/outro.mp4",
          durationInFrames: 11,
          inputIndex: 3
        }
      ],
      [
        { sectionId: "section-intro", from: 0, durationInFrames: 80 },
        { sectionId: "section-main", from: 80, durationInFrames: 50 },
        { sectionId: "section-outro", from: 130, durationInFrames: 60 }
      ]
    );

    expect(result.inserts).toEqual([
      {
        id: "intro",
        role: "intro",
        from: 0,
        durationInFrames: 10,
        src: "media/intro.mp4",
        volume: 1
      },
      {
        id: "cutin-order-zero",
        role: "cutin",
        from: 90,
        durationInFrames: 7,
        src: "media/cutin-zero.mp4",
        volume: 0
      },
      {
        id: "cutin-order-one",
        role: "cutin",
        from: 97,
        durationInFrames: 5,
        src: "media/cutin-one.mp4",
        volume: 0.25
      },
      {
        id: "outro",
        role: "outro",
        from: 212,
        durationInFrames: 11,
        src: "media/outro.mp4",
        volume: 1
      }
    ]);
    expect([...result.sectionShiftById.entries()]).toEqual([
      ["section-intro", 10],
      ["section-main", 22],
      ["section-outro", 22]
    ]);
    expect(result.durationInFrames).toBe(223);
  });

  it("keeps the script duration when EditPlan has no video elements", () => {
    const result = calculateEditVideoTimeline(
      [],
      [{ sectionId: "section-main", from: 0, durationInFrames: 42 }]
    );

    expect(result.inserts).toEqual([]);
    expect(result.durationInFrames).toBe(42);
    expect(result.sectionShiftById.get("section-main")).toBe(0);
  });
});
