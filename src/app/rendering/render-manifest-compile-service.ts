import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import {
  CHARACTER_VARIANT_CATALOG_VERSION,
  CHARACTER_VARIANT_MAPPING_VERSION
} from "../../assets/character-asset-manifest.js";
import type { CharacterVisualCatalogService } from "../character-visuals/character-visual-service.js";
import type { AssetRepository } from "../assets/asset-repository.js";
import {
  ASSET_DETECTION_HEAD_BYTES,
  detectAssetFormat
} from "../assets/asset-formats.js";
import { processAudioMedia } from "../assets/processing/video-audio.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  type RenderManifestAssetMetadata,
  type RenderManifestCompilerInput
} from "./render-manifest-compiler.js";
import type {
  RenderManifestCacheResult,
  RenderManifestStore
} from "./render-manifest-store.js";
import type {
  CharacterVisualCatalogSnapshot,
  VideoProject
} from "../../schema/index.js";
import type { VoicevoxAudioIndex } from "../voicevox/audio-index.js";
import type { VoicevoxAudioStore } from "../voicevox/audio-store.js";

type ProjectReader = Pick<ProjectRepository, "read">;
type AssetDetailReader = Pick<AssetRepository, "findAssetDetail">;
type CharacterVisualCatalogVerifier = Pick<
  CharacterVisualCatalogService,
  "verifyFiles"
>;
type AudioIndexReader = Pick<VoicevoxAudioStore, "readIndex">;
type ManifestStoreWriter = Pick<RenderManifestStore, "compileAndStore">;
type AssetMetadataByPath = Map<string, RenderManifestAssetMetadata>;

export type RenderManifestInputBuilderOptions = {
  readonly workspaceRoot: string;
  readonly projectRepository: ProjectReader;
  readonly assetRepository: AssetDetailReader;
  readonly characterVisualCatalogService: CharacterVisualCatalogVerifier;
  readonly audioStore: AudioIndexReader;
};

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function addAssetMetadata(
  metadata: AssetMetadataByPath,
  asset: RenderManifestAssetMetadata
): void {
  if (!metadata.has(asset.path)) {
    metadata.set(asset.path, asset);
  }
}

function detectedFormat(contents: Buffer): string {
  const detection = detectAssetFormat(
    contents.subarray(0, ASSET_DETECTION_HEAD_BYTES)
  );
  return detection.status === "matched" ? detection.format : "unsupported";
}

function appendAssetMetadata(
  metadata: AssetMetadataByPath,
  assetRepository: AssetDetailReader,
  assetId: string,
  path: string,
  kind: string,
  options: {
    readonly includeDuration: boolean;
    readonly includePageCount: boolean;
    readonly assetVersion?: number;
    readonly includeMimeType?: boolean;
  }
): void {
  const detail = assetRepository.findAssetDetail(assetId, options.assetVersion);
  if (detail === undefined || detail.checksum === null) {
    return;
  }
  addAssetMetadata(metadata, {
    path,
    kind,
    sha256: detail.checksum,
    ...(options.includeDuration && detail.durationMs !== null
      ? { durationMs: detail.durationMs }
      : {}),
    ...(options.includePageCount && detail.pageCount !== null
      ? { pageCount: detail.pageCount }
      : {}),
    ...(options.includeMimeType ? { mimeType: detail.mimeType } : {})
  });
}

async function appendEditVideoMetadata(
  metadata: AssetMetadataByPath,
  workspaceRoot: string,
  project: VideoProject,
  assetRepository: AssetDetailReader
): Promise<void> {
  const projectRoot = path.resolve(
    workspaceRoot,
    "projects",
    project.metadata.id
  );
  for (const element of project.edit.videoElements) {
    const filePath = path.resolve(
      projectRoot,
      ...element.projectMediaPath.split("/")
    );
    if (!isPathInside(projectRoot, filePath)) {
      continue;
    }
    const detail = assetRepository.findAssetDetail(
      element.assetId,
      element.assetVersion
    );
    if (detail === undefined || detail.checksum === null) {
      continue;
    }
    try {
      const contents = await readFile(filePath);
      metadata.set(element.projectMediaPath, {
        path: element.projectMediaPath,
        kind: detail.kind,
        sha256: createHash("sha256").update(contents).digest("hex"),
        durationMs: detail.durationMs,
        mimeType: detail.mimeType,
        format: detectedFormat(contents)
      });
    } catch {
      // Let the compiler report the missing project file or metadata.
    }
  }
}

async function appendBgmMetadata(
  metadata: AssetMetadataByPath,
  workspaceRoot: string,
  project: VideoProject
): Promise<void> {
  const projectRoot = path.resolve(
    workspaceRoot,
    "projects",
    project.metadata.id
  );
  for (const bgm of project.edit.sectionBgms) {
    const filePath = path.resolve(
      projectRoot,
      ...bgm.projectMediaPath.split("/")
    );
    if (!isPathInside(projectRoot, filePath)) {
      continue;
    }
    try {
      const [contents, processed] = await Promise.all([
        readFile(filePath),
        processAudioMedia(filePath)
      ]);
      addAssetMetadata(metadata, {
        path: bgm.projectMediaPath,
        kind: "bgm",
        sha256: createHash("sha256").update(contents).digest("hex"),
        durationMs: processed.metadata.durationMs,
        format: detectedFormat(contents)
      });
    } catch {
      // Let the compiler report missing or incomplete BGM metadata.
    }
  }
}

