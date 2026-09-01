import { assertValidScreenTemplate } from "../../../src/validation/screen-templates.js";
import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH,
  type ScreenTemplate
} from "../../../src/schema/screen-template.js";
import type { VideoProject } from "../../../src/schema/index.js";
import {
  createStandardScreenTemplate,
  STANDARD_SCREEN_TEMPLATE_ID
} from "../../../src/app/screen-templates/screen-template-seed.js";
import {
  legacyVideoProjectFixture,
  videoProjectFixture
} from "../video-project.js";

export const ALTERNATE_SCREEN_TEMPLATE_ID =
  "screen-template-alternate" as const;
export const SCREEN_TEMPLATE_FIXTURE_TIMESTAMP = "2026-08-19T00:00:00.000Z";

export function createAlternateScreenTemplate(
  timestamp = SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
): ScreenTemplate {
  return assertValidScreenTemplate({
    templateId: ALTERNATE_SCREEN_TEMPLATE_ID,
    name: "Alternate dialog layout",
    description:
      "Representative non-standard layout with rotated title/content and a flipped speaker.",
    status: "active",
    canvasWidth: SCREEN_TEMPLATE_CANVAS_WIDTH,
    canvasHeight: SCREEN_TEMPLATE_CANVAS_HEIGHT,
    revision: 1,
    elements: [
      {
        elementId: "screen-template-alternate-section-title",
        type: "section-title",
        transform: {
          rect: { x: 0.18, y: 0.06, width: 0.64, height: 0.1 },
          rotationDeg: -4
        },
        fontSize: 56
      },
      {
        elementId: "screen-template-alternate-dialogue-window",
        type: "dialogue-window",
        transform: {
          rect: { x: 0.14, y: 0.58, width: 0.72, height: 0.31 },
          rotationDeg: 3
        },
        fontSize: 44
      },
      {
        elementId: "screen-template-alternate-content-slot",
        type: "content-slot",
        transform: {
          rect: { x: 0.17, y: 0.2, width: 0.66, height: 0.3 },
          rotationDeg: -5
        },
        slot: "primary"
      },
      {
        elementId: "screen-template-alternate-character-speaker-1",
        type: "character-visual",
        transform: {
          rect: { x: 0.035, y: 0.58, width: 0.19, height: 0.35 },
          rotationDeg: -4
        },
        slot: "speaker-1",
        flipX: false
      },
      {
        elementId: "screen-template-alternate-character-speaker-2",
        type: "character-visual",
        transform: {
          rect: { x: 0.775, y: 0.58, width: 0.19, height: 0.35 },
          rotationDeg: 7
        },
        slot: "speaker-2",
        flipX: true
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createScreenTemplateProjectFixture(): VideoProject {
  const project = structuredClone(videoProjectFixture) as VideoProject;
  const intro = project.script.sections[0];
  const main = project.script.sections[1];
  const outro = project.script.sections[2];
  if (intro === undefined || main === undefined || outro === undefined) {
    throw new Error("representative script sections are missing");
  }

  const firstMainLine = main.lines[0];
  if (firstMainLine === undefined) {
    throw new Error("representative main line is missing");
  }
  const thirdMainLine = {
    ...firstMainLine,
    id: "main-mentor-2",
    spokenText: "最後に登録内容を確定します。",
    subtitleText: "登録内容を確定します。",
    characterVariantId: "character-mentor-stand-v1",
    pauseBeforeMs: 100,
    pauseAfterMs: 150
  };
  intro.screenTemplateId = STANDARD_SCREEN_TEMPLATE_ID;
  main.screenTemplateId = ALTERNATE_SCREEN_TEMPLATE_ID;
  main.lines = [...main.lines, thirdMainLine];
  outro.screenTemplateId = ALTERNATE_SCREEN_TEMPLATE_ID;

  const spanningPhoto = project.visuals.assignments.find(
    (assignment) => assignment.id === "visual-main-photo"
  );
  if (spanningPhoto === undefined) {
    throw new Error("representative main visual is missing");
  }
  spanningPhoto.endLineId = thirdMainLine.id;
  spanningPhoto.display = {
    ...spanningPhoto.display,
    displayCoordinateSpace: "content-slot-relative",
    crop: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 },
    position: { x: 0.54, y: 0.46 },
    scale: 0.92,
    prioritizeVisual: false
  };

  project.edit.videoElements = [
    {
      id: "cutin-confirm",
      assetId: "asset-cutin-confirm",
      assetVersion: 1,
      assetChecksum: "9".repeat(64),
      projectMediaPath: "media/cutin-confirm.mp4",
      role: "cutin",
      placement: { kind: "before_section", sectionId: main.id, order: 0 },
      startMs: null,
      playbackRate: 1,
      volume: 0.35,
      text: "",
      textTemplateId: null
    }
  ];

  return project;
}

export function createLineOverrideScreenTemplateProjectFixture(): unknown {
  const project = structuredClone(
    createLegacyScreenTemplateProjectFixture()
  ) as {
    schemaVersion: string;
    script: {
      sections: Array<{
        screenTemplateId?: string;
        lines: Array<Record<string, unknown>>;
      }>;
    };
    visuals: {
      assignments: Array<{
        display: {
          displayCoordinateSpace?: string;
          playbackCues?: unknown;
        };
      }>;
    };
  };
  project.schemaVersion = "1.3.0";
  const sectionTemplateIds = [
    STANDARD_SCREEN_TEMPLATE_ID,
    ALTERNATE_SCREEN_TEMPLATE_ID,
    ALTERNATE_SCREEN_TEMPLATE_ID
  ];
  for (const [sectionIndex, section] of project.script.sections.entries()) {
    section.screenTemplateId = sectionTemplateIds[sectionIndex];
    for (const line of section.lines) {
      line.screenTemplateId = null;
    }
  }
  for (const assignment of project.visuals.assignments) {
    assignment.display.displayCoordinateSpace = "legacy-media-frame";
    delete assignment.display.playbackCues;
  }
  const overrideLine = project.script.sections[1]?.lines[1];
  if (overrideLine === undefined) {
    throw new Error("line override fixture is missing a line");
  }
  overrideLine.screenTemplateId = STANDARD_SCREEN_TEMPLATE_ID;
  return project;
}

export function createLegacyScreenTemplateProjectFixture(): unknown {
  const project = structuredClone(legacyVideoProjectFixture) as unknown as {
    schemaVersion: string;
    script: {
      sections: Array<{
        screenTemplateId?: string;
        lines: Array<{ screenTemplateId?: string | null }>;
      }>;
    };
    visuals: {
      assignments: Array<{
        display: { displayCoordinateSpace?: string; playbackCues?: unknown };
      }>;
    };
    edit: {
      videoElements: Array<Record<string, unknown>>;
    };
  };
  delete (project as unknown as Record<string, unknown>).overlays;
  project.schemaVersion = "1.2.0";
  const sourceEdit = createScreenTemplateProjectFixture().edit;
  const cutin = sourceEdit.videoElements[0];
  if (cutin !== undefined) {
    const legacyCutin = { ...cutin } as Record<string, unknown>;
    delete legacyCutin.text;
    delete legacyCutin.textTemplateId;
    delete legacyCutin.startMs;
    delete legacyCutin.playbackRate;
    project.edit.videoElements = [legacyCutin];
  }
  for (const section of project.script.sections) {
    delete section.screenTemplateId;
    for (const line of section.lines) {
      delete line.screenTemplateId;
    }
  }
  for (const assignment of project.visuals.assignments) {
    delete assignment.display.displayCoordinateSpace;
    delete assignment.display.playbackCues;
  }
  return project;
}

export function createStandardAndAlternateTemplateSnapshot(): ScreenTemplate[] {
  return [
    createStandardScreenTemplate(SCREEN_TEMPLATE_FIXTURE_TIMESTAMP),
    createAlternateScreenTemplate(SCREEN_TEMPLATE_FIXTURE_TIMESTAMP)
  ];
}
