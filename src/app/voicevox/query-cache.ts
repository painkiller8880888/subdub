import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { idSchema } from "../../schema/primitives.js";
import {
  voicevoxAudioQuerySchema,
  type VoicevoxAudioQuery
} from "../../voicevox/schemas.js";

const cacheKeyPattern = /^[0-9a-f]{64}$/;

export const VOICEVOX_QUERY_CACHE_RELATIVE_DIRECTORY =
  "cache/voicevox-query" as const;

export type VoicevoxQueryCacheFileSystem = {
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

const defaultFileSystem: VoicevoxQueryCacheFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
  writeFile: (filePath, contents) =>
    fs.writeFile(filePath, contents, {
      encoding: "utf8",
      flag: "wx"
    }),
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

export type VoicevoxQueryCacheOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<VoicevoxQueryCacheFileSystem>;
};

export type VoicevoxQueryCacheEntry = {
  readonly projectId: string;
  readonly lineId: string;
  readonly cacheKey: string;
};

export type VoicevoxQueryCacheErrorCode =
  | "VOICEVOX_QUERY_CACHE_ID_INVALID"
  | "VOICEVOX_QUERY_CACHE_KEY_INVALID"
  | "VOICEVOX_QUERY_CACHE_PATH_INVALID"
  | "VOICEVOX_QUERY_CACHE_READ_FAILED"
  | "VOICEVOX_QUERY_CACHE_WRITE_FAILED"
  | "VOICEVOX_QUERY_CACHE_QUERY_INVALID";

export class VoicevoxQueryCacheError extends Error {
  readonly code: VoicevoxQueryCacheErrorCode;

  constructor(code: VoicevoxQueryCacheErrorCode) {
    super(code);
    this.name = "VoicevoxQueryCacheError";
    this.code = code;
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return getErrorCode(error) === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return getErrorCode(error) === "EEXIST";
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

function validateId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) {
    throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_ID_INVALID");
  }
  return parsed.data;
}

function validateCacheKey(value: unknown): string {
  if (typeof value !== "string" || !cacheKeyPattern.test(value)) {
    throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_KEY_INVALID");
  }
  return value;
}

function queryRelativePath(entry: VoicevoxQueryCacheEntry): string {
  const projectId = validateId(entry.projectId);
  const lineId = validateId(entry.lineId);
  const cacheKey = validateCacheKey(entry.cacheKey);
  return `projects/${projectId}/${VOICEVOX_QUERY_CACHE_RELATIVE_DIRECTORY}/${lineId}-${cacheKey}.json`;
}

export class VoicevoxQueryCache {
  private readonly workspaceRoot: string;
  private readonly fileSystem: VoicevoxQueryCacheFileSystem;

  constructor(options: VoicevoxQueryCacheOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
  }

  getQueryPath(entry: VoicevoxQueryCacheEntry): string {
    return queryRelativePath(entry);
  }

