import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  idSchema,
  renderRunLogSchema,
  type RenderRunLog
} from "../../schema/index.js";

export type RenderRunLogStoreErrorCode =
  | "RENDER_PROJECT_ID_INVALID"
  | "RENDER_RUN_ID_INVALID"
  | "RENDER_RUN_LOG_PATH_INVALID"
  | "RENDER_RUN_NOT_FOUND"
  | "RENDER_RUN_LOG_READ_FAILED"
  | "RENDER_RUN_LOG_INVALID"
  | "RENDER_RUN_LOG_WRITE_FAILED";

export class RenderRunLogStoreError extends Error {
  readonly code: RenderRunLogStoreErrorCode;
  readonly status: 400 | 404 | 500;

  constructor(
    code: RenderRunLogStoreErrorCode,
    status: 400 | 404 | 500,
    message = code
  ) {
    super(message);
    this.name = "RenderRunLogStoreError";
    this.stack = undefined;
    this.code = code;
    this.status = status;
  }
}

export type RenderRunLogStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
};

const defaultFileSystem: RenderRunLogStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
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
  fileSystem: RenderRunLogStoreFileSystem,
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
  code: "RENDER_PROJECT_ID_INVALID" | "RENDER_RUN_ID_INVALID"
): string {
  const result = idSchema.safeParse(value);
  if (!result.success) {
    throw new RenderRunLogStoreError(code, 400);
  }
  return result.data;
}

export type RenderRunLogStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<RenderRunLogStoreFileSystem>;
  readonly createId?: () => string;
};

export type RenderRunLogStorePort = Pick<RenderRunLogStore, "read" | "write">;

export class RenderRunLogStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: RenderRunLogStoreFileSystem;
  private readonly createId: () => string;

  constructor(options: RenderRunLogStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.createId = options.createId ?? randomUUID;
  }

  async read(projectId: unknown, runId: unknown): Promise<RenderRunLog> {
    const safeProjectId = normalizedId(projectId, "RENDER_PROJECT_ID_INVALID");
    const safeRunId = normalizedId(runId, "RENDER_RUN_ID_INVALID");
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
        throw new RenderRunLogStoreError("RENDER_RUN_NOT_FOUND", 404);
      }
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_READ_FAILED", 500);
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_INVALID", 500);
    }

    const parsedLog = renderRunLogSchema.safeParse(parsedJson);
    if (
      !parsedLog.success ||
      parsedLog.data.projectId !== safeProjectId ||
      parsedLog.data.runId !== safeRunId
    ) {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_INVALID", 500);
    }
    return parsedLog.data;
  }

  async write(projectId: unknown, runLog: unknown): Promise<void> {
    const safeProjectId = normalizedId(projectId, "RENDER_PROJECT_ID_INVALID");
    const parsedLog = renderRunLogSchema.safeParse(runLog);
    if (!parsedLog.success || parsedLog.data.projectId !== safeProjectId) {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_INVALID", 500);
    }

    const runFilePath = await this.resolveRunFilePath(
      safeProjectId,
      parsedLog.data.runId,
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
        `.${parsedLog.data.runId}.${token}.tmp`
      );
    } catch {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_WRITE_FAILED", 500);
    }

    try {
      await this.fileSystem.writeFile(
        temporaryFilePath,
        `${JSON.stringify(parsedLog.data, null, 2)}\n`
      );
      await renameAtomically(this.fileSystem, temporaryFilePath, runFilePath);
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_WRITE_FAILED", 500);
    }
  }

  private async resolveRunFilePath(
    projectId: string,
    runId: string,
    createDirectory: boolean
  ): Promise<string> {
    let workspacePath: string;
    let projectsPath: string;
    let projectPath: string;
    try {
      workspacePath = await this.fileSystem.realpath(this.workspaceRoot);
      projectsPath = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects")
      );
      projectPath = await this.fileSystem.realpath(
        path.join(this.workspaceRoot, "projects", projectId)
      );
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new RenderRunLogStoreError("RENDER_RUN_NOT_FOUND", 404);
      }
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
    }

    if (
      !isPathInside(workspacePath, projectsPath) ||
      !isPathInside(projectsPath, projectPath)
    ) {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
    }

    const runsPath = path.join(projectPath, "runs");
    if (createDirectory) {
      try {
        await this.fileSystem.mkdir(runsPath, { recursive: true });
      } catch {
        throw new RenderRunLogStoreError("RENDER_RUN_LOG_WRITE_FAILED", 500);
      }
    }

    let resolvedRunsPath: string;
    try {
      resolvedRunsPath = await this.fileSystem.realpath(runsPath);
    } catch (error) {
      if (!createDirectory && isMissingPathError(error)) {
        throw new RenderRunLogStoreError("RENDER_RUN_NOT_FOUND", 404);
      }
      throw new RenderRunLogStoreError(
        createDirectory
          ? "RENDER_RUN_LOG_WRITE_FAILED"
          : "RENDER_RUN_LOG_READ_FAILED",
        500
      );
    }

    if (!isPathInside(projectPath, resolvedRunsPath)) {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
    }

    const runFilePath = path.resolve(resolvedRunsPath, `${runId}.json`);
    if (!isPathInside(resolvedRunsPath, runFilePath)) {
      throw new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
    }
    try {
      const resolvedRunFilePath = await this.fileSystem.realpath(runFilePath);
      if (!isPathInside(resolvedRunsPath, resolvedRunFilePath)) {
        throw new RenderRunLogStoreError("RENDER_RUN_LOG_PATH_INVALID", 500);
      }
    } catch (error) {
      if (createDirectory && isMissingPathError(error)) {
        return runFilePath;
      }
      if (!createDirectory && isMissingPathError(error)) {
        throw new RenderRunLogStoreError("RENDER_RUN_NOT_FOUND", 404);
      }
      if (error instanceof RenderRunLogStoreError) {
        throw error;
      }
      throw new RenderRunLogStoreError(
        createDirectory
          ? "RENDER_RUN_LOG_WRITE_FAILED"
          : "RENDER_RUN_LOG_READ_FAILED",
        500
      );
    }
    return runFilePath;
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Best-effort cleanup must not replace the original log error.
    }
  }
}
