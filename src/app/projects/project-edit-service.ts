import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  projectEditSaveRequestSchema,
  type ProjectEditSaveRequest
} from "../../schema/api.js";
import {
  idSchema,
  relativePosixPathSchema,
  sha256Schema,
  videoProjectSchema,
  type AssetDetail,
  type EditPlan,
  type EditVideoElement,
  type ProjectAssetSnapshot,
  type SectionBgmAssignment,
  type VideoProject
} from "../../schema/index.js";
import {
  ASSET_FORMATS,
  ASSET_KIND_FORMATS,
  assetFormatForMimeType
} from "../assets/asset-formats.js";
import { AssetRepository } from "../assets/asset-repository.js";
import {
  NodeVisualAssignmentFileSystem,
  type VisualAssignmentFileSystem
} from "./visual-assignment-file-system.js";
import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryLockedOperations
} from "./project-repository.js";
import {
  PROJECT_EDIT_ERROR_CODE,
  ProjectEditError
} from "./project-edit-errors.js";

type ProjectRepositoryPort = Pick<ProjectRepository, "withProjectLock">;
type AssetRepositoryPort = Pick<AssetRepository, "findAssetDetail">;

export type ProjectEditServiceOptions = {
  repository: ProjectRepositoryPort;
  assetRepository: AssetRepositoryPort;
  workspaceRoot: string;
  libraryRoot?: string;
  fileSystem?: Partial<VisualAssignmentFileSystem>;
  createId?: () => string;
};

export type ProjectEditReadResult = {
  readonly data: EditPlan;
  readonly revision: number;
};

export type ProjectEditMutationResult = {
  readonly data: VideoProject;
  readonly revision: number;
};

type ExpectedAssetKind = "video" | "bgm";

type ProjectPaths = {
  readonly projectRoot: string;
  readonly finalPath: string;
  readonly projectMediaPath: string;
};

type PendingImport = {
  readonly asset: AssetDetail;
  readonly projectPaths: ProjectPaths;
  readonly snapshot: ProjectAssetSnapshot;
};

type PlacementResult = {
  readonly createdFinalFile: boolean;
  readonly finalPath: string;
  readonly projectMediaPath: string;
};

function getFileSystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return getFileSystemErrorCode(error) === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return getFileSystemErrorCode(error) === "EEXIST";
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function normalizeChecksum(checksum: string): string {
  return checksum.toLowerCase();
}

function validationDetails(
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
): Array<{ path: Array<string | number>; message: string }> {
  return issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number"
    ),
    message: issue.message
  }));
}

function projectEditError(
  code: (typeof PROJECT_EDIT_ERROR_CODE)[keyof typeof PROJECT_EDIT_ERROR_CODE],
  status: 400 | 404 | 409 | 422 | 500,
  message: string,
  details: readonly { path: readonly (string | number)[]; message: string }[] = []
): ProjectEditError {
  return new ProjectEditError(
    code,
    status,
    message,
    details.map((detail) => ({
      path: [...detail.path],
      message: detail.message
    }))
  );
}

function projectRevisionConflict(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_REVISION_CONFLICT",
    409,
    "The project revision does not match the expected revision."
  );
}

function assetPathDetails(
  pathValue: readonly (string | number)[],
  message: string
): { path: Array<string | number>; message: string } {
  return { path: [...pathValue], message };
}

export class ProjectEditService {
  private readonly repository: ProjectRepositoryPort;
  private readonly assetRepository: AssetRepositoryPort;
  private readonly workspaceRoot: string;
  private readonly libraryRoot: string;
  private readonly fileSystem: VisualAssignmentFileSystem;
  private readonly createId: () => string;

