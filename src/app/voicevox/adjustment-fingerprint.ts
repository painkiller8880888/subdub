import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { idSchema } from "../../schema/primitives.js";
import type {
  VoicevoxAdjustmentFingerprintInput,
  VoicevoxAdjustmentFingerprintProvider
} from "./query-service.js";

export const VOICEVOX_ADJUSTMENT_RELATIVE_DIRECTORY =
  "voice-adjustments" as const;

export type VoicevoxAdjustmentFingerprintFileSystem = {
  readFile(filePath: string): Promise<Uint8Array>;
  realpath(filePath: string): Promise<string>;
};

export type VoicevoxAdjustmentFingerprintErrorCode =
  | "VOICEVOX_ADJUSTMENT_FINGERPRINT_INPUT_INVALID"
  | "VOICEVOX_ADJUSTMENT_FINGERPRINT_PATH_INVALID"
  | "VOICEVOX_ADJUSTMENT_FINGERPRINT_READ_FAILED";

export class VoicevoxAdjustmentFingerprintError extends Error {
  readonly code: VoicevoxAdjustmentFingerprintErrorCode;

  constructor(code: VoicevoxAdjustmentFingerprintErrorCode) {
    super(code);
    this.name = "VoicevoxAdjustmentFingerprintError";
    this.code = code;
  }
}

const defaultFileSystem: VoicevoxAdjustmentFingerprintFileSystem = {
  readFile: (filePath) => fs.readFile(filePath),
  realpath: (filePath) => fs.realpath(filePath)
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

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath === "" ||
    (relativePath !== ".." &&
      !relativePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativePath))
  );
}

export class VoicevoxAdjustmentFingerprint implements VoicevoxAdjustmentFingerprintProvider {
  private readonly workspaceRoot: string;
  private readonly fileSystem: VoicevoxAdjustmentFingerprintFileSystem;

  constructor(options: {
    readonly workspaceRoot: string;
    readonly fileSystem?: Partial<VoicevoxAdjustmentFingerprintFileSystem>;
  }) {
    this.workspaceRoot = path.resolve(options.workspaceRoot);
    this.fileSystem = {
      ...defaultFileSystem,
      ...options.fileSystem
    };
  }

  async getChecksum(
    input: VoicevoxAdjustmentFingerprintInput
  ): Promise<string | null> {
    const projectId = idSchema.safeParse(input.projectId);
    const lineId = idSchema.safeParse(input.lineId);
    if (!projectId.success || !lineId.success) {
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_INPUT_INVALID"
      );
    }

    const lexicalPath = path.resolve(
      this.workspaceRoot,
      "projects",
      projectId.data,
      VOICEVOX_ADJUSTMENT_RELATIVE_DIRECTORY,
      `${lineId.data}.json`
    );
    if (!isPathInside(this.workspaceRoot, lexicalPath)) {
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_PATH_INVALID"
      );
    }

    let resolvedWorkspaceRoot: string;
    try {
      resolvedWorkspaceRoot = await this.fileSystem.realpath(
        this.workspaceRoot
      );
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_READ_FAILED"
      );
    }

    let resolvedFilePath: string;
    try {
      resolvedFilePath = await this.fileSystem.realpath(lexicalPath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_READ_FAILED"
      );
    }
    if (!isPathInside(resolvedWorkspaceRoot, resolvedFilePath)) {
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_PATH_INVALID"
      );
    }

    let contents: Uint8Array;
    try {
      contents = await this.fileSystem.readFile(resolvedFilePath);
    } catch (error) {
      if (isMissingPathError(error)) {
        return null;
      }
      throw new VoicevoxAdjustmentFingerprintError(
        "VOICEVOX_ADJUSTMENT_FINGERPRINT_READ_FAILED"
      );
    }

    return createHash("sha256").update(contents).digest("hex");
  }
}

export function createVoicevoxAdjustmentFingerprintProvider(options: {
  readonly workspaceRoot: string;
  readonly fileSystem?: Partial<VoicevoxAdjustmentFingerprintFileSystem>;
}): VoicevoxAdjustmentFingerprintProvider {
  return new VoicevoxAdjustmentFingerprint(options);
}
