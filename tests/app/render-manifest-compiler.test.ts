import { describe, expect, it } from "vitest";

import { legacyCharacterVariantCatalog as characterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import {
  characterVariantMapping,
  CHARACTER_VARIANT_CATALOG_VERSION,
  CHARACTER_VARIANT_MAPPING_VERSION
} from "../../src/assets/character-asset-manifest.js";
import {
  compileRenderManifest,
  serializeRenderManifest,
  type RenderManifestAssetMetadata
} from "../../src/app/rendering/render-manifest-compiler.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import type { VideoProject } from "../../src/schema/index.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";

const validInput = createRenderManifestInput;

function diagnosticCodes(result: ReturnType<typeof compileRenderManifest>) {
  if (result.success) {
    return [];
  }
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

describe("compileRenderManifest", () => {
  it("rejects compilation when the runtime catalog snapshot is not injected", () => {
    const input = { ...validInput() };
    Reflect.deleteProperty(input, "characterVariantCatalog");
    const result = compileRenderManifest(input);

    expect(result.success).toBe(false);
    expect(diagnosticCodes(result)).toContain("CHARACTER_CATALOG_INVALID");
  });

  it("resolves explicit character selections and compiles all timeline inputs", () => {
    const result = compileRenderManifest(validInput());

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.manifest.manifestVersion).toBe("2.2.0");
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
        lipSyncPeriodFrames: 3,
        idleVariantId: "character-mentor-stand-v1"
      },
      {
        characterId: "character-learner",
        visualId: "character-learner",
        displayName: "ずんだもん",
        themeColorToken: "character.zundamon",
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

    expect(
      result.manifest.inserts.map(({ slot, from, durationInFrames }) => [
        slot,
        from,
        durationInFrames
      ])
    ).toEqual([
      ["opening", 0, 60],
      ["eye_catch", 139, 60],
      ["ending", 313, 60]
    ]);
    expect(
      result.manifest.lines.map(({ from, durationInFrames }) => [
        from,
        durationInFrames
      ])
    ).toEqual([
      [60, 38],
      [98, 41],
      [199, 38],
      [237, 38],
      [275, 38]
    ]);
    expect(result.manifest.durationInFrames).toBe(373);
    expect(result.manifest.soundEffects[0]).toMatchObject({
      lineId: "main-learner-1",
      from: 240,
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
        ({
          sectionId,
          from,
          durationInFrames,
          volume,
          loop,
          fadeInFrames,
          fadeOutFrames
        }) => [
          sectionId,
          from,
          durationInFrames,
          volume,
          loop,
          fadeInFrames,
          fadeOutFrames
        ]
      )
    ).toEqual([
      ["section-intro", 60, 79, 0.25, true, 0, 9],
      ["section-main", 199, 76, 0.2, true, 9, 9]
    ]);
    const placeholderRanges = result.manifest.inserts.map((insert) => ({
      from: insert.from,
      to: insert.from + insert.durationInFrames
    }));
    for (const range of [
      ...result.manifest.audioTracks,
      ...result.manifest.soundEffects
    ]) {
      expect(
        placeholderRanges.some(
          (placeholder) =>
            range.from < placeholder.to &&
            placeholder.from < range.from + range.durationInFrames
        )
      ).toBe(false);
    }
    const ending = result.manifest.inserts.find(
      (insert) => insert.slot === "ending"
    );
    const lastLine = result.manifest.lines[result.manifest.lines.length - 1];
    expect(ending?.from).toBe(
      (lastLine?.from ?? 0) + (lastLine?.durationInFrames ?? 0)
    );
    expect(ending?.from).toBeGreaterThan(
      Math.max(
        ...result.manifest.audioTracks.map(
          (track) => track.from + track.durationInFrames
        ),
        ...result.manifest.soundEffects.map(
          (effect) => effect.from + effect.durationInFrames
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

  it("keeps source-valid long subtitles renderable in the derived manifest", () => {
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

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.lines[0]?.subtitleText).toBe(
        sourceLine.subtitleText
      );
    }
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
});
