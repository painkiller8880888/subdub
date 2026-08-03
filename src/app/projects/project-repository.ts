import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  idSchema,
  nonNegativeIntegerSchema,
  videoProjectSchema,
  type VideoProject
} from "../../schema/index.js";

export type ProjectRepositoryErrorCode =
  | "PROJECT_ID_INVALID"
  | "PROJECT_PATH_INVALID"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_READ_FAILED"
  | "PROJECT_JSON_PARSE_FAILED"
  | "PROJECT_CURRENT_VALIDATION_FAILED"
  | "PROJECT_CANDIDATE_VALIDATION_FAILED"
  | "PROJECT_CURRENT_ID_MISMATCH"
  | "PROJECT_CANDIDATE_ID_MISMATCH"
  | "PROJECT_UPDATED_VALIDATION_FAILED"
  | "PROJECT_EXPECTED_REVISION_INVALID"
  | "PROJECT_REVISION_CONFLICT"
  | "PROJECT_WRITE_FAILED"
  | "PROJECT_RENAME_FAILED";

export type ProjectValidationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

export class ProjectRepositoryError extends Error {
  readonly code: ProjectRepositoryErrorCode;
  readonly status: number;
  readonly issues: readonly ProjectValidationIssue[];

  constructor(
    code: ProjectRepositoryErrorCode,
    status: number,
    message: string,
    issues: readonly ProjectValidationIssue[] = []
  ) {
    super(message);
    this.name = "ProjectRepositoryError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.issues = issues;
  }

  toJSON(): {
    code: ProjectRepositoryErrorCode;
    status: number;
    message: string;
    issues?: readonly ProjectValidationIssue[];
  } {
    return this.issues.length === 0
      ? {
          code: this.code,
          status: this.status,
          message: this.message
        }
      : {
          code: this.code,
          status: this.status,
          message: this.message,
          issues: this.issues
        };
  }
}

export interface ProjectRepositoryFileSystem {
  mkdir(
    directoryPath: string,
    options?: { recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
}

export type ProjectRepositoryOptions = {
  workspaceRoot: string;
  fileSystem?: Partial<ProjectRepositoryFileSystem>;
  now?: () => Date;
};

type ResolvedProjectPaths = {
  readonly projectDirectoryPath: string;
  readonly projectFilePath: string;
};

const defaultFileSystem: ProjectRepositoryFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
  writeFile: (filePath, contents) =>
    fs.writeFile(filePath, contents, {
      encoding: "utf8",
      flag: "wx"
    }),
  rename: (sourcePath, destinationPath) => fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

const projectSaveLocks = new Map<string, Promise<void>>();

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

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

function validationIssues(error: {
  issues: ReadonlyArray<{
    path: ReadonlyArray<PropertyKey>;
    message: string;
  }>;
}): readonly ProjectValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number"
    ),
    message: issue.message
  }));
}

function invalidProjectIdError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_ID_INVALID",
    400,
    "The project ID is invalid."
  );
}

function invalidProjectPathError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_PATH_INVALID",
    400,
    "The project path is invalid."
  );
}

function projectNotFoundError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_NOT_FOUND",
    404,
    "The project does not exist."
  );
}

function readFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_READ_FAILED",
    500,
    "The project could not be read."
  );
}

function parseFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_JSON_PARSE_FAILED",
    422,
    "The project JSON could not be parsed."
  );
}

function currentValidationFailedError(
  issues: readonly ProjectValidationIssue[]
): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_CURRENT_VALIDATION_FAILED",
    422,
    "The current project data is invalid.",
    issues
  );
}

function candidateValidationFailedError(
  issues: readonly ProjectValidationIssue[]
): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_CANDIDATE_VALIDATION_FAILED",
    422,
    "The project candidate is invalid.",
    issues
  );
}

function currentProjectIdMismatchError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_CURRENT_ID_MISMATCH",
    422,
    "The current project ID does not match the requested project."
  );
}

function candidateProjectIdMismatchError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_CANDIDATE_ID_MISMATCH",
    422,
    "The candidate project ID does not match the requested project."
  );
}

function updatedValidationFailedError(
  issues: readonly ProjectValidationIssue[]
): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_UPDATED_VALIDATION_FAILED",
    500,
    "The updated project data is invalid.",
    issues
  );
}

function expectedRevisionInvalidError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_EXPECTED_REVISION_INVALID",
    400,
    "The expected revision is invalid."
  );
}

function revisionConflictError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_REVISION_CONFLICT",
    409,
    "The project revision does not match the expected revision."
  );
}

function writeFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_WRITE_FAILED",
    500,
    "The project could not be written."
  );
}

function renameFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_RENAME_FAILED",
    500,
    "The project could not be replaced."
  );
}

export class ProjectRepository {
  private readonly workspaceRoot: string;
  private readonly fileSystem: ProjectRepositoryFileSystem;
  private readonly now: () => Date;

  constructor(options: ProjectRepositoryOptions | string) {
    if (typeof options === "string") {
      this.workspaceRoot = path.resolve(options);
      this.fileSystem = defaultFileSystem;
      this.now = () => new Date();
      return;
    }

    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.now = options.now ?? (() => new Date());
  }

  async read(projectId: unknown): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    const paths = await this.resolveProjectPaths(safeProjectId);
    return this.readProjectWithExpectedId(safeProjectId, paths);
  }

  async create(candidate: unknown): Promise<VideoProject> {
    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw candidateValidationFailedError(
        validationIssues(candidateResult.error)
      );
    }

    if (candidateResult.data.revision !== 0) {
      throw candidateValidationFailedError([
        {
          path: ["revision"],
          message: "a new project must start at revision 0"
        }
      ]);
    }

    const projectId = this.validateProjectId(candidateResult.data.metadata.id);
    return this.withSaveLock(projectId, () =>
      this.createUnlocked(projectId, candidateResult.data)
    );
  }

  async save(
    projectId: unknown,
    candidate: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      this.saveUnlocked(safeProjectId, candidate, expectedRevision)
    );
  }

  private async saveUnlocked(
    projectId: string,
    candidate: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    const currentProject = await this.readProjectWithExpectedId(
      projectId,
      paths
    );

    const candidateResult = videoProjectSchema.safeParse(candidate);
    if (!candidateResult.success) {
      throw candidateValidationFailedError(
        validationIssues(candidateResult.error)
      );
    }

    if (candidateResult.data.metadata.id !== projectId) {
      throw candidateProjectIdMismatchError();
    }

    const expectedRevisionResult =
      nonNegativeIntegerSchema.safeParse(expectedRevision);
    if (!expectedRevisionResult.success) {
      throw expectedRevisionInvalidError();
    }

    if (expectedRevisionResult.data !== currentProject.revision) {
      throw revisionConflictError();
    }

    const updatedProjectCandidate: VideoProject = {
      ...candidateResult.data,
      revision: currentProject.revision + 1,
      metadata: {
        ...candidateResult.data.metadata,
        id: currentProject.metadata.id,
        createdAt: currentProject.metadata.createdAt,
        updatedAt: this.now().toISOString()
      }
    };
    const updatedProjectResult = videoProjectSchema.safeParse(
      updatedProjectCandidate
    );
    if (!updatedProjectResult.success) {
      throw updatedValidationFailedError(
        validationIssues(updatedProjectResult.error)
      );
    }

    const serializedProject = `${JSON.stringify(
      updatedProjectResult.data,
      null,
      2
    )}\n`;
    const temporaryFilePath = path.join(
      paths.projectDirectoryPath,
      `project.json.${randomUUID()}.tmp`
    );

    try {
      await this.fileSystem.writeFile(temporaryFilePath, serializedProject);
    } catch (error) {
      if (getFileSystemErrorCode(error) !== "EEXIST") {
        await this.removeTemporaryFile(temporaryFilePath);
      }
      throw writeFailedError();
    }

    try {
      await this.fileSystem.rename(
        temporaryFilePath,
        paths.projectFilePath
      );
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw renameFailedError();
    }

    return updatedProjectResult.data;
  }

  private async createUnlocked(
    projectId: string,
    project: VideoProject
  ): Promise<VideoProject> {
    const paths = await this.resolveCreateProjectPaths(projectId);
    const serializedProject = `${JSON.stringify(project, null, 2)}\n`;
    const temporaryFilePath = path.join(
      paths.projectDirectoryPath,
      `project.json.${randomUUID()}.tmp`
    );

    try {
      await this.fileSystem.writeFile(temporaryFilePath, serializedProject);
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw writeFailedError();
    }

    try {
      await this.fileSystem.rename(
        temporaryFilePath,
        paths.projectFilePath
      );
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw renameFailedError();
    }

    return project;
  }

  private validateProjectId(projectId: unknown): string {
    const projectIdResult = idSchema.safeParse(projectId);
    if (!projectIdResult.success) {
      throw invalidProjectIdError();
    }

    const safeProjectId = projectIdResult.data;
    if (
      safeProjectId.includes("/") ||
      safeProjectId.includes("\\") ||
      safeProjectId.includes("..") ||
      path.posix.isAbsolute(safeProjectId) ||
      path.win32.isAbsolute(safeProjectId)
    ) {
      throw invalidProjectIdError();
    }

    return safeProjectId;
  }

  private async resolveProjectPaths(
    safeProjectId: string
  ): Promise<ResolvedProjectPaths> {
    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      throw projectNotFoundError();
    }

    const projectsPath = path.resolve(this.workspaceRoot, "projects");
    const resolvedProjectsPath = await this.resolveExistingPath(projectsPath);
    if (resolvedProjectsPath === null) {
      throw projectNotFoundError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedProjectsPath
    );

    const projectDirectoryPath = path.resolve(projectsPath, safeProjectId);
    if (!isPathInside(this.workspaceRoot, projectDirectoryPath)) {
      throw invalidProjectPathError();
    }

    const resolvedProjectDirectoryPath = await this.resolveExistingPath(
      projectDirectoryPath
    );
    if (resolvedProjectDirectoryPath === null) {
      throw projectNotFoundError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedProjectDirectoryPath
    );

    const projectFilePath = path.join(projectDirectoryPath, "project.json");
    const resolvedProjectFilePath = await this.resolveExistingPath(
      projectFilePath
    );
    if (resolvedProjectFilePath !== null) {
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedProjectFilePath
      );
    }

    return {
      projectDirectoryPath,
      projectFilePath
    };
  }

  private async resolveCreateProjectPaths(
    safeProjectId: string
  ): Promise<ResolvedProjectPaths> {
    try {
      await this.fileSystem.mkdir(this.workspaceRoot, { recursive: true });
    } catch {
      throw writeFailedError();
    }

    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      throw writeFailedError();
    }

    const projectsPath = path.resolve(this.workspaceRoot, "projects");
    try {
      await this.fileSystem.mkdir(projectsPath, { recursive: true });
    } catch {
      throw writeFailedError();
    }

    const resolvedProjectsPath = await this.resolveExistingPath(projectsPath);
    if (resolvedProjectsPath === null) {
      throw writeFailedError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedProjectsPath
    );

    const projectDirectoryPath = path.resolve(projectsPath, safeProjectId);
    if (!isPathInside(this.workspaceRoot, projectDirectoryPath)) {
      throw invalidProjectPathError();
    }

    const resolvedProjectDirectoryPath = await this.resolveExistingPath(
      projectDirectoryPath
    );
    if (resolvedProjectDirectoryPath !== null) {
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedProjectDirectoryPath
      );
      throw writeFailedError();
    }

    try {
      await this.fileSystem.mkdir(projectDirectoryPath, { recursive: false });
    } catch {
      throw writeFailedError();
    }

    const resolvedCreatedDirectoryPath = await this.resolveExistingPath(
      projectDirectoryPath
    );
    if (resolvedCreatedDirectoryPath === null) {
      throw writeFailedError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedCreatedDirectoryPath
    );

    const projectFilePath = path.join(projectDirectoryPath, "project.json");
    const resolvedProjectFilePath = await this.resolveExistingPath(
      projectFilePath
    );
    if (resolvedProjectFilePath !== null) {
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedProjectFilePath
      );
      throw writeFailedError();
    }

    return {
      projectDirectoryPath,
      projectFilePath
    };
  }

  private async withSaveLock<T>(
    projectId: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const lockKey = `${this.workspaceRoot}\0${projectId}`;
    const previous = projectSaveLocks.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    projectSaveLocks.set(lockKey, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (projectSaveLocks.get(lockKey) === current) {
        projectSaveLocks.delete(lockKey);
      }
    }
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.realpath(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw readFailedError();
    }
  }

  private assertInsideManagementRoot(
    managementRootPath: string,
    candidatePath: string
  ): void {
    if (!isPathInside(managementRootPath, candidatePath)) {
      throw invalidProjectPathError();
    }
  }

  private async readResolvedProject(
    paths: ResolvedProjectPaths
  ): Promise<VideoProject> {
    let contents: string;
    try {
      contents = await this.fileSystem.readFile(paths.projectFilePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw projectNotFoundError();
      }
      throw readFailedError();
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      throw parseFailedError();
    }

    const projectResult = videoProjectSchema.safeParse(parsedJson);
    if (!projectResult.success) {
      throw currentValidationFailedError(validationIssues(projectResult.error));
    }

    return projectResult.data;
  }

  private async readProjectWithExpectedId(
    projectId: string,
    paths: ResolvedProjectPaths
  ): Promise<VideoProject> {
    const project = await this.readResolvedProject(paths);
    if (project.metadata.id !== projectId) {
      throw currentProjectIdMismatchError();
    }
    return project;
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // The original project is more important than a cleanup error.
    }
  }
}
