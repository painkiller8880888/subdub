import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { idSchema } from "../../schema/index.js";
import {
  type VoicevoxAdjustmentFile,
  voicevoxAdjustmentFileSchema
} from "../../voicevox/schemas.js";

export const VOICEVOX_ADJUSTMENT_RELATIVE_DIRECTORY =
  "voice-adjustments" as const;

export type VoicevoxAdjustmentAddress = {
  readonly projectId: unknown;
  readonly lineId: unknown;
};

export type VoicevoxAdjustmentStoreFileSystem = {
  mkdir(
    directoryPath: string,
    options?: { readonly recursive?: boolean }
  ): Promise<void>;
  readFile(filePath: string): Promise<Uint8Array>;
  writeFile(filePath: string, contents: string): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
};

export type VoicevoxAdjustmentStoreOptions = {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<VoicevoxAdjustmentStoreFileSystem>;
};

export type VoicevoxAdjustmentStoreErrorCode =
  | "VOICEVOX_ADJUSTMENT_STORE_INPUT_INVALID"
  | "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
  | "VOICEVOX_ADJUSTMENT_STORE_READ_FAILED"
  | "VOICEVOX_ADJUSTMENT_STORE_JSON_INVALID"
  | "VOICEVOX_ADJUSTMENT_STORE_SCHEMA_INVALID"
  | "VOICEVOX_ADJUSTMENT_STORE_LINE_ID_MISMATCH"
  | "VOICEVOX_ADJUSTMENT_STORE_WRITE_FAILED"
  | "VOICEVOX_ADJUSTMENT_STORE_RENAME_FAILED"
  | "VOICEVOX_ADJUSTMENT_STORE_DELETE_FAILED";

export class VoicevoxAdjustmentStoreError extends Error {
  readonly code: VoicevoxAdjustmentStoreErrorCode;

  constructor(code: VoicevoxAdjustmentStoreErrorCode) {
    super(code);
    this.name = "VoicevoxAdjustmentStoreError";
    this.code = code;
  }
}

const defaultFileSystem: VoicevoxAdjustmentStoreFileSystem = {
  mkdir: async (directoryPath, options) => {
    await fs.mkdir(directoryPath, options);
  },
  readFile: (filePath) => fs.readFile(filePath),
  writeFile: async (filePath, contents) => {
    await fs.writeFile(filePath, contents, {
      encoding: "utf8",
      flag: "wx"
    });
  },
  rename: (sourcePath, destinationPath) =>
    fs.rename(sourcePath, destinationPath),
  unlink: (filePath) => fs.unlink(filePath),
  realpath: (filePath) => fs.realpath(filePath)
};

const adjustmentLocks = new Map<string, Promise<void>>();

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

function parseAddress(input: VoicevoxAdjustmentAddress): {
  readonly projectId: string;
  readonly lineId: string;
} {
  const projectId = idSchema.safeParse(input.projectId);
  const lineId = idSchema.safeParse(input.lineId);
  if (!projectId.success || !lineId.success) {
    throw new VoicevoxAdjustmentStoreError(
      "VOICEVOX_ADJUSTMENT_STORE_INPUT_INVALID"
    );
  }
  return { projectId: projectId.data, lineId: lineId.data };
}

