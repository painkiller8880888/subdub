import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import {
  idSchema,
  renderManifestSchema,
  type RenderManifest
} from "../../schema/index.js";
import {
  compileRenderManifest,
  RENDER_MANIFEST_VERSION,
  serializeRenderManifest,
  type RenderManifestCompilerInput,
  type RenderManifestDiagnostic,
  type RenderManifestWarning
} from "./render-manifest-compiler.js";

export const RENDER_MANIFEST_RELATIVE_PATH =
  "cache/render-manifest.json" as const;

export type RenderManifestStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
};

const defaultFileSystem: RenderManifestStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath, { encoding: "utf8" }),
  writeFile: (filePath, contents) =>
    fs.writeFile(filePath, contents, { encoding: "utf8", flag: "wx" }),
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath)
};

export type RenderManifestStoreErrorCode =
  | "RENDER_MANIFEST_PROJECT_ID_INVALID"
  | "RENDER_MANIFEST_PATH_INVALID"
  | "RENDER_MANIFEST_READ_FAILED"
  | "RENDER_MANIFEST_INVALID"
  | "RENDER_MANIFEST_WRITE_FAILED"
  | "RENDER_MANIFEST_RENAME_FAILED";

export class RenderManifestStoreError extends Error {
  readonly code: RenderManifestStoreErrorCode;

  constructor(code: RenderManifestStoreErrorCode) {
    super(code);
    this.name = "RenderManifestStoreError";
    this.code = code;
  }
}

export type RenderManifestStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<RenderManifestStoreFileSystem>;
  readonly createId?: () => string;
  readonly maxTemporaryFileAttempts?: number;
};

export type RenderManifestCacheResult =
  | {
      readonly status: "compiled" | "reused";
      readonly reused: boolean;
      readonly manifest: RenderManifest;
      readonly diagnostics: readonly [];
      readonly warnings: readonly RenderManifestWarning[];
    }
  | {
      readonly status: "failed";
      readonly reused: false;
      readonly manifest: null;
      readonly diagnostics: readonly RenderManifestDiagnostic[];
      readonly warnings: readonly RenderManifestWarning[];
    };

export type RenderManifestReadResult =
  | { readonly status: "missing"; readonly manifest: null }
  | { readonly status: "invalid"; readonly manifest: null }
  | { readonly status: "unreadable"; readonly manifest: null }
  | { readonly status: "valid"; readonly manifest: RenderManifest };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  return typeof error.code === "string" ? error.code : undefined;
}

function isMissingPathError(error: unknown): boolean {
  return errorCode(error) === "ENOENT";
}

