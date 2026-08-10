import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { idSchema } from "../../schema/index.js";

export const VOICEVOX_PREVIEW_RELATIVE_DIRECTORY =
  "cache/voicevox-preview" as const;

export type VoicevoxPreviewStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, contents: Uint8Array): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
};

export type VoicevoxPreviewAddress = {
  readonly projectId: unknown;
  readonly lineId: unknown;
  readonly previewId: unknown;
};

export type VoicevoxPreviewStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<VoicevoxPreviewStoreFileSystem>;
};

export type VoicevoxPreviewStoreErrorCode =
  | "VOICEVOX_PREVIEW_STORE_INPUT_INVALID"
  | "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
  | "VOICEVOX_PREVIEW_STORE_READ_FAILED"
  | "VOICEVOX_PREVIEW_STORE_WRITE_FAILED"
  | "VOICEVOX_PREVIEW_STORE_RENAME_FAILED";

export class VoicevoxPreviewStoreError extends Error {
  readonly code: VoicevoxPreviewStoreErrorCode;

  constructor(code: VoicevoxPreviewStoreErrorCode) {
    super(code);
    this.name = "VoicevoxPreviewStoreError";
    this.code = code;
  }
}

const defaultFileSystem: VoicevoxPreviewStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath),
  writeFile: async (filePath, contents) => {
    await fs.writeFile(filePath, contents, { flag: "wx" });
  },
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

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

export class VoicevoxPreviewStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: VoicevoxPreviewStoreFileSystem;

  constructor(options: VoicevoxPreviewStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = { ...defaultFileSystem, ...options.fileSystem };
  }

  async write(
    input: VoicevoxPreviewAddress,
    bytes: Uint8Array
  ): Promise<string> {
    const address = this.parseAddress(input);
    if (bytes.byteLength === 0) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_WRITE_FAILED"
      );
    }

    const previewId = idSchema.parse(address.previewId);
    const filePath = this.resolveLexicalPath(
      this.relativePath({ ...address, previewId })
    );
    await this.ensureSafeDirectory(path.dirname(filePath));
    const temporaryFilePath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${randomUUID()}.tmp`
    );

    try {
      await this.fileSystem.writeFile(temporaryFilePath, new Uint8Array(bytes));
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_WRITE_FAILED"
      );
    }

    try {
      await this.fileSystem.rename(temporaryFilePath, filePath);
    } catch {
      await this.removeTemporaryFile(temporaryFilePath);
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_RENAME_FAILED"
      );
    }

    return previewId;
  }

  async read(input: VoicevoxPreviewAddress): Promise<Uint8Array | null> {
    const address = this.parseAddress(input);
    const filePath = await this.resolveExistingFilePath(address);
    if (filePath === null) {
      return null;
    }
    try {
      return new Uint8Array(await this.fileSystem.readFile(filePath));
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxPreviewStoreError("VOICEVOX_PREVIEW_STORE_READ_FAILED");
    }
  }

  private parseAddress(input: VoicevoxPreviewAddress): {
    readonly projectId: string;
    readonly lineId: string;
    readonly previewId: string;
  } {
    const projectId = idSchema.safeParse(input.projectId);
    const lineId = idSchema.safeParse(input.lineId);
    const previewId = idSchema.safeParse(input.previewId);
    if (!projectId.success || !lineId.success || !previewId.success) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_INPUT_INVALID"
      );
    }
    return {
      projectId: projectId.data,
      lineId: lineId.data,
      previewId: previewId.data
    };
  }

  private relativePath(input: {
    readonly projectId: string;
    readonly lineId: string;
    readonly previewId: string;
  }): string {
    return `projects/${input.projectId}/${VOICEVOX_PREVIEW_RELATIVE_DIRECTORY}/${input.lineId}-${input.previewId}.wav`;
  }

  private resolveLexicalPath(relativePath: string): string {
    const filePath = path.resolve(
      this.workspaceRoot,
      ...relativePath.split("/")
    );
    if (!isPathInside(this.workspaceRoot, filePath)) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
    return filePath;
  }

  private async resolveExistingFilePath(input: {
    readonly projectId: string;
    readonly lineId: string;
    readonly previewId: string;
  }): Promise<string | null> {
    const filePath = this.resolveLexicalPath(this.relativePath(input));
    const workspaceRoot = await this.resolveExistingPath(this.workspaceRoot);
    if (workspaceRoot === null) {
      return null;
    }
    if (!isPathInside(this.workspaceRoot, workspaceRoot)) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
    const parentPath = await this.resolveExistingPath(path.dirname(filePath));
    if (parentPath === null) {
      return null;
    }
    this.assertInsideWorkspace(workspaceRoot, parentPath);
    const resolvedFilePath = await this.resolveExistingPath(filePath);
    if (resolvedFilePath === null) {
      return null;
    }
    this.assertInsideWorkspace(workspaceRoot, resolvedFilePath);
    return filePath;
  }

  private async ensureSafeDirectory(directoryPath: string): Promise<void> {
    if (!isPathInside(this.workspaceRoot, directoryPath)) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
    try {
      await this.fileSystem.mkdir(this.workspaceRoot, { recursive: true });
    } catch {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
    const workspaceRoot = await this.resolveExistingPath(this.workspaceRoot);
    if (workspaceRoot === null) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
    if (!isPathInside(this.workspaceRoot, workspaceRoot)) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }

    let currentPath = this.workspaceRoot;
    const segments = path
      .relative(this.workspaceRoot, directoryPath)
      .split(path.sep)
      .filter((segment) => segment.length > 0);
    for (const segment of segments) {
      currentPath = path.join(currentPath, segment);
      const existingPath = await this.resolveExistingPath(currentPath);
      if (existingPath === null) {
        try {
          await this.fileSystem.mkdir(currentPath, { recursive: false });
        } catch (error) {
          if (!isExistingPathError(error)) {
            throw new VoicevoxPreviewStoreError(
              "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
            );
          }
        }
      }
      const resolvedPath = await this.resolveExistingPath(currentPath);
      if (resolvedPath === null) {
        throw new VoicevoxPreviewStoreError(
          "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
        );
      }
      this.assertInsideWorkspace(workspaceRoot, resolvedPath);
    }
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.realpath(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
  }

  private assertInsideWorkspace(
    workspaceRoot: string,
    candidatePath: string
  ): void {
    if (!isPathInside(workspaceRoot, candidatePath)) {
      throw new VoicevoxPreviewStoreError(
        "VOICEVOX_PREVIEW_STORE_PATH_INVALID"
      );
    }
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Cleanup must not hide the original preview write failure.
    }
  }
}
