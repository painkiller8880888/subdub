import { createHash, randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import * as path from "node:path";

import {
  idSchema,
  nonNegativeIntegerSchema,
  projectBriefSchema,
  outlineSchema,
  scriptSchema,
  videoProjectSchema,
  type VideoProject
} from "../../schema/index.js";
import {
  RunLogStore,
  RunLogStoreError,
  type RunLogStorePort
} from "../run-log-store.js";
import { invalidateForUpstreamChange } from "./project-invalidation.js";

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
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_WRITE_FAILED"
  | "PROJECT_RENAME_FAILED"
  | "PROJECT_SOURCE_NOT_FOUND"
  | "PROJECT_SOURCE_READ_FAILED"
  | "PROJECT_SOURCE_HASH_MISMATCH"
  | "PROJECT_ROLLBACK_FAILED"
  | "PROJECT_RUN_LOG_INVALID"
  | "PROJECT_RUN_LOG_WRITE_FAILED";

export type ProjectValidationIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

export class ProjectRepositoryError extends Error {
  readonly code: ProjectRepositoryErrorCode;
  readonly status: number;
  readonly issues: readonly ProjectValidationIssue[];
  readonly publicMessage: string | undefined;

  constructor(
    code: ProjectRepositoryErrorCode,
    status: number,
    message: string,
    issues: readonly ProjectValidationIssue[] = [],
    publicMessage?: string
  ) {
    super(message);
    this.name = "ProjectRepositoryError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
    this.issues = issues;
    this.publicMessage = publicMessage;
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
  readdir(directoryPath: string): Promise<Dirent[]>;
  rmdir(directoryPath: string): Promise<void>;
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
  runLogStore?: RunLogStorePort;
};

export type ProjectRepositoryLockedOperations = {
  read(): Promise<VideoProject>;
  save(candidate: unknown, expectedRevision: unknown): Promise<VideoProject>;
};

type ResolvedProjectPaths = {
  readonly projectDirectoryPath: string;
  readonly projectFilePath: string;
  readonly sourceDirectoryPath: string;
  readonly sourceFilePath: string;
};

type ResolvedCreateProjectPaths = ResolvedProjectPaths & {
  readonly managementRootPath: string;
  readonly temporaryDirectoryPath: string;
};

export type ProjectSourceDocument = {
  readonly markdown: string;
  readonly sha256: string;
  readonly revision: number;
};

export type ProjectGenerationSnapshot = {
  readonly project: VideoProject;
  readonly markdown: string;
  readonly sourceHash: string;
};

const defaultFileSystem: ProjectRepositoryFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readdir: (directoryPath) =>
    fs.readdir(directoryPath, { withFileTypes: true }),
  rmdir: (directoryPath) => fs.rmdir(directoryPath),
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

function projectAlreadyExistsError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_ALREADY_EXISTS",
    409,
    "The project already exists."
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

function sourceNotFoundError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_SOURCE_NOT_FOUND",
    422,
    "The project source is missing.",
    [],
    "Project source is unavailable."
  );
}

function sourceReadFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_SOURCE_READ_FAILED",
    500,
    "The project source could not be read.",
    [],
    "Project source could not be read."
  );
}

function sourceHashMismatchError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_SOURCE_HASH_MISMATCH",
    422,
    "The project source hash does not match the project data.",
    [],
    "Project source integrity could not be verified."
  );
}

function rollbackFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_ROLLBACK_FAILED",
    500,
    "The project save could not be rolled back safely.",
    [],
    "Project save rollback failed."
  );
}

function runLogInvalidError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_RUN_LOG_INVALID",
    500,
    "The run log is invalid."
  );
}

function runLogWriteFailedError(): ProjectRepositoryError {
  return new ProjectRepositoryError(
    "PROJECT_RUN_LOG_WRITE_FAILED",
    500,
    "The run log could not be written."
  );
}

function isExistingDestinationError(error: unknown): boolean {
  const code = getFileSystemErrorCode(error);
  return code === "EEXIST" || code === "ENOTEMPTY" || code === "EISDIR";
}

function isProjectTemporaryDirectoryName(entryName: string): boolean {
  return (
    entryName.startsWith(".subdub-project-") && entryName.endsWith(".tmp")
  );
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents, "utf8").digest("hex");
}