  async read(
    entry: VoicevoxQueryCacheEntry
  ): Promise<VoicevoxAudioQuery | null> {
    const relativePath = queryRelativePath(entry);
    const filePath = await this.resolveExistingFilePath(relativePath);
    if (filePath === null) {
      return null;
    }

    let contents: string;
    try {
      contents = await this.fileSystem.readFile(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_READ_FAILED");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      return null;
    }

    const parsedQuery = voicevoxAudioQuerySchema.safeParse(parsedJson);
    return parsedQuery.success ? parsedQuery.data : null;
  }

  async write(entry: VoicevoxQueryCacheEntry, query: unknown): Promise<void> {
    const relativePath = queryRelativePath(entry);
    const parsedQuery = voicevoxAudioQuerySchema.safeParse(query);
    if (!parsedQuery.success) {
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_QUERY_INVALID");
    }

    const cacheDirectoryPath = path.dirname(
      path.resolve(this.workspaceRoot, ...relativePath.split("/"))
    );
    const filePath = path.join(
      await this.ensureSafeCacheDirectory(cacheDirectoryPath),
      path.basename(relativePath)
    );
    const temporaryFilePath = path.join(
      cacheDirectoryPath,
      `.${path.basename(filePath)}.${randomUUID()}.tmp`
    );

    try {
      await this.fileSystem.writeFile(
        temporaryFilePath,
        `${JSON.stringify(parsedQuery.data, null, 2)}\n`
      );
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_WRITE_FAILED");
    }

    try {
      await this.fileSystem.rename(temporaryFilePath, filePath);
    } catch {
      let existingQuery: VoicevoxAudioQuery | null = null;
      try {
        existingQuery = await this.read(entry);
      } catch {
        // A failed revalidation leaves the rename failure as a write failure.
      }
      await this.removeTemporaryFile(temporaryFilePath);
      if (existingQuery !== null) {
        return;
      }
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_WRITE_FAILED");
    }
  }

  private async resolveExistingFilePath(
    relativePath: string
  ): Promise<string | null> {
    const filePath = this.resolveLexicalPath(relativePath);
    const managementRootPath = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (managementRootPath === null) {
      return null;
    }

    const parentPath = path.dirname(filePath);
    const resolvedParentPath = await this.resolveExistingPath(parentPath);
    if (resolvedParentPath === null) {
      return null;
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedParentPath);

    const resolvedFilePath = await this.resolveExistingPath(filePath);
    if (resolvedFilePath === null) {
      return null;
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedFilePath);
    return filePath;
  }

  private async ensureSafeCacheDirectory(
    cacheDirectoryPath: string
  ): Promise<string> {
    const managementRootPath = await this.ensureDirectoryAndResolve(
      this.workspaceRoot
    );
    if (!isPathInside(this.workspaceRoot, cacheDirectoryPath)) {
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
    }

    let currentPath = this.workspaceRoot;
    const relativeSegments = path
      .relative(this.workspaceRoot, cacheDirectoryPath)
      .split(path.sep)
      .filter((segment) => segment.length > 0);
    for (const segment of relativeSegments) {
      currentPath = path.join(currentPath, segment);
      await this.ensureSafeDirectory(currentPath, managementRootPath);
    }

    return cacheDirectoryPath;
  }

  private async ensureSafeDirectory(
    directoryPath: string,
    managementRootPath: string
  ): Promise<void> {
    const existingPath = await this.resolveExistingPath(directoryPath);
    if (existingPath !== null) {
      this.assertInsideManagementRoot(managementRootPath, existingPath);
      return;
    }

    try {
      await this.fileSystem.mkdir(directoryPath, { recursive: false });
    } catch (error) {
      if (!isExistingPathError(error)) {
        throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_WRITE_FAILED");
      }

      const resolvedPathAfterRace =
        await this.resolveExistingPath(directoryPath);
      if (resolvedPathAfterRace === null) {
        throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_WRITE_FAILED");
      }
      this.assertInsideManagementRoot(
        managementRootPath,
        resolvedPathAfterRace
      );
      return;
    }

    const resolvedPath = await this.resolveExistingPath(directoryPath);
    if (resolvedPath === null) {
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
    }
    this.assertInsideManagementRoot(managementRootPath, resolvedPath);
  }

  private async ensureDirectoryAndResolve(
    directoryPath: string
  ): Promise<string> {
    try {
      await this.fileSystem.mkdir(directoryPath, { recursive: true });
      const resolvedPath = await this.fileSystem.realpath(directoryPath);
      if (!isPathInside(directoryPath, resolvedPath)) {
        throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
      }
      return resolvedPath;
    } catch (error) {
      if (error instanceof VoicevoxQueryCacheError) {
        throw error;
      }
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_WRITE_FAILED");
    }
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.realpath(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
    }
  }

  private resolveLexicalPath(relativePath: string): string {
    const filePath = path.resolve(
      this.workspaceRoot,
      ...relativePath.split("/")
    );
    if (!isPathInside(this.workspaceRoot, filePath)) {
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
    }
    return filePath;
  }

  private assertInsideManagementRoot(
    managementRootPath: string,
    candidatePath: string
  ): void {
    if (!isPathInside(managementRootPath, candidatePath)) {
      throw new VoicevoxQueryCacheError("VOICEVOX_QUERY_CACHE_PATH_INVALID");
    }
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // A cleanup failure must not expose a partially written cache as valid.
    }
  }
}
