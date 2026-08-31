import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { migrateVideoProjectWithDiagnostics } from "../../src/app/projects/video-project-migration.js";
import { validateVideoProjectScreenTemplateReferences } from "../../src/app/projects/screen-template-selection.js";
import {
  compileRenderManifest,
  compileRenderManifestV24,
  type RenderManifestCompilerInput
} from "../../src/app/rendering/render-manifest-compiler.js";
import { screenTemplateContentHash } from "../../src/app/screen-templates/screen-template-hash.js";
import {
  resolveScreenTemplateLayout,
  resolveVisualDisplay
} from "../../src/screen-layout-resolver.js";
import {
  videoProjectSchema,
  videoProjectV13Schema,
  type AssetDetail,
  type CharacterVisualCatalogSnapshot,
  type ScreenTemplate,
  type VideoProject
} from "../../src/schema/index.js";
import { screenTemplateSchema } from "../../src/schema/screen-template.js";
import {
  assertValidScreenTemplate,
  resolvedScreenLayoutValidationIssues,
  screenTemplateTextValidationIssues,
  screenTemplateValidationReport
} from "../../src/validation/screen-templates.js";
import {
  findScreenTemplateElement,
  moveScreenTemplateElement,
  resizeScreenTemplateElement,
  updateScreenTemplateElementNumericField,
  updateScreenTemplateElementRotation
} from "../../src/web/screen-template-editor.js";
import {
  resolveScriptLineScreenPreview,
  resolveScriptScreenTemplate,
  screenPreviewAssetKey
} from "../../src/web/screen-template-preview.js";
import {
  DEFAULT_SCREEN_LAYOUT_PREVIEW,
  ScreenLayoutFrame,
  type ScreenLayoutPreview
} from "../../src/remotion/screen-template-layout.js";
import { legacyCharacterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";
import {
  ALTERNATE_SCREEN_TEMPLATE_ID,
  createAlternateScreenTemplate,
  createLegacyScreenTemplateProjectFixture,
  createLineOverrideScreenTemplateProjectFixture,
  createScreenTemplateProjectFixture,
  createStandardAndAlternateTemplateSnapshot,
  SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
} from "../fixtures/e2e/screen-template-project.js";

const STANDARD_SCREEN_TEMPLATE_ID = "screen-template-standard";

function diagnosticCodes(result: ReturnType<typeof compileRenderManifest>) {
  return result.success
    ? []
    : result.diagnostics.map((diagnostic) => diagnostic.code);
}

function createCharacterCatalog(): CharacterVisualCatalogSnapshot {
  const visualIds = ["character-mentor", "character-learner"];
  return visualIds.map((visualId) => ({
    visualId,
    name: `${visualId} fixture`,
    description: "",
    status: "active",
    glowColor: visualId === "character-mentor" ? "#e78ac3" : "#75c97a",
    baseWidth: 600,
    baseHeight: 1000,
    variants: legacyCharacterVariantCatalog
      .filter((variant) => variant.characterId === visualId)
      .map((variant) => ({
        variantId: variant.variantId,
        label: variant.label,
        renderType: variant.renderType,
        status: "active" as const,
        tags: [...variant.tags],
        files: variant.files.map((file) => ({
          key: file.key,
          libraryPath: file.destinationPath,
          mimeType: "image/png" as const,
          checksum: "a".repeat(64),
          sizeBytes: 1,
          width: 600,
          height: 1000
        }))
      })),
    createdAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP,
    updatedAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
  }));
}

function createAssetDetail(): AssetDetail {
  return {
    assetId: "asset-application-form",
    version: 1,
    kind: "photo",
    title: "申請フォームのサンプル",
    description: "",
    confidentiality: "internal",
    department: null,
    system: null,
    mimeType: "image/png",
    libraryMediaPath: "library/assets/asset-application-form/form.png",
    checksum: "c".repeat(64),
    sizeBytes: 1,
    width: 1920,
    height: 1080,
    durationMs: null,
    pageCount: null,
    thumbnailPaths: ["library/assets/asset-application-form/thumbnail-0.png"],
    status: "active",
    errorCode: null,
    errorMessage: null,
    createdAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP,
    updatedAt: SCREEN_TEMPLATE_FIXTURE_TIMESTAMP
  };
}

function compileRepresentativeProject(
  project: VideoProject = createScreenTemplateProjectFixture(),
  templates: readonly ScreenTemplate[] = createStandardAndAlternateTemplateSnapshot()
) {
  const input = createRenderManifestInput(project, {
    screenTemplateCatalogSnapshot: templates
  });
  return compileRenderManifest(input);
}

function compileRepresentativeProjectV24(
  project: VideoProject = createScreenTemplateProjectFixture(),
  templates: readonly ScreenTemplate[] = createStandardAndAlternateTemplateSnapshot()
) {
  const input = createRenderManifestInput(project, {
    screenTemplateCatalogSnapshot: templates
  });
  return compileRenderManifestV24(input);
}

describe("ScreenTemplate cross-layer acceptance fixture", () => {
  it("migrates 1.2.0 selections to section-level standard templates", () => {
    const legacy = createLegacyScreenTemplateProjectFixture();
    expect(videoProjectSchema.safeParse(legacy).success).toBe(false);
    const migrated = migrateVideoProjectWithDiagnostics(legacy);

    expect(migrated.migrated).toBe(true);
    const project = videoProjectSchema.parse(migrated.project);
    expect(project.schemaVersion).toBe("1.8.0");
    expect(
      project.script.sections.every(
        (section) => section.screenTemplateId === STANDARD_SCREEN_TEMPLATE_ID
      )
    ).toBe(true);
    for (const line of project.script.sections.flatMap(
      (section) => section.lines
    )) {
      expect(line).not.toHaveProperty("screenTemplateId");
    }
    expect(project.metadata.title).toBe("申請手順の基本");
    expect(
      project.visuals.assignments.map((assignment) => assignment.id)
    ).toEqual([
      "visual-intro-video",
      "visual-main-photo",
      "visual-outro-document"
    ]);
    expect(project.audio.soundEffects).toHaveLength(2);
    expect(project.edit.videoElements).toHaveLength(1);
  });

  it("does not mutate a 1.2.0 project when the prerequisite is missing or inactive", () => {
    const missing = createLegacyScreenTemplateProjectFixture();
    const missingBefore = structuredClone(missing);
    const missingResult = migrateVideoProjectWithDiagnostics(missing, {
      standardTemplateAvailable: false
    });
    expect(missingResult.migrated).toBe(false);
    expect(missingResult.blockedReason).toBe("standard_template_unavailable");
    expect(missingResult.project).toBe(missing);
    expect(missing).toEqual(missingBefore);

    const inactive = createLegacyScreenTemplateProjectFixture();
    const inactiveBefore = structuredClone(inactive);
    const inactiveResult = migrateVideoProjectWithDiagnostics(inactive, {
      screenTemplateCatalog: {
        findById: () => ({ status: "inactive" })
      }
    });
    expect(inactiveResult.migrated).toBe(false);
    expect(inactiveResult.blockedReason).toBe("standard_template_unavailable");
    expect(inactiveResult.project).toBe(inactive);
    expect(inactive).toEqual(inactiveBefore);
  });

  it("migrates the retained 1.3.0 line override fixture to section authority", () => {
    const legacy = createLineOverrideScreenTemplateProjectFixture();
    expect(videoProjectV13Schema.safeParse(legacy).success).toBe(true);

    const migrated = migrateVideoProjectWithDiagnostics(legacy);
    expect(migrated.migrated).toBe(true);
    expect(migrated.logEntries).toHaveLength(1);
    expect(migrated.logEntries[0]).toMatchObject({
      fromSchemaVersion: "1.3.0",
      toSchemaVersion: "1.4.0",
      kind: "removed_line_screen_template_override",
      sectionId: "section-main",
      lineId: "main-learner-1",
      oldLineScreenTemplateId: STANDARD_SCREEN_TEMPLATE_ID,
      effectiveSectionScreenTemplateId: ALTERNATE_SCREEN_TEMPLATE_ID
    });

    const project = videoProjectSchema.parse(migrated.project);
    expect(project.schemaVersion).toBe("1.8.0");
    expect(project.script.sections[1]?.screenTemplateId).toBe(
      ALTERNATE_SCREEN_TEMPLATE_ID
    );
    for (const line of project.script.sections.flatMap(
      (section) => section.lines
    )) {
      expect(line).not.toHaveProperty("screenTemplateId");
    }
  });

  it("keeps editor move/resize/rotate/flip operations valid across save and reload", () => {
    const alternate = createAlternateScreenTemplate();
    const title = findScreenTemplateElement(
      alternate,
      "screen-template-alternate-section-title"
    );
    const content = findScreenTemplateElement(
      alternate,
      "screen-template-alternate-content-slot"
    );
    const speaker = findScreenTemplateElement(
      alternate,
      "screen-template-alternate-character-speaker-2"
    );
    if (title === undefined || content === undefined || speaker === undefined) {
      throw new Error("alternate editor fixture elements are missing");
    }

    let edited = updateScreenTemplateElementNumericField(
      alternate,
      title.elementId,
      "fontSize",
      60
    );
    edited = updateScreenTemplateElementRotation(edited, title.elementId, -6);
    edited = {
      ...edited,
      elements: edited.elements.map((element) =>
        element.elementId === title.elementId
          ? moveScreenTemplateElement(element, 0.01, 0.01)
          : element
      )
    };
    edited = {
      ...edited,
      elements: edited.elements.map((element) =>
        element.elementId === content.elementId
          ? resizeScreenTemplateElement(element, "south-east", 0.015, 0.01)
          : element
      )
    };
    edited = {
      ...edited,
      elements: edited.elements.map((element) =>
        element.elementId === speaker.elementId &&
        element.type === "character-visual"
          ? { ...element, flipX: !element.flipX }
          : element
      )
    };

    expect(screenTemplateValidationReport(edited).errors).toEqual([]);
    const saved = assertValidScreenTemplate({
      ...edited,
      revision: edited.revision + 1,
      updatedAt: "2026-08-19T00:01:00.000Z"
    });
    const reloaded = structuredClone(saved) as ScreenTemplate;
    expect(reloaded.elements).toEqual(saved.elements);
    expect(screenTemplateContentHash(reloaded)).toBe(
      screenTemplateContentHash(saved)
    );
    expect(
      reloaded.elements.find(
        (element) => element.elementId === speaker.elementId
      )
    ).toMatchObject({ flipX: false });
  });

  it("rejects text that cannot fit while keeping normal representative copy valid", () => {
    const alternate = createAlternateScreenTemplate();
    expect(
      screenTemplateTextValidationIssues(alternate, {
        dialogueText: "内容を確認してから登録します。",
        speakerNameText: "ずんだもん",
        sectionTitleText: "申請を登録する"
      })
    ).toEqual([]);

    expect(
      screenTemplateTextValidationIssues(alternate, {
        dialogueText: "字幕".repeat(200),
        speakerNameText: "ずんだもん"
      }).map((issue) => issue.message)
    ).toEqual(expect.arrayContaining([expect.stringContaining("overflow")]));

    const tinyDialogue = screenTemplateSchema.parse({
      ...alternate,
      elements: alternate.elements.map((element) =>
        element.type === "dialogue-window"
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { ...element.transform.rect, height: 0.02 }
              }
            }
          : element
      )
    });
    expect(
      screenTemplateTextValidationIssues(tinyDialogue, {
        dialogueText: "短い字幕",
        speakerNameText: "話者"
      }).map((issue) => issue.message)
    ).toEqual(expect.arrayContaining([expect.stringContaining("padding")]));

    const longTitle = "長いタイトル".repeat(30);
    expect(
      screenTemplateTextValidationIssues(alternate, {
        sectionTitleText: longTitle
      }).map((issue) => issue.message)
    ).toEqual(expect.arrayContaining([expect.stringContaining("overflows")]));
  });

  it("validates section titles for the selected section template", () => {
    const project = createScreenTemplateProjectFixture();
    const alternate = createAlternateScreenTemplate();
    project.script.sections[1]!.screenTemplateId = STANDARD_SCREEN_TEMPLATE_ID;
    project.script.sections[2]!.screenTemplateId = STANDARD_SCREEN_TEMPLATE_ID;
    const narrowTitle = screenTemplateSchema.parse({
      ...alternate,
      templateId: "screen-template-line-title",
      elements: alternate.elements.map((element) =>
        element.type === "section-title"
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { ...element.transform.rect, height: 0.005 }
              }
            }
          : element
      )
    });
    project.script.sections[1]!.screenTemplateId = narrowTitle.templateId;
    const input = createRenderManifestInput(project, {
      screenTemplateCatalogSnapshot: [
        createStandardAndAlternateTemplateSnapshot()[0]!,
        narrowTitle
      ]
    });

    const result = compileRenderManifest(input);
    const titleDiagnostic = result.success
      ? undefined
      : result.diagnostics.find(
          (diagnostic) =>
            diagnostic.code === "SCREEN_TEMPLATE_TEXT_OVERFLOW" &&
            diagnostic.sectionId === "section-main"
        );
    expect(result.success).toBe(false);
    expect(titleDiagnostic).toMatchObject({
      path: ["script", "sections", 1, "name"],
      sectionId: "section-main"
    });
  });

  it("uses one effective template resolver for preview and preserves actual assets", () => {
    const project = createScreenTemplateProjectFixture();
    const main = project.script.sections[1];
    const line = main?.lines[0];
    const assignment = project.visuals.assignments.find(
      (candidate) => candidate.id === "visual-main-photo"
    );
    if (main === undefined || line === undefined || assignment === undefined) {
      throw new Error("preview fixture is incomplete");
    }
    const templates = new Map(
      createStandardAndAlternateTemplateSnapshot().map((template) => [
        template.templateId,
        template
      ])
    );
    const resolved = resolveScriptScreenTemplate(main, templates);
    expect(resolved).toMatchObject({
      status: "ready",
      templateId: ALTERNATE_SCREEN_TEMPLATE_ID
    });

    const preview = resolveScriptLineScreenPreview({
      projectId: project.metadata.id,
      project,
      section: main,
      line,
      catalog: createCharacterCatalog(),
      manifest: {
        characters: [
          { characterId: "character-mentor", glowColor: "#e78ac3" },
          { characterId: "character-learner", glowColor: "#75c97a" }
        ]
      },
      assignments: [assignment],
      assets: new Map([
        [screenPreviewAssetKey(assignment), createAssetDetail()]
      ])
    });
    expect(preview.dialogueText).toBe(line.subtitleText);
    expect(preview.sectionTitleText).toBe(main.name);
    expect(preview.content.src).toContain(
      "/api/assets/asset-application-form/thumbnails/0?version=1"
    );
    expect(preview.characters["speaker-1"]?.src).toContain(
      "/api/character-visuals/character-mentor/"
    );

    const singleImageLine = main.lines[2];
    if (singleImageLine === undefined) {
      throw new Error("single-image line is missing");
    }
    const singleImagePreview = resolveScriptLineScreenPreview({
      projectId: project.metadata.id,
      project,
      section: main,
      line: singleImageLine,
      catalog: createCharacterCatalog(),
      manifest: {
        characters: [
          { characterId: "character-mentor", glowColor: "#e78ac3" },
          { characterId: "character-learner", glowColor: "#75c97a" }
        ]
      },
      assignments: [assignment],
      assets: new Map([
        [screenPreviewAssetKey(assignment), createAssetDetail()]
      ])
    });
    expect(singleImagePreview.characters["speaker-1"]?.src).toContain(
      "character-mentor-stand-v1/single"
    );
  });

  it("compiles one v2.4 manifest for web and MP4 geometry across template boundaries", () => {
    const project = createScreenTemplateProjectFixture();
    const result = compileRepresentativeProjectV24(project);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.manifest.manifestVersion).toBe("2.4.0");
    expect(result.manifest.inserts).toEqual([
      expect.objectContaining({ id: "cutin-confirm", role: "cutin" })
    ]);
    expect(result.manifest.audioTracks).toHaveLength(2);
    expect(result.manifest.soundEffects).toHaveLength(2);

    const main = project.script.sections[1];
    if (main === undefined) {
      throw new Error("main section is missing");
    }
    const mainLines = result.manifest.lines.filter(
      (line) => line.sectionId === main.id
    );
    expect(mainLines.map((line) => line.screenTemplateId)).toEqual([
      ALTERNATE_SCREEN_TEMPLATE_ID,
      ALTERNATE_SCREEN_TEMPLATE_ID,
      ALTERNATE_SCREEN_TEMPLATE_ID
    ]);

    const alternate = createAlternateScreenTemplate();
    const expectedLayout = resolveScreenTemplateLayout(alternate, {
      characterIds: {
        "speaker-1": "character-mentor",
        "speaker-2": "character-learner"
      }
    });
    expect(mainLines[0]?.resolvedLayout).toEqual(expectedLayout);
    expect(
      mainLines[0]?.resolvedLayout.elements.find(
        (element) =>
          element.type === "character-visual" && element.slot === "speaker-2"
      )
    ).toMatchObject({ flipX: true });

    const photoSegments = result.manifest.visuals.filter(
      (visual) => visual.sourceAssignmentId === "visual-main-photo"
    );
    expect(photoSegments.map((segment) => segment.screenTemplateId)).toEqual([
      ALTERNATE_SCREEN_TEMPLATE_ID
    ]);
    expect(photoSegments[0]?.display.contentClip.enabled).toBe(true);
    expect(photoSegments[0]?.display.outerFrame.rotationDeg).toBe(-5);

    const resolvedPhoto = resolveVisualDisplay(
      project.visuals.assignments.find(
        (assignment) => assignment.id === "visual-main-photo"
      )!.display,
      expectedLayout,
      { fps: 30 }
    );
    expect(photoSegments[0]?.display).toMatchObject(resolvedPhoto);
  });

  it("preserves partial character overflow through validation, preview, and manifest compilation", () => {
    const project = createScreenTemplateProjectFixture();
    const standard = createStandardAndAlternateTemplateSnapshot()[0]!;
    const alternate = createAlternateScreenTemplate();
    const overflowTemplate = assertValidScreenTemplate({
      ...alternate,
      elements: alternate.elements.map((element) =>
        element.type === "character-visual" && element.slot === "speaker-1"
          ? {
              ...element,
              transform: {
                rect: { x: -0.06, y: 0.5, width: 0.35, height: 0.5 },
                rotationDeg: 12
              }
            }
          : element
      )
    });
    expect(screenTemplateValidationReport(overflowTemplate).errors).toEqual([]);

    const result = compileRepresentativeProjectV24(project, [
      standard,
      overflowTemplate
    ]);
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const main = project.script.sections[1];
    if (main === undefined) {
      throw new Error("main section is missing");
    }
    const mainLine = result.manifest.lines.find(
      (line) =>
        line.sectionId === main.id &&
        line.screenTemplateId === ALTERNATE_SCREEN_TEMPLATE_ID
    );
    if (mainLine === undefined) {
      throw new Error("overflow line is missing");
    }
    const expectedLayout = resolveScreenTemplateLayout(overflowTemplate, {
      characterIds: {
        "speaker-1": "character-mentor",
        "speaker-2": "character-learner"
      }
    });
    expect(mainLine.resolvedLayout).toEqual(expectedLayout);
    expect(
      mainLine.resolvedLayout.elements.find(
        (element) =>
          element.type === "character-visual" && element.slot === "speaker-1"
      )
    ).toMatchObject({
      transform: { rect: { x: -0.06, width: 0.35 }, rotationDeg: 12 }
    });
    const prioritizedLayout = resolveScreenTemplateLayout(overflowTemplate, {
      characterIds: {
        "speaker-1": "character-mentor",
        "speaker-2": "character-learner"
      },
      prioritizeVisual: true
    });
    const prioritizedCharacter = prioritizedLayout.elements.find(
      (element) =>
        element.type === "character-visual" && element.slot === "speaker-1"
    );
    expect(prioritizedCharacter?.transform.rect.x).toBeCloseTo(-0.011);

    const markup = renderToStaticMarkup(
      createElement(ScreenLayoutFrame, { template: overflowTemplate })
    );
    expect(markup).toContain("screen-layout-frame");
    expect(markup).toContain("left:-6%");
    expect(markup).toContain("rotate(12deg)");

    const fullyOffCanvas = screenTemplateSchema.parse({
      ...overflowTemplate,
      elements: overflowTemplate.elements.map((element) =>
        element.type === "character-visual" && element.slot === "speaker-1"
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { x: -1.2, y: 0.5, width: 0.2, height: 0.5 }
              }
            }
          : element
      )
    });
    const invalidResult = compileRepresentativeProject(project, [
      standard,
      fullyOffCanvas
    ]);
    expect(invalidResult.success).toBe(false);
    expect(
      invalidResult.success
        ? []
        : invalidResult.diagnostics.map((diagnostic) => diagnostic.message)
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("must intersect the canvas")
      ])
    );

    const barelyIntersectingTemplate = assertValidScreenTemplate({
      ...alternate,
      elements: alternate.elements.map((element) =>
        element.type === "character-visual" && element.slot === "speaker-1"
          ? {
              ...element,
              transform: {
                rect: { x: -1, y: 0.58, width: 1.1, height: 0.35 },
                rotationDeg: -4
              }
            }
          : element
      )
    });
    expect(
      screenTemplateValidationReport(barelyIntersectingTemplate).errors
    ).toEqual([]);
    const barelyPrioritizedLayout = resolveScreenTemplateLayout(
      barelyIntersectingTemplate,
      {
        characterIds: {
          "speaker-1": "character-mentor",
          "speaker-2": "character-learner"
        },
        prioritizeVisual: true
      }
    );
    expect(
      barelyPrioritizedLayout.elements.find(
        (element) =>
          element.type === "character-visual" && element.slot === "speaker-1"
      )?.transform.rect.x
    ).toBeCloseTo(-0.846);
    expect(
      resolvedScreenLayoutValidationIssues(barelyPrioritizedLayout)
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "character visual bounds must intersect the canvas"
        })
      ])
    );
    const prioritizedResult = compileRepresentativeProject(project, [
      standard,
      barelyIntersectingTemplate
    ]);
    expect(prioritizedResult.success).toBe(false);
    expect(diagnosticCodes(prioritizedResult)).toContain(
      "RESOLVED_SCREEN_LAYOUT_CHARACTER_MISSING"
    );
  });

  it("fails unresolved or inactive references without falling back to standard", () => {
    const project = createScreenTemplateProjectFixture();
    const missing = compileRepresentativeProject(project, [
      createStandardAndAlternateTemplateSnapshot()[0]!
    ]);
    expect(missing.success).toBe(false);
    expect(diagnosticCodes(missing)).toContain("SCREEN_TEMPLATE_MISSING");

    const inactive = createAlternateScreenTemplate();
    inactive.status = "inactive";
    const inactiveResult = compileRepresentativeProject(project, [
      createStandardAndAlternateTemplateSnapshot()[0]!,
      inactive
    ]);
    expect(inactiveResult.success).toBe(false);
    expect(diagnosticCodes(inactiveResult)).toContain(
      "SCREEN_TEMPLATE_INACTIVE"
    );
    if (!inactiveResult.success) {
      expect(
        inactiveResult.diagnostics.some((diagnostic) =>
          diagnostic.message.includes("inactive")
        )
      ).toBe(true);
    }

    const references = validateVideoProjectScreenTemplateReferences(project, {
      findById: (templateId) =>
        templateId === ALTERNATE_SCREEN_TEMPLATE_ID
          ? { status: "inactive" }
          : templateId === STANDARD_SCREEN_TEMPLATE_ID
            ? { status: "active" }
            : undefined
    });
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateId: ALTERNATE_SCREEN_TEMPLATE_ID,
          reason: "inactive"
        })
      ])
    );

    const duplicate = createAlternateScreenTemplate();
    const duplicateResult = compileRepresentativeProject(project, [
      createStandardAndAlternateTemplateSnapshot()[0]!,
      createStandardAndAlternateTemplateSnapshot()[1]!,
      duplicate
    ]);
    expect(duplicateResult.success).toBe(false);
    expect(diagnosticCodes(duplicateResult)).toContain(
      "SCREEN_TEMPLATE_SNAPSHOT_INVALID"
    );
  });

  it("keeps editor/card/production geometry tied to the same resolved layout", () => {
    const template = createAlternateScreenTemplate();
    const preview: ScreenLayoutPreview = {
      characters: {
        "speaker-2": {
          alt: "学習者",
          src: "/character-learner.png"
        }
      },
      content: {
        alt: "generic photo",
        src: "/generic-photo.png",
        display: {
          fit: "contain",
          crop: { x: 0, y: 0, width: 1, height: 1 },
          scale: 1,
          position: { x: 0.5, y: 0.5 },
          prioritizeVisual: false,
          displayCoordinateSpace: "content-slot-relative",
          annotations: []
        }
      },
      dialogueText: "字幕",
      speakerNameText: "話者",
      sectionTitleText: "タイトル"
    };
    const markup = renderToStaticMarkup(
      createElement(ScreenLayoutFrame, { preview, template })
    );
    expect(markup).toContain("/generic-photo.png");
    expect(markup).toContain("/character-learner.png");
    expect(markup).toContain("scaleX(-1)");
    expect(markup).toContain("rotate(-5deg)");
    expect(markup).toContain("rotate(7deg)");
    expect(markup).toContain("padding:0 1.25cqw");
    expect(markup).toContain("padding:0.8333333333333334cqw 1.5625cqw");
    expect(markup).toContain("background-color:rgba(0, 0, 0, 0.4)");
    expect(markup).toContain("justify-content:center");
    expect(markup).toContain("text-align:center");
    expect(markup).toContain(
      "text-shadow:0 0 0.3125cqw #ffffff, 0 0 0.7291666666666666cqw #ffffff"
    );
    expect(markup).toContain("border:none");
    expect(markup).toContain("border-radius:0.8333333333333334cqw");
    expect(markup).toContain("box-shadow:none");
    expect(markup).not.toContain(">話者</span>");
    expect(markup).not.toContain(">話者名</span>");
    expect(markup).not.toContain("margin-bottom:0.20833333333333334cqw");
  });

  it("keeps the dialogue window visible when the preview text is empty", () => {
    const template = createAlternateScreenTemplate();
    const markup = renderToStaticMarkup(
      createElement(ScreenLayoutFrame, {
        preview: {
          ...DEFAULT_SCREEN_LAYOUT_PREVIEW,
          dialogueText: ""
        },
        template
      })
    );

    expect(markup).toContain("screen-layout-dialogue-card");
    expect(markup).toContain("background-color:rgba(0, 0, 0, 0.4)");
    expect(markup).not.toContain("ここにサンプルセリフが表示されます。");
  });

  it("rejects ScreenTemplate subtitles that overflow at the template font size", () => {
    const project = createScreenTemplateProjectFixture();
    project.script.sections[1]!.lines[0]!.subtitleText = "字幕".repeat(200);
    const input: RenderManifestCompilerInput = createRenderManifestInput(
      project,
      {
        screenTemplateCatalogSnapshot:
          createStandardAndAlternateTemplateSnapshot()
      }
    );
    const result = compileRenderManifest(input);
    const diagnostic = result.success
      ? undefined
      : result.diagnostics.find(
          (candidate) =>
            candidate.code === "SCREEN_TEMPLATE_TEXT_OVERFLOW" &&
            candidate.lineId === "main-mentor-1"
        );
    expect(result.success).toBe(false);
    expect(diagnostic).toMatchObject({
      path: ["script", "sections", 1, "lines", 0, "subtitleText"],
      sectionId: "section-main",
      lineId: "main-mentor-1"
    });
  });
});
