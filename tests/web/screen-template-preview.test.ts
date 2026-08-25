import { describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import { createEmptyVideoProject } from "../../src/app/projects/empty-video-project.js";
import type {
  AssetDetail,
  CharacterVisualCatalogSnapshot,
  ScriptLine,
  ScriptSection,
  ScreenTemplate,
  VisualAssignment,
  VisualPlaybackCue
} from "../../src/schema/index.js";
import { createDefaultScriptLine } from "../../src/web/script-editor.js";
import {
  findVisualAssignmentsForLine,
  persistentScreenStateKey,
  previewLineKey,
  previewModeForLine,
  resolveCharacterPreviewForSlot,
  resolveCharacterPreviews,
  resolveContentPreview,
  resolvePersistentScreenState,
  screenPreviewAssetKey,
  resolveScriptLineScreenPreview,
  resolveScriptLinePreviewStates,
  resolveScriptScreenTemplate,
  screenTemplateIdsForScript
} from "../../src/web/screen-template-preview.js";

const TIMESTAMP = "2026-08-18T00:00:00.000Z";
const CHECKSUM = "0".repeat(64);

function createLine(id: string): ScriptLine {
  return createDefaultScriptLine("character-mentor", id);
}

function createSection(
  screenTemplateId = "screen-template-standard",
  lines: readonly ScriptLine[] = [
    createLine("line-one"),
    createLine("line-two"),
    createLine("line-three")
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
    projectMediaPath: "media/visuals/asset-scan/v3.pdf",
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

function createVideoAssignment(
  id: string,
  startLineId: string,
  endLineId: string,
  playbackCues: readonly VisualPlaybackCue[] = []
): VisualAssignment {
  return {
    id,
    startLineId,
    endLineId,
    assetId: "asset-video",
    assetChecksum: CHECKSUM,
    projectMediaPath: "media/visuals/asset-video/v1.mp4",
    display: {
      kind: "video",
      fit: "contain",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      position: { x: 0.5, y: 0.5 },
      prioritizeVisual: false,
      annotations: [],
      startMs: 0,
      endMs: 3000,
      playbackRate: 1,
      volume: 0,
      playbackCues: [...playbackCues],
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
    glowColor: "#e78ac3",
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
    glowColor: "#75c97a",
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
  it("resolves the section template and reports missing or inactive references without fallback", () => {
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
      "screen-template-standard"
    ]);
    expect(resolveScriptScreenTemplate(section, templates).status).toBe(
      "ready"
    );
    expect(
      resolveScriptScreenTemplate(
        { ...section, screenTemplateId: inactive.templateId },
        templates
      ).status
    ).toBe("inactive");
    expect(
      resolveScriptScreenTemplate(
        { ...section, screenTemplateId: "template-missing" },
        templates
      ).status
    ).toBe("missing");
    expect(
      resolveScriptScreenTemplate(
        { ...section, screenTemplateId: "template-missing-section" },
        templates
      )
    ).toMatchObject({
      status: "missing",
      templateId: "template-missing-section"
    });
    expect(
      resolveScriptScreenTemplate(
        { ...section, screenTemplateId: "template-loading" },
        templates,
        new Set(["template-loading"])
      ).status
    ).toBe("loading");
  });

  it("returns every visual assignment in compiler start-line order", () => {
    const section = createSection("screen-template-standard", [
      createLine("line-one"),
      createLine("line-two"),
      createLine("line-three")
    ]);
    const first = createAssignment(
      "assignment-first",
      "line-one",
      "line-three"
    );
    const second = createAssignment(
      "assignment-second",
      "line-two",
      "line-two"
    );

    expect(
      findVisualAssignmentsForLine(section, "line-two", [second, first]).map(
        (assignment) => assignment.id
      )
    ).toEqual(["assignment-first", "assignment-second"]);
    expect(findVisualAssignmentsForLine(section, "missing", [first])).toEqual(
      []
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
    project.characters[0]!.characterVisual = {
      visualId: "visual-mentor",
      idleVariantId: "variant-idle"
    };
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
    const assets = new Map([
      [screenPreviewAssetKey(assignment), createAsset()]
    ]);
    const preview = resolveScriptLineScreenPreview({
      projectId: project.metadata.id,
      project,
      section,
      line,
      catalog: characterCatalog,
      assignments: [assignment],
      assets
    });

    expect(preview.dialogueText).toBe("現在の字幕");
    expect(preview.dialogueGlowColor).toBe("#e78ac3");
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

  it("keeps a matching snapshot thumbnail when the live asset is inactive", () => {
    const inactiveAsset = { ...createAsset(), status: "inactive" as const };
    expect(
      resolveContentPreview(createAssignment("a", "a", "a"), inactiveAsset)
    ).toEqual({
      alt: "申請書サンプル",
      display: createAssignment("a", "a", "a").display,
      src: "/api/assets/asset-scan/thumbnails/1?version=3"
    });
  });

  it("does not show a live thumbnail when the snapshot checksum or version differs", () => {
    const assignment = createAssignment("a", "a", "a");
    expect(
      resolveContentPreview(assignment, {
        ...createAsset(),
        checksum: "1".repeat(64)
      })
    ).toMatchObject({
      alt: "snapshot preview を解決できません",
      display: assignment.display,
      src: null
    });
    expect(
      resolveContentPreview(assignment, { ...createAsset(), version: 2 })
    ).toMatchObject({
      alt: "snapshot preview を解決できません",
      display: assignment.display,
      src: null
    });
  });

  it("uses one persistent state comparison for full and dialogue-only modes", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const states = resolveScriptLinePreviewStates({
      script: { sections: [section] },
      templates: new Map([[template.templateId, template]]),
      assignments: [],
      assets: new Map()
    });

    expect(states.get(previewLineKey(section.id, "line-one"))?.mode).toBe(
      "full-screen"
    );
    expect(states.get(previewLineKey(section.id, "line-two"))?.mode).toBe(
      "dialogue-only"
    );
    expect(states.get(previewLineKey(section.id, "line-three"))?.mode).toBe(
      "dialogue-only"
    );

    const nextSection = {
      ...createSection(template.templateId, [createLine("line-four")]),
      id: "script-section-next"
    };
    const withSectionBoundary = resolveScriptLinePreviewStates({
      script: { sections: [section, nextSection] },
      templates: new Map([[template.templateId, template]]),
      assignments: [],
      assets: new Map()
    });
    expect(
      withSectionBoundary.get(previewLineKey(nextSection.id, "line-four"))?.mode
    ).toBe("full-screen");
  });

  it("resolves static and video lifecycle states from the shared cue resolver", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const resolvedTemplate = resolveScriptScreenTemplate(
      section,
      new Map([[template.templateId, template]])
    );
    const video = createVideoAssignment(
      "video-assignment",
      "line-one",
      "line-three",
      [{ lineId: "line-two", edge: "before", action: "pause" }]
    );

    const playing = resolvePersistentScreenState({
      section,
      lineId: "line-one",
      resolvedTemplate,
      assignments: [video],
      assets: new Map()
    });
    const paused = resolvePersistentScreenState({
      section,
      lineId: "line-two",
      resolvedTemplate,
      assignments: [video],
      assets: new Map()
    });
    const staticVisible = resolvePersistentScreenState({
      section,
      lineId: "line-two",
      resolvedTemplate,
      assignments: [createAssignment("static", "line-one", "line-three")],
      assets: new Map()
    });

    expect(playing.visualPresentationState[0]?.lifecycle).toBe("playing");
    expect(paused.visualPresentationState[0]?.lifecycle).toBe("paused");
    expect(staticVisible.visualPresentationState[0]?.lifecycle).toBe(
      "static-visible"
    );
    expect(playing.visualPresentationState[0]?.playbackIssues).toEqual([]);
  });

  it("exposes cue conflicts as an explicit persistent preview issue", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const resolvedTemplate = resolveScriptScreenTemplate(
      section,
      new Map([[template.templateId, template]])
    );
    const invalid = createVideoAssignment(
      "invalid-video",
      "line-one",
      "line-three",
      [
        { lineId: "line-two", edge: "before", action: "pause" },
        { lineId: "line-two", edge: "before", action: "resume" }
      ]
    );

    const state = resolvePersistentScreenState({
      section,
      lineId: "line-two",
      resolvedTemplate,
      assignments: [invalid],
      assets: new Map()
    });

    expect(state.visualPresentationState[0]).toMatchObject({
      lifecycle: "hidden",
      playbackIssues: [expect.objectContaining({ code: "cue-ambiguous" })]
    });
  });

  it("makes an end-line change a full preview trigger on the affected line", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const assignment = createVideoAssignment(
      "video-assignment",
      "line-one",
      "line-three"
    );
    const shortened = { ...assignment, endLineId: "line-two" };
    const templates = new Map([[template.templateId, template]]);

    const before = resolveScriptLinePreviewStates({
      script: { sections: [section] },
      templates,
      assignments: [assignment],
      assets: new Map()
    });
    const after = resolveScriptLinePreviewStates({
      script: { sections: [section] },
      templates,
      assignments: [shortened],
      assets: new Map()
    });

    expect(before.get(previewLineKey(section.id, "line-two"))?.mode).toBe(
      "dialogue-only"
    );
    expect(after.get(previewLineKey(section.id, "line-two"))?.mode).toBe(
      "full-screen"
    );
    expect(
      after.get(previewLineKey(section.id, "line-two"))?.persistentScreenState
        .visualBoundaryTransitions
    ).toEqual([{ assignmentId: assignment.id, action: "end" }]);
    expect(after.get(previewLineKey(section.id, "line-three"))?.mode).toBe(
      "full-screen"
    );
  });

  it("does not include line text or character variant fields in persistent state", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const resolvedTemplate = resolveScriptScreenTemplate(
      section,
      new Map([[template.templateId, template]])
    );
    const first = resolvePersistentScreenState({
      section,
      resolvedTemplate,
      assignments: [],
      assets: new Map()
    });
    const changedLine = {
      ...section.lines[0]!,
      subtitleText: "別の字幕",
      spokenText: "別の読み上げ",
      speakerId: "character-learner",
      characterVariantId: "variant-changed"
    };
    const changedLineSection = {
      ...section,
      lines: [changedLine, ...section.lines.slice(1)]
    };
    const second = resolvePersistentScreenState({
      section: changedLineSection,
      resolvedTemplate,
      assignments: [],
      assets: new Map()
    });

    expect(persistentScreenStateKey(first)).toBe(
      persistentScreenStateKey(second)
    );
    expect(previewModeForLine(first, second, false)).toBe("dialogue-only");
  });

  it("promotes assignment identity and display changes to a full preview", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const section = createSection();
    const firstAssignment = createAssignment(
      "assignment-first",
      "line-one",
      "line-two"
    );
    const changedAssignment = {
      ...createAssignment("assignment-second", "line-three", "line-three"),
      display: { ...firstAssignment.display, scale: 0.8 }
    };
    const states = resolveScriptLinePreviewStates({
      script: { sections: [section] },
      templates: new Map([[template.templateId, template]]),
      assignments: [firstAssignment, changedAssignment],
      assets: new Map()
    });

    expect(states.get(previewLineKey(section.id, "line-one"))?.mode).toBe(
      "full-screen"
    );
    expect(states.get(previewLineKey(section.id, "line-two"))?.mode).toBe(
      "full-screen"
    );
    expect(states.get(previewLineKey(section.id, "line-three"))?.mode).toBe(
      "full-screen"
    );
  });

  it("keeps template revision and API contentHash in the persistent key", () => {
    const section = createSection();
    const base = createStandardScreenTemplate(TIMESTAMP);
    const firstTemplate = {
      ...base,
      contentHash: "a".repeat(64)
    };
    const secondTemplate = {
      ...firstTemplate,
      revision: firstTemplate.revision + 1,
      contentHash: "b".repeat(64)
    };
    const first = resolvePersistentScreenState({
      section,
      resolvedTemplate: resolveScriptScreenTemplate(
        section,
        new Map([[base.templateId, firstTemplate]])
      ),
      assignments: [],
      assets: new Map()
    });
    const second = resolvePersistentScreenState({
      section,
      resolvedTemplate: resolveScriptScreenTemplate(
        section,
        new Map([[base.templateId, secondTemplate]])
      ),
      assignments: [],
      assets: new Map()
    });

    expect(first.screenTemplateIdentity).toMatchObject({
      revision: 1,
      contentHash: "a".repeat(64)
    });
    expect(persistentScreenStateKey(first)).not.toBe(
      persistentScreenStateKey(second)
    );
  });
});
