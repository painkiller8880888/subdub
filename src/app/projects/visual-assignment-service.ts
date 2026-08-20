import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  visualAssignmentRequestSchema,
  visualAssignmentUpdateRequestSchema,
  visualAssignmentDeleteRequestSchema,
  visualApprovalRequestSchema,
  type VisualAssignmentUpdateRequest,
  type VisualAssignmentRequest
} from "../../schema/api.js";
import {
  displayV15Schema,
  idSchema,
  relativePosixPathSchema,
  sha256Schema,
  visualSuggestionCandidateSchema,
  videoProjectSchema,
  type DisplayInput,
  type DisplayV15,
  type AssetDetail,
  type VisualAssignment,
  type VideoProject
} from "../../schema/index.js";
import { normalizeImprovementReason } from "../../schema/improvement-log.js";
import {
  ASSET_FORMATS,
  ASSET_KIND_FORMATS,
  assetFormatForMimeType,
  type AssetFormat
} from "../assets/asset-formats.js";
import { AssetRepository } from "../assets/asset-repository.js";
import {
  ProjectRepository,
  ProjectRepositoryError,
  type ProjectRepositoryLockedOperations
} from "./project-repository.js";
import {
  VISUAL_ASSIGNMENT_ERROR_CODE,
  VisualAssignmentError
} from "./visual-assignment-errors.js";
import type {
  ImprovementLogRepositoryPort
} from "./improvement-log-repository.js";
import {
  IMPROVEMENT_LOG_ERROR_CODE,
  ImprovementLogError
} from "./improvement-log-errors.js";
import { hasMeaningfulVisuals } from "./project-invalidation.js";
import {
  NodeVisualAssignmentFileSystem,
  type VisualAssignmentFileSystem
} from "./visual-assignment-file-system.js";

type ProjectRepositoryPort = Pick<ProjectRepository, "withProjectLock">;
type AssetRepositoryPort = Pick<AssetRepository, "findAssetDetail">;

export type VisualAssignmentServiceOptions = {
  repository: ProjectRepositoryPort;
  assetRepository: AssetRepositoryPort;
  workspaceRoot: string;
  libraryRoot?: string;
  fileSystem?: Partial<VisualAssignmentFileSystem>;
  createId?: () => string;
  improvementLogRepository?: ImprovementLogRepositoryPort;
};

export type VisualAssignmentServiceResult = {
  readonly data: VideoProject;
  readonly revision: number;
};

type ProjectPaths = {
  readonly projectRoot: string;
  readonly finalPath: string;
  readonly projectMediaPath: string;
};

type PlacementResult = {
  readonly createdFinalFile: boolean;
  readonly finalPath: string;
  readonly projectMediaPath: string;
};

function isMissingPathError(error: unknown): boolean {
  return getFileSystemErrorCode(error) === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return getFileSystemErrorCode(error) === "EEXIST";
}

function getFileSystemErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
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

function visualAssignmentError(
  code: (typeof VISUAL_ASSIGNMENT_ERROR_CODE)[keyof typeof VISUAL_ASSIGNMENT_ERROR_CODE],
  status: 400 | 404 | 409 | 422 | 500,
  message: string,
  details: readonly {
    path: readonly (string | number)[];
    message: string;
  }[] = []
): VisualAssignmentError {
  return new VisualAssignmentError(code, status, message, details);
}

function projectRevisionConflict(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_REVISION_CONFLICT",
    409,
    "The project revision does not match the expected revision."
  );
}

function visualMutationStatus(
  currentProject: VideoProject,
  currentAssignments: readonly VisualAssignment[],
  nextAssignments: readonly VisualAssignment[]
): VideoProject["visuals"]["status"] {
  if (JSON.stringify(currentAssignments) === JSON.stringify(nextAssignments)) {
    return currentProject.visuals.status;
  }

  return hasMeaningfulVisuals(currentProject)
    ? "needs_review"
    : currentProject.visuals.status;
}

function assignmentDetails(
  assignmentIndex: number,
  path: readonly (string | number)[],
  message: string
): { path: Array<string | number>; message: string } {
  return {
    path: ["visuals", "assignments", assignmentIndex, ...path],
    message
  };
}

function hasCurrentLineRange(
  project: VideoProject,
  startLineId: string,
  endLineId: string
): boolean {
  return project.script.sections.some((section) => {
    const startIndex = section.lines.findIndex((line) => line.id === startLineId);
    const endIndex = section.lines.findIndex((line) => line.id === endLineId);
    return startIndex >= 0 && endIndex >= startIndex;
  });
}

type DisplayDomainIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
  readonly metadataUnavailable?: boolean;
};

