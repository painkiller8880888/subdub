import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  manifestPreviewDataSchema,
  type ManifestPreviewBlocker,
  type ManifestPreviewData,
  type VoiceLineGenerationStatus
} from "../../schema/api.js";
import {
  idSchema,
  relativePosixPathSchema,
  type RenderManifest,
  type VideoProject
} from "../../schema/index.js";
import { computeSourceProjectHash } from "./render-manifest-compiler.js";
import { RenderManifestStore } from "./render-manifest-store.js";
import {
  ProjectFileService,
  ProjectFileServiceError
} from "../projects/project-file-service.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import { computeOutlineHash } from "../projects/script-domain.js";
import {
  validateVideoProjectScreenTemplateReferences,
  type ScreenTemplateCatalogPort
} from "../projects/screen-template-selection.js";
import type { VoicevoxGenerationService } from "../voicevox/generation-service.js";
import { VoicevoxAudioStore } from "../voicevox/audio-store.js";
import type { VoicevoxAudioIndex } from "../voicevox/audio-index.js";

export type ManifestPreviewServiceOptions = {
  readonly workspaceRoot: string;
  readonly projectRepository: Pick<ProjectRepository, "read">;
  readonly screenTemplateCatalog?: ScreenTemplateCatalogPort;
  readonly manifestStore?: Pick<RenderManifestStore, "readDetailed">;
  readonly audioStore?: Pick<VoicevoxAudioStore, "readIndex">;
  readonly voiceGenerationService: Pick<VoicevoxGenerationService, "getStatus">;
  readonly projectFileService?: Pick<ProjectFileService, "resolveFile">;
};

export type ManifestPreviewServicePort = Pick<ManifestPreviewService, "get">;

type BlockerTarget = ManifestPreviewBlocker["target"];

