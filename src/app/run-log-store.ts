import { randomUUID } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import * as path from "node:path";

import { idSchema, normalizeRunLog, type RunLog } from "../schema/index.js";

export type RunLogStoreErrorCode =
  | "RUN_LOG_PROJECT_ID_INVALID"
  | "RUN_LOG_ID_INVALID"
  | "RUN_LOG_PATH_INVALID"
  | "RUN_LOG_NOT_FOUND"
  | "RUN_LOG_READ_FAILED"
  | "RUN_LOG_INVALID"
  | "RUN_LOG_WRITE_FAILED";

export class RunLogStoreError extends Error {
  readonly code: RunLogStoreErrorCode;
  readonly status: 400 | 404 | 500;

  constructor(
    code: RunLogStoreErrorCode,
    status: 400 | 404 | 500,
    message = code
  ) {
    super(message);
    this.name = "RunLogStoreError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
  }
}

export type RunLogStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readdir(directoryPath: string): Promise<Dirent[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
};

const defaultFileSystem: RunLogStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readdir: (directoryPath) =>
    fs.readdir(directoryPath, { withFileTypes: true }),
  readFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
  writeFile: (filePath, contents) =>
    fs.writeFile(filePath, contents, { encoding: "utf8", flag: "wx" }),
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isRetryableRenameError(error: unknown): boolean {
  const code = errorCode(error);
  return code === "EACCES" || code === "EBUSY" || code === "EPERM";
}

async function renameAtomically(
  fileSystem: RunLogStoreFileSystem,
  sourcePath: string,
  destinationPath: string
): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fileSystem.rename(sourcePath, destinationPath);
      return;
    } catch (error) {
      if (!isRetryableRenameError(error) || attempt === 19) {
        throw error;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
  }
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

function temporaryToken(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-").replace(/^-+|-+$/g, "");
}

function normalizedId(
  value: unknown,
  code: "RUN_LOG_PROJECT_ID_INVALID" | "RUN_LOG_ID_INVALID"
): string {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new RunLogStoreError(code, 400);
  }
  return result.data;
}

export type RunLogStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<RunLogStoreFileSystem>;
  readonly createId?: () => string;
};

export type RunLogStorePort = Pick<RunLogStore, "read" | "write">;
export type RunLogStoreListPort = Pick<RunLogStore, "list">;