  constructor(options: ProjectEditServiceOptions) {
    this.repository = options.repository;
    this.assetRepository = options.assetRepository;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.libraryRoot = path.resolve(
      options.libraryRoot ?? path.join(this.workspaceRoot, "library")
    );
    const defaultFileSystem = new NodeVisualAssignmentFileSystem();
    const suppliedFileSystem = options.fileSystem;
    this.fileSystem = {
      mkdir:
        suppliedFileSystem?.mkdir ??
        defaultFileSystem.mkdir.bind(defaultFileSystem),
      copyFile:
        suppliedFileSystem?.copyFile ??
        defaultFileSystem.copyFile.bind(defaultFileSystem),
      hashFile:
        suppliedFileSystem?.hashFile ??
        defaultFileSystem.hashFile.bind(defaultFileSystem),
      rename:
        suppliedFileSystem?.rename ??
        defaultFileSystem.rename.bind(defaultFileSystem),
      pathExists:
        suppliedFileSystem?.pathExists ??
        defaultFileSystem.pathExists.bind(defaultFileSystem),
      unlink:
        suppliedFileSystem?.unlink ??
        defaultFileSystem.unlink.bind(defaultFileSystem),
      realpath:
        suppliedFileSystem?.realpath ??
        defaultFileSystem.realpath.bind(defaultFileSystem)
    };
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
  }

  async read(projectId: unknown): Promise<ProjectEditReadResult> {
    const safeProjectId = this.parseProjectId(projectId);
    return this.repository.withProjectLock(safeProjectId, async (repository) => {
      const project = await repository.read();
      return { data: project.edit, revision: project.revision };
    });
  }

  async save(
    projectId: unknown,
    input: unknown
  ): Promise<ProjectEditMutationResult> {
    const safeProjectId = this.parseProjectId(projectId);
    const request = projectEditSaveRequestSchema.parse(input);
    return this.repository.withProjectLock(safeProjectId, (repository) =>
      this.saveLocked(safeProjectId, request, repository)
    );
  }