const blockerMessages: Readonly<Record<string, string>> = {
  OUTLINE_NOT_APPROVED: "構成案を承認してからプレビューを生成してください。",
  OUTLINE_SOURCE_HASH_MISMATCH:
    "元資料が更新されているため、構成案を確認して再承認してください。",
  SCREEN_TEMPLATE_REFERENCE_INVALID:
    "選択された画面テンプレートが見つからないか無効です。台本のテンプレート設定を修正してください。",
  SCRIPT_NOT_APPROVED:
    "台本の内容を検証できません。入力と構成案との整合性を確認してください。",
  SCRIPT_OUTLINE_HASH_MISMATCH:
    "構成案が更新されているため、台本を確認して再承認してください。",
  VISUALS_NOT_APPROVED:
    "素材の割り当てを検証できません。範囲・素材状態・表示設定を確認してください。",
  AUDIO_INDEX_ENTRY_MISSING: "必要な音声が未生成です。音声を生成してください。",
  AUDIO_ENTRY_STALE:
    "音声が現在の台本と一致しません。音声を再生成してください。",
  AUDIO_INDEX_UNREADABLE:
    "音声インデックスを読み込めません。音声を確認してください。",
  AUDIO_MANIFEST_STALE:
    "保存済みプレビューの音声が現在の音声と一致しません。再生成が必要です。",
  ASSET_MISSING:
    "プレビューに必要な素材が見つかりません。素材を確認してください。",
  ASSET_PATH_INVALID:
    "プレビュー素材の参照先が不正です。素材の割り当てを確認してください。",
  ASSET_UNREADABLE: "プレビュー素材を読み込めません。素材を確認してください。",
  ASSET_CHECKSUM_MISMATCH:
    "プレビュー素材が更新されています。素材を再確認してください。",
  MANIFEST_NOT_FOUND:
    "保存済みプレビューがありません。必要な工程を完了してください。",
  MANIFEST_INVALID:
    "保存済みプレビューが不正です。プレビューを再生成してください。",
  MANIFEST_UNREADABLE:
    "保存済みプレビューを読み込めません。プレビューを再生成してください。",
  MANIFEST_PROJECT_STALE:
    "保存済みプレビューが現在のプロジェクトと一致しません。プレビューを再生成してください."
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

function blockerMessage(code: string): string {
  return (
    blockerMessages[code] ?? "プレビューを実行できない理由を確認してください。"
  );
}

function blockerKey(blocker: ManifestPreviewBlocker): string {
  return JSON.stringify([blocker.code, blocker.target]);
}

function normalizeManifestPath(projectId: string, value: string): string {
  const prefix = `projects/${projectId}/`;
  if (value.startsWith("projects/")) {
    if (!value.startsWith(prefix)) {
      throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
    }
    return value.slice(prefix.length);
  }
  return value;
}

function toTarget(
  kind: BlockerTarget["kind"],
  values: Partial<Omit<BlockerTarget, "kind">> = {}
): BlockerTarget {
  return { kind, ...values };
}

function sourceAssetTarget(
  manifest: RenderManifest,
  assetPath: string
): BlockerTarget {
  const line = manifest.lines.find(
    (candidate) => candidate.audioPath === assetPath
  );
  if (line !== undefined) {
    return toTarget("voice", { lineId: line.id, path: assetPath });
  }

  const visual = manifest.visuals.find(
    (candidate) => candidate.src === assetPath
  );
  if (visual !== undefined) {
    return toTarget("visuals", {
      assignmentId: visual.sourceAssignmentId,
      path: assetPath
    });
  }

  const insert = manifest.inserts.find(
    (candidate) => candidate.src === assetPath
  );
  if (insert !== undefined) {
    return toTarget("asset", { assignmentId: insert.id, path: assetPath });
  }

  const background = manifest.backgrounds.find(
    (candidate) =>
      candidate.background.kind === "image" &&
      candidate.background.src === assetPath
  );
  if (background !== undefined) {
    return toTarget("asset", {
      sectionId: background.sectionId,
      path: assetPath
    });
  }

  const effect = manifest.soundEffects.find(
    (candidate) => candidate.src === assetPath
  );
  if (effect !== undefined) {
    return toTarget("asset", { lineId: effect.lineId, path: assetPath });
  }

  const track = manifest.audioTracks.find(
    (candidate) => candidate.src === assetPath
  );
  if (track !== undefined) {
    return toTarget("asset", { sectionId: track.sectionId, path: assetPath });
  }

  return toTarget("asset", { path: assetPath });
}

function addBlocker(
  blockers: ManifestPreviewBlocker[],
  code: string,
  target: BlockerTarget
): void {
  const blocker = { code, message: blockerMessage(code), target };
  if (
    !blockers.some((existing) => blockerKey(existing) === blockerKey(blocker))
  ) {
    blockers.push(blocker);
  }
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export class ManifestPreviewService {
  private readonly workspaceRoot: string;
  private readonly projectRepository: Pick<ProjectRepository, "read">;
  private readonly screenTemplateCatalog: ScreenTemplateCatalogPort | undefined;
  private readonly manifestStore: Pick<RenderManifestStore, "readDetailed">;
  private readonly audioStore: Pick<VoicevoxAudioStore, "readIndex">;
  private readonly voiceGenerationService: Pick<
    VoicevoxGenerationService,
    "getStatus"
  >;
  private readonly projectFileService: Pick<ProjectFileService, "resolveFile">;

  constructor(options: ManifestPreviewServiceOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.projectRepository = options.projectRepository;
    this.screenTemplateCatalog = options.screenTemplateCatalog;
    this.manifestStore =
      options.manifestStore ??
      new RenderManifestStore({
        workspaceRoot: this.workspaceRoot
      });
    this.audioStore =
      options.audioStore ??
      new VoicevoxAudioStore({
        workspaceRoot: this.workspaceRoot
      });
    this.voiceGenerationService = options.voiceGenerationService;
    this.projectFileService =
      options.projectFileService ??
      new ProjectFileService({ workspaceRoot: this.workspaceRoot });
  }

  async get(projectId: unknown): Promise<ManifestPreviewData> {
    const safeProjectId = idSchema.parse(projectId);
    const project = await this.projectRepository.read(safeProjectId);
    const manifestResult = await this.manifestStore.readDetailed(safeProjectId);
    const blockers: ManifestPreviewBlocker[] = [];

    this.addProjectStageBlockers(project, blockers);

    let audioIndex: VoicevoxAudioIndex | undefined;
    try {
      audioIndex = await this.audioStore.readIndex(safeProjectId);
    } catch {
      addBlocker(blockers, "AUDIO_INDEX_UNREADABLE", toTarget("voice"));
    }
    const manifest =
      manifestResult.status === "valid" ? manifestResult.manifest : null;
    const voiceLineStatuses = await this.readVoiceLineStatuses(
      safeProjectId,
      audioIndex
    );

    if (audioIndex !== undefined) {
      await this.addAudioBlockers(
        project,
        manifest,
        audioIndex,
        voiceLineStatuses,
        blockers
      );
    }

    if (manifest !== null) {
      if (manifest.sourceProjectHash !== computeSourceProjectHash(project)) {
        addBlocker(
          blockers,
          "MANIFEST_PROJECT_STALE",
          toTarget("manifest", { path: "cache/render-manifest.json" })
        );
      }
      await this.addAssetBlockers(safeProjectId, manifest, blockers);
    } else if (manifestResult.status === "missing") {
      addBlocker(
        blockers,
        "MANIFEST_NOT_FOUND",
        toTarget("manifest", { path: "cache/render-manifest.json" })
      );
    } else if (manifestResult.status === "invalid") {
      addBlocker(
        blockers,
        "MANIFEST_INVALID",
        toTarget("manifest", { path: "cache/render-manifest.json" })
      );
    } else {
      addBlocker(
        blockers,
        "MANIFEST_UNREADABLE",
        toTarget("manifest", { path: "cache/render-manifest.json" })
      );
    }

    const state =
      manifestResult.status === "missing"
        ? "missing"
        : manifestResult.status !== "valid"
          ? "invalid"
          : blockers.length === 0
            ? "current"
            : "stale";

    return manifestPreviewDataSchema.parse({
      project: {
        id: project.metadata.id,
        title: project.metadata.title
      },
      state,
      canPlay: state === "current" && manifest !== null,
      manifest,
      blockers
    });
  }

  private addProjectStageBlockers(
    project: VideoProject,
    blockers: ManifestPreviewBlocker[]
  ): void {
    if (project.outline.status !== "approved") {
      addBlocker(blockers, "OUTLINE_NOT_APPROVED", toTarget("outline"));
    }
    if (project.outline.sourceHash !== project.source.sha256) {
      addBlocker(blockers, "OUTLINE_SOURCE_HASH_MISMATCH", toTarget("outline"));
    }
    if (computeOutlineHash(project.outline) !== project.script.outlineHash) {
      addBlocker(blockers, "SCRIPT_OUTLINE_HASH_MISMATCH", toTarget("script"));
    }
    if (this.screenTemplateCatalog !== undefined) {
      for (const issue of validateVideoProjectScreenTemplateReferences(
        project,
        this.screenTemplateCatalog
      )) {
        const sectionIndex = issue.path[2];
        const section =
          typeof sectionIndex === "number"
            ? project.script.sections[sectionIndex]
            : undefined;
        const lineIndex = issue.path[4];
        const line =
          section !== undefined && typeof lineIndex === "number"
            ? section.lines[lineIndex]
            : undefined;
        addBlocker(
          blockers,
          "SCREEN_TEMPLATE_REFERENCE_INVALID",
          line !== undefined
            ? toTarget("script", { lineId: line.id })
            : toTarget("script", { sectionId: section?.id })
        );
      }
    }
  }

  private async addAudioBlockers(
    project: VideoProject,
    manifest: RenderManifest | null,
    audioIndex: VoicevoxAudioIndex,
    voiceLineStatuses: ReadonlyMap<string, VoiceLineGenerationStatus["status"]>,
    blockers: ManifestPreviewBlocker[]
  ): Promise<void> {
    const manifestLines = new Map(
      manifest?.lines.map((line) => [line.id, line]) ?? []
    );
    for (const line of project.script.sections.flatMap(
      (section) => section.lines
    )) {
      const target = toTarget("voice", {
        lineId: line.id,
        path: "cache/audio-index.json"
      });
      const entry = audioIndex[line.id];
      if (entry === undefined) {
        addBlocker(blockers, "AUDIO_INDEX_ENTRY_MISSING", target);
        continue;
      }

      if (voiceLineStatuses.get(line.id) !== "current") {
        addBlocker(blockers, "AUDIO_ENTRY_STALE", target);
      }

      const manifestLine = manifestLines.get(line.id);
      const manifestChecksum = manifest?.sourceAssetChecksums.find(
        (asset) => asset.path === entry.audioPath
      )?.sha256;
      if (
        manifest !== null &&
        (manifestLine?.audioPath !== entry.audioPath ||
          (manifestChecksum !== undefined &&
            manifestChecksum.toLowerCase() !== entry.audioSha256.toLowerCase()))
      ) {
        addBlocker(blockers, "AUDIO_MANIFEST_STALE", target);
      }
    }
  }

  private async readVoiceLineStatuses(
    projectId: string,
    audioIndex: VoicevoxAudioIndex | undefined
  ): Promise<ReadonlyMap<string, VoiceLineGenerationStatus["status"]>> {
    if (audioIndex === undefined || Object.keys(audioIndex).length === 0) {
      return new Map();
    }
    try {
      const status = await this.voiceGenerationService.getStatus(projectId);
      return new Map(
        status.lines.map((line) => [line.lineId, line.status] as const)
      );
    } catch {
      // If current voice conditions cannot be resolved, existing entries must
      // remain blocked rather than being treated as current by integrity alone.
      return new Map();
    }
  }

  private async addAssetBlockers(
    projectId: string,
    manifest: RenderManifest,
    blockers: ManifestPreviewBlocker[]
  ): Promise<void> {
    for (const asset of manifest.sourceAssetChecksums) {
      const target = sourceAssetTarget(manifest, asset.path);
      let filePath: string;
      try {
        filePath = await this.resolveManifestAssetFile(projectId, asset.path);
      } catch (error) {
        const code = errorCode(error);
        if (code === "PROJECT_FILE_PATH_INVALID") {
          addBlocker(blockers, "ASSET_PATH_INVALID", target);
        } else if (
          code === "PROJECT_FILE_NOT_FOUND" ||
          isMissingPathError(error)
        ) {
          addBlocker(blockers, "ASSET_MISSING", target);
        } else {
          addBlocker(blockers, "ASSET_UNREADABLE", target);
        }
        continue;
      }

      let actualChecksum: string;
      try {
        actualChecksum = await sha256File(filePath);
      } catch {
        addBlocker(blockers, "ASSET_UNREADABLE", target);
        continue;
      }
      if (actualChecksum.toLowerCase() !== asset.sha256.toLowerCase()) {
        addBlocker(blockers, "ASSET_CHECKSUM_MISMATCH", target);
      }
    }
  }

  private async resolveManifestAssetFile(
    projectId: string,
    manifestPath: string
  ): Promise<string> {
    if (manifestPath.startsWith("library/")) {
      const parsedPath = relativePosixPathSchema.safeParse(manifestPath);
      if (!parsedPath.success || manifestPath.includes("%")) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const libraryRoot = path.resolve(this.workspaceRoot, "library");
      const resolvedLibraryRoot = await fs.realpath(libraryRoot);
      const candidatePath = path.resolve(
        libraryRoot,
        ...manifestPath.slice("library/".length).split("/")
      );
      if (!isPathInside(libraryRoot, candidatePath)) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const resolvedCandidate = await fs.realpath(candidatePath);
      if (!isPathInside(resolvedLibraryRoot, resolvedCandidate)) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const stats = await fs.stat(resolvedCandidate);
      if (!stats.isFile()) {
        throw new ProjectFileServiceError("PROJECT_FILE_NOT_FOUND", 404);
      }
      return resolvedCandidate;
    }

    if (manifestPath.startsWith("shared-assets/")) {
      const parsedPath = relativePosixPathSchema.safeParse(manifestPath);
      if (!parsedPath.success || manifestPath.includes("%")) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const sharedRoot = path.resolve(
        this.workspaceRoot,
        "public",
        "shared-assets"
      );
      const resolvedSharedRoot = await fs.realpath(sharedRoot);
      const candidatePath = path.resolve(
        sharedRoot,
        ...manifestPath.slice("shared-assets/".length).split("/")
      );
      if (!isPathInside(sharedRoot, candidatePath)) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const resolvedCandidate = await fs.realpath(candidatePath);
      if (!isPathInside(resolvedSharedRoot, resolvedCandidate)) {
        throw new ProjectFileServiceError("PROJECT_FILE_PATH_INVALID", 400);
      }
      const stats = await fs.stat(resolvedCandidate);
      if (!stats.isFile()) {
        throw new ProjectFileServiceError("PROJECT_FILE_NOT_FOUND", 404);
      }
      return resolvedCandidate;
    }

    const projectRelativePath = normalizeManifestPath(projectId, manifestPath);
    return (
      await this.projectFileService.resolveFile(projectId, projectRelativePath)
    ).filePath;
  }
}