function displayDomainIssues(
  asset: AssetDetail,
  display: DisplayV15
): DisplayDomainIssue[] {
  if (display.kind === "video") {
    if (
      asset.durationMs === null ||
      !Number.isInteger(asset.durationMs) ||
      asset.durationMs <= 0
    ) {
      return [
        {
          path: ["endMs"],
          message: "video duration is unavailable",
          metadataUnavailable: true
        }
      ];
    }
    if (display.endMs > asset.durationMs) {
      return [
        {
          path: ["endMs"],
          message: "video display range exceeds the asset duration"
        }
      ];
    }
  }

  if (display.kind === "document_scan") {
    if (
      asset.pageCount === null ||
      !Number.isInteger(asset.pageCount) ||
      asset.pageCount <= 0
    ) {
      return [
        {
          path: ["page"],
          message: "document page count is unavailable",
          metadataUnavailable: true
        }
      ];
    }
    if (display.page > asset.pageCount) {
      return [
        {
          path: ["page"],
          message: "document page is outside the asset page count"
        }
      ];
    }
  }

  return [];
}

function formatFromLibraryPath(
  libraryMediaPath: string,
  kind: AssetDetail["kind"]
): AssetFormat | undefined {
  const extension = path.posix.extname(libraryMediaPath).slice(1).toLowerCase();
  if (extension.length === 0) {
    return undefined;
  }

  for (const format of Object.keys(ASSET_FORMATS) as AssetFormat[]) {
    const info = ASSET_FORMATS[format];
    if (info.kind === kind && info.extension === extension) {
      return format;
    }
  }
  return undefined;
}

function extensionForAsset(detail: AssetDetail): string {
  const allowedFormats = ASSET_KIND_FORMATS[detail.kind];
  const mimeFormat = assetFormatForMimeType(detail.mimeType);
  if (mimeFormat !== undefined && allowedFormats.includes(mimeFormat)) {
    return ASSET_FORMATS[mimeFormat].extension;
  }

  const pathFormat = formatFromLibraryPath(detail.libraryMediaPath, detail.kind);
  if (pathFormat !== undefined && allowedFormats.includes(pathFormat)) {
    return ASSET_FORMATS[pathFormat].extension;
  }

  throw visualAssignmentError(
    VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
    422,
    "The asset media path does not have a supported visual extension."
  );
}

export class VisualAssignmentService {
  private readonly repository: ProjectRepositoryPort;
  private readonly assetRepository: AssetRepositoryPort;
  private readonly workspaceRoot: string;
  private readonly libraryRoot: string;
  private readonly fileSystem: VisualAssignmentFileSystem;
  private readonly createId: () => string;
  private readonly improvementLogRepository:
    | ImprovementLogRepositoryPort
    | undefined;

  constructor(options: VisualAssignmentServiceOptions) {
    this.repository = options.repository;
    this.assetRepository = options.assetRepository;
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.libraryRoot = path.resolve(
      options.libraryRoot ?? path.join(this.workspaceRoot, "library")
    );
    const defaultFileSystem = new NodeVisualAssignmentFileSystem();
    const suppliedFileSystem = options.fileSystem;
    this.fileSystem = {
      mkdir: suppliedFileSystem?.mkdir ?? defaultFileSystem.mkdir.bind(defaultFileSystem),
      copyFile:
        suppliedFileSystem?.copyFile ??
        defaultFileSystem.copyFile.bind(defaultFileSystem),
      hashFile:
        suppliedFileSystem?.hashFile ??
        defaultFileSystem.hashFile.bind(defaultFileSystem),
      rename:
        suppliedFileSystem?.rename ?? defaultFileSystem.rename.bind(defaultFileSystem),
      pathExists:
        suppliedFileSystem?.pathExists ??
        defaultFileSystem.pathExists.bind(defaultFileSystem),
      unlink:
        suppliedFileSystem?.unlink ?? defaultFileSystem.unlink.bind(defaultFileSystem),
      realpath:
        suppliedFileSystem?.realpath ??
        defaultFileSystem.realpath.bind(defaultFileSystem)
    };
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.improvementLogRepository = options.improvementLogRepository;
  }