export class RunLogStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: RunLogStoreFileSystem;
  private readonly createId: () => string;

  constructor(options: RunLogStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.createId = options.createId ?? randomUUID;
  }

  async read(projectId: unknown, runId: unknown): Promise<RunLog> {
    const safeProjectId = normalizedId(projectId, "RUN_LOG_PROJECT_ID_INVALID");
    const safeRunId = normalizedId(runId, "RUN_LOG_ID_INVALID");
    const runFilePath = await this.resolveRunFilePath(
      safeProjectId,
      safeRunId,
      false
    );

    let contents: string;
    try {
      contents = await this.fileSystem.readFile(runFilePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new RunLogStoreError("RUN_LOG_NOT_FOUND", 404);
      }
      throw new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      throw new RunLogStoreError("RUN_LOG_INVALID", 500);
    }

    const parsedLog = normalizeRunLog(parsedJson);
    if (
      parsedLog === undefined ||
      parsedLog.projectId !== safeProjectId ||
      parsedLog.runId !== safeRunId
    ) {
      throw new RunLogStoreError("RUN_LOG_INVALID", 500);
    }
    return parsedLog;
  }

  async list(projectId: unknown): Promise<RunLog[]> {
    const safeProjectId = normalizedId(projectId, "RUN_LOG_PROJECT_ID_INVALID");
    const runsPath = await this.resolveRunsPath(safeProjectId, false);
    if (runsPath === null) {
      return [];
    }

    let entries: Dirent[];
    try {
      entries = await this.fileSystem.readdir(runsPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return [];
      }
      throw new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
    }

    const logs: RunLog[] = [];
    const sortedEntries = [...entries].sort((first, second) =>
      first.name < second.name ? -1 : first.name > second.name ? 1 : 0
    );

    for (const entry of sortedEntries) {
      if (entry.name.startsWith(".") || !entry.name.endsWith(".json")) {
        continue;
      }

      const fileRunId = entry.name.slice(0, -".json".length);
      if (!idSchema.safeParse(fileRunId).success) {
        throw new RunLogStoreError("RUN_LOG_INVALID", 500);
      }

      const entryPath = path.resolve(runsPath, entry.name);
      if (!isPathInside(runsPath, entryPath)) {
        throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
      }

      let resolvedEntryPath: string;
      try {
        resolvedEntryPath = await this.fileSystem.realpath(entryPath);
      } catch {
        throw new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
      }
      if (!isPathInside(runsPath, resolvedEntryPath)) {
        throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
      }

      let contents: string;
      try {
        contents = await this.fileSystem.readFile(resolvedEntryPath);
      } catch {
        throw new RunLogStoreError("RUN_LOG_READ_FAILED", 500);
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(contents);
      } catch {
        throw new RunLogStoreError("RUN_LOG_INVALID", 500);
      }

      const parsedLog = normalizeRunLog(parsedJson);
      if (
        parsedLog === undefined ||
        parsedLog.projectId !== safeProjectId ||
        parsedLog.runId !== fileRunId
      ) {
        throw new RunLogStoreError("RUN_LOG_INVALID", 500);
      }
      logs.push(parsedLog);
    }

    return logs;
  }

  async write(
    projectId: unknown,
    runLog: unknown,
    expectedRunId?: unknown
  ): Promise<void> {
    const safeProjectId = normalizedId(projectId, "RUN_LOG_PROJECT_ID_INVALID");
    const parsedLog = normalizeRunLog(runLog);
    if (parsedLog === undefined || parsedLog.projectId !== safeProjectId) {
      throw new RunLogStoreError("RUN_LOG_INVALID", 500);
    }
    const safeRunId = normalizedId(parsedLog.runId, "RUN_LOG_ID_INVALID");
    if (
      expectedRunId !== undefined &&
      safeRunId !== normalizedId(expectedRunId, "RUN_LOG_ID_INVALID")
    ) {
      throw new RunLogStoreError("RUN_LOG_INVALID", 500);
    }

    const runFilePath = await this.resolveRunFilePath(
      safeProjectId,
      safeRunId,
      true
    );
    const directoryPath = path.dirname(runFilePath);
    let temporaryFilePath: string;
    try {
      const token = temporaryToken(this.createId());
      if (token.length === 0) {
        throw new Error("temporary run log id is empty");
      }
      temporaryFilePath = path.join(
        directoryPath,
        `.${safeRunId}.${token}.tmp`
      );
    } catch {
      throw new RunLogStoreError("RUN_LOG_WRITE_FAILED", 500);
    }

    try {
      await this.fileSystem.writeFile(
        temporaryFilePath,
        `${JSON.stringify(parsedLog, null, 2)}\n`
      );
      await renameAtomically(this.fileSystem, temporaryFilePath, runFilePath);
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new RunLogStoreError("RUN_LOG_WRITE_FAILED", 500);
    }
  }

  private async resolveRunFilePath(
    projectId: string,
    runId: string,
    createDirectory: boolean
  ): Promise<string> {
    const runsPath = await this.resolveRunsPath(projectId, createDirectory);
    if (runsPath === null) {
      throw new RunLogStoreError("RUN_LOG_NOT_FOUND", 404);
    }

    const runFilePath = path.resolve(runsPath, `${runId}.json`);
    if (!isPathInside(runsPath, runFilePath)) {
      throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
    }
    try {
      const resolvedRunFilePath = await this.fileSystem.realpath(runFilePath);
      if (!isPathInside(runsPath, resolvedRunFilePath)) {
        throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
      }
    } catch (error) {
      if (createDirectory && isMissingPathError(error)) {
        return runFilePath;
      }
      if (!createDirectory && isMissingPathError(error)) {
        throw new RunLogStoreError("RUN_LOG_NOT_FOUND", 404);
      }
      if (error instanceof RunLogStoreError) {
        throw error;
      }
      throw new RunLogStoreError(
        createDirectory ? "RUN_LOG_WRITE_FAILED" : "RUN_LOG_READ_FAILED",
        500
      );
    }
    return runFilePath;
  }

  private async resolveRunsPath(
    projectId: string,
    createDirectory: boolean
  ): Promise<string | null> {
    let workspacePath: string;
    let projectsPath: string;
    let projectPath: string;
    try {
      if (createDirectory) {
        await this.fileSystem.mkdir(this.workspaceRoot, { recursive: true });
        await this.fileSystem.mkdir(path.join(this.workspaceRoot, "projects"), {
          recursive: true
        });
        await this.fileSystem.mkdir(
          path.join(this.workspaceRoot, "projects", projectId),
          { recursive: true }
        );
      }
      workspacePath = await this.fileSystem.realpath(this.workspaceRoot);
      projectsPath = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects")
      );
      projectPath = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects", projectId)
      );
    } catch (error) {
      if (!createDirectory && isMissingPathError(error)) {
        return null;
      }
      throw new RunLogStoreError(
        createDirectory ? "RUN_LOG_WRITE_FAILED" : "RUN_LOG_PATH_INVALID",
        500
      );
    }

    if (
      !isPathInside(workspacePath, projectsPath) ||
      !isPathInside(projectsPath, projectPath)
    ) {
      throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
    }

    const runsPath = path.join(projectPath, "runs");
    if (createDirectory) {
      try {
        await this.fileSystem.mkdir(runsPath, { recursive: true });
      } catch {
        throw new RunLogStoreError("RUN_LOG_WRITE_FAILED", 500);
      }
    }

    let resolvedRunsPath: string;
    try {
      resolvedRunsPath = await this.fileSystem.realpath(runsPath);
    } catch (error) {
      if (!createDirectory && isMissingPathError(error)) {
        return null;
      }
      throw new RunLogStoreError(
        createDirectory ? "RUN_LOG_WRITE_FAILED" : "RUN_LOG_READ_FAILED",
        500
      );
    }

    if (!isPathInside(projectPath, resolvedRunsPath)) {
      throw new RunLogStoreError("RUN_LOG_PATH_INVALID", 500);
    }
    return resolvedRunsPath;
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Cleanup is best effort and must not replace the original error.
    }
  }
}