function isExistingPathError(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
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

function normalizeProjectId(projectId: unknown): string {
  const result = idSchema.safeParse(projectId);
  if (!result.success) {
    throw new RenderManifestStoreError("RENDER_MANIFEST_PROJECT_ID_INVALID");
  }
  return result.data;
}

function cacheMatches(
  current: RenderManifest,
  expected: RenderManifest
): boolean {
  return (
    current.manifestVersion === RENDER_MANIFEST_VERSION &&
    current.sourceProjectHash === expected.sourceProjectHash &&
    current.compilerInputHash === expected.compilerInputHash &&
    current.characterCatalogVersion === expected.characterCatalogVersion &&
    current.characterMappingVersion === expected.characterMappingVersion &&
    JSON.stringify(current.sourceAssetChecksums) ===
      JSON.stringify(expected.sourceAssetChecksums)
  );
}

export function isCurrentRenderManifestCache(
  current: unknown,
  expected: unknown
): boolean {
  const currentResult = renderManifestSchema.safeParse(current);
  const expectedResult = renderManifestSchema.safeParse(expected);
  return (
    currentResult.success &&
    expectedResult.success &&
    cacheMatches(currentResult.data, expectedResult.data)
  );
}

export class RenderManifestStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: RenderManifestStoreFileSystem;
  private readonly createId: () => string;
  private readonly maxTemporaryFileAttempts: number;

  constructor(options: RenderManifestStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.maxTemporaryFileAttempts = Math.max(
      1,
      Math.floor(options.maxTemporaryFileAttempts ?? 8)
    );
  }

  getManifestPath(projectId: unknown): string {
    const safeProjectId = normalizeProjectId(projectId);
    const projectRoot = path.resolve(
      this.workspaceRoot,
      "projects",
      safeProjectId
    );
    const manifestPath = path.resolve(
      projectRoot,
      ...RENDER_MANIFEST_RELATIVE_PATH.split("/")
    );
    if (!isPathInside(this.workspaceRoot, manifestPath)) {
      throw new RenderManifestStoreError("RENDER_MANIFEST_PATH_INVALID");
    }
    return manifestPath;
  }

  async read(projectId: unknown): Promise<RenderManifest | null> {
    const result = await this.readDetailed(projectId);
    if (result.status === "unreadable") {
      throw new RenderManifestStoreError("RENDER_MANIFEST_READ_FAILED");
    }
    return result.manifest;
  }

  async readDetailed(projectId: unknown): Promise<RenderManifestReadResult> {
    const manifestPath = this.getManifestPath(projectId);
    let contents: string;
    try {
      contents = await this.fileSystem.readFile(manifestPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return { status: "missing", manifest: null };
      }
      return { status: "unreadable", manifest: null };
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(contents);
    } catch {
      return { status: "invalid", manifest: null };
    }
    const parsedManifest = renderManifestSchema.safeParse(parsedJson);
    return parsedManifest.success
      ? { status: "valid", manifest: parsedManifest.data }
      : { status: "invalid", manifest: null };
  }

  async write(projectId: unknown, manifest: unknown): Promise<void> {
    const manifestPath = this.getManifestPath(projectId);
    let serialized: string;
    try {
      serialized = serializeRenderManifest(manifest);
    } catch {
      throw new RenderManifestStoreError("RENDER_MANIFEST_INVALID");
    }

    const directoryPath = path.dirname(manifestPath);
    if (!isPathInside(this.workspaceRoot, directoryPath)) {
      throw new RenderManifestStoreError("RENDER_MANIFEST_PATH_INVALID");
    }
    try {
      await this.fileSystem.mkdir(directoryPath, { recursive: true });
    } catch {
      throw new RenderManifestStoreError("RENDER_MANIFEST_WRITE_FAILED");
    }

    let temporaryPath: string | undefined;
    let written = false;
    for (
      let attempt = 0;
      attempt < this.maxTemporaryFileAttempts;
      attempt += 1
    ) {
      const token = this.createId()
        .replace(/[^A-Za-z0-9_-]/g, "-")
        .replace(/^-+|-+$/g, "");
      if (token.length === 0) {
        continue;
      }
      const candidatePath = path.join(
        directoryPath,
        `.${path.basename(manifestPath)}.${token}.tmp`
      );
      try {
        await this.fileSystem.writeFile(candidatePath, serialized);
        temporaryPath = candidatePath;
        written = true;
        break;
      } catch (error) {
        if (isExistingPathError(error)) {
          continue;
        }
        await this.removeTemporaryFile(candidatePath);
        throw new RenderManifestStoreError("RENDER_MANIFEST_WRITE_FAILED");
      }
    }

    if (!written || temporaryPath === undefined) {
      throw new RenderManifestStoreError("RENDER_MANIFEST_WRITE_FAILED");
    }

    try {
      await this.fileSystem.rename(temporaryPath, manifestPath);
    } catch {
      await this.removeTemporaryFile(temporaryPath);
      throw new RenderManifestStoreError("RENDER_MANIFEST_RENAME_FAILED");
    }
  }

  async compileAndStore(
    projectId: unknown,
    input: RenderManifestCompilerInput
  ): Promise<RenderManifestCacheResult> {
    const result = compileRenderManifest(input);
    if (!result.success) {
      return {
        status: "failed",
        reused: false,
        manifest: null,
        diagnostics: result.diagnostics,
        warnings: result.warnings
      };
    }

    const current = await this.read(projectId);
    if (current !== null && cacheMatches(current, result.manifest)) {
      return {
        status: "reused",
        reused: true,
        manifest: current,
        diagnostics: [],
        warnings: result.warnings
      };
    }

    await this.write(projectId, result.manifest);
    return {
      status: "compiled",
      reused: false,
      manifest: result.manifest,
      diagnostics: [],
      warnings: result.warnings
    };
  }

  async getOrCompile(
    projectId: unknown,
    input: RenderManifestCompilerInput
  ): Promise<RenderManifestCacheResult> {
    return this.compileAndStore(projectId, input);
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Best-effort cleanup must not replace the original write or rename error.
    }
  }
}

export class RenderManifestCompilerService {
  private readonly store: RenderManifestStore;

  constructor(options: RenderManifestStoreOptions | RenderManifestStore) {
    this.store =
      options instanceof RenderManifestStore
        ? options
        : new RenderManifestStore(options);
  }

  async compile(
    projectId: unknown,
    input: RenderManifestCompilerInput
  ): Promise<RenderManifestCacheResult> {
    return this.store.compileAndStore(projectId, input);
  }
}
