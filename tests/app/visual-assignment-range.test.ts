import { describe, expect, it } from "vitest";

import {
  removeVisualPlaybackCuesOutsideRange,
  splitVisualAssignmentAtLine
} from "../../src/app/projects/visual-assignment-range.js";
import type {
  DisplayV15,
  ScriptSection,
  VisualAssignment
} from "../../src/schema/index.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function sectionWithFourLines(): ScriptSection {
  const section = clone(
    videoProjectFixture.script.sections[1]
  ) as ScriptSection;
  if (section === undefined) {
    throw new Error("the fixture must contain a main section");
  }
  const template = section.lines[0];
  if (template === undefined) {
    throw new Error("the fixture must contain a main line");
  }
  section.lines = [
    ...section.lines,
    { ...clone(template), id: "main-line-3" },
    { ...clone(template), id: "main-line-4" }
  ];
  section.lines[0]!.id = "main-line-1";
  section.lines[1]!.id = "main-line-2";
  return section;
}

function createAssignment(
  display: VisualAssignment["display"] = clone(
    videoProjectFixture.visuals.assignments[1]!.display
  )
): VisualAssignment {
  return {
    id: "assignment-a",
    startLineId: "main-line-1",
    endLineId: "main-line-4",
    assetId: "asset-a",
    assetChecksum: "a".repeat(64),
    projectMediaPath: "media/visuals/asset-a/v1.png",
    display
  };
}

function replacement(
  display: VisualAssignment["display"] = clone(
    videoProjectFixture.visuals.assignments[1]!.display
  )
) {
  return {
    id: "assignment-b",
    assetId: "asset-b",
    assetChecksum: "b".repeat(64),
    projectMediaPath: "media/visuals/asset-b/v2.png",
    display
  } satisfies Omit<VisualAssignment, "startLineId" | "endLineId">;
}