async function appendImageBackgroundMetadata(
  metadata: AssetMetadataByPath,
  workspaceRoot: string,
  project: VideoProject
): Promise<void> {
  const projectRoot = path.resolve(
    workspaceRoot,
    "projects",
    project.metadata.id
  );
  for (const section of project.script.sections) {
    if (section.background.kind !== "image") {
      continue;
    }
    const filePath = path.resolve(
      projectRoot,
      ...section.background.src.split("/")
    );
    if (!isPathInside(projectRoot, filePath)) {
      continue;
    }
    try {
      const contents = await readFile(filePath);
      addAssetMetadata(metadata, {
        path: section.background.src,
        kind: "image",
        sha256: createHash("sha256").update(contents).digest("hex")
      });
    } catch {
      // Let the compiler report missing or unreadable background metadata.
    }
  }
}

async function assetMetadataForProject(
  workspaceRoot: string,
  project: VideoProject,
  audioIndex: VoicevoxAudioIndex,
  snapshot: CharacterVisualCatalogSnapshot,
  assetRepository: AssetDetailReader
): Promise<readonly RenderManifestAssetMetadata[]> {
  const metadata: AssetMetadataByPath = new Map();

  for (const entry of Object.values(audioIndex)) {
    addAssetMetadata(metadata, {
      path: entry.audioPath,
      kind: "audio",
      sha256: entry.audioSha256,
      durationMs: entry.durationMs
    });
  }

  for (const assignment of project.visuals.assignments) {
    appendAssetMetadata(
      metadata,
      assetRepository,
      assignment.assetId,
      assignment.projectMediaPath,
      assignment.display.kind,
      { includeDuration: true, includePageCount: true }
    );
  }

  for (const effect of project.audio.soundEffects) {
    appendAssetMetadata(
      metadata,
      assetRepository,
      effect.soundEffectAssetId,
      effect.projectMediaPath,
      "sound_effect",
      { includeDuration: true, includePageCount: false }
    );
  }

  await appendImageBackgroundMetadata(metadata, workspaceRoot, project);

  for (const visual of snapshot) {
    for (const variant of visual.variants) {
      for (const file of variant.files) {
        addAssetMetadata(metadata, {
          path: file.libraryPath,
          kind: "character",
          sha256: file.checksum
        });
      }
    }
  }

  await appendEditVideoMetadata(
    metadata,
    workspaceRoot,
    project,
    assetRepository
  );
  await appendBgmMetadata(metadata, workspaceRoot, project);
  return [...metadata.values()];
}

export class RenderManifestInputBuilder {
  private readonly workspaceRoot: string;
  private readonly projectRepository: ProjectReader;
  private readonly assetRepository: AssetDetailReader;
  private readonly characterVisualCatalogService: CharacterVisualCatalogVerifier;
  private readonly audioStore: AudioIndexReader;

  constructor(options: RenderManifestInputBuilderOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.projectRepository = options.projectRepository;
    this.assetRepository = options.assetRepository;
    this.characterVisualCatalogService = options.characterVisualCatalogService;
    this.audioStore = options.audioStore;
  }

  async build(projectId: unknown): Promise<RenderManifestCompilerInput> {
    const project = await this.projectRepository.read(projectId);
    const audioIndex = await this.audioStore.readIndex(projectId);
    const characterVisualCatalog =
      await this.characterVisualCatalogService.verifyFiles();

    return {
      project,
      audioIndex,
      assetMetadata: await assetMetadataForProject(
        this.workspaceRoot,
        project,
        audioIndex,
        characterVisualCatalog,
        this.assetRepository
      ),
      characterVariantCatalog: characterVisualCatalog,
      characterCatalogVersion: CHARACTER_VARIANT_CATALOG_VERSION,
      // Retained in the manifest for cache/run-log compatibility. Explicit
      // project references and the validated snapshot resolve every variant.
      characterMappingVersion: CHARACTER_VARIANT_MAPPING_VERSION
    };
  }
}

export type RenderManifestCompileServiceOptions =
  RenderManifestInputBuilderOptions & {
    readonly manifestStore: ManifestStoreWriter;
  };

export class RenderManifestCompileService {
  private readonly inputBuilder: RenderManifestInputBuilder;
  private readonly manifestStore: ManifestStoreWriter;

  constructor(options: RenderManifestCompileServiceOptions) {
    this.inputBuilder = new RenderManifestInputBuilder(options);
    this.manifestStore = options.manifestStore;
  }

  async compile(projectId: unknown): Promise<RenderManifestCacheResult> {
    const input = await this.inputBuilder.build(projectId);
    return this.manifestStore.compileAndStore(projectId, input);
  }
}
