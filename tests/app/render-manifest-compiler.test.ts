import { describe, expect, it } from "vitest";

import { legacyCharacterVariantCatalog as characterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  characterVariantMapping,
  CHARACTER_VARIANT_CATALOG_VERSION,
  CHARACTER_VARIANT_MAPPING_VERSION
} from "../../src/assets/character-asset-manifest.js";
import {
  compileRenderManifest,
  compileRenderManifestV24,
  compileRenderManifestV25,
  serializeRenderManifest,
  type RenderManifestAssetMetadata,
  type RenderManifestCompileResult
} from "../../src/app/rendering/render-manifest-compiler.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import {
  EDIT_VIDEO_PLAYBACK_RATE_OPTIONS,
  type RenderVisual,
  type VideoProject
} from "../../src/schema/index.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";
import { characterVisualCatalogSnapshotSchema } from "../../src/schema/character-visual.js";
import { mediaMillisecondsToFrames } from "../../src/media-frame.js";
import {
  screenTemplateContentHash,
  screenTemplateLegacyContentHash
} from "../../src/app/screen-templates/screen-template-hash.js";

const validInput = createRenderManifestInput;

function diagnosticCodes<T>(result: RenderManifestCompileResult<T>) {
  if (result.success) {
    return [];
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function inputWithOrphanAudioEntry(): ReturnType<typeof validInput> {
  const input = validInput();
  const audioIndex = input.audioIndex as VoicevoxAudioIndex;
  const sourceEntry = audioIndex["intro-learner-1"];
  if (sourceEntry === undefined) {
    throw new Error("fixture audio entry is missing");
  }
  const orphanLineId = "deleted-line-b";
  return {
    ...input,
    audioIndex: {
      ...audioIndex,
      [orphanLineId]: {
        ...sourceEntry,
        lineId: orphanLineId,
        audioPath: `audio/voice/${orphanLineId}.wav`,
        queryPath: `cache/voicevox-query/${orphanLineId}.json`
      }
    }
  };
}

function snapshotCatalogInput(input: ReturnType<typeof validInput>): {
  readonly catalog: unknown;
  readonly assetMetadata: readonly RenderManifestAssetMetadata[];
} {
  const characterFiles = characterVariantCatalog.flatMap((variant) =>
    variant.files.map((file) => ({ variant, file }))
  );
  const assetsByPath = new Map<string, RenderManifestAssetMetadata>(
    (input.assetMetadata as readonly RenderManifestAssetMetadata[]).map(
      (asset) => [asset.path, asset]
    )
  );
  const libraryPathByLegacyPath = new Map<string, string>(
    characterFiles.map(({ variant, file }) => [
      file.destinationPath,
      `library/character-visuals/${variant.characterId}/${variant.variantId}/${file.key}.png`
    ])
  );
  const catalog = characterVisualCatalogSnapshotSchema.parse(
    [
      ...new Set(characterVariantCatalog.map((variant) => variant.characterId))
    ].map((visualId) => ({
      visualId,
      name: visualId,
      description: "",
      status: "active",
      baseWidth: 600,
      baseHeight: 1000,
      variants: characterVariantCatalog
        .filter((variant) => variant.characterId === visualId)
        .map((variant) => ({
          variantId: variant.variantId,
          label: variant.label,
          renderType: variant.renderType,
          status: "active",
          tags: [...variant.tags],
          files: variant.files.map((file) => ({
            key: file.key,
            libraryPath: libraryPathByLegacyPath.get(file.destinationPath),
            mimeType: "image/png",
            checksum: assetsByPath.get(file.destinationPath)?.sha256,
            sizeBytes: 0,
            width: 600,
            height: 1000
          }))
        })),
      createdAt: "2026-08-15T00:00:00.000Z",
      updatedAt: "2026-08-15T00:00:00.000Z"
    }))
  );
  const assetMetadata = (
    input.assetMetadata as readonly RenderManifestAssetMetadata[]
  ).map((asset) => {
    const libraryPath = libraryPathByLegacyPath.get(asset.path);
    return libraryPath === undefined ? asset : { ...asset, path: libraryPath };
  });
  return { catalog, assetMetadata };
}

function compileTemplateBoundaryVideoSegments(playbackRate: number) {
  const project = structuredClone(videoProjectFixture) as VideoProject;
  const introSection = project.script.sections[0];
  if (introSection === undefined || introSection.lines[0] === undefined) {
    throw new Error("intro fixture lines are missing");
  }
  const secondLine = introSection.lines[1];
  if (secondLine === undefined) {
    throw new Error("intro fixture second line is missing");
  }
  const thirdLine = {
    ...secondLine,
    id: "intro-learner-2"
  };
  introSection.lines = [...introSection.lines, thirdLine];

  // 66 ms rounds up to two 30 fps timeline frames. Removing the fixture's
  // pauses makes the next template boundaries land at frames 2 and 32.
  introSection.lines[0]!.pauseAfterMs = 0;
  introSection.lines[1]!.pauseBeforeMs = 0;
  introSection.lines[1]!.pauseAfterMs = 0;

  const assignment = project.visuals.assignments[0];
  if (assignment === undefined || assignment.display.kind !== "video") {
    throw new Error("intro visual assignment must be a video");
  }
  assignment.endLineId = thirdLine.id;
  assignment.display.playbackRate = playbackRate;

  const baseInput = createRenderManifestInput(project);
  const firstAudio = (baseInput.audioIndex as VoicevoxAudioIndex)[
    introSection.lines[0]!.id
  ];
  if (firstAudio === undefined) {
    throw new Error("first line audio is missing");
  }
  const audioIndex = {
    ...(baseInput.audioIndex as VoicevoxAudioIndex),
    [firstAudio.lineId]: { ...firstAudio, durationMs: 66 }
  } satisfies VoicevoxAudioIndex;
  const assetMetadata = (
    baseInput.assetMetadata as readonly RenderManifestAssetMetadata[]
  ).map((asset) =>
    asset.path === firstAudio.audioPath ? { ...asset, durationMs: 66 } : asset
  );
  const result = compileRenderManifest(
    createRenderManifestInput(project, {
      audioIndex,
      assetMetadata,
      screenTemplateCatalogSnapshot: [
        createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
      ]
    })
  );
  if (!result.success) {
    throw new Error(
      result.diagnostics.map((diagnostic) => diagnostic.message).join("; ")
    );
  }

  const videoSegments = result.manifest.visuals.filter(
    (visual): visual is Extract<RenderVisual, { kind: "video" }> =>
      visual.sourceAssignmentId === assignment.id && visual.kind === "video"
  );
  return { manifest: result.manifest, videoSegments };
}

describe("compileRenderManifest", () => {
  it("ignores orphan audio entries in the manifest and compiler input hash", () => {
    const input = validInput();
    const withOrphan = inputWithOrphanAudioEntry();
    const orphanResult = compileRenderManifest(withOrphan);

    expect(orphanResult.success).toBe(true);
    expect(diagnosticCodes(orphanResult)).not.toContain(
      "AUDIO_INDEX_ENTRY_EXTRA"
    );
    if (!orphanResult.success) {
      return;
    }
    expect(orphanResult.manifest.lines.map((line) => line.id)).not.toContain(
      "deleted-line-b"
    );

    const orphanAudioIndex = withOrphan.audioIndex as VoicevoxAudioIndex;
    const orphanEntry = orphanAudioIndex["deleted-line-b"];
    if (orphanEntry === undefined) {
      throw new Error("orphan audio entry is missing");
    }
    const changedOrphan = compileRenderManifest({
      ...withOrphan,
      audioIndex: {
        ...orphanAudioIndex,
        "deleted-line-b": {
          ...orphanEntry,
          audioPath: "audio/voice/deleted-line-b-v2.wav",
          queryPath: "cache/voicevox-query/deleted-line-b-v2.json"
        }
      }
    });

    expect(changedOrphan.success).toBe(true);
    if (!changedOrphan.success) {
      return;
    }
    expect(changedOrphan.manifest.compilerInputHash).toBe(
      orphanResult.manifest.compilerInputHash
    );

    const currentEntry = (input.audioIndex as VoicevoxAudioIndex)[
      "intro-learner-1"
    ];
    if (currentEntry === undefined) {
      throw new Error("current audio entry is missing");
    }
    const changedCurrent = compileRenderManifest({
      ...input,
      audioIndex: {
        ...(input.audioIndex as VoicevoxAudioIndex),
        "intro-learner-1": {
          ...currentEntry,
          cacheKey: "c".repeat(64)
        }
      }
    });

    expect(changedCurrent.success).toBe(true);
    if (!changedCurrent.success) {
      return;
    }
    expect(changedCurrent.manifest.compilerInputHash).not.toBe(
      orphanResult.manifest.compilerInputHash
    );
  });

  it("ignores malformed orphan audio entries", () => {
    const input = inputWithOrphanAudioEntry();
    const audioIndex = {
      ...(input.audioIndex as VoicevoxAudioIndex),
      "deleted-line-b": {
        lineId: "deleted-line-b"
      }
    };

    const result = compileRenderManifest({ ...input, audioIndex });

    expect(result.success).toBe(true);
  });

  it("keeps current-line audio validation with orphan entries present", () => {
    const input = inputWithOrphanAudioEntry();
    const audioIndex = { ...(input.audioIndex as VoicevoxAudioIndex) };
    delete audioIndex["intro-learner-1"];

    const result = compileRenderManifest({ ...input, audioIndex });

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("AUDIO_INDEX_ENTRY_MISSING");
    expect(diagnosticCodes(result)).not.toContain("AUDIO_INDEX_ENTRY_EXTRA");
  });

  it("validates the checksum carried by a SQLite catalog snapshot", () => {
    const input = validInput();
    const snapshot = snapshotCatalogInput(input);
    const brokenCatalog = structuredClone(snapshot.catalog) as Array<{
      variants: Array<{ files: Array<{ checksum: string }> }>;
    }>;
    const firstFile = brokenCatalog[0]?.variants[0]?.files[0];
    if (firstFile === undefined) {
      throw new Error("The snapshot fixture has no character file.");
    }
    firstFile.checksum = "d".repeat(64);

    const result = compileRenderManifest({
      ...input,
      characterVariantCatalog: brokenCatalog,
      assetMetadata: snapshot.assetMetadata
    });

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain(
      "CHARACTER_VARIANT_FILE_CHECKSUM_MISMATCH"
    );
  });

  it("rejects compilation when the runtime catalog snapshot is not injected", () => {
    const input = { ...validInput() };
    Reflect.deleteProperty(input, "characterVariantCatalog");
    const result = compileRenderManifest(input);

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("CHARACTER_CATALOG_INVALID");
  });

  it("returns a structured failure when the screen-template snapshot is missing", () => {
    const input = validInput();
    Reflect.deleteProperty(input, "screenTemplateCatalogSnapshot");

    expect(() => compileRenderManifest(input)).not.toThrow();
    const result = compileRenderManifest(input);

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("SCREEN_TEMPLATE_MISSING");
  });

  it("returns a structured failure before layout resolution for invalid templates", () => {
    const invalidTemplate = createStandardScreenTemplate(
      "2026-08-10T00:00:00.000Z"
    );
    invalidTemplate.elements = invalidTemplate.elements.filter(
      (element) => element.type !== "content-slot"
    );

    expect(() =>
      compileRenderManifest(
        validInput(undefined, {
          screenTemplateCatalogSnapshot: [invalidTemplate]
        })
      )
    ).not.toThrow();
    const result = compileRenderManifest(
      validInput(undefined, {
        screenTemplateCatalogSnapshot: [invalidTemplate]
      })
    );

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain(
      "SCREEN_TEMPLATE_CARDINALITY_INVALID"
    );
  });

  it("keeps the frozen 2.4 compiler unable to represent non-empty playback cues", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const assignment = project.visuals.assignments[0];
    if (assignment === undefined || assignment.display.kind !== "video") {
      throw new Error("video fixture assignment is missing");
    }
    assignment.display.playbackCues = [
      { lineId: "intro-mentor-1", edge: "after", action: "pause" },
      { lineId: "intro-learner-1", edge: "after", action: "resume" }
    ];

    const result = compileRenderManifestV24(validInput(project));

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain(
      "VISUAL_PLAYBACK_CUES_UNSUPPORTED"
    );
    if (!result.success) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["visuals", "assignments", 0, "display", "playbackCues"],
            assignmentId: assignment.id
          })
        ])
      );
    }
  });

  it("resolves pause and resume cues into source-continuous V25 segments", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const section = project.script.sections[0];
    const assignment = project.visuals.assignments[0];
    const firstLine = section?.lines[0];
    const secondLine = section?.lines[1];
    const thirdLine =
      secondLine === undefined
        ? undefined
        : { ...secondLine, id: "intro-learner-2" };
    if (
      section === undefined ||
      assignment?.display.kind !== "video" ||
      firstLine === undefined ||
      secondLine === undefined ||
      thirdLine === undefined
    ) {
      throw new Error("cue fixture is incomplete");
    }
    section.lines = [...section.lines, thirdLine];
    assignment.endLineId = thirdLine.id;
    assignment.display.playbackCues = [
      { lineId: firstLine.id, edge: "after", action: "pause" },
      { lineId: thirdLine.id, edge: "before", action: "resume" }
    ];

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const segments = result.manifest.visuals.filter(
      (visual) => visual.sourceAssignmentId === assignment.id
    );
    expect(result.manifest.manifestVersion).toBe("2.9.0");
    expect(
      segments.map((segment) =>
        segment.kind === "video" ? segment.display.playbackState : segment.kind
      )
    ).toEqual(["playing", "paused", "playing"]);
    const paused = segments[1];
    const resumed = segments[2];
    if (
      paused?.kind !== "video" ||
      resumed?.kind !== "video" ||
      paused.display.playbackState !== "paused" ||
      resumed.display.playbackState !== "playing"
    ) {
      throw new Error("pause/resume segments were not resolved");
    }
    expect(paused.display.volume).toBe(0);
    expect(paused.display.sourceFrame).toBe(
      resumed.display.sourceTrimBeforeFrame
    );
    expect(paused.display.playbackCues).toEqual(
      assignment.display.playbackCues
    );
    expect(resumed.display.sourceTrimAfterFrame).toBeGreaterThan(
      resumed.display.sourceTrimBeforeFrame
    );
  });

  it("rejects cues that occur after the implicit natural source end", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const section = project.script.sections[0];
    const assignment = project.visuals.assignments[0];
    const secondLine = section?.lines[1];
    if (assignment?.display.kind !== "video" || secondLine === undefined) {
      throw new Error("source-end cue fixture is incomplete");
    }
    assignment.display.endMs = 500;
    assignment.display.playbackCues = [
      { lineId: secondLine.id, edge: "before", action: "pause" }
    ];

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("VISUAL_PLAYBACK_CUE_INVALID");
  });

  it("keeps prioritizeVisual geometry inside its assignment line interval", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const section = project.script.sections[0];
    const assignment = project.visuals.assignments[0];
    const firstLine = section?.lines[0];
    const secondLine = section?.lines[1];
    if (
      section === undefined ||
      assignment?.display.kind !== "video" ||
      firstLine === undefined ||
      secondLine === undefined
    ) {
      throw new Error("priority layout fixture is incomplete");
    }

    const thirdLine = { ...secondLine, id: "intro-learner-2" };
    const fourthLine = { ...secondLine, id: "intro-learner-3" };
    section.lines = [firstLine, secondLine, thirdLine, fourthLine];
    assignment.startLineId = secondLine.id;
    assignment.endLineId = thirdLine.id;
    assignment.display.prioritizeVisual = true;

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    const widthForLine = (lineId: string): number | undefined => {
      const line = result.manifest.lines.find(
        (candidate) => candidate.id === lineId
      );
      if (line === undefined) {
        return undefined;
      }
      const interval = result.manifest.layoutIntervals.find(
        (candidate) =>
          candidate.sectionId === line.sectionId &&
          candidate.from === line.from &&
          candidate.durationInFrames === line.durationInFrames
      );
      return interval?.resolvedLayout.elements.find(
        (element) =>
          element.type === "character-visual" && element.slot === "speaker-1"
      )?.transform.rect.width;
    };

    expect(widthForLine(firstLine.id)).toBeCloseTo(0.25);
    expect(widthForLine(secondLine.id)).toBeCloseTo(0.25 * 0.72);
    expect(widthForLine(thirdLine.id)).toBeCloseTo(0.25 * 0.72);
    expect(widthForLine(fourthLine.id)).toBeCloseTo(0.25);
    expect(
      result.manifest.sectionLayouts
        .find((layout) => layout.sectionId === section.id)
        ?.resolvedLayout.elements.find(
          (element) =>
            element.type === "character-visual" && element.slot === "speaker-1"
        )?.transform.rect.width
    ).toBeCloseTo(0.25);
  });

  it("resolves explicit character selections and compiles all timeline inputs", () => {
    const result = compileRenderManifest(validInput());

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.manifest.manifestVersion).toBe("2.9.0");
    expect(result.manifest.characterCatalogVersion).toBe(
      CHARACTER_VARIANT_CATALOG_VERSION
    );
    expect(result.manifest.characterMappingVersion).toBe(
      CHARACTER_VARIANT_MAPPING_VERSION
    );
    expect(result.manifest.characters).toEqual([
      {
        characterId: "character-mentor",
        visualId: "character-mentor",
        displayName: "四国めたん",
        themeColorToken: "character.metan",
        glowColor: "#ffffff",
        lipSyncPeriodFrames: 3,
        idleVariantId: "character-mentor-stand-v1"
      },
      {
        characterId: "character-learner",
        visualId: "character-learner",
        displayName: "ずんだもん",
        themeColorToken: "character.zundamon",
        glowColor: "#ffffff",
        lipSyncPeriodFrames: 3,
        idleVariantId: "character-learner-stand-v1"
      }
    ]);
    expect(
      result.manifest.characterVariants.map(({ variantId }) => variantId)
    ).toEqual([
      "character-learner-speak-normal-v1",
      "character-learner-speak-pointing-v1",
      "character-learner-stand-v1",
      "character-mentor-speak-normal-v1",
      "character-mentor-speak-pointing-v1",
      "character-mentor-stand-v1"
    ]);
    expect(
      result.manifest.lines.map((line) => line.characterVariantId)
    ).toEqual([
      "character-mentor-speak-pointing-v1",
      "character-learner-speak-normal-v1",
      "character-mentor-speak-pointing-v1",
      "character-learner-speak-pointing-v1",
      "character-mentor-speak-normal-v1"
    ]);

    const normalMentor = result.manifest.characterVariants.find(
      ({ variantId }) => variantId === "character-mentor-speak-normal-v1"
    );
    expect(normalMentor).toMatchObject({
      renderType: "mouth-pair",
      files: {
        closed: {
          path: expect.stringContaining("closed.png"),
          sha256: expect.any(String)
        },
        open: {
          path: expect.stringContaining("open.png"),
          sha256: expect.any(String)
        }
      }
    });
    expect(
      result.manifest.characterVariants.find(
        ({ variantId }) => variantId === "character-mentor-stand-v1"
      )
    ).toMatchObject({
      renderType: "single-image",
      files: { single: { path: expect.stringContaining("stand.png") } }
    });

    expect(result.manifest.inserts).toEqual([]);
    expect(
      result.manifest.lines.map(({ from, durationInFrames }) => [
        from,
        durationInFrames
      ])
    ).toEqual([
      [0, 38],
      [38, 41],
      [79, 38],
      [117, 38],
      [155, 38]
    ]);
    expect(result.manifest.durationInFrames).toBe(193);
    expect(result.manifest.visuals[0]?.display).toMatchObject({
      kind: "video",
      volume: 0
    });
    expect(result.manifest.soundEffects[0]).toMatchObject({
      lineId: "main-learner-1",
      from: 120,
      durationInFrames: 12
    });
    const mainLearnerLine = result.manifest.lines.find(
      (line) => line.id === "main-learner-1"
    );
    if (mainLearnerLine === undefined) {
      throw new Error("main learner line is missing");
    }
    expect(result.manifest.soundEffects[0]?.from).toBe(
      mainLearnerLine.from +
        mainLearnerLine.speechFrom +
        Math.ceil((100 / 1000) * result.manifest.fps)
    );
    expect(
      result.manifest.audioTracks.map(
        ({ sectionId, from, durationInFrames, volume, loop }) => [
          sectionId,
          from,
          durationInFrames,
          volume,
          loop
        ]
      )
    ).toEqual([
      ["section-intro", 0, 79, 0.25, true],
      ["section-main", 79, 76, 0.2, true]
    ]);
    const insertRanges = result.manifest.inserts.map((insert) => ({
      from: insert.from,
      to: insert.from + insert.durationInFrames
    }));
    for (const range of [
      ...result.manifest.audioTracks,
      ...result.manifest.soundEffects
    ]) {
      expect(
        insertRanges.some(
          (insert) =>
            range.from < insert.to &&
            insert.from < range.from + range.durationInFrames
        )
      ).toBe(false);
    }
    expect(result.manifest.durationInFrames).toBe(
      Math.max(
        ...result.manifest.lines.map(
          (line) => line.from + line.durationInFrames
        )
      )
    );
    expect(result.warnings).toEqual([]);
    expect(
      result.manifest.sourceAssetChecksums.map(({ path }) => path)
    ).toEqual(
      [...result.manifest.sourceAssetChecksums]
        .map(({ path }) => path)
        .sort((left, right) => left.localeCompare(right))
    );
  });

  it("takes subtitle glow colors from the selected visual snapshot", () => {
    const input = validInput();
    const snapshot = snapshotCatalogInput(input);
    const catalog = characterVisualCatalogSnapshotSchema
      .parse(snapshot.catalog)
      .map((visual) => ({
        ...visual,
        glowColor:
          visual.visualId === "character-mentor" ? "#102030" : "#405060"
      }));

    const result = compileRenderManifest({
      ...input,
      characterVariantCatalog: catalog,
      assetMetadata: snapshot.assetMetadata
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(
      result.manifest.characters.map((character) => ({
        visualId: character.visualId,
        glowColor: character.glowColor
      }))
    ).toEqual([
      { visualId: "character-mentor", glowColor: "#102030" },
      { visualId: "character-learner", glowColor: "#405060" }
    ]);
  });

  it("keeps RF-01 fields out of the V24 and V25 cache identity", () => {
    const input = validInput();
    const snapshot = snapshotCatalogInput(input);
    const baseCatalog = characterVisualCatalogSnapshotSchema.parse(
      snapshot.catalog
    );
    const changedCatalog = baseCatalog.map((visual) => ({
      ...visual,
      glowColor: visual.visualId === "character-mentor" ? "#102030" : "#405060"
    }));
    const baseTemplates = [
      createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
    ];
    const changedColorTemplates = baseTemplates.map((template) => ({
      ...template,
      elements: template.elements.map((element) =>
        element.type === "dialogue-window"
          ? {
              ...element,
              backgroundColor: "#123456"
            }
          : element
      )
    }));
    const changedOpacityTemplates = baseTemplates.map((template) => ({
      ...template,
      elements: template.elements.map((element) =>
        element.type === "dialogue-window"
          ? {
              ...element,
              backgroundOpacity: 0.7
            }
          : element
      )
    }));
    const createInput = (
      catalog: typeof baseCatalog,
      templates: typeof baseTemplates
    ) => ({
      ...input,
      characterVariantCatalog: catalog,
      assetMetadata: snapshot.assetMetadata,
      screenTemplateCatalogSnapshot: templates
    });

    const baseInput = createInput(baseCatalog, baseTemplates);
    const v24Base = compileRenderManifestV24(baseInput);
    const v25Base = compileRenderManifestV25(baseInput);
    const v26Base = compileRenderManifest(baseInput);

    expect(v24Base.success).toBe(true);
    expect(v25Base.success).toBe(true);
    expect(v26Base.success).toBe(true);
    if (!v24Base.success || !v25Base.success || !v26Base.success) {
      return;
    }

    const baseTemplate = baseTemplates[0]!;
    expect(v24Base.manifest.sectionLayouts[0]?.templateHash).toBe(
      screenTemplateLegacyContentHash(baseTemplate)
    );
    expect(v26Base.manifest.sectionLayouts[0]?.templateHash).toBe(
      screenTemplateContentHash(baseTemplate)
    );

    const variants = [
      { catalog: changedCatalog, templates: baseTemplates },
      { catalog: baseCatalog, templates: changedColorTemplates },
      { catalog: baseCatalog, templates: changedOpacityTemplates }
    ];
    for (const variant of variants) {
      const changedInput = createInput(variant.catalog, variant.templates);
      const v24Changed = compileRenderManifestV24(changedInput);
      const v25Changed = compileRenderManifestV25(changedInput);
      const v26Changed = compileRenderManifest(changedInput);

      expect(v24Changed.success).toBe(true);
      expect(v25Changed.success).toBe(true);
      expect(v26Changed.success).toBe(true);
      if (!v24Changed.success || !v25Changed.success || !v26Changed.success) {
        return;
      }

      const changedTemplate = variant.templates[0]!;
      expect(v24Changed.manifest.compilerInputHash).toBe(
        v24Base.manifest.compilerInputHash
      );
      expect(v25Changed.manifest.compilerInputHash).toBe(
        v25Base.manifest.compilerInputHash
      );
      expect(v26Changed.manifest.compilerInputHash).not.toBe(
        v26Base.manifest.compilerInputHash
      );
      expect(v24Changed.manifest.sectionLayouts[0]?.templateHash).toBe(
        screenTemplateLegacyContentHash(changedTemplate)
      );
      expect(v25Changed.manifest.sectionLayouts[0]?.templateHash).toBe(
        screenTemplateLegacyContentHash(changedTemplate)
      );
      expect(v26Changed.manifest.sectionLayouts[0]?.templateHash).toBe(
        screenTemplateContentHash(changedTemplate)
      );
    }
  });

  it("adds source-end boundaries without using line-template differences", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const introSection = project.script.sections[0];
    if (introSection === undefined || introSection.lines[1] === undefined) {
      throw new Error("intro fixture lines are missing");
    }
    const thirdLine = {
      ...introSection.lines[1],
      id: "intro-learner-2"
    };
    introSection.lines = [...introSection.lines, thirdLine];

    const assignment = project.visuals.assignments[0];
    if (assignment === undefined) {
      throw new Error("intro visual assignment is missing");
    }
    if (assignment.display.kind !== "video") {
      throw new Error("intro visual assignment must be a video");
    }
    const sourcePlaybackRate = assignment.display.playbackRate;
    assignment.endLineId = thirdLine.id;

    const result = compileRenderManifest(createRenderManifestInput(project));

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const segments = result.manifest.visuals.filter(
      (visual) => visual.sourceAssignmentId === assignment.id
    );
    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]).toMatchObject({
      segmentIndex: 0,
      segmentStartLineId: introSection.lines[0]!.id,
      sectionId: introSection.id
    });

    const visual = segments[0];
    if (
      visual?.kind !== "video" ||
      visual.display.kind !== "video" ||
      visual.display.playbackState !== "playing"
    ) {
      throw new Error("fixture visual must remain a video");
    }
    expect(visual.display.playbackState).toBe("playing");
    expect(visual.display.sourceTrimBeforeFrame).toBe(0);
    expect(visual.display.sourceTrimAfterFrame).toBeGreaterThan(
      visual.display.sourceTrimBeforeFrame
    );
    expect(visual.display.playbackRate).toBe(sourcePlaybackRate);
  });

  it("preserves arbitrary millisecond trim points for an unsplit video", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const assignment = project.visuals.assignments[0];
    if (assignment === undefined || assignment.display.kind !== "video") {
      throw new Error("intro visual assignment must be a video");
    }
    assignment.display.startMs = 110;
    assignment.display.endMs = 1_101;

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const visual = result.manifest.visuals.find(
      (candidate) => candidate.sourceAssignmentId === assignment.id
    );
    if (
      visual?.display.kind !== "video" ||
      visual.display.playbackState !== "playing"
    ) {
      throw new Error("compiled visual must be a video");
    }

    expect(visual.display.startMs).toBe(110);
    expect(visual.display.endMs).toBe(1_101);
    expect(visual.display.sourceTrimBeforeFrame).toBe(4);
    expect(visual.display.sourceTrimAfterFrame).toBe(34);
    expect(mediaMillisecondsToFrames(visual.display.startMs, 30)).toBe(4);
    expect(mediaMillisecondsToFrames(visual.display.endMs, 30)).toBe(34);
  });

  it("keeps the unsplit video source range at 1x playback", () => {
    const { videoSegments } = compileTemplateBoundaryVideoSegments(1);
    expect(videoSegments).toHaveLength(1);

    const firstDisplay = videoSegments[0]!.display;
    if (firstDisplay.playbackState !== "playing") {
      throw new Error("fixture video segment must be playing");
    }
    const sourceStartFrame = firstDisplay.sourceTrimBeforeFrame;
    expect(
      videoSegments.map((segment) => {
        if (segment.display.playbackState !== "playing") {
          throw new Error("fixture video segment must be playing");
        }
        return segment.display.sourceTrimBeforeFrame;
      })
    ).toEqual([sourceStartFrame]);
    expect(firstDisplay.sourceTrimAfterFrame).toBeGreaterThan(sourceStartFrame);
    expect(videoSegments[0]!.display.startMs).toBe(0);
    expect(videoSegments[0]!.display.endMs).toBe(3_000);
  });

  it("splits a non-1 playback-rate video at natural source end", () => {
    const { videoSegments } = compileTemplateBoundaryVideoSegments(1.25);
    const playingSegment = videoSegments.find(
      (segment) => segment.display.playbackState === "playing"
    );
    const endedSegment = videoSegments.find(
      (segment) => segment.display.playbackState === "ended"
    );

    expect(playingSegment).toBeDefined();
    expect(endedSegment).toBeDefined();
    if (
      playingSegment?.display.playbackState !== "playing" ||
      endedSegment?.display.playbackState !== "ended"
    ) {
      return;
    }
    expect(playingSegment.display.sourceTrimBeforeFrame).toBe(0);
    expect(playingSegment.display.sourceTrimAfterFrame).toBeGreaterThan(0);
    expect(endedSegment.display.sourceFrame).toBe(89);
    expect(endedSegment.display.volume).toBe(0);
    expect(playingSegment.display.startMs).toBe(0);
    expect(playingSegment.display.endMs).toBe(3_000);
  });

  it("accepts a positive fractional source range below one frame", () => {
    const { videoSegments } = compileTemplateBoundaryVideoSegments(0.2);
    const firstDisplay = videoSegments[0]!.display;
    if (firstDisplay.playbackState !== "playing") {
      throw new Error("fixture video segment must be playing");
    }

    expect(firstDisplay.sourceTrimBeforeFrame).toBe(0);
    expect(firstDisplay.sourceTrimAfterFrame).toBeCloseTo(14.6);
    expect(videoSegments).toHaveLength(1);
    expect(videoSegments[0]!.display.startMs).toBe(0);
    expect(videoSegments[0]!.display.endMs).toBe(3_000);
  });

  it("keeps a fractional source end for a final short video segment", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const introSection = project.script.sections[0];
    const assignment = project.visuals.assignments[0];
    const firstLine = introSection?.lines[0];
    if (
      introSection === undefined ||
      firstLine === undefined ||
      assignment === undefined ||
      assignment.display.kind !== "video"
    ) {
      throw new Error("intro fixture video assignment is missing");
    }

    assignment.endLineId = assignment.startLineId;
    assignment.display.startMs = 110;
    assignment.display.endMs = 3_000;
    assignment.display.playbackRate = 0.2;
    firstLine.pauseAfterMs = 0;

    const baseInput = createRenderManifestInput(project);
    const firstAudio = (baseInput.audioIndex as VoicevoxAudioIndex)[
      firstLine.id
    ];
    if (firstAudio === undefined) {
      throw new Error("first line audio is missing");
    }
    const audioIndex = {
      ...(baseInput.audioIndex as VoicevoxAudioIndex),
      [firstAudio.lineId]: { ...firstAudio, durationMs: 66 }
    } satisfies VoicevoxAudioIndex;
    const assetMetadata = (
      baseInput.assetMetadata as readonly RenderManifestAssetMetadata[]
    ).map((asset) =>
      asset.path === firstAudio.audioPath ? { ...asset, durationMs: 66 } : asset
    );

    const result = compileRenderManifest(
      createRenderManifestInput(project, { audioIndex, assetMetadata })
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const visual = result.manifest.visuals.find(
      (candidate) => candidate.sourceAssignmentId === assignment.id
    );
    if (
      visual?.display.kind !== "video" ||
      visual.display.playbackState !== "playing"
    ) {
      throw new Error("compiled visual must be a video");
    }

    expect(visual.from).toBe(0);
    expect(visual.durationInFrames).toBe(2);
    expect(visual.display.startMs).toBe(110);
    expect(visual.display.endMs).toBe(3_000);
    expect(visual.display.sourceTrimBeforeFrame).toBe(4);
    expect(visual.display.sourceTrimAfterFrame).toBeCloseTo(4.4);
  });

  it("bakes coordinate space, section titles, and freshness into 2.6.0", () => {
    const legacy = compileRenderManifest(validInput());
    expect(legacy.success).toBe(true);
    if (!legacy.success) {
      return;
    }
    const legacyVisual = legacy.manifest.visuals[0];
    if (legacyVisual?.display.kind !== "video") {
      throw new Error("fixture visual must be a video");
    }
    expect(legacyVisual.display.contentClip.enabled).toBe(false);
    expect(legacyVisual.display.outerFrame.rect).toMatchObject({
      x: expect.closeTo(0.09),
      y: expect.closeTo(0.19),
      width: expect.closeTo(0.82),
      height: expect.closeTo(0.62)
    });
    expect(
      legacy.manifest.sectionLayouts[0]!.resolvedLayout.elements.find(
        (element) =>
          element.type === "character-visual" && element.slot === "speaker-1"
      )?.transform.rect.width
    ).toBeCloseTo(0.25);
    expect(legacy.manifest.sectionLayouts[0]?.sectionTitle).toBe(
      videoProjectFixture.script.sections[0]?.name
    );

    const relativeProject = structuredClone(
      videoProjectFixture
    ) as VideoProject;
    const relativeDisplay = relativeProject.visuals.assignments[0]!.display;
    relativeDisplay.displayCoordinateSpace = "content-slot-relative";
    relativeDisplay.position = { x: 0.5, y: 0.5 };
    relativeDisplay.scale = 0.5;
    const relative = compileRenderManifest(validInput(relativeProject));
    expect(relative.success).toBe(true);
    if (!relative.success) {
      return;
    }
    const relativeVisual = relative.manifest.visuals[0];
    if (relativeVisual?.display.kind !== "video") {
      throw new Error("fixture visual must be a video");
    }
    expect(relativeVisual.display.contentClip.enabled).toBe(true);
    expect(relativeVisual.display.outerFrame.rect).toMatchObject({
      x: expect.closeTo(0.295),
      y: expect.closeTo(0.345),
      width: expect.closeTo(0.41),
      height: expect.closeTo(0.31)
    });
    expect(relative.manifest.compilerInputHash).not.toBe(
      legacy.manifest.compilerInputHash
    );

    const renamedProject = structuredClone(videoProjectFixture) as VideoProject;
    renamedProject.script.sections[0]!.name += " (更新)";
    const renamed = compileRenderManifest(validInput(renamedProject));
    expect(renamed.success).toBe(true);
    if (!renamed.success) {
      return;
    }
    expect(renamed.manifest.sectionLayouts[0]?.sectionTitle).toContain("更新");
    expect(renamed.manifest.compilerInputHash).not.toBe(
      legacy.manifest.compilerInputHash
    );
  });

  it("preserves arbitrary project video volumes in the 2.4.0 manifest", () => {
    const input = validInput();
    const project = structuredClone(input.project) as VideoProject;
    const display = project.visuals.assignments[0]?.display;
    if (display?.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    display.volume = 0.25;

    const result = compileRenderManifest({ ...input, project });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.manifest.visuals[0]?.display).toMatchObject({ volume: 0.25 });
  });

  it("preserves project video volume 1 in the 2.4.0 manifest", () => {
    const input = validInput();
    const project = structuredClone(input.project) as VideoProject;
    const display = project.visuals.assignments[0]?.display;
    if (display?.kind !== "video") {
      throw new Error("fixture must contain a video display");
    }
    display.volume = 1;

    const result = compileRenderManifest({ ...input, project });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.manifest.visuals[0]?.display).toMatchObject({
      kind: "video",
      volume: 1
    });
  });

  it("resolves real EditPlan video durations and shifts every dependent timeline", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const videoAssignment = project.visuals.assignments.find(
      (assignment) => assignment.display.kind === "video"
    );
    if (videoAssignment === undefined) {
      throw new Error("fixture video assignment is missing");
    }
    project.edit.videoElements = [
      {
        id: "edit-intro",
        role: "intro",
        assetId: "asset-application-demo",
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: { kind: "before_first_section" },
        startMs: null,
        playbackRate: 1,
        volume: 0,
        text: "",
        textTemplateId: null
      },
      {
        id: "edit-cutin-one",
        role: "cutin",
        assetId: "asset-application-demo",
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: {
          kind: "before_section",
          sectionId: "section-main",
          order: 1
        },
        startMs: null,
        playbackRate: 1,
        volume: 0.25,
        text: "",
        textTemplateId: null
      },
      {
        id: "edit-cutin-zero",
        role: "cutin",
        assetId: "asset-application-demo",
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: {
          kind: "before_section",
          sectionId: "section-main",
          order: 0
        },
        startMs: null,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      },
      {
        id: "edit-outro",
        role: "outro",
        assetId: "asset-application-demo",
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: { kind: "after_last_section" },
        startMs: null,
        playbackRate: 1,
        volume: 0.25,
        text: "",
        textTemplateId: null
      }
    ];
    const input = createRenderManifestInput(project);
    const assetMetadata = (
      input.assetMetadata as readonly RenderManifestAssetMetadata[]
    ).map((asset) =>
      asset.kind === "bgm" ? { ...asset, durationMs: 400 } : asset
    );

    const result = compileRenderManifest({ ...input, assetMetadata });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.manifest.inserts).toEqual([
      expect.objectContaining({
        id: "edit-intro",
        role: "intro",
        from: 0,
        durationInFrames: 150,
        src: videoAssignment.projectMediaPath,
        volume: 0
      }),
      expect.objectContaining({
        id: "edit-cutin-zero",
        role: "cutin",
        from: 229,
        durationInFrames: 150,
        volume: 1
      }),
      expect.objectContaining({
        id: "edit-cutin-one",
        role: "cutin",
        from: 379,
        durationInFrames: 150,
        volume: 0.25
      }),
      expect.objectContaining({
        id: "edit-outro",
        role: "outro",
        from: 643,
        durationInFrames: 150,
        volume: 0.25
      })
    ]);
    expect(result.manifest.lines.map(({ from }) => from)).toEqual([
      150, 188, 529, 567, 605
    ]);
    expect(result.manifest.visuals.map(({ from }) => from)).toEqual([
      150, 529, 605
    ]);
    expect(result.manifest.audioTracks).toEqual([
      expect.objectContaining({
        sectionId: "section-intro",
        from: 150,
        durationInFrames: 79,
        loop: true
      }),
      expect.objectContaining({
        sectionId: "section-main",
        from: 529,
        durationInFrames: 76,
        loop: true
      })
    ]);
    expect(result.manifest.durationInFrames).toBe(793);
    expect(
      result.manifest.audioTracks.every((track) =>
        result.manifest.inserts.every(
          (insert) =>
            track.from >= insert.from + insert.durationInFrames ||
            insert.from >= track.from + track.durationInFrames
        )
      )
    ).toBe(true);
    expect(
      result.manifest.sourceAssetChecksums.some(
        (asset) => asset.path === videoAssignment.projectMediaPath
      )
    ).toBe(true);
  });

  it("resolves every allowed edit playback rate from the remaining source range", () => {
    for (const option of EDIT_VIDEO_PLAYBACK_RATE_OPTIONS) {
      const project = structuredClone(videoProjectFixture) as VideoProject;
      const videoAssignment = project.visuals.assignments.find(
        (assignment) => assignment.display.kind === "video"
      );
      if (videoAssignment === undefined) {
        throw new Error("fixture video assignment is missing");
      }
      project.edit.videoElements = [
        {
          id: "edit-intro-timing",
          role: "intro",
          assetId: videoAssignment.assetId,
          assetVersion: 1,
          assetChecksum: videoAssignment.assetChecksum,
          projectMediaPath: videoAssignment.projectMediaPath,
          placement: { kind: "before_first_section" },
          startMs: 500,
          playbackRate: option.value,
          volume: 0.25,
          text: "",
          textTemplateId: null
        }
      ];

      const result = compileRenderManifest(createRenderManifestInput(project));

      expect(result.success).toBe(true);
      if (!result.success) {
        continue;
      }
      const insert = result.manifest.inserts[0];
      expect(insert).toMatchObject({
        startMs: 500,
        playbackRate: option.value,
        volume: 0.25
      });
      expect(insert?.durationInFrames).toBe(
        Math.ceil(((5_000 - 500) / option.value / 1_000) * 30)
      );
      expect(result.manifest.lines[0]?.from).toBe(insert?.durationInFrames);
    }
  });

  it("rejects an edit video start at or beyond its verified duration", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const videoAssignment = project.visuals.assignments.find(
      (assignment) => assignment.display.kind === "video"
    );
    if (videoAssignment === undefined) {
      throw new Error("fixture video assignment is missing");
    }
    project.edit.videoElements = [
      {
        id: "edit-intro-invalid-range",
        role: "intro",
        assetId: videoAssignment.assetId,
        assetVersion: 1,
        assetChecksum: videoAssignment.assetChecksum,
        projectMediaPath: videoAssignment.projectMediaPath,
        placement: { kind: "before_first_section" },
        startMs: 5_000,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      }
    ];

    const result = compileRenderManifest(createRenderManifestInput(project));

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("ASSET_RANGE_INVALID");
    if (!result.success) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "ASSET_RANGE_INVALID",
            path: ["edit", "videoElements", 0, "startMs"]
          })
        ])
      );
    }
  });

  it("invalidates the compiler hash when edit order, asset snapshot, or volume changes", () => {
    const createProject = (): VideoProject => {
      const project = structuredClone(videoProjectFixture) as VideoProject;
      const videoAssignment = project.visuals.assignments.find(
        (assignment) => assignment.display.kind === "video"
      );
      if (videoAssignment === undefined) {
        throw new Error("fixture video assignment is missing");
      }
      project.edit.videoElements = [
        {
          id: "edit-cutin-a",
          role: "cutin",
          assetId: videoAssignment.assetId,
          assetVersion: 1,
          assetChecksum: videoAssignment.assetChecksum,
          projectMediaPath: videoAssignment.projectMediaPath,
          placement: {
            kind: "before_section",
            sectionId: "section-main",
            order: 0
          },
          startMs: null,
          playbackRate: 1,
          volume: 0.25,
          text: "",
          textTemplateId: null
        },
        {
          id: "edit-cutin-b",
          role: "cutin",
          assetId: videoAssignment.assetId,
          assetVersion: 1,
          assetChecksum: videoAssignment.assetChecksum,
          projectMediaPath: videoAssignment.projectMediaPath,
          placement: {
            kind: "before_section",
            sectionId: "section-main",
            order: 1
          },
          startMs: null,
          playbackRate: 1,
          volume: 1,
          text: "",
          textTemplateId: null
        }
      ];
      return project;
    };

    const baseProject = createProject();
    const first = compileRenderManifest(validInput(baseProject));
    const changedVolumeProject = structuredClone(baseProject) as VideoProject;
    changedVolumeProject.edit.videoElements[0]!.volume = 0.5;
    const changedVolume = compileRenderManifest(
      validInput(changedVolumeProject)
    );
    const changedOrderProject = structuredClone(baseProject) as VideoProject;
    changedOrderProject.edit.videoElements[0]!.placement = {
      kind: "before_section",
      sectionId: "section-main",
      order: 2
    };
    changedOrderProject.edit.videoElements[1]!.placement = {
      kind: "before_section",
      sectionId: "section-main",
      order: 0
    };
    const changedOrder = compileRenderManifest(validInput(changedOrderProject));
    const changedAssetProject = structuredClone(baseProject) as VideoProject;
    changedAssetProject.edit.videoElements[0]!.assetId = "asset-replaced-video";
    changedAssetProject.edit.videoElements[0]!.assetVersion = 2;
    const changedAsset = compileRenderManifest(validInput(changedAssetProject));

    expect(first.success).toBe(true);
    expect(changedVolume.success).toBe(true);
    expect(changedOrder.success).toBe(true);
    expect(changedAsset.success).toBe(true);
    if (
      !first.success ||
      !changedVolume.success ||
      !changedOrder.success ||
      !changedAsset.success
    ) {
      return;
    }
    expect(changedVolume.manifest.compilerInputHash).not.toBe(
      first.manifest.compilerInputHash
    );
    expect(changedOrder.manifest.compilerInputHash).not.toBe(
      first.manifest.compilerInputHash
    );
    expect(changedAsset.manifest.compilerInputHash).not.toBe(
      first.manifest.compilerInputHash
    );
  });

  it("rejects edit video metadata that is not a supported MP4", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    project.edit.videoElements = [
      {
        id: "edit-intro-invalid-format",
        role: "intro",
        assetId: "asset-invalid-video",
        assetVersion: 1,
        assetChecksum: "1".repeat(64),
        projectMediaPath: "media/intro.avi",
        placement: { kind: "before_first_section" },
        startMs: null,
        playbackRate: 1,
        volume: 1,
        text: "",
        textTemplateId: null
      }
    ];
    const input = validInput(project);
    const result = compileRenderManifest({
      ...input,
      assetMetadata: [
        ...(input.assetMetadata ?? []),
        {
          path: "media/intro.avi",
          kind: "video",
          sha256: "1".repeat(64),
          durationMs: 1_000,
          mimeType: "video/avi",
          format: "unsupported"
        }
      ]
    });

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("EDIT_VIDEO_FORMAT_INVALID");
  });

  it("rejects BGM metadata when MIME or detected format is missing", () => {
    const input = validInput();
    const bgmPath = videoProjectFixture.edit.sectionBgms[0]?.projectMediaPath;
    if (bgmPath === undefined) {
      throw new Error("fixture BGM is missing");
    }

    for (const field of ["mimeType", "format"] as const) {
      const assetMetadata = (
        input.assetMetadata as readonly RenderManifestAssetMetadata[]
      ).map((asset) => {
        if (asset.path !== bgmPath) {
          return asset;
        }
        const copy = { ...asset };
        Reflect.deleteProperty(copy, field);
        return copy;
      });
      const result = compileRenderManifest({ ...input, assetMetadata });

      expect(result.success).toBe(false);
      expect(diagnosticCodes(result)).toContain("EDIT_BGM_FORMAT_INVALID");
    }
  });

  it("shares a physical visual variant without assigning ownership to one speaker", () => {
    const input = validInput();
    const project = structuredClone(input.project) as VideoProject;
    project.characters[1]!.characterVisual = {
      visualId: "character-mentor",
      idleVariantId: "character-mentor-stand-v1"
    };
    for (const section of project.script.sections) {
      for (const line of section.lines) {
        if (line.speakerId === "character-learner") {
          line.characterVariantId = "character-mentor-speak-normal-v1";
        }
      }
    }

    const result = compileRenderManifest({ ...input, project });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.manifest.characters[1]).toMatchObject({
      characterId: "character-learner",
      visualId: "character-mentor"
    });
    expect(
      result.manifest.characterVariants.filter(
        (variant) => variant.variantId === "character-mentor-speak-normal-v1"
      )
    ).toHaveLength(1);
    expect(
      result.manifest.lines
        .filter((line) => line.speakerId === "character-learner")
        .every(
          (line) =>
            line.characterVariantId === "character-mentor-speak-normal-v1"
        )
    ).toBe(true);
  });

  it("is deterministic for hashes, deep equality, and serialization", () => {
    const input = validInput();
    const first = compileRenderManifest(input);
    const second = compileRenderManifest(structuredClone(input));

    expect(first).toEqual(second);
    if (!first.success || !second.success) {
      return;
    }
    expect(first.manifest.sourceProjectHash).toBe(
      second.manifest.sourceProjectHash
    );
    expect(first.manifest.compilerInputHash).toBe(
      second.manifest.compilerInputHash
    );
    expect(serializeRenderManifest(first.manifest)).toBe(
      serializeRenderManifest(second.manifest)
    );
  });

  it("keeps multiple effects on one line and positions them from speechFrom", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const first = project.audio.soundEffects[0];
    if (first === undefined) {
      throw new Error("sound effect fixture is missing");
    }
    project.audio.soundEffects = [
      {
        ...first,
        id: "effect-relative-first",
        projectMediaPath: "media/effect-relative-first.wav",
        lineId: "intro-learner-1",
        offsetMs: 101
      },
      {
        ...first,
        id: "effect-relative-second",
        projectMediaPath: "media/effect-relative-second.wav",
        lineId: "intro-learner-1",
        offsetMs: 201
      }
    ];

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const line = result.manifest.lines.find(
      (candidate) => candidate.id === "intro-learner-1"
    );
    if (line === undefined) {
      throw new Error("intro learner line is missing");
    }
    expect(result.manifest.soundEffects).toHaveLength(2);
    expect(result.manifest.soundEffects.map((effect) => effect.id)).toEqual([
      "effect-relative-first",
      "effect-relative-second"
    ]);
    expect(result.manifest.soundEffects.map((effect) => effect.from)).toEqual([
      line.from +
        line.speechFrom +
        Math.ceil((101 / 1000) * result.manifest.fps),
      line.from +
        line.speechFrom +
        Math.ceil((201 / 1000) * result.manifest.fps)
    ]);
  });

  it("returns a deterministic non-failing warning for three overlapping effects", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const template = project.audio.soundEffects[0];
    if (template === undefined) {
      throw new Error("sound effect fixture is missing");
    }
    project.audio.soundEffects = [0, 100, 200].map((offsetMs, index) => ({
      ...template,
      id: `effect-overlap-${index + 1}`,
      projectMediaPath: `media/effect-overlap-${index + 1}.wav`,
      lineId: "main-learner-1",
      offsetMs
    }));

    const input = createRenderManifestInput(project);
    const first = compileRenderManifest(input);
    const second = compileRenderManifest(structuredClone(input));

    expect(first.success).toBe(true);
    expect(first).toEqual(second);
    if (!first.success) {
      return;
    }
    const line = first.manifest.lines.find(
      (candidate) => candidate.id === "main-learner-1"
    );
    if (line === undefined) {
      throw new Error("main learner line is missing");
    }
    expect(first.diagnostics).toEqual([]);
    expect(first.errors).toEqual([]);
    expect(first.warnings).toEqual([
      {
        code: "SOUND_EFFECT_OVERLAP_LIMIT",
        message: "three or more sound effects overlap in this interval",
        from: line.from + Math.ceil((200 / 1000) * first.manifest.fps),
        to: line.from + 12,
        soundEffectIds: [
          "effect-overlap-1",
          "effect-overlap-2",
          "effect-overlap-3"
        ],
        lineIds: ["main-learner-1"]
      }
    ]);
  });

  it("does not warn for two effects or touching half-open boundaries", () => {
    const createProject = (offsets: number[]): VideoProject => {
      const project = structuredClone(videoProjectFixture) as VideoProject;
      const template = project.audio.soundEffects[0];
      if (template === undefined) {
        throw new Error("sound effect fixture is missing");
      }
      project.audio.soundEffects = offsets.map((offsetMs, index) => ({
        ...template,
        id: `effect-boundary-${index + 1}`,
        projectMediaPath: `media/effect-boundary-${index + 1}.wav`,
        lineId: "main-learner-1",
        offsetMs
      }));
      return project;
    };

    expect(
      compileRenderManifest(createRenderManifestInput(createProject([0, 100])))
    ).toMatchObject({ success: true, warnings: [] });
    expect(
      compileRenderManifest(
        createRenderManifestInput(createProject([0, 400, 800]))
      )
    ).toMatchObject({ success: true, warnings: [] });
  });

  it("changes the source hash when resolved character display metadata changes", () => {
    const first = compileRenderManifest(validInput());
    const changedProject = structuredClone(videoProjectFixture) as VideoProject;
    changedProject.characters[0].name += "（変更）";
    changedProject.characters[0].lipSyncPeriodFrames = 5;
    const second = compileRenderManifest(validInput(changedProject));

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    if (!first.success || !second.success) {
      return;
    }
    expect(second.manifest.characters[0]).toMatchObject({
      displayName: "四国めたん（変更）",
      lipSyncPeriodFrames: 5
    });
    expect(second.manifest.sourceProjectHash).not.toBe(
      first.manifest.sourceProjectHash
    );
    expect(second.manifest.compilerInputHash).not.toBe(
      first.manifest.compilerInputHash
    );
  });

  it("rejects source-valid long subtitles that overflow the ScreenTemplate bounds", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const sourceLine = project.script.sections[0]?.lines[0];
    if (sourceLine === undefined) {
      throw new Error("fixture source line is missing");
    }
    sourceLine.subtitleText = [
      "あ".repeat(137),
      ...Array.from({ length: 12 }, () => "行")
    ].join("\n");

    const result = compileRenderManifest(validInput(project));

    const diagnostic = result.success
      ? undefined
      : result.diagnostics.find(
          (candidate) =>
            candidate.code === "SCREEN_TEMPLATE_TEXT_OVERFLOW" &&
            candidate.lineId === sourceLine.id
        );
    expect(result.success).toBe(false);
    expect(diagnostic).toMatchObject({
      path: ["script", "sections", 0, "lines", 0, "subtitleText"],
      lineId: sourceLine.id,
      sectionId: "section-intro"
    });
  });

  it("collects outline, stale, audio, and material diagnostics without stage approvals", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    project.outline.status = "draft";
    project.script.status = "needs_review";
    project.visuals.status = "draft";
    project.outline.sourceHash = "1".repeat(64);
    project.script.outlineHash = "2".repeat(64);
    const result = compileRenderManifest({
      project,
      audioIndex: {},
      assetMetadata: []
    });

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "OUTLINE_NOT_APPROVED",
        "OUTLINE_SOURCE_HASH_MISMATCH",
        "SCRIPT_OUTLINE_HASH_MISMATCH",
        "AUDIO_INDEX_ENTRY_MISSING",
        "ASSET_METADATA_MISSING"
      ])
    );
    expect(diagnosticCodes(result)).not.toEqual(
      expect.arrayContaining(["SCRIPT_NOT_APPROVED", "VISUALS_NOT_APPROVED"])
    );
    if (result.success) {
      return;
    }
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.lineId === "main-mentor-1"
      )
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.sectionId === "section-main"
      )
    ).toBe(true);
  });

  it("compiles valid data without script or visual approval status", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    project.script.status = "draft";
    project.visuals.status = "needs_review";

    const result = compileRenderManifest(validInput(project));

    expect(result.success).toBe(true);
  });

  it("requires document pages to fit within the verified pageCount", () => {
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const documentAssignment = project.visuals.assignments.find(
      (assignment) => assignment.display.kind === "document_scan"
    );
    if (documentAssignment === undefined) {
      throw new Error("fixture document assignment is missing");
    }
    if (documentAssignment.display.kind !== "document_scan") {
      throw new Error("fixture document assignment has the wrong kind");
    }
    documentAssignment.display.page = 999;

    const outOfRange = compileRenderManifest(validInput(project));
    expect(outOfRange.success).toBe(false);
    if (!outOfRange.success) {
      expect(outOfRange.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "ASSET_RANGE_INVALID",
          assignmentId: documentAssignment.id,
          assetPath: documentAssignment.projectMediaPath
        })
      );
    }

    const input = validInput();
    const assets = [
      ...((input.assetMetadata ?? []) as readonly RenderManifestAssetMetadata[])
    ].map((asset) =>
      asset.path === documentAssignment.projectMediaPath
        ? { ...asset, pageCount: null }
        : asset
    );
    const missingPageCount = compileRenderManifest({
      ...input,
      assetMetadata: assets
    });
    expect(missingPageCount.success).toBe(false);
    if (!missingPageCount.success) {
      expect(missingPageCount.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "ASSET_PAGE_COUNT_MISSING",
          assignmentId: documentAssignment.id,
          assetPath: documentAssignment.projectMediaPath
        })
      );
    }
  });

  it("requires explicit project selections and does not use the legacy mapping", () => {
    const projectWithoutLineSelection = structuredClone(
      videoProjectFixture
    ) as VideoProject;
    const outroLine = projectWithoutLineSelection.script.sections
      .flatMap((section) => section.lines)
      .find((line) => line.id === "outro-mentor-1");
    if (outroLine === undefined) {
      throw new Error("fixture line is missing");
    }
    outroLine.characterVariantId = null;
    const missingSelection = compileRenderManifest(
      validInput(projectWithoutLineSelection, {
        characterVariantMapping
      })
    );
    expect(missingSelection.success).toBe(false);
    expect(diagnosticCodes(missingSelection)).toContain(
      "CHARACTER_VARIANT_UNSELECTED"
    );
    if (!missingSelection.success) {
      expect(
        missingSelection.diagnostics.find(
          (diagnostic) => diagnostic.lineId === "outro-mentor-1"
        )?.variantId
      ).toBeUndefined();
    }

    const missingVariantCatalog = characterVariantCatalog.filter(
      ({ variantId }) => variantId !== "character-mentor-speak-pointing-v1"
    );
    const missingVariant = compileRenderManifest(
      validInput(undefined, { characterVariantCatalog: missingVariantCatalog })
    );
    expect(diagnosticCodes(missingVariant)).toContain(
      "CHARACTER_VARIANT_MISSING"
    );
    if (!missingVariant.success) {
      expect(missingVariant.manifest).toBeNull();
      expect(
        missingVariant.diagnostics.some(
          (diagnostic) =>
            diagnostic.variantId === "character-mentor-speak-pointing-v1" &&
            diagnostic.lineId === "intro-mentor-1"
        )
      ).toBe(true);
    }
  });

  it("reports visual ownership, slot, kind, checksum, and duration errors with context", () => {
    const catalog = characterVariantCatalog.map((variant) =>
      variant.variantId === "character-mentor-speak-pointing-v1"
        ? { ...variant, characterId: "character-learner" }
        : variant
    );
    const input = validInput();
    const assets = [
      ...((input.assetMetadata ?? []) as readonly RenderManifestAssetMetadata[])
    ].filter(
      (asset) =>
        asset.path !==
        "shared-assets/characters/character-mentor/speak-pointing/open.png"
    );
    const effect = assets.find((asset) => asset.path === "media/confirm.wav");
    if (effect !== undefined) {
      effect.kind = "photo";
    }
    const audio = Object.fromEntries(
      Object.entries(input.audioIndex as VoicevoxAudioIndex).map(
        ([lineId, entry]) => [
          lineId,
          lineId === "intro-mentor-1"
            ? { ...entry, audioSha256: "3".repeat(64) }
            : entry
        ]
      )
    );
    const result = compileRenderManifest({
      ...input,
      characterVariantCatalog: catalog,
      assetMetadata: assets,
      audioIndex: audio
    });

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toEqual(
      expect.arrayContaining([
        "CHARACTER_VARIANT_CHARACTER_MISMATCH",
        "CHARACTER_VARIANT_FILE_MISSING",
        "ASSET_KIND_MISMATCH",
        "AUDIO_ASSET_CHECKSUM_MISMATCH"
      ])
    );
    if (result.success) {
      return;
    }
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.lineId === "main-learner-1" &&
          diagnostic.assetPath === "media/confirm.wav"
      )
    ).toBe(true);
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.variantId === "character-mentor-speak-pointing-v1"
      )
    ).toBe(true);
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.assetPath?.endsWith("open.png")
      )
    ).toBe(true);
  });

  it("rejects inactive catalog visuals and variants", () => {
    const inactiveVariantCatalog = characterVariantCatalog.map((variant) =>
      variant.variantId === "character-mentor-speak-normal-v1"
        ? { ...variant, status: "inactive" as const }
        : variant
    );
    const inactiveVariant = compileRenderManifest(
      validInput(undefined, { characterVariantCatalog: inactiveVariantCatalog })
    );
    expect(diagnosticCodes(inactiveVariant)).toContain(
      "CHARACTER_VARIANT_INACTIVE"
    );

    const inactiveVisualCatalog = characterVariantCatalog.map((variant) =>
      variant.variantId === "character-mentor-speak-pointing-v1"
        ? { ...variant, visualStatus: "inactive" as const }
        : variant
    );
    const inactiveVisual = compileRenderManifest(
      validInput(undefined, { characterVariantCatalog: inactiveVisualCatalog })
    );
    expect(diagnosticCodes(inactiveVisual)).toContain(
      "CHARACTER_VISUAL_INACTIVE"
    );
  });

  it("resolves line overlays to line timing and final canvas coordinates", () => {
    const emptyResult = compileRenderManifest(validInput());
    const project = structuredClone(videoProjectFixture) as VideoProject;
    const targetLine = project.script.sections[0]?.lines[0];
    const labelLine = project.script.sections[1]?.lines[0];
    if (targetLine === undefined || labelLine === undefined) {
      throw new Error("line overlay fixture is incomplete");
    }
    project.overlays.lineOverlays = [
      {
        id: "overlay-highlight-box",
        lineId: targetLine.id,
        kind: "box",
        transform: {
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.25,
          rotationDeg: 15
        },
        colorToken: "warning",
        text: null,
        animation: "pulse"
      },
      {
        id: "overlay-label",
        lineId: labelLine.id,
        kind: "label",
        transform: {
          x: 0.55,
          y: 0.1,
          width: 0.2,
          height: 0.1,
          rotationDeg: 0
        },
        colorToken: "accent",
        text: "確認",
        animation: "blink"
      }
    ];

    const result = compileRenderManifest(createRenderManifestInput(project));
    expect(result.success).toBe(true);
    if (!result.success || !emptyResult.success) {
      return;
    }

    expect(result.manifest.lineOverlays).toEqual([
      expect.objectContaining({
        id: "overlay-highlight-box",
        lineId: targetLine.id,
        from: result.manifest.lines.find((line) => line.id === targetLine.id)
          ?.from,
        durationInFrames: result.manifest.lines.find(
          (line) => line.id === targetLine.id
        )?.durationInFrames,
        resolvedTransform: expect.objectContaining({
          x: 192,
          y: 216,
          width: 576,
          height: 270,
          rotationDeg: 15
        })
      }),
      expect.objectContaining({
        id: "overlay-label",
        lineId: labelLine.id,
        kind: "label",
        text: "確認"
      })
    ]);
    expect(result.manifest.compilerInputHash).not.toBe(
      emptyResult.manifest.compilerInputHash
    );
  });
});
