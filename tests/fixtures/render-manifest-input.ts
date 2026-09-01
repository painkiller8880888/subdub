import { legacyCharacterVariantCatalog } from "../../src/app/character-visuals/character-visual-seed.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import type {
  RenderManifestAssetMetadata,
  RenderManifestCompilerInput
} from "../../src/app/rendering/render-manifest-compiler.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";
import type { VideoProject } from "../../src/schema/index.js";
import { videoProjectFixture } from "./video-project.js";

const AUDIO_CHECKSUM = "e".repeat(64);
const BACKGROUND_CHECKSUM = "a".repeat(64);

function linesOf(project: VideoProject) {
  return project.script.sections.flatMap((section) => section.lines);
}

export function createRenderManifestAudioIndex(
  project: VideoProject,
  overrides: Partial<VoicevoxAudioIndex> = {}
): VoicevoxAudioIndex {
  return {
    ...Object.fromEntries(
      linesOf(project).map((line) => [
        line.id,
        {
          lineId: line.id,
          audioPath: `audio/voice/${line.id}.wav`,
          cacheKey: "b".repeat(64),
          audioSha256: AUDIO_CHECKSUM,
          durationMs: 1_000,
          generatedAt: "2026-08-10T00:00:00.000Z",
          voicevoxEngineVersion: "fixture-engine-1",
          speakerUuid: `${line.speakerId}-uuid`,
          styleName: "ノーマル",
          resolvedStyleId: 1,
          resolvedSpokenText: line.spokenText,
          appliedTerms: [],
          queryPath: `cache/voicevox-query/${line.id}.json`
        }
      ])
    ),
    ...overrides
  } as VoicevoxAudioIndex;
}

export function createRenderManifestAssetMetadata(
  project: VideoProject,
  audioIndex: VoicevoxAudioIndex
): RenderManifestAssetMetadata[] {
  const audio = Object.values(audioIndex).map((entry) => ({
    path: entry.audioPath,
    kind: "audio",
    sha256: entry.audioSha256,
    durationMs: entry.durationMs
  }));
  const visuals = project.visuals.assignments.map((assignment) => ({
    path: assignment.projectMediaPath,
    kind: assignment.display.kind,
    sha256: assignment.assetChecksum,
    ...(assignment.display.kind === "video" ? { durationMs: 5_000 } : {}),
    ...(assignment.display.kind === "video"
      ? { mimeType: "video/mp4", format: "mp4" }
      : {}),
    ...(assignment.display.kind === "document_scan" ? { pageCount: 3 } : {})
  }));
  const backgrounds = project.script.sections.flatMap((section) =>
    section.background.kind === "image"
      ? [
          {
            path: section.background.src,
            kind: "image",
            sha256: BACKGROUND_CHECKSUM
          }
        ]
      : []
  );
  const bgms = project.edit.sectionBgms.map((bgm) => ({
    path: bgm.projectMediaPath,
    kind: "bgm",
    sha256: bgm.assetChecksum,
    durationMs: 60_000,
    mimeType: "audio/mpeg",
    format: "mp3"
  }));
  const effects = project.audio.soundEffects.map((effect) => ({
    path: effect.projectMediaPath,
    kind: "sound_effect",
    sha256: effect.assetChecksum,
    durationMs: 400
  }));
  const editVideos = project.edit.videoElements.map((element) => ({
    path: element.projectMediaPath,
    kind: "video",
    sha256: element.assetChecksum,
    durationMs:
      visuals.find((asset) => asset.path === element.projectMediaPath)
        ?.durationMs ?? 1_000,
    mimeType: "video/mp4",
    format: "mp4"
  }));
  const characters = legacyCharacterVariantCatalog.flatMap((variant, index) =>
    variant.files.map((file, fileIndex) => ({
      path: file.destinationPath,
      kind: "character",
      sha256: `${String(index + 1)}${String(fileIndex + 1)}`.padStart(64, "c"),
      durationMs: null
    }))
  );
  const assets = [
    ...audio,
    ...visuals,
    ...backgrounds,
    ...bgms,
    ...effects,
    ...editVideos,
    ...characters
  ];
  return [...new Map(assets.map((asset) => [asset.path, asset])).values()];
}

export function createRenderManifestInput(
  project: VideoProject = videoProjectFixture,
  overrides: Partial<RenderManifestCompilerInput> = {}
): RenderManifestCompilerInput {
  const currentProject = structuredClone(project) as VideoProject;
  const audioIndex = createRenderManifestAudioIndex(currentProject);
  return {
    project: currentProject,
    audioIndex,
    characterVariantCatalog: legacyCharacterVariantCatalog,
    screenTemplateCatalogSnapshot: [
      createStandardScreenTemplate("2026-08-10T00:00:00.000Z")
    ],
    assetMetadata: createRenderManifestAssetMetadata(
      currentProject,
      audioIndex
    ),
    ...overrides
  };
}