function projectListEntryError(
  projectId: string,
  error: ProjectRepositoryError
): ProjectRepositoryError {
  return new ProjectRepositoryError(
    error.code,
    error.status,
    `Project '${projectId}' could not be loaded: ${error.message}`,
    error.issues,
    `プロジェクト「${projectId}」を読み込めませんでした。`
  );
}

export class ProjectRepository {
  private readonly workspaceRoot: string;
  private readonly fileSystem: ProjectRepositoryFileSystem;
  private readonly now: () => Date;
  private readonly runLogStore: RunLogStorePort;

  constructor(options: ProjectRepositoryOptions | string) {
    if (typeof options === "string") {
      this.workspaceRoot = path.resolve(options);
      this.fileSystem = defaultFileSystem;
      this.now = () => new Date();
      this.runLogStore = new RunLogStore({
        workspaceRoot: this.workspaceRoot,
        fileSystem: this.fileSystem
      });
      return;
    }

    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.now = options.now ?? (() => new Date());
    this.runLogStore =
      options.runLogStore ??
      new RunLogStore({
        workspaceRoot: this.workspaceRoot,
        fileSystem: this.fileSystem
      });
  }

  private async readUnlocked(projectId: string): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    return this.readProjectWithExpectedId(projectId, paths);
  }

  async read(projectId: unknown): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.readUnlocked(safeProjectId);
  }

  async withProjectLock<T>(
    projectId: unknown,
    operation: (repository: ProjectRepositoryLockedOperations) => Promise<T>
  ): Promise<T> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      operation({
        read: () => this.readUnlocked(safeProjectId),
        save: (candidate, expectedRevision) =>
          this.saveUnlocked(safeProjectId, candidate, expectedRevision)
      })
    );
  }

  async readSource(projectId: unknown): Promise<ProjectSourceDocument> {
    const snapshot = await this.readGenerationSnapshot(projectId);

    return {
      markdown: snapshot.markdown,
      sha256: snapshot.sourceHash,
      revision: snapshot.project.revision
    };
  }

  async readGenerationSnapshot(
    projectId: unknown
  ): Promise<ProjectGenerationSnapshot> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, async () => {
      const paths = await this.resolveProjectPaths(safeProjectId);
      const project = await this.readProjectWithExpectedId(
        safeProjectId,
        paths
      );
      const markdown = await this.readValidatedSource(paths, project);
      return { project, markdown, sourceHash: sha256(markdown) };
    });
  }

  async list(): Promise<VideoProject[]> {
    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      return [];
    }

    const projectsPath = path.resolve(this.workspaceRoot, "projects");
    const resolvedProjectsPath = await this.resolveExistingPath(projectsPath);
    if (resolvedProjectsPath === null) {
      return [];
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedProjectsPath
    );

    let entries: Dirent[];
    try {
      entries = await this.fileSystem.readdir(projectsPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }
      throw readFailedError();
    }

    const projects: VideoProject[] = [];
    for (const entry of [...entries].sort((first, second) =>
      first.name.localeCompare(second.name)
    )) {
      const entryName = entry.name;
      if (isProjectTemporaryDirectoryName(entryName)) {
        continue;
      }

      if (!entry.isDirectory() && !entry.isSymbolicLink()) {
        continue;
      }

      const projectIdResult = idSchema.safeParse(entryName);
      if (!projectIdResult.success) {
        continue;
      }
      const projectId = projectIdResult.data;

      try {
        const projectDirectoryPath = path.resolve(projectsPath, projectId);
        if (!isPathInside(this.workspaceRoot, projectDirectoryPath)) {
          throw invalidProjectPathError();
        }

        const resolvedProjectDirectoryPath = await this.resolveExistingPath(
          projectDirectoryPath
        );
        if (resolvedProjectDirectoryPath === null) {
          continue;
        }
        this.assertInsideManagementRoot(
          managementRootPath,
          resolvedProjectDirectoryPath
        );
        if (!isPathInside(resolvedProjectsPath, resolvedProjectDirectoryPath)) {
          throw invalidProjectPathError();
        }

        const projectFilePath = path.join(projectDirectoryPath, "project.json");
        const resolvedProjectFilePath = await this.resolveExistingPath(
          projectFilePath
        );
        if (resolvedProjectFilePath === null) {
          continue;
        }
        this.assertInsideManagementRoot(
          managementRootPath,
          resolvedProjectFilePath
        );
        if (
          !isPathInside(resolvedProjectDirectoryPath, resolvedProjectFilePath)
        ) {
          throw invalidProjectPathError();
        }

        projects.push(
          await this.readProjectWithExpectedId(projectId, {
            projectDirectoryPath,
            projectFilePath,
            sourceDirectoryPath: path.join(projectDirectoryPath, "source"),
            sourceFilePath: path.join(
              projectDirectoryPath,
              "source",
              "source.md"
            )
          })
        );
      } catch (error) {
        if (error instanceof ProjectRepositoryError) {
          if (error.code === "PROJECT_NOT_FOUND") {
            continue;
          }
          throw projectListEntryError(projectId, error);
        }
        throw error;
      }
    }

    return projects;
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

  async saveSource(
    projectId: unknown,
    markdown: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      this.saveSourceUnlocked(safeProjectId, markdown, expectedRevision)
    );
  }

  async saveBrief(
    projectId: unknown,
    brief: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      this.saveBriefUnlocked(safeProjectId, brief, expectedRevision)
    );
  }

  async saveOutline(
    projectId: unknown,
    outline: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      this.saveOutlineUnlocked(safeProjectId, outline, expectedRevision)
    );
  }

  async saveScript(
    projectId: unknown,
    script: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const safeProjectId = this.validateProjectId(projectId);
    return this.withSaveLock(safeProjectId, () =>
      this.saveScriptUnlocked(safeProjectId, script, expectedRevision)
    );
  }

  async writeRunLog(
    projectId: unknown,
    runId: unknown,
    runLog: unknown
  ): Promise<void> {
    const safeProjectId = this.validateProjectId(projectId);
    const safeRunIdResult = idSchema.safeParse(runId);
    if (!safeRunIdResult.success) {
      throw runLogInvalidError();
    }
    try {
      await this.runLogStore.write(safeProjectId, runLog, safeRunIdResult.data);
    } catch (error) {
      if (
        error instanceof RunLogStoreError &&
        error.code === "RUN_LOG_INVALID"
      ) {
        throw runLogInvalidError();
      }
      throw runLogWriteFailedError();
    }
  }

  private async saveBriefUnlocked(
    projectId: string,
    brief: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    const currentProject = await this.readProjectWithExpectedId(
      projectId,
      paths
    );
    const briefResult = projectBriefSchema.safeParse(brief);
    if (!briefResult.success) {
      throw candidateValidationFailedError(validationIssues(briefResult.error));
    }

    const expectedRevisionResult =
      nonNegativeIntegerSchema.safeParse(expectedRevision);
    if (!expectedRevisionResult.success) {
      throw expectedRevisionInvalidError();
    }
    if (expectedRevisionResult.data !== currentProject.revision) {
      throw revisionConflictError();
    }
    await this.readValidatedSource(paths, currentProject);

    const briefChanged =
      JSON.stringify(currentProject.brief) !== JSON.stringify(briefResult.data);
    const baseProject = briefChanged
      ? invalidateForUpstreamChange(currentProject)
      : currentProject;
    const updatedProjectResult = videoProjectSchema.safeParse({
      ...baseProject,
      revision: currentProject.revision + 1,
      brief: briefResult.data,
      metadata: {
        ...currentProject.metadata,
        updatedAt: this.now().toISOString()
      }
    });
    if (!updatedProjectResult.success) {
      throw updatedValidationFailedError(
        validationIssues(updatedProjectResult.error)
      );
    }

    return this.writeProjectCandidate(paths, updatedProjectResult.data);
  }

  private async saveOutlineUnlocked(
    projectId: string,
    outline: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    const currentProject = await this.readProjectWithExpectedId(
      projectId,
      paths
    );
    const outlineResult = outlineSchema.safeParse(outline);
    if (!outlineResult.success) {
      throw candidateValidationFailedError(validationIssues(outlineResult.error));
    }
    const expectedRevisionResult =
      nonNegativeIntegerSchema.safeParse(expectedRevision);
    if (!expectedRevisionResult.success) {
      throw expectedRevisionInvalidError();
    }
    if (expectedRevisionResult.data !== currentProject.revision) {
      throw revisionConflictError();
    }
    await this.readValidatedSource(paths, currentProject);
    const updatedProjectResult = videoProjectSchema.safeParse({
      ...currentProject,
      revision: currentProject.revision + 1,
      outline: outlineResult.data,
      metadata: {
        ...currentProject.metadata,
        updatedAt: this.now().toISOString()
      }
    });
    if (!updatedProjectResult.success) {
      throw updatedValidationFailedError(
        validationIssues(updatedProjectResult.error)
      );
    }

    return this.writeProjectCandidate(paths, updatedProjectResult.data);
  }

  private async saveScriptUnlocked(
    projectId: string,
    script: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    const currentProject = await this.readProjectWithExpectedId(
      projectId,
      paths
    );
    const scriptResult = scriptSchema.safeParse(script);
    if (!scriptResult.success) {
      throw candidateValidationFailedError(validationIssues(scriptResult.error));
    }

    const expectedRevisionResult =
      nonNegativeIntegerSchema.safeParse(expectedRevision);
    if (!expectedRevisionResult.success) {
      throw expectedRevisionInvalidError();
    }
    if (expectedRevisionResult.data !== currentProject.revision) {
      throw revisionConflictError();
    }
    await this.readValidatedSource(paths, currentProject);

    const updatedProjectResult = videoProjectSchema.safeParse({
      ...currentProject,
      revision: currentProject.revision + 1,
      script: scriptResult.data,
      metadata: {
        ...currentProject.metadata,
        updatedAt: this.now().toISOString()
      }
    });
    if (!updatedProjectResult.success) {
      throw updatedValidationFailedError(
        validationIssues(updatedProjectResult.error)
      );
    }

    return this.writeProjectCandidate(paths, updatedProjectResult.data);
  }

  private async saveSourceUnlocked(
    projectId: string,
    markdown: unknown,
    expectedRevision: unknown
  ): Promise<VideoProject> {
    const paths = await this.resolveProjectPaths(projectId);
    const currentProject = await this.readProjectWithExpectedId(
      projectId,
      paths
    );
    if (typeof markdown !== "string") {
      throw candidateValidationFailedError([
        { path: ["markdown"], message: "markdown must be a string" }
      ]);
    }

    const expectedRevisionResult =
      nonNegativeIntegerSchema.safeParse(expectedRevision);
    if (!expectedRevisionResult.success) {
      throw expectedRevisionInvalidError();
    }
    if (expectedRevisionResult.data !== currentProject.revision) {
      throw revisionConflictError();
    }

    const currentMarkdown = await this.readValidatedSource(paths, currentProject);
    const baseProject =
      currentMarkdown === markdown
        ? currentProject
        : invalidateForUpstreamChange(currentProject);
    const updatedProjectResult = videoProjectSchema.safeParse({
      ...baseProject,
      revision: currentProject.revision + 1,
      source: {
        ...baseProject.source,
        sha256: sha256(markdown)
      },
      metadata: {
        ...currentProject.metadata,
        updatedAt: this.now().toISOString()
      }
    });
    if (!updatedProjectResult.success) {
      throw updatedValidationFailedError(
        validationIssues(updatedProjectResult.error)
      );
    }

    return this.writeSourceAndProjectFiles(
      paths,
      markdown,
      updatedProjectResult.data
    );
  }

  private async writeProjectCandidate(
    paths: ResolvedProjectPaths,
    project: VideoProject
  ): Promise<VideoProject> {
    const serializedProject = `${JSON.stringify(project, null, 2)}\n`;
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

    return project;
  }

  private async writeSourceAndProjectFiles(
    paths: ResolvedProjectPaths,
    markdown: string,
    project: VideoProject
  ): Promise<VideoProject> {
    const saveToken = randomUUID();
    const sourceTemporaryFilePath = path.join(
      paths.projectDirectoryPath,
      `source.md.${saveToken}.tmp`
    );
    const projectTemporaryFilePath = path.join(
      paths.projectDirectoryPath,
      `project.json.${saveToken}.tmp`
    );
    const sourceBackupFilePath = path.join(
      paths.projectDirectoryPath,
      `source.md.${saveToken}.bak`
    );
    const projectBackupFilePath = path.join(
      paths.projectDirectoryPath,
      `project.json.${saveToken}.bak`
    );

    try {
      await this.fileSystem.writeFile(sourceTemporaryFilePath, markdown);
      await this.fileSystem.writeFile(
        projectTemporaryFilePath,
        `${JSON.stringify(project, null, 2)}\n`
      );
    } catch {
      await this.removeTemporaryFile(sourceTemporaryFilePath);
      await this.removeTemporaryFile(projectTemporaryFilePath);
      throw writeFailedError();
    }

    let projectBackupReady = false;
    let sourceBackupReady = false;
    try {
      await this.fileSystem.rename(
        paths.projectFilePath,
        projectBackupFilePath
      );
      projectBackupReady = true;
      await this.fileSystem.rename(paths.sourceFilePath, sourceBackupFilePath);
      sourceBackupReady = true;
      await this.fileSystem.rename(
        sourceTemporaryFilePath,
        paths.sourceFilePath
      );
      await this.fileSystem.rename(
        projectTemporaryFilePath,
        paths.projectFilePath
      );
    } catch {
      const sourceRollbackSucceeded = await this.restoreBackup(
        sourceBackupFilePath,
        paths.sourceFilePath,
        sourceBackupReady
      );
      const projectRollbackSucceeded = await this.restoreBackup(
        projectBackupFilePath,
        paths.projectFilePath,
        projectBackupReady
      );
      await this.removeTemporaryFile(sourceTemporaryFilePath);
      await this.removeTemporaryFile(projectTemporaryFilePath);
      if (!sourceRollbackSucceeded || !projectRollbackSucceeded) {
        throw rollbackFailedError();
      }
      throw renameFailedError();
    }

    await this.removeTemporaryFile(sourceBackupFilePath);
    await this.removeTemporaryFile(projectBackupFilePath);
    return project;
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
      paths.temporaryDirectoryPath,
      "project.json"
    );
    const temporarySourceDirectoryPath = path.join(
      paths.temporaryDirectoryPath,
      "source"
    );
    const temporarySourceFilePath = path.join(
      temporarySourceDirectoryPath,
      "source.md"
    );
    let temporaryDirectoryCreated = false;

    try {
      try {
        await this.fileSystem.mkdir(paths.temporaryDirectoryPath, {
          recursive: false
        });
      } catch {
        throw writeFailedError();
      }
      temporaryDirectoryCreated = true;

      try {
        await this.fileSystem.mkdir(temporarySourceDirectoryPath, {
          recursive: false
        });
      } catch {
        throw writeFailedError();
      }

      let resolvedTemporaryDirectoryPath: string;
      try {
        resolvedTemporaryDirectoryPath = await this.fileSystem.realpath(
          paths.temporaryDirectoryPath
        );
      } catch {
        throw writeFailedError();
      }
      this.assertInsideManagementRoot(
        paths.managementRootPath,
        resolvedTemporaryDirectoryPath
      );

      try {
        await this.fileSystem.writeFile(temporarySourceFilePath, "");
      } catch {
        throw writeFailedError();
      }

      try {
        await this.fileSystem.writeFile(temporaryFilePath, serializedProject);
      } catch {
        throw writeFailedError();
      }

      try {
        await this.fileSystem.rename(
          paths.temporaryDirectoryPath,
          paths.projectDirectoryPath
        );
      } catch (error) {
        if (
          isExistingDestinationError(error) ||
          (await this.projectDirectoryExists(paths))
        ) {
          throw projectAlreadyExistsError();
        }
        throw renameFailedError();
      }

      return project;
    } finally {
      if (temporaryDirectoryCreated) {
        await this.removeTemporaryDirectory(
          paths.temporaryDirectoryPath,
          temporaryFilePath,
          temporarySourceDirectoryPath,
          temporarySourceFilePath
        );
      }
    }
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
    if (!isPathInside(resolvedProjectsPath, resolvedProjectDirectoryPath)) {
      throw invalidProjectPathError();
    }

    const projectFilePath = path.join(projectDirectoryPath, "project.json");
    const resolvedProjectFilePath = await this.resolveExistingPath(
      projectFilePath
    );
    if (resolvedProjectFilePath !== null) {
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedProjectFilePath
      );
      if (
        !isPathInside(resolvedProjectDirectoryPath, resolvedProjectFilePath)
      ) {
        throw invalidProjectPathError();
      }
    }

    return {
      projectDirectoryPath,
      projectFilePath,
      sourceDirectoryPath: path.join(projectDirectoryPath, "source"),
      sourceFilePath: path.join(
        projectDirectoryPath,
        "source",
        "source.md"
      )
    };
  }

  private async resolveCreateProjectPaths(
    safeProjectId: string
  ): Promise<ResolvedCreateProjectPaths> {
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
      throw projectAlreadyExistsError();
    }

    const temporaryDirectoryPath = path.join(
      projectsPath,
      `.subdub-project-${safeProjectId}.${randomUUID()}.tmp`
    );

    return {
      projectDirectoryPath,
      projectFilePath: path.join(projectDirectoryPath, "project.json"),
      sourceDirectoryPath: path.join(projectDirectoryPath, "source"),
      sourceFilePath: path.join(
        projectDirectoryPath,
        "source",
        "source.md"
      ),
      managementRootPath,
      temporaryDirectoryPath
    };
  }

  private async projectDirectoryExists(
    paths: ResolvedCreateProjectPaths
  ): Promise<boolean> {
    try {
      const resolvedProjectDirectoryPath = await this.fileSystem.realpath(
        paths.projectDirectoryPath
      );
      this.assertInsideManagementRoot(
        paths.managementRootPath,
        resolvedProjectDirectoryPath
      );
      return true;
    } catch (error) {
      if (isMissingPathError(error)) {
        return false;
      }
      if (error instanceof ProjectRepositoryError) {
        throw error;
      }
      throw renameFailedError();
    }
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

  private async readValidatedSource(
    paths: ResolvedProjectPaths,
    project: VideoProject
  ): Promise<string> {
    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      throw sourceNotFoundError();
    }
    const resolvedSourceDirectoryPath = await this.resolveExistingPath(
      paths.sourceDirectoryPath
    );
    if (resolvedSourceDirectoryPath === null) {
      throw sourceNotFoundError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedSourceDirectoryPath
    );
    if (!isPathInside(paths.projectDirectoryPath, resolvedSourceDirectoryPath)) {
      throw invalidProjectPathError();
    }

    const resolvedSourceFilePath = await this.resolveExistingPath(
      paths.sourceFilePath
    );
    if (resolvedSourceFilePath === null) {
      throw sourceNotFoundError();
    }
    this.assertInsideManagementRoot(
      managementRootPath,
      resolvedSourceFilePath
    );
    if (!isPathInside(resolvedSourceDirectoryPath, resolvedSourceFilePath)) {
      throw invalidProjectPathError();
    }

    let contents: string;
    try {
      contents = await this.fileSystem.readFile(paths.sourceFilePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw sourceNotFoundError();
      }
      throw sourceReadFailedError();
    }

    if (sha256(contents) !== project.source.sha256) {
      throw sourceHashMismatchError();
    }
    return contents;
  }

  private async restoreBackup(
    backupPath: string,
    destinationPath: string,
    backupReady: boolean
  ): Promise<boolean> {
    if (!backupReady) {
      return true;
    }

    try {
      await this.fileSystem.unlink(destinationPath);
    } catch (error) {
      if (!isMissingPathError(error)) {
        return false;
      }
    }

    try {
      await this.fileSystem.rename(backupPath, destinationPath);
      return true;
    } catch {
      return false;
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

  private async removeTemporaryDirectory(
    directoryPath: string,
    filePath: string,
    sourceDirectoryPath: string,
    sourceFilePath: string
  ): Promise<void> {
    await this.removeTemporaryFile(filePath);
    await this.removeTemporaryFile(sourceFilePath);
    try {
      await this.fileSystem.rmdir(sourceDirectoryPath);
    } catch {
      // The source directory may already be absent.
    }
    try {
      await this.fileSystem.rmdir(directoryPath);
    } catch {
      // The directory may already have been renamed or removed.
    }
  }
}