describe("splitVisualAssignmentAtLine", () => {
  it("splits a range at the selected line and preserves the old snapshot and display", () => {
    const section = sectionWithFourLines();
    const assignment = createAssignment();
    const result = splitVisualAssignmentAtLine({
      assignment,
      selectedLineId: "main-line-3",
      replacement: replacement(),
      section,
      existingAssignments: [assignment]
    });

    expect(result).toMatchObject({ ok: true, mode: "split" });
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.shortenedAssignment).toEqual({
      ...assignment,
      endLineId: "main-line-2"
    });
    expect(result.replacementAssignment).toMatchObject({
      id: "assignment-b",
      startLineId: "main-line-3",
      endLineId: "main-line-4",
      assetId: "asset-b",
      assetChecksum: "b".repeat(64),
      projectMediaPath: "media/visuals/asset-b/v2.png"
    });
    expect(result.outsidePlaybackCues).toEqual([]);
  });

  it("replaces an assignment in place when the selected line is its start", () => {
    const section = sectionWithFourLines();
    const assignment = createAssignment();
    const result = splitVisualAssignmentAtLine({
      assignment,
      selectedLineId: "main-line-1",
      replacement: replacement(),
      section,
      existingAssignments: [assignment]
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "replace",
      shortenedAssignment: undefined,
      replacementAssignment: {
        id: assignment.id,
        startLineId: "main-line-1",
        endLineId: "main-line-4",
        assetId: "asset-b"
      }
    });
  });

  it.each([
    ["missing-line", "selected-line-not-found"],
    ["main-line-1", "selected-line-outside-assignment"]
  ] as const)(
    "rejects %s when it is not inside the assignment",
    (lineId, code) => {
      const section = sectionWithFourLines();
      const assignment = {
        ...createAssignment(),
        startLineId: "main-line-2",
        endLineId: "main-line-4"
      };
      const result = splitVisualAssignmentAtLine({
        assignment,
        selectedLineId: lineId,
        replacement: replacement(),
        section,
        existingAssignments: [assignment]
      });

      expect(result).toMatchObject({ ok: false, code });
    }
  );

  it("rejects a selected line from a different section", () => {
    const section = sectionWithFourLines();
    const assignment = createAssignment();
    const result = splitVisualAssignmentAtLine({
      assignment,
      selectedLineId: "other-section-line",
      replacement: replacement(),
      section,
      existingAssignments: [assignment]
    });

    expect(result).toMatchObject({
      ok: false,
      code: "selected-line-not-found"
    });
  });

  it("rejects a replacement that would overlap another assignment", () => {
    const section = sectionWithFourLines();
    const assignment = createAssignment();
    const other: VisualAssignment = {
      ...createAssignment(),
      id: "assignment-existing",
      startLineId: "main-line-4",
      endLineId: "main-line-4"
    };
    const result = splitVisualAssignmentAtLine({
      assignment,
      selectedLineId: "main-line-3",
      replacement: replacement(),
      section,
      existingAssignments: [assignment, other]
    });

    expect(result).toMatchObject({
      ok: false,
      code: "replacement-overlap",
      conflictingAssignmentId: other.id
    });
  });

  it("reports cues that would leave the shortened range and removes them only explicitly", () => {
    const section = sectionWithFourLines();
    const display = clone(
      videoProjectFixture.visuals.assignments[0]!.display
    ) as DisplayV15;
    if (display.kind !== "video") {
      throw new Error("the fixture must contain a video display");
    }
    display.playbackCues = [
      { lineId: "main-line-2", edge: "after", action: "pause" },
      { lineId: "main-line-3", edge: "before", action: "resume" },
      { lineId: "main-line-4", edge: "before", action: "pause" }
    ];
    const assignment = createAssignment(display);
    const result = splitVisualAssignmentAtLine({
      assignment,
      selectedLineId: "main-line-3",
      replacement: replacement(),
      section,
      existingAssignments: [assignment]
    });

    expect(result).toMatchObject({
      ok: true,
      outsidePlaybackCues: [
        { lineId: "main-line-3", edge: "before", action: "resume" },
        { lineId: "main-line-4", edge: "before", action: "pause" }
      ]
    });
    if (!result.ok || result.shortenedAssignment === undefined) {
      throw new Error("the split plan was not created");
    }
    const trimmed = removeVisualPlaybackCuesOutsideRange(
      result.shortenedAssignment,
      section,
      "main-line-2"
    );
    expect(trimmed.display).toMatchObject({
      kind: "video",
      playbackCues: [{ lineId: "main-line-2", edge: "after", action: "pause" }]
    });
  });

  it.each([
    [
      "photo -> photo",
      videoProjectFixture.visuals.assignments[1]!.display,
      videoProjectFixture.visuals.assignments[1]!.display
    ],
    [
      "photo -> video",
      videoProjectFixture.visuals.assignments[1]!.display,
      videoProjectFixture.visuals.assignments[0]!.display
    ],
    [
      "video -> photo",
      videoProjectFixture.visuals.assignments[0]!.display,
      videoProjectFixture.visuals.assignments[1]!.display
    ],
    [
      "video -> video",
      videoProjectFixture.visuals.assignments[0]!.display,
      videoProjectFixture.visuals.assignments[0]!.display
    ],
    [
      "document_scan -> document_scan",
      videoProjectFixture.visuals.assignments[2]!.display,
      videoProjectFixture.visuals.assignments[2]!.display
    ]
  ] as const)(
    "uses the same range operation for %s",
    (_kind, display, replacementDisplay) => {
      const section = sectionWithFourLines();
      const assignment = createAssignment(clone(display));
      const result = splitVisualAssignmentAtLine({
        assignment,
        selectedLineId: "main-line-3",
        replacement: replacement(clone(replacementDisplay)),
        section,
        existingAssignments: [assignment]
      });

      expect(result).toMatchObject({
        ok: true,
        shortenedAssignment: { endLineId: "main-line-2" },
        replacementAssignment: {
          startLineId: "main-line-3",
          endLineId: "main-line-4"
        }
      });
    }
  );
});