  private async saveLocked(
    projectId: string,
    request: ProjectEditSaveRequest,
    repository: ProjectRepositoryLockedOperations
  ): Promise<ProjectEditMutationResult> {
    const currentProject = await repository.read();
    if (currentProject.revision !== request.expectedRevision) {
      throw projectRevisionConflict();
    }

    const projectRoot = await this.resolveProjectRoot(projectId);
    const pendingImports: PendingImport[] = [];
    const videoElements: EditVideoElement[] = [];
    const sectionBgms: SectionBgmAssignment[] = [];

    for (const [index, input] of request.edit.videoElements.entries()) {
      const current = currentProject.edit.videoElements.find(
        (element) => element.id === input.id
      );
      if (
        current !== undefined &&
        current.assetId === input.assetId &&
        current.assetVersion === input.assetVersion
      ) {
        const asset = this.assetRepository.findAssetDetail(
          input.assetId,
          input.assetVersion
        );
        this.validateVideoTiming(
          input.startMs,
          asset,
          ["edit", "videoElements", index, "startMs"]
        );
        videoElements.push({ ...current, ...input });
        continue;
      }

      const pending = await this.prepareImport(
        input.assetId,
        input.assetVersion,
        "video",
        projectRoot,
        ["edit", "videoElements", index, "assetId"]
      );
      this.validateVideoTiming(
        input.startMs,
        pending.asset,
        ["edit", "videoElements", index, "startMs"]
      );
      pendingImports.push(pending);
      videoElements.push({ ...pending.snapshot, ...input });
    }

    for (const [index, input] of request.edit.sectionBgms.entries()) {
      const current = currentProject.edit.sectionBgms.find(
        (bgm) => bgm.id === input.id
      );
      if (
        current !== undefined &&
        current.assetId === input.assetId &&
        current.assetVersion === input.assetVersion
      ) {
        sectionBgms.push({ ...current, ...input });
        continue;
      }

      const pending = await this.prepareImport(
        input.assetId,
        input.assetVersion,
        "bgm",
        projectRoot,
        ["edit", "sectionBgms", index, "assetId"]
      );
      pendingImports.push(pending);
      sectionBgms.push({ ...pending.snapshot, ...input });
    }

    const candidateResult = videoProjectSchema.safeParse({
      ...currentProject,
      edit: { videoElements, sectionBgms }
    });
    if (!candidateResult.success) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.candidateInvalid,
        422,
        "The edit plan does not produce a valid project.",
        validationDetails(candidateResult.error.issues)
      );
    }

    const createdFiles: PlacementResult[] = [];
    try {
      for (const pending of pendingImports) {
        const sourcePath = await this.resolveLibrarySource(
          pending.asset.libraryMediaPath
        );
        const placement = await this.placeFile(
          sourcePath,
          pending.projectPaths,
          normalizeChecksum(pending.snapshot.assetChecksum)
        );
        if (placement.createdFinalFile) {
          createdFiles.push(placement);
        }
      }

      const saved = await repository.save(
        candidateResult.data,
        request.expectedRevision
      );
      return { data: saved, revision: saved.revision };
    } catch (error) {
      await this.cleanupCreatedFiles(repository, projectRoot, createdFiles);
      throw error;
    }
  }

  private async prepareImport(
    assetId: string,
    assetVersion: number,
    expectedKind: ExpectedAssetKind,
    projectRoot: string,
    detailPath: readonly (string | number)[]
  ): Promise<PendingImport> {
    const asset = this.assetRepository.findAssetDetail(assetId, assetVersion);
    if (asset === undefined) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.assetNotFound,
        404,
        "The selected edit asset does not exist.",
        [assetPathDetails(detailPath, "asset not found")]
      );
    }
    if (asset.status !== "active") {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.assetNotActive,
        422,
        "The selected edit asset is not active.",
        [assetPathDetails(detailPath, "asset is not active")]
      );
    }
    if (asset.kind !== expectedKind) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.assetKindMismatch,
        422,
        "The selected edit asset kind is not supported for this element.",
        [assetPathDetails(detailPath, "asset kind does not match the edit element")]
      );
    }

    const extension = this.extensionForAsset(asset, expectedKind, detailPath);
    const checksumResult = sha256Schema.safeParse(asset.checksum);
    if (!checksumResult.success) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.assetChecksumUnavailable,
        422,
        "The selected edit asset does not have a confirmed SHA-256 checksum.",
        [assetPathDetails(detailPath, "asset checksum is unavailable")]
      );
    }

    const projectMediaPath =
      expectedKind === "video"
        ? `media/edits/${asset.assetId}/v${asset.version}.${extension}`
        : `audio/bgm/${asset.assetId}/v${asset.version}.${extension}`;
    const finalPath = path.resolve(
      projectRoot,
      projectMediaPath.split("/").join(path.sep)
    );
    this.assertInside(
      projectRoot,
      finalPath,
      PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    return {
      asset,
      projectPaths: { projectRoot, finalPath, projectMediaPath },
      snapshot: {
        assetId: asset.assetId,
        assetVersion: asset.version,
        assetChecksum: checksumResult.data,
        projectMediaPath
      }
    };
  }

  private validateVideoTiming(
    startMs: number | null,
    asset: AssetDetail | undefined,
    detailPath: readonly (string | number)[]
  ): void {
    if (
      asset === undefined ||
      asset.durationMs === null ||
      !Number.isInteger(asset.durationMs) ||
      asset.durationMs <= 0
    ) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.candidateInvalid,
        422,
        "The selected edit video does not have a verified duration.",
        [assetPathDetails(detailPath, "asset durationMs is required")]
      );
    }
    if (startMs !== null && startMs >= asset.durationMs) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.candidateInvalid,
        422,
        "The edit video start time must be within the selected asset.",
        [assetPathDetails(detailPath, "startMs must be less than asset durationMs")]
      );
    }
  }

  private extensionForAsset(
    asset: AssetDetail,
    expectedKind: ExpectedAssetKind,
    detailPath: readonly (string | number)[]
  ): string {
    const allowedFormats = ASSET_KIND_FORMATS[expectedKind];
    const mimeFormat = assetFormatForMimeType(asset.mimeType);
    const pathResult = relativePosixPathSchema.safeParse(
      asset.libraryMediaPath
    );
    if (!pathResult.success) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
        422,
        "The asset library path is invalid.",
        [assetPathDetails(detailPath, "asset library path is invalid")]
      );
    }
    const pathExtension = pathResult.success
      ? path.posix.extname(pathResult.data).slice(1).toLowerCase()
      : "";
    const expectedExtension =
      mimeFormat === undefined ? undefined : ASSET_FORMATS[mimeFormat].extension;

    if (
      mimeFormat === undefined ||
      !allowedFormats.includes(mimeFormat) ||
      expectedExtension === undefined ||
      pathExtension !== expectedExtension
    ) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.assetFormatMismatch,
        422,
        "The selected edit asset format is not supported.",
        [assetPathDetails(detailPath, "asset format does not match the edit element")]
      );
    }

    return expectedExtension;
  }

  private parseProjectId(projectId: unknown): string {
    const result = idSchema.safeParse(projectId);
    if (!result.success) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    return result.data;
  }

  private async resolveProjectRoot(projectId: string): Promise<string> {
    let workspaceRoot: string;
    let projectsRoot: string;
    let projectRoot: string;
    try {
      workspaceRoot = await this.fileSystem.realpath(this.workspaceRoot);
      projectsRoot = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects")
      );
      projectRoot = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects", projectId)
      );
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }

    this.assertInside(
      workspaceRoot,
      projectsRoot,
      PROJECT_EDIT_ERROR_CODE.projectPathInvalid,
      "The project path is invalid.",
      400
    );
    this.assertInside(
      projectsRoot,
      projectRoot,
      PROJECT_EDIT_ERROR_CODE.projectPathInvalid,
      "The project path is invalid.",
      400
    );
    return projectRoot;
  }

  private async resolveLibrarySource(libraryMediaPath: string): Promise<string> {
    const pathResult = relativePosixPathSchema.safeParse(libraryMediaPath);
    if (!pathResult.success) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
        422,
        "The asset library path is invalid."
      );
    }

    let libraryRoot: string;
    try {
      libraryRoot = await this.fileSystem.realpath(this.libraryRoot);
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
        422,
        "The asset library path is invalid."
      );
    }

    const sourcePath = path.resolve(
      libraryRoot,
      pathResult.data.split("/").join(path.sep)
    );
    this.assertInside(
      libraryRoot,
      sourcePath,
      PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
      "The asset library path is invalid."
    );

    try {
      if (!(await this.fileSystem.pathExists(sourcePath))) {
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.libraryFileNotFound,
          500,
          "The active edit asset file is unavailable."
        );
      }
    } catch (error) {
      if (error instanceof ProjectEditError) {
        throw error;
      }
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.libraryFileNotFound,
        500,
        "The active edit asset file is unavailable."
      );
    }

    let resolvedSourcePath: string;
    try {
      resolvedSourcePath = await this.fileSystem.realpath(sourcePath);
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.libraryFileNotFound,
        500,
        "The active edit asset file is unavailable."
      );
    }
    this.assertInside(
      libraryRoot,
      resolvedSourcePath,
      PROJECT_EDIT_ERROR_CODE.libraryPathInvalid,
      "The asset library path is invalid."
    );
    return sourcePath;
  }

  private async ensureProjectDirectory(
    projectRoot: string,
    directoryPath: string
  ): Promise<void> {
    this.assertInside(
      projectRoot,
      directoryPath,
      PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    let probe = directoryPath;
    while (true) {
      try {
        const resolvedProbe = await this.fileSystem.realpath(probe);
        this.assertInside(
          projectRoot,
          resolvedProbe,
          PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
          "The project media path is invalid."
        );
        break;
      } catch (error) {
        if (!isMissingPathError(error)) {
          if (error instanceof ProjectEditError) {
            throw error;
          }
          throw projectEditError(
            PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
            422,
            "The project media path is invalid."
          );
        }
        const parent = path.dirname(probe);
        if (parent === probe || !isPathInside(projectRoot, parent)) {
          throw projectEditError(
            PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
            422,
            "The project media path is invalid."
          );
        }
        probe = parent;
      }
    }

    try {
      await this.fileSystem.mkdir(directoryPath);
      const resolvedDirectory = await this.fileSystem.realpath(directoryPath);
      this.assertInside(
        projectRoot,
        resolvedDirectory,
        PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
        "The project media path is invalid."
      );
    } catch (error) {
      if (error instanceof ProjectEditError) {
        throw error;
      }
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
        422,
        "The project media path is invalid."
      );
    }
  }

  private async inspectExistingFinal(
    projectRoot: string,
    finalPath: string,
    expectedChecksum: string
  ): Promise<boolean> {
    let exists: boolean;
    try {
      exists = await this.fileSystem.pathExists(finalPath);
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.mediaPathCheckFailed,
        500,
        "The project media path could not be checked."
      );
    }
    if (!exists) {
      return false;
    }

    let resolvedFinalPath: string;
    try {
      resolvedFinalPath = await this.fileSystem.realpath(finalPath);
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.mediaPathConflict,
        409,
        "The project media path is already occupied."
      );
    }
    this.assertInside(
      projectRoot,
      resolvedFinalPath,
      PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    let existingChecksum: string;
    try {
      existingChecksum = normalizeChecksum(
        await this.fileSystem.hashFile(finalPath)
      );
    } catch {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.mediaPathConflict,
        409,
        "The project media path is already occupied."
      );
    }
    if (existingChecksum === expectedChecksum) {
      return true;
    }
    throw projectEditError(
      PROJECT_EDIT_ERROR_CODE.mediaPathConflict,
      409,
      "The project media path contains different content."
    );
  }

  private async placeFile(
    sourcePath: string,
    projectPaths: ProjectPaths,
    expectedChecksum: string
  ): Promise<PlacementResult> {
    const directoryPath = path.dirname(projectPaths.finalPath);
    await this.ensureProjectDirectory(projectPaths.projectRoot, directoryPath);

    if (
      await this.inspectExistingFinal(
        projectPaths.projectRoot,
        projectPaths.finalPath,
        expectedChecksum
      )
    ) {
      return {
        createdFinalFile: false,
        finalPath: projectPaths.finalPath,
        projectMediaPath: projectPaths.projectMediaPath
      };
    }

    const tempToken = this.createId().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(tempToken)) {
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.copyFailed,
        500,
        "The edit asset could not be copied into the project."
      );
    }
    const temporaryPath = path.join(
      directoryPath,
      `.${path.basename(projectPaths.finalPath)}.${tempToken}.tmp`
    );
    let temporaryCreated = false;

    try {
      try {
        await this.fileSystem.copyFile(sourcePath, temporaryPath);
        temporaryCreated = true;
      } catch (error) {
        if (!isExistingPathError(error)) {
          await this.cleanupTemporaryFile(temporaryPath);
        }
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.copyFailed,
          500,
          "The edit asset could not be copied into the project."
        );
      }

      let copiedChecksum: string;
      try {
        copiedChecksum = normalizeChecksum(
          await this.fileSystem.hashFile(temporaryPath)
        );
      } catch {
        await this.cleanupTemporaryFile(temporaryPath);
        temporaryCreated = false;
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.hashFailed,
          500,
          "The copied edit asset could not be verified."
        );
      }

      if (copiedChecksum !== expectedChecksum) {
        await this.cleanupTemporaryFile(temporaryPath);
        temporaryCreated = false;
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.checksumMismatch,
          422,
          "The copied edit asset checksum does not match the library record."
        );
      }

      try {
        if (
          await this.inspectExistingFinal(
            projectPaths.projectRoot,
            projectPaths.finalPath,
            expectedChecksum
          )
        ) {
          await this.cleanupTemporaryFile(temporaryPath);
          temporaryCreated = false;
          return {
            createdFinalFile: false,
            finalPath: projectPaths.finalPath,
            projectMediaPath: projectPaths.projectMediaPath
          };
        }
      } catch (error) {
        await this.cleanupTemporaryFile(temporaryPath);
        temporaryCreated = false;
        throw error;
      }

      try {
        await this.fileSystem.rename(temporaryPath, projectPaths.finalPath);
        temporaryCreated = false;
        return {
          createdFinalFile: true,
          finalPath: projectPaths.finalPath,
          projectMediaPath: projectPaths.projectMediaPath
        };
      } catch {
        try {
          if (
            await this.inspectExistingFinal(
              projectPaths.projectRoot,
              projectPaths.finalPath,
              expectedChecksum
            )
          ) {
            await this.cleanupTemporaryFile(temporaryPath);
            temporaryCreated = false;
            return {
              createdFinalFile: false,
              finalPath: projectPaths.finalPath,
              projectMediaPath: projectPaths.projectMediaPath
            };
          }
        } catch (raceError) {
          await this.cleanupTemporaryFile(temporaryPath);
          temporaryCreated = false;
          throw raceError;
        }
        await this.cleanupTemporaryFile(temporaryPath);
        temporaryCreated = false;
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.renameFailed,
          500,
          "The copied edit asset could not be placed in the project."
        );
      }
    } finally {
      if (temporaryCreated) {
        await this.cleanupTemporaryFile(temporaryPath);
      }
    }
  }

  private async cleanupTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw projectEditError(
        PROJECT_EDIT_ERROR_CODE.cleanupFailed,
        500,
        "The failed edit asset import could not be cleaned up."
      );
    }
  }

  private async cleanupCreatedFiles(
    repository: ProjectRepositoryLockedOperations,
    projectRoot: string,
    createdFiles: readonly PlacementResult[]
  ): Promise<void> {
    if (createdFiles.length === 0) {
      return;
    }

    let currentProject: VideoProject;
    try {
      currentProject = await repository.read();
    } catch {
      // If the current project cannot be read, leave the file in place as an
      // orphan rather than risking deletion of a referenced file.
      return;
    }

    const referencedPaths = new Set([
      ...currentProject.edit.videoElements.map(
        (element) => element.projectMediaPath
      ),
      ...currentProject.edit.sectionBgms.map((bgm) => bgm.projectMediaPath)
    ]);

    for (const createdFile of createdFiles) {
      if (referencedPaths.has(createdFile.projectMediaPath)) {
        continue;
      }

      try {
        if (!(await this.fileSystem.pathExists(createdFile.finalPath))) {
          continue;
        }
        const resolvedFinalPath = await this.fileSystem.realpath(
          createdFile.finalPath
        );
        this.assertInside(
          projectRoot,
          resolvedFinalPath,
          PROJECT_EDIT_ERROR_CODE.mediaPathInvalid,
          "The project media path is invalid."
        );
        await this.fileSystem.unlink(createdFile.finalPath);
      } catch (error) {
        if (isMissingPathError(error)) {
          continue;
        }
        if (error instanceof ProjectEditError) {
          throw error;
        }
        throw projectEditError(
          PROJECT_EDIT_ERROR_CODE.cleanupFailed,
          500,
          "The failed edit asset import could not be cleaned up."
        );
      }
    }
  }

  private assertInside(
    rootPath: string,
    candidatePath: string,
    code: ProjectEditError["code"],
    message: string,
    status: 400 | 422 = 422
  ): void {
    if (!isPathInside(rootPath, candidatePath)) {
      throw projectEditError(code, status, message);
    }
  }
}