function adjustmentRelativePath(address: {
  readonly projectId: string;
  readonly lineId: string;
}): string {
  return `projects/${address.projectId}/${VOICEVOX_ADJUSTMENT_RELATIVE_DIRECTORY}/${address.lineId}.json`;
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type VoicevoxAdjustmentReadResult = {
  readonly adjustment: VoicevoxAdjustmentFile;
  readonly checksum: string;
};

export class VoicevoxAdjustmentStore {
  private readonly workspaceRoot: string;
  private readonly fileSystem: VoicevoxAdjustmentStoreFileSystem;

  constructor(options: VoicevoxAdjustmentStoreOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
  }

  getAdjustmentPath(input: VoicevoxAdjustmentAddress): string {
    const address = parseAddress(input);
    return adjustmentRelativePath(address);
  }

  async read(
    input: VoicevoxAdjustmentAddress
  ): Promise<VoicevoxAdjustmentFile | null> {
    const result = await this.readWithChecksum(input);
    return result?.adjustment ?? null;
  }

  async readWithChecksum(
    input: VoicevoxAdjustmentAddress
  ): Promise<VoicevoxAdjustmentReadResult | null> {
    const address = parseAddress(input);
    return this.withLock(address, async () => {
      const filePath = await this.resolveExistingFilePath(address);
      if (filePath === null) {
        return null;
      }

      let bytes: Uint8Array;
      try {
        bytes = await this.fileSystem.readFile(filePath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return null;
        }
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_READ_FAILED"
        );
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(decodeUtf8(bytes)) as unknown;
      } catch {
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_JSON_INVALID"
        );
      }

      const parsed = voicevoxAdjustmentFileSchema.safeParse(parsedJson);
      if (!parsed.success) {
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_SCHEMA_INVALID"
        );
      }
      if (parsed.data.lineId !== address.lineId) {
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_LINE_ID_MISMATCH"
        );
      }

      return {
        adjustment: parsed.data,
        checksum: checksum(bytes)
      };
    });
  }

  async getChecksum(input: VoicevoxAdjustmentAddress): Promise<string | null> {
    return (await this.readWithChecksum(input))?.checksum ?? null;
  }

  async write(
    input: VoicevoxAdjustmentAddress,
    candidate: unknown
  ): Promise<VoicevoxAdjustmentFile> {
    const address = parseAddress(input);
    const parsed = voicevoxAdjustmentFileSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_SCHEMA_INVALID"
      );
    }
    if (parsed.data.lineId !== address.lineId) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_LINE_ID_MISMATCH"
      );
    }

    return this.withLock(address, async () => {
      const filePath = await this.resolveWritePath(address);
      const temporaryFilePath = path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${randomUUID()}.tmp`
      );
      const contents = `${JSON.stringify(parsed.data, null, 2)}\n`;

      try {
        await this.fileSystem.writeFile(temporaryFilePath, contents);
      } catch {
        await this.removeTemporaryFile(temporaryFilePath);
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_WRITE_FAILED"
        );
      }

      try {
        await this.fileSystem.rename(temporaryFilePath, filePath);
      } catch {
        await this.removeTemporaryFile(temporaryFilePath);
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_RENAME_FAILED"
        );
      }

      return parsed.data;
    });
  }

  async delete(input: VoicevoxAdjustmentAddress): Promise<void> {
    const address = parseAddress(input);
    await this.withLock(address, async () => {
      const filePath = await this.resolveExistingFilePath(address);
      if (filePath === null) {
        return;
      }

      try {
        await this.fileSystem.unlink(filePath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return;
        }
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_DELETE_FAILED"
        );
      }
    });
  }

  private async resolveWritePath(address: {
    readonly projectId: string;
    readonly lineId: string;
  }): Promise<string> {
    const relativePath = adjustmentRelativePath(address);
    const filePath = this.resolveLexicalPath(relativePath);
    await this.ensureSafeDirectory(path.dirname(filePath));

    // Resolve an existing target before the rename so an attacker cannot use
    // a symlink at the destination to redirect the replacement outside the
    // workspace.
    await this.resolveExistingFilePath(address);
    return filePath;
  }

  private async resolveExistingFilePath(address: {
    readonly projectId: string;
    readonly lineId: string;
  }): Promise<string | null> {
    const filePath = this.resolveLexicalPath(adjustmentRelativePath(address));
    const resolvedWorkspaceRoot = await this.resolveExistingPath(
      this.workspaceRoot
    );
    if (resolvedWorkspaceRoot === null) {
      return null;
    }
    if (!isPathInside(this.workspaceRoot, resolvedWorkspaceRoot)) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }

    const resolvedParentPath = await this.resolveExistingPath(
      path.dirname(filePath)
    );
    if (resolvedParentPath === null) {
      return null;
    }
    this.assertInsideWorkspace(resolvedWorkspaceRoot, resolvedParentPath);

    const resolvedFilePath = await this.resolveExistingPath(filePath);
    if (resolvedFilePath === null) {
      return null;
    }
    this.assertInsideWorkspace(resolvedWorkspaceRoot, resolvedFilePath);
    return filePath;
  }

  private async ensureSafeDirectory(directoryPath: string): Promise<void> {
    const lexicalWorkspaceRoot = this.workspaceRoot;
    if (!isPathInside(lexicalWorkspaceRoot, directoryPath)) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }

    try {
      await this.fileSystem.mkdir(lexicalWorkspaceRoot, { recursive: true });
    } catch {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }
    const managementRootPath =
      await this.resolveExistingPath(lexicalWorkspaceRoot);
    if (managementRootPath === null) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }
    if (!isPathInside(lexicalWorkspaceRoot, managementRootPath)) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }

    let currentPath = lexicalWorkspaceRoot;
    const segments = path
      .relative(lexicalWorkspaceRoot, directoryPath)
      .split(path.sep)
      .filter((segment) => segment.length > 0);
    for (const segment of segments) {
      currentPath = path.join(currentPath, segment);
      const resolvedExistingPath = await this.resolveExistingPath(currentPath);
      if (resolvedExistingPath === null) {
        try {
          await this.fileSystem.mkdir(currentPath, { recursive: false });
        } catch (error) {
          if (!isExistingPathError(error)) {
            throw new VoicevoxAdjustmentStoreError(
              "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
            );
          }
        }
      }

      const resolvedPath = await this.resolveExistingPath(currentPath);
      if (resolvedPath === null) {
        throw new VoicevoxAdjustmentStoreError(
          "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
        );
      }
      this.assertInsideWorkspace(managementRootPath, resolvedPath);
    }
  }

  private resolveLexicalPath(relativePath: string): string {
    const filePath = path.resolve(
      this.workspaceRoot,
      ...relativePath.split("/")
    );
    if (!isPathInside(this.workspaceRoot, filePath)) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }
    return filePath;
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      return await this.fileSystem.realpath(filePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }
  }

  private assertInsideWorkspace(
    workspaceRootPath: string,
    candidatePath: string
  ): void {
    if (!isPathInside(workspaceRootPath, candidatePath)) {
      throw new VoicevoxAdjustmentStoreError(
        "VOICEVOX_ADJUSTMENT_STORE_PATH_INVALID"
      );
    }
  }

  private async withLock<T>(
    address: { readonly projectId: string; readonly lineId: string },
    operation: () => Promise<T>
  ): Promise<T> {
    const key = `${this.workspaceRoot}\u0000${address.projectId}\u0000${address.lineId}`;
    const previous = adjustmentLocks.get(key) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    adjustmentLocks.set(key, current);

    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (adjustmentLocks.get(key) === current) {
        adjustmentLocks.delete(key);
      }
    }
  }

  private async removeTemporaryFile(filePath: string): Promise<void> {
    try {
      await this.fileSystem.unlink(filePath);
    } catch {
      // Cleanup must not hide the original write or rename failure.
    }
  }
}

export function createVoicevoxAdjustmentStore(
  options: VoicevoxAdjustmentStoreOptions
): VoicevoxAdjustmentStore {
  return new VoicevoxAdjustmentStore(options);
}
