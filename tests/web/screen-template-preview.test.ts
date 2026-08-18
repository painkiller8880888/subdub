import { describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import type {
  AssetDetail,
  CharacterVisualCatalogSnapshot,
  ScriptLine,
  ScriptSection,
  ScreenTemplate,
  VisualAssignment
} from "../../src/schema/index.js";
import { createDefaultScriptLine } from "../../src/web/script-editor.js";
import {
  findVisualAssignmentForLine,
  resolveCharacterPreviewForSlot,
  resolveCharacterPreviews,
  resolveContentPreview,
  resolveScriptLineScreenPreview,
  resolveScriptScreenTemplate,
  screenTemplateIdsForScript
} from "../../src/web/screen-template-preview.js";

const TIMESTAMP = "2026-08-18T00:00:00.000Z";
const CHECKSUM = "0".repeat(64);

function createLine(
  id: string,
  screenTemplateId: string | null = null
): ScriptLine {
  return {
    ...createDefaultScriptLine("character-mentor", id),
    screenTemplateId
  };
}

function createSection(
  screenTemplateId = "screen-template-standard",
  lines: readonly ScriptLine[] = [
    createLine("line-one"),
    createLine("line-two", "template-inactive"),
    createLine("line-three", "template-missing")
  ]
): ScriptSection {
  return {
    id: "script-section-main",
    outlineSectionId: "outline-main",
    name: "操作",
    screenTemplateId,
    background: { kind: "solid", colorToken: "background" },
    lines: [...lines]
  };
}

function createAssignment(
  id: string,
  startLineId: string,
  endLineId: string
): VisualAssignment {
  return {
    id,
    startLineId,
    endLineId,
    assetId: "asset-scan",
    assetChecksum: CHECKSUM,
    projectMediaPath: "projects/preview-project/media/visuals/scan.pdf",
    display: {
      kind: "document_scan",
      fit: "contain",
      crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
      scale: 1.2,
      position: { x: 0.6, y: 0.4 },
      prioritizeVisual: true,
      annotations: [],
      page: 2,
      displayCoordinateSpace: "content-slot-relative"
    }
  };
}

function createAsset(): AssetDetail {
  return {
    assetId: "asset-scan",
    version: 3,
    kind: "document_scan",
    title: "申請書サンプル",
    description: "",
    confidentiality: "internal",
    department: null,
    system: null,
    mimeType: "application/pdf",
    libraryMediaPath: "library/assets/asset-scan/scan.pdf",
    checksum: CHECKSUM,
    sizeBytes: 100,
    width: 1920,
    height: 1080,
    durationMs: null,
    pageCount: 3,
    thumbnailPaths: [
      "library/assets/asset-scan/thumbnail-0.png",
      "library/assets/asset-scan/thumbnail-1.png"
    ],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  };
}

function createCharacterFile(
  visualId: string,
  variantId: string,
  key: "closed" | "open" | "single"
) {
  return {
    key,
    libraryPath: `library/character-visuals/${visualId}/${variantId}/${key}.png`,
    mimeType: "image/png" as const,
    checksum: CHECKSUM,
    sizeBytes: 100,
    width: 256,
    height: 256
  };
}

const characterCatalog: CharacterVisualCatalogSnapshot = [
  {
    visualId: "visual-mentor",
    name: "メンター素材",
    description: "",
    status: "active",
    baseWidth: 256,
    baseHeight: 256,
    variants: [
      {
        variantId: "variant-talk",
        label: "説明",
        renderType: "mouth-pair",
        status: "active",
        tags: [],
        files: [
          createCharacterFile("visual-mentor", "variant-talk", "closed"),
          createCharacterFile("visual-mentor", "variant-talk", "open")
        ]
      },
      {
        variantId: "variant-idle",
        label: "待機",
        renderType: "single-image",
        status: "active",
        tags: [],
        files: [createCharacterFile("visual-mentor", "variant-idle", "single")]
      }
    ],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  },
  {
    visualId: "visual-learner",
    name: "学習者素材",
    description: "",
    status: "active",
    baseWidth: 256,
    baseHeight: 256,
    variants: [
      {
        variantId: "variant-learner-idle",
        label: "待機",
        renderType: "single-image",
        status: "active",
        tags: [],
        files: [
          createCharacterFile(
            "visual-learner",
            "variant-learner-idle",
            "single"
          )
        ]
      }
    ],
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP
  }
];

describe("script ScreenTemplate preview resolution", () => {
  it("resolves line overrides and reports missing or inactive references without fallback", () => {
    const standard = createStandardScreenTemplate(TIMESTAMP);
    const inactive: ScreenTemplate = {
      ...standard,
      templateId: "template-inactive",
      name: "Inactive",
      status: "inactive"
    };
    const templates = new Map([
      [standard.templateId, standard],
      [inactive.templateId, inactive]
    ]);
    const section = createSection();

    expect(screenTemplateIdsForScript({ sections: [section] })).toEqual([
      "screen-template-standard",
      "template-inactive",
      "template-missing"
    ]);
    expect(
      resolveScriptScreenTemplate(section, section.lines[0]!, templates).status
    ).toBe("ready");
    expect(
      resolveScriptScreenTemplate(section, section.lines[1]!, templates).status
    ).toBe("inactive");
    expect(
      resolveScriptScreenTemplate(section, section.lines[2]!, templates).status
    ).toBe("missing");
    expect(
      resolveScriptScreenTemplate(
        { ...section, screenTemplateId: "template-missing-section" },
        { screenTemplateId: standard.templateId },
        templates
      )
    ).toMatchObject({ status: "ready", templateId: standard.templateId });
    expect(
      resolveScriptScreenTemplate(
        section,
        { screenTemplateId: "template-loading" },
        templates,
        new Set(["template-loading"])
      ).status
    ).toBe("loading");
  });

  it("selects the first visual assignment covering the current line", () => {
    const section = createSection("screen-template-standard", [
      createLine("line-one"),
      createLine("line-two"),
      createLine("line-three")
    ]);
    const first = createAssignment("assignment-first", "line-one", "line-two");
    const second = createAssignment(
      "assignment-second",
      "line-three",
      "line-three"
    );

    expect(
      findVisualAssignmentForLine(section, "line-two", [first, second])?.id
    ).toBe("assignment-first");
    expect(
      findVisualAssignmentForLine(section, "line-three", [first, second])?.id
    ).toBe("assignment-second");
    expect(findVisualAssignmentForLine(section, "missing", [first])).toBe(
      undefined
    );
  });

  it("uses the line variant for the speaker and the bound idle variant for the other slot", () => {
    const project = createEmptyVideoProject({
      projectId: "preview-project",
      createdAt: TIMESTAMP
    });
    project.characters[0]!.characterVisual = {
      visualId: "visual-mentor",
      idleVariantId: "variant-idle"
    };
    project.characters[1]!.characterVisual = {
      visualId: "visual-learner",
      idleVariantId: "variant-learner-idle"
    };
    const line = createLine("line-one");
    line.characterVariantId = "variant-talk";

    expect(resolveCharacterPreviews(project, line, characterCatalog)).toEqual({
      "speaker-1": {
        alt: "四国めたんの説明",
        src: "/api/character-visuals/visual-mentor/variant-talk/closed"
      },
      "speaker-2": {
        alt: "ずんだもんの待機",
        src: "/api/character-visuals/visual-learner/variant-learner-idle/single"
      }
    });
    expect(
      resolveCharacterPreviewForSlot(project, line, characterCatalog, 0).src
    ).toContain("/closed");
  });

  it("passes assignment transforms, document page thumbnails, subtitles, and backgrounds into the shared preview", () => {
    const project = createEmptyVideoProject({
      projectId: "preview-project",
      createdAt: TIMESTAMP
    });
    const section = {
      ...createSection(),
      background: {
        kind: "image" as const,
        src: "projects/preview-project/backgrounds/section.png",
        fit: "cover" as const
      }
    };
    const line = { ...createLine("line-one"), subtitleText: "現在の字幕" };
    const assignment = createAssignment("assignment", "line-one", "line-one");
    const preview = resolveScriptLineScreenPreview({
      projectId: project.metadata.id,
      project,
      section,
      line,
      catalog: characterCatalog,
      assignment,
      asset: createAsset()
    });

    expect(preview.dialogueText).toBe("現在の字幕");
    expect(preview.sectionTitleText).toBe("操作");
    expect(preview.background).toEqual({
      fit: "cover",
      src: "/api/projects/preview-project/files/backgrounds/section.png"
    });
    expect(preview.content).toMatchObject({
      alt: "申請書サンプル",
      src: "/api/assets/asset-scan/thumbnails/1?version=3",
      display: assignment.display
    });
  });

  it("does not resolve inactive generic assets to a thumbnail", () => {
    const inactiveAsset = { ...createAsset(), status: "inactive" as const };
    expect(
      resolveContentPreview(createAssignment("a", "a", "a"), inactiveAsset)
    ).toEqual({
      alt: "申請書サンプル",
      display: createAssignment("a", "a", "a").display,
      src: null
    });
  });
});