  async assign(
    projectId: unknown,
    input: unknown
  ): Promise<VisualAssignmentServiceResult> {
    const projectIdResult = idSchema.safeParse(projectId);
    if (!projectIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    const safeProjectId = projectIdResult.data;
    const request = visualAssignmentRequestSchema.parse(input);
    return this.repository.withProjectLock(safeProjectId, (repository) =>
      this.assignLocked(safeProjectId, request, repository)
    );
  }

  async update(
    projectId: unknown,
    assignmentId: unknown,
    input: unknown
  ): Promise<VisualAssignmentServiceResult> {
    const projectIdResult = idSchema.safeParse(projectId);
    if (!projectIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    const assignmentIdResult = idSchema.safeParse(assignmentId);
    if (!assignmentIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound,
        404,
        "The visual assignment does not exist."
      );
    }
    const request = visualAssignmentUpdateRequestSchema.parse(input);
    return this.repository.withProjectLock(projectIdResult.data, (repository) =>
      this.updateLocked(
        assignmentIdResult.data,
        request,
        repository
      )
    );
  }

  async remove(
    projectId: unknown,
    assignmentId: unknown,
    input: unknown
  ): Promise<VisualAssignmentServiceResult> {
    const projectIdResult = idSchema.safeParse(projectId);
    if (!projectIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    const assignmentIdResult = idSchema.safeParse(assignmentId);
    if (!assignmentIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound,
        404,
        "The visual assignment does not exist."
      );
    }
    const request = visualAssignmentDeleteRequestSchema.parse(input);
    return this.repository.withProjectLock(projectIdResult.data, (repository) =>
      this.removeLocked(
        assignmentIdResult.data,
        request.expectedRevision,
        repository
      )
    );
  }

  async approve(
    projectId: unknown,
    input: unknown
  ): Promise<VisualAssignmentServiceResult> {
    const projectIdResult = idSchema.safeParse(projectId);
    if (!projectIdResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    const request = visualApprovalRequestSchema.parse(input);
    return this.repository.withProjectLock(projectIdResult.data, (repository) =>
      this.approveLocked(
        projectIdResult.data,
        request.expectedRevision,
        repository
      )
    );
  }

  private async assignLocked(
    safeProjectId: string,
    request: VisualAssignmentRequest,
    repository: ProjectRepositoryLockedOperations
  ): Promise<VisualAssignmentServiceResult> {
    const currentProject = await repository.read();

    if (currentProject.revision !== request.expectedRevision) {
      throw projectRevisionConflict();
    }

    if (
      currentProject.visuals.assignments.some(
        (assignment) => assignment.id === request.assignment.id
      )
    ) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdConflict,
        409,
        "The visual assignment ID is already in use."
      );
    }

    const aiCandidate = await this.findAiCandidate(
      safeProjectId,
      currentProject,
      request
    );

    const asset = this.assetRepository.findAssetDetail(
      request.assignment.assetId
    );
    if (asset === undefined) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound,
        404,
        "The selected asset does not exist."
      );
    }

    const display = this.normalizeDisplay(
      request.assignment.display ?? this.createDefaultDisplay(asset),
      "content-slot-relative"
    );
    if (
      aiCandidate !== undefined &&
      (aiCandidate.candidatePayload.asset.status !== "active" ||
        aiCandidate.candidatePayload.asset.checksum === null ||
        asset.checksum === null ||
        aiCandidate.candidatePayload.asset.checksum.toLowerCase() !==
          asset.checksum.toLowerCase())
    ) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
        422,
        "The visual suggestion asset is no longer active or unchanged."
      );
    }
    this.assertAssetUsable(asset, display.kind);
    this.assertDisplayWithinAsset(asset, display);
    const confirmedChecksum = this.assertChecksum(asset.checksum);
    const checksum = normalizeChecksum(confirmedChecksum);
    const extension = extensionForAsset(asset);
    const projectRoot = await this.resolveProjectRoot(safeProjectId);
    const sourcePath = await this.resolveLibrarySource(asset.libraryMediaPath);
    const projectPaths = this.resolveProjectMediaPaths(
      projectRoot,
      asset,
      extension
    );
    const assignment = {
      ...request.assignment,
      display,
      assetId: asset.assetId,
      assetChecksum: confirmedChecksum,
      projectMediaPath: projectPaths.projectMediaPath
    };
    const assignments = [...currentProject.visuals.assignments, assignment];
    const candidate = {
      ...currentProject,
      visuals: {
        ...currentProject.visuals,
        status: visualMutationStatus(
          currentProject,
          currentProject.visuals.assignments,
          assignments
        ),
        assignments
      }
    };
    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
        422,
        "The visual assignment does not produce a valid project.",
        validationDetails(candidateResult.error.issues)
      );
    }

    const placement = await this.placeFile(
      sourcePath,
      projectPaths,
      checksum
    );

    try {
      const saved = await repository.save(
        candidateResult.data,
        request.expectedRevision
      );
      if (aiCandidate !== undefined && this.improvementLogRepository !== undefined) {
        const savedAssignment = saved.visuals.assignments.find(
          (item) => item.id === assignment.id
        );
        if (savedAssignment === undefined) {
          throw new ImprovementLogError(
            IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
            422,
            "The saved visual assignment could not be related to the candidate."
          );
        }
        await this.improvementLogRepository.insertDecision({
          decisionId: `${aiCandidate.candidateId}-decision-accepted`,
          candidateId: aiCandidate.candidateId,
          projectId: saved.metadata.id,
          projectRevisionBefore: request.expectedRevision,
          projectRevisionAfter: saved.revision,
          decision: "accepted",
          after: savedAssignment,
          reason: normalizeImprovementReason(request.reason),
          createdAt: new Date().toISOString()
        });
      }
      return { data: saved, revision: saved.revision };
    } catch (error) {
      if (placement.createdFinalFile) {
        await this.cleanupFinalFileIfUnreferenced(
          repository,
          projectPaths.projectRoot,
          placement.finalPath,
          placement.projectMediaPath
        );
      }
      throw error;
    }
  }

  private async findAiCandidate(
    projectId: string,
    project: VideoProject,
    request: VisualAssignmentRequest
  ) {
    if (request.suggestionRunId === undefined) {
      return undefined;
    }
    if (this.improvementLogRepository === undefined) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.databaseFailed,
        500,
        "The improvement log is unavailable."
      );
    }
    const candidate =
      await this.improvementLogRepository.findGenerationCandidate({
        projectId,
        generationRunId: request.suggestionRunId,
        candidateKey: `asset:${request.assignment.assetId}`
      });
    if (candidate === undefined) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.candidateNotFound,
        404,
        "The visual suggestion candidate does not exist."
      );
    }
    if (
      candidate.taskKind !== "visual_search_intent" ||
      candidate.targetKind !== "visual_line_range" ||
      candidate.projectRevision !== project.revision ||
      !project.visuals.suggestionRunIds.includes(request.suggestionRunId) ||
      candidate.targetId !==
        `${request.assignment.startLineId}:${request.assignment.endLineId}`
    ) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
        409,
        "The visual suggestion candidate no longer matches this project revision or line range."
      );
    }
    if (
      !hasCurrentLineRange(
        project,
        request.assignment.startLineId,
        request.assignment.endLineId
      )
    ) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
        422,
        "The visual suggestion line range no longer exists."
      );
    }
    const payload = visualSuggestionCandidateSchema.safeParse(
      candidate.candidateJson
    );
    if (!payload.success || payload.data.asset.assetId !== request.assignment.assetId) {
      throw new ImprovementLogError(
        IMPROVEMENT_LOG_ERROR_CODE.relationInvalid,
        422,
        "The visual suggestion candidate asset relation is invalid."
      );
    }
    return { ...candidate, candidatePayload: payload.data };
  }

  private createDefaultDisplay(asset: AssetDetail): DisplayInput {
    const common = {
      fit: "contain" as const,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      position: { x: 0.5, y: 0.5 },
      prioritizeVisual: false,
      annotations: []
    };

    if (asset.kind === "video") {
      if (
        asset.durationMs === null ||
        !Number.isInteger(asset.durationMs) ||
        asset.durationMs <= 0
      ) {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.assetMetadataUnavailable,
          422,
          "The selected video does not have a confirmed duration.",
          [{ path: ["assignment", "display", "endMs"], message: "duration is unavailable" }]
        );
      }
      return {
        ...common,
        kind: "video",
        startMs: 0,
        endMs: asset.durationMs,
        playbackRate: 1,
        volume: 0,
        playbackCues: []
      };
    }

    if (asset.kind === "document_scan") {
      if (
        asset.pageCount === null ||
        !Number.isInteger(asset.pageCount) ||
        asset.pageCount <= 0
      ) {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.assetMetadataUnavailable,
          422,
          "The selected document does not have a confirmed page count.",
          [{ path: ["assignment", "display", "page"], message: "page count is unavailable" }]
        );
      }
      return { ...common, kind: "document_scan", page: 1 };
    }

    if (asset.kind === "photo") {
      return { ...common, kind: "photo" };
    }

    throw visualAssignmentError(
      VISUAL_ASSIGNMENT_ERROR_CODE.assetKindUnsupported,
      422,
      "Sound effects cannot be used as visual assignments."
    );
  }

  private normalizeDisplay(
    display: DisplayInput,
    fallbackCoordinateSpace: DisplayV15["displayCoordinateSpace"]
  ): DisplayV15 {
    return displayV15Schema.parse({
      ...display,
      displayCoordinateSpace:
        display.displayCoordinateSpace ?? fallbackCoordinateSpace
    });
  }

  private assertDisplayWithinAsset(
    asset: AssetDetail,
    display: DisplayV15
  ): void {
    const displayResult = displayV15Schema.safeParse(display);
    if (!displayResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
        422,
        "The visual display settings are invalid.",
        validationDetails(displayResult.error.issues).map((issue) => ({
          path: ["assignment", "display", ...issue.path],
          message: issue.message
        }))
      );
    }

    const issues = displayDomainIssues(asset, displayResult.data);
    if (issues.length === 0) {
      return;
    }
    const firstIssue = issues[0];
    if (firstIssue === undefined) {
      return;
    }
    throw visualAssignmentError(
      firstIssue.metadataUnavailable
        ? VISUAL_ASSIGNMENT_ERROR_CODE.assetMetadataUnavailable
        : VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
      422,
      firstIssue.metadataUnavailable
        ? "The selected asset is missing required display metadata."
        : "The visual display range is outside the asset bounds.",
      [
        {
          path: ["assignment", "display", ...firstIssue.path],
          message: firstIssue.message
        }
      ]
    );
  }

  private async updateLocked(
    assignmentId: string,
    request: VisualAssignmentUpdateRequest,
    repository: ProjectRepositoryLockedOperations
  ): Promise<VisualAssignmentServiceResult> {
    const currentProject = await repository.read();
    if (currentProject.revision !== request.expectedRevision) {
      throw projectRevisionConflict();
    }
    if (request.assignment.id !== assignmentId) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentIdMismatch,
        422,
        "The assignment ID in the URL and body must match.",
        [{ path: ["assignment", "id"], message: "assignment ID mismatch" }]
      );
    }

    const assignmentIndex = currentProject.visuals.assignments.findIndex(
      (assignment) => assignment.id === assignmentId
    );
    const currentAssignment = currentProject.visuals.assignments[assignmentIndex];
    if (currentAssignment === undefined) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound,
        404,
        "The visual assignment does not exist."
      );
    }
    if (request.assignment.assetId !== currentAssignment.assetId) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentAssetReplacementUnsupported,
        422,
        "Replace an asset by creating a new assignment and removing the old one."
      );
    }

    const asset = this.assetRepository.findAssetDetail(currentAssignment.assetId);
    if (asset === undefined) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound,
        404,
        "The selected asset does not exist.",
        [{ path: ["assignment", "assetId"], message: "asset not found" }]
      );
    }
    const display = this.normalizeDisplay(
      request.assignment.display,
      currentAssignment.display.displayCoordinateSpace
    );
    if (
      display.displayCoordinateSpace !==
      currentAssignment.display.displayCoordinateSpace
    ) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
        422,
        "Changing display coordinate space requires an explicit conversion operation.",
        [
          {
            path: ["assignment", "display", "displayCoordinateSpace"],
            message:
              "display coordinate space cannot be changed by a regular update"
          }
        ]
      );
    }
    this.assertAssetUsable(asset, display.kind);
    this.assertDisplayWithinAsset(asset, display);
    const confirmedChecksum = this.assertChecksum(asset.checksum);
    if (
      normalizeChecksum(confirmedChecksum) !==
      normalizeChecksum(currentAssignment.assetChecksum)
    ) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.checksumMismatch,
        422,
        "The current asset checksum no longer matches the assignment.",
        [{ path: ["assignment", "assetChecksum"], message: "checksum mismatch" }]
      );
    }

    const updatedAssignment: VisualAssignment = {
      ...currentAssignment,
      startLineId: request.assignment.startLineId,
      endLineId: request.assignment.endLineId,
      display
    };
    const assignments = currentProject.visuals.assignments.map((assignment) =>
      assignment.id === assignmentId ? updatedAssignment : assignment
    );
    const candidate = {
      ...currentProject,
      visuals: {
        ...currentProject.visuals,
        status: visualMutationStatus(
          currentProject,
          currentProject.visuals.assignments,
          assignments
        ),
        assignments
      }
    };
    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
        422,
        "The visual assignment does not produce a valid project.",
        validationDetails(candidateResult.error.issues)
      );
    }
    const saved = await repository.save(
      candidateResult.data,
      request.expectedRevision
    );
    return { data: saved, revision: saved.revision };
  }

  private async removeLocked(
    assignmentId: string,
    expectedRevision: number,
    repository: ProjectRepositoryLockedOperations
  ): Promise<VisualAssignmentServiceResult> {
    const currentProject = await repository.read();
    if (currentProject.revision !== expectedRevision) {
      throw projectRevisionConflict();
    }
    if (
      !currentProject.visuals.assignments.some(
        (assignment) => assignment.id === assignmentId
      )
    ) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assignmentNotFound,
        404,
        "The visual assignment does not exist."
      );
    }

    const assignments = currentProject.visuals.assignments.filter(
      (assignment) => assignment.id !== assignmentId
    );
    const candidate = {
      ...currentProject,
      visuals: {
        ...currentProject.visuals,
        status: visualMutationStatus(
          currentProject,
          currentProject.visuals.assignments,
          assignments
        ),
        assignments
      }
    };
    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.candidateInvalid,
        422,
        "Removing the visual assignment does not produce a valid project.",
        validationDetails(candidateResult.error.issues)
      );
    }
    const saved = await repository.save(candidateResult.data, expectedRevision);
    return { data: saved, revision: saved.revision };
  }

  private async approveLocked(
    safeProjectId: string,
    expectedRevision: number,
    repository: ProjectRepositoryLockedOperations
  ): Promise<VisualAssignmentServiceResult> {
    const currentProject = await repository.read();
    if (currentProject.revision !== expectedRevision) {
      throw projectRevisionConflict();
    }

    const linePositions = new Map<
      string,
      { sectionId: string; lineIndex: number }
    >();
    for (const section of currentProject.script.sections) {
      for (const [lineIndex, line] of section.lines.entries()) {
        linePositions.set(line.id, { sectionId: section.id, lineIndex });
      }
    }

    const validationIssuesForApproval: Array<{
      path: Array<string | number>;
      message: string;
    }> = [];

    for (const [assignmentIndex, assignment] of currentProject.visuals.assignments.entries()) {
      const start = linePositions.get(assignment.startLineId);
      const end = linePositions.get(assignment.endLineId);
      if (start === undefined) {
        validationIssuesForApproval.push(
          assignmentDetails(assignmentIndex, ["startLineId"], "start line not found")
        );
      }
      if (end === undefined) {
        validationIssuesForApproval.push(
          assignmentDetails(assignmentIndex, ["endLineId"], "end line not found")
        );
      }
      if (start !== undefined && end !== undefined) {
        if (start.sectionId !== end.sectionId) {
          validationIssuesForApproval.push(
            assignmentDetails(
              assignmentIndex,
              ["endLineId"],
              "visual assignment range crosses script sections"
            )
          );
        } else if (start.lineIndex > end.lineIndex) {
          validationIssuesForApproval.push(
            assignmentDetails(
              assignmentIndex,
              ["startLineId"],
              "visual assignment range is reversed"
            )
          );
        }
      }

      const asset = this.assetRepository.findAssetDetail(assignment.assetId);
      if (asset === undefined) {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.assetNotFound,
          404,
          "A visual assignment references a missing asset.",
          [assignmentDetails(assignmentIndex, ["assetId"], "asset not found")]
        );
      }
      if (asset.status !== "active") {
        validationIssuesForApproval.push(
          assignmentDetails(assignmentIndex, ["assetId"], "asset is not active")
        );
      }
      if (asset.kind === "sound_effect" || asset.kind !== assignment.display.kind) {
        validationIssuesForApproval.push(
          assignmentDetails(
            assignmentIndex,
            ["display", "kind"],
            "asset kind does not match display kind"
          )
        );
      }

      const currentChecksum = sha256Schema.safeParse(asset.checksum);
      if (!currentChecksum.success) {
        validationIssuesForApproval.push(
          assignmentDetails(
            assignmentIndex,
            ["assetChecksum"],
            "asset checksum is unavailable"
          )
        );
      } else if (
        normalizeChecksum(currentChecksum.data) !==
        normalizeChecksum(assignment.assetChecksum)
      ) {
        validationIssuesForApproval.push(
          assignmentDetails(
            assignmentIndex,
            ["assetChecksum"],
            "database checksum does not match assignment checksum"
          )
        );
      }
      if (typeof asset.confidentiality !== "string" || asset.confidentiality.trim().length === 0) {
        validationIssuesForApproval.push(
          assignmentDetails(
            assignmentIndex,
            ["assetId"],
            "asset confidentiality is missing"
          )
        );
      }

      const displayResult = displayV15Schema.safeParse(assignment.display);
      if (!displayResult.success) {
        for (const issue of validationDetails(displayResult.error.issues)) {
          validationIssuesForApproval.push(
            assignmentDetails(assignmentIndex, ["display", ...issue.path], issue.message)
          );
        }
      } else {
        for (const issue of displayDomainIssues(asset, displayResult.data)) {
          validationIssuesForApproval.push(
            assignmentDetails(assignmentIndex, ["display", ...issue.path], issue.message)
          );
        }
      }
    }

    if (validationIssuesForApproval.length > 0) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.approvalValidationFailed,
        422,
        "The visual plan does not meet the approval requirements.",
        validationIssuesForApproval
      );
    }

    const projectRoot = await this.resolveProjectRoot(safeProjectId);
    for (const [assignmentIndex, assignment] of currentProject.visuals.assignments.entries()) {
      const mediaPath = await this.resolveProjectMediaFile(
        projectRoot,
        assignment.projectMediaPath,
        assignmentIndex
      );
      let actualChecksum: string;
      try {
        actualChecksum = normalizeChecksum(await this.fileSystem.hashFile(mediaPath));
      } catch {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaHashFailed,
          500,
          "An imported visual file could not be verified.",
          [
            assignmentDetails(
              assignmentIndex,
              ["projectMediaPath"],
              "file hash could not be calculated"
            )
          ]
        );
      }
      if (actualChecksum !== normalizeChecksum(assignment.assetChecksum)) {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaChecksumMismatch,
          422,
          "An imported visual file checksum does not match the assignment.",
          [
            assignmentDetails(
              assignmentIndex,
              ["projectMediaPath"],
              "file checksum does not match assignment checksum"
            )
          ]
        );
      }
    }

    const candidate = {
      ...currentProject,
      visuals: { ...currentProject.visuals, status: "approved" as const }
    };
    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.approvalValidationFailed,
        422,
        "The visual plan does not produce a valid project.",
        validationDetails(candidateResult.error.issues)
      );
    }
    const saved = await repository.save(candidateResult.data, expectedRevision);
    return { data: saved, revision: saved.revision };
  }

  private async resolveProjectMediaFile(
    projectRoot: string,
    projectMediaPath: string,
    assignmentIndex: number
  ): Promise<string> {
    const pathResult = relativePosixPathSchema.safeParse(projectMediaPath);
    if (!pathResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
        422,
        "The project media path is invalid.",
        [assignmentDetails(assignmentIndex, ["projectMediaPath"], "unsafe relative path")]
      );
    }
    const mediaPath = path.resolve(
      projectRoot,
      pathResult.data.split("/").join(path.sep)
    );
    this.assertInside(
      projectRoot,
      mediaPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    let exists: boolean;
    try {
      exists = await this.fileSystem.pathExists(mediaPath);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaFileMissing,
        500,
        "An imported visual file could not be found.",
        [assignmentDetails(assignmentIndex, ["projectMediaPath"], "file check failed")]
      );
    }
    if (!exists) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaFileMissing,
        500,
        "An imported visual file could not be found.",
        [assignmentDetails(assignmentIndex, ["projectMediaPath"], "file is missing")]
      );
    }

    let resolvedMediaPath: string;
    try {
      resolvedMediaPath = await this.fileSystem.realpath(mediaPath);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectMediaFileMissing,
        500,
        "An imported visual file could not be found.",
        [assignmentDetails(assignmentIndex, ["projectMediaPath"], "file cannot be read")]
      );
    }
    this.assertInside(
      projectRoot,
      resolvedMediaPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );
    return mediaPath;
  }

  private assertAssetUsable(
    asset: AssetDetail,
    displayKind: DisplayV15["kind"]
  ): void {
    if (asset.status !== "active") {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assetNotActive,
        422,
        "The selected asset is not active."
      );
    }
    if (asset.kind === "sound_effect") {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assetKindUnsupported,
        422,
        "Sound effects cannot be used as visual assignments."
      );
    }
    if (asset.kind !== displayKind) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.displayKindMismatch,
        422,
        "The display kind does not match the selected asset kind.",
        [{ path: ["assignment", "display", "kind"], message: "kind mismatch" }]
      );
    }
  }

  private assertChecksum(checksum: string | null): string {
    const result = sha256Schema.safeParse(checksum);
    if (!result.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.assetChecksumUnavailable,
        422,
        "The selected asset does not have a confirmed SHA-256 checksum."
      );
    }
    return result.data;
  }

  private async resolveProjectRoot(projectId: string): Promise<string> {
    let workspaceRoot: string;
    try {
      workspaceRoot = await this.fileSystem.realpath(this.workspaceRoot);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }

    const projectsPath = path.resolve(this.workspaceRoot, "projects");
    let resolvedProjectsPath: string;
    try {
      resolvedProjectsPath = await this.fileSystem.realpath(projectsPath);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    this.assertInside(
      workspaceRoot,
      resolvedProjectsPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
      "The project path is invalid."
    );

    const projectPath = path.resolve(projectsPath, projectId);
    if (!isPathInside(this.workspaceRoot, projectPath)) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }

    let resolvedProjectPath: string;
    try {
      resolvedProjectPath = await this.fileSystem.realpath(projectPath);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
        400,
        "The project path is invalid."
      );
    }
    this.assertInside(
      resolvedProjectsPath,
      resolvedProjectPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid,
      "The project path is invalid."
    );
    return resolvedProjectPath;
  }

  private async resolveLibrarySource(libraryMediaPath: string): Promise<string> {
    const pathResult = relativePosixPathSchema.safeParse(libraryMediaPath);
    if (!pathResult.success) {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
        422,
        "The asset library path is invalid."
      );
    }

    let resolvedLibraryRoot: string;
    try {
      resolvedLibraryRoot = await this.fileSystem.realpath(this.libraryRoot);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
        422,
        "The asset library path is invalid."
      );
    }

    const sourcePath = path.resolve(
      resolvedLibraryRoot,
      pathResult.data.split("/").join(path.sep)
    );
    this.assertInside(
      resolvedLibraryRoot,
      sourcePath,
      VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
      "The asset library path is invalid."
    );

    try {
      if (!(await this.fileSystem.pathExists(sourcePath))) {
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.libraryFileNotFound,
          500,
          "The active asset file is unavailable."
        );
      }
    } catch (error) {
      if (error instanceof VisualAssignmentError) {
        throw error;
      }
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.libraryFileNotFound,
        500,
        "The active asset file is unavailable."
      );
    }

    let resolvedSourcePath: string;
    try {
      resolvedSourcePath = await this.fileSystem.realpath(sourcePath);
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.libraryFileNotFound,
        500,
        "The active asset file is unavailable."
      );
    }
    this.assertInside(
      resolvedLibraryRoot,
      resolvedSourcePath,
      VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid,
      "The asset library path is invalid."
    );
    return sourcePath;
  }

  private resolveProjectMediaPaths(
    projectRoot: string,
    asset: AssetDetail,
    extension: string
  ): ProjectPaths {
    const projectMediaPath = `media/visuals/${asset.assetId}/v${asset.version}.${extension}`;
    const finalPath = path.resolve(
      projectRoot,
      projectMediaPath.split("/").join(path.sep)
    );
    this.assertInside(
      projectRoot,
      finalPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );
    return { projectRoot, finalPath, projectMediaPath };
  }

  private assertInside(
    rootPath: string,
    candidatePath: string,
    code:
      | typeof VISUAL_ASSIGNMENT_ERROR_CODE.projectPathInvalid
      | typeof VISUAL_ASSIGNMENT_ERROR_CODE.libraryPathInvalid
      | typeof VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
    message: string
  ): void {
    if (!isPathInside(rootPath, candidatePath)) {
      throw visualAssignmentError(code, code === "VISUAL_ASSIGNMENT_PROJECT_PATH_INVALID" ? 400 : 422, message);
    }
  }

  private async ensureProjectDirectory(
    projectRoot: string,
    directoryPath: string
  ): Promise<void> {
    this.assertInside(
      projectRoot,
      directoryPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    let probe = directoryPath;
    while (true) {
      try {
        const resolvedProbe = await this.fileSystem.realpath(probe);
        this.assertInside(
          projectRoot,
          resolvedProbe,
          VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
          "The project media path is invalid."
        );
        break;
      } catch (error) {
        if (!isMissingPathError(error)) {
          if (error instanceof VisualAssignmentError) {
            throw error;
          }
          throw visualAssignmentError(
            VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
            422,
            "The project media path is invalid."
          );
        }
        const parent = path.dirname(probe);
        if (parent === probe || !isPathInside(projectRoot, parent)) {
          throw visualAssignmentError(
            VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
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
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
        "The project media path is invalid."
      );
    } catch (error) {
      if (error instanceof VisualAssignmentError) {
        throw error;
      }
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
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
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathCheckFailed,
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
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict,
        409,
        "The project media path is already occupied."
      );
    }
    this.assertInside(
      projectRoot,
      resolvedFinalPath,
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
      "The project media path is invalid."
    );

    let existingChecksum: string;
    try {
      existingChecksum = normalizeChecksum(
        await this.fileSystem.hashFile(finalPath)
      );
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict,
        409,
        "The project media path is already occupied."
      );
    }
    if (existingChecksum === expectedChecksum) {
      return true;
    }
    throw visualAssignmentError(
      VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathConflict,
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
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.copyFailed,
        500,
        "The asset could not be copied into the project."
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
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.copyFailed,
          500,
          "The asset could not be copied into the project."
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
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.hashFailed,
          500,
          "The copied asset could not be verified."
        );
      }

      if (copiedChecksum !== expectedChecksum) {
        await this.cleanupTemporaryFile(temporaryPath);
        temporaryCreated = false;
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.checksumMismatch,
          500,
          "The copied asset checksum does not match the library record."
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
        throw visualAssignmentError(
          VISUAL_ASSIGNMENT_ERROR_CODE.renameFailed,
          500,
          "The copied asset could not be placed in the project."
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
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed,
        500,
        "The failed asset import could not be cleaned up."
      );
    }
  }

  private async cleanupFinalFileIfUnreferenced(
    repository: ProjectRepositoryLockedOperations,
    projectRoot: string,
    finalPath: string,
    projectMediaPath: string
  ): Promise<void> {
    let currentProject: VideoProject;
    try {
      currentProject = await repository.read();
    } catch {
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed,
        500,
        "The failed asset import could not be cleaned up."
      );
    }

    if (
      currentProject.visuals.assignments.some(
        (assignment) => assignment.projectMediaPath === projectMediaPath
      )
    ) {
      return;
    }

    try {
      if (!(await this.fileSystem.pathExists(finalPath))) {
        return;
      }
      const resolvedFinalPath = await this.fileSystem.realpath(finalPath);
      this.assertInside(
        projectRoot,
        resolvedFinalPath,
        VISUAL_ASSIGNMENT_ERROR_CODE.mediaPathInvalid,
        "The project media path is invalid."
      );
      await this.fileSystem.unlink(finalPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return;
      }
      throw visualAssignmentError(
        VISUAL_ASSIGNMENT_ERROR_CODE.cleanupFailed,
        500,
        "The failed asset import could not be cleaned up."
      );
    }
  }
}
