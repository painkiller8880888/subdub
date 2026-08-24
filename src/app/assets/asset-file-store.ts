import { constants, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  stat,
  writeFile as writeFileNode
} from "node:fs/promises";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  AssetFileTooLargeError,
  AssetStagingFailedError
} from "./asset-errors.js";

export type StagedUploadRecord = {
  uploadId: string;
  /** Path of the staging directory relative to the management root. */
  stagingRelativePath: string;
  /** Path of the staged file relative to the management root. */
  fileRelativePath: string;
  bytes: number;
};

export type AssetFileStore = {
  stageUpload(uploadId: string, stream: Readable): Promise<StagedUploadRecord>;
  readHead(relativePath: string, byteCount: number): Promise<Buffer>;
  moveToMedia(relativePath: string, mediaRelativePath: string): Promise<void>;
  pathExists(relativePath: string): Promise<boolean>;
  removeBestEffort(relativePath: string): Promise<void>;
  resolvePath(relativePath: string): string;
  writeFile(relativePath: string, data: Buffer): Promise<void>;
};

const safeUploadIdPattern = /^[a-z0-9-]{1,64}$/;

function isTruncated(stream: Readable): boolean {
  const truncated = (stream as Readable & { truncated?: unknown }).truncated;
  return truncated === true;
}

export class NodeAssetFileStore implements AssetFileStore {
  private readonly managementRoot: string;
  private readonly stagingRoot: string;

  constructor(managementRoot: string) {
    this.managementRoot = path.resolve(managementRoot);
    this.stagingRoot = path.join(this.managementRoot, "staging");
  }

  private resolveSafe(relativePath: string): string {
    const resolved = path.resolve(this.managementRoot, relativePath);
    const relative = path.relative(this.managementRoot, resolved);
    if (
      relative === "" ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    ) {
      throw new AssetStagingFailedError(new Error("unsafe media path"));
    }
    return resolved;
  }

  resolvePath(relativePath: string): string {
    return this.resolveSafe(relativePath);
  }

  async writeFile(relativePath: string, data: Buffer): Promise<void> {
    const targetPath = this.resolveSafe(relativePath);
    try {
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFileNode(targetPath, data);
    } catch (error) {
      throw new AssetStagingFailedError(error);
    }
  }

  async stageUpload(
    uploadId: string,
    stream: Readable
  ): Promise<StagedUploadRecord> {
    if (!safeUploadIdPattern.test(uploadId)) {
      throw new AssetStagingFailedError(new Error("unsafe upload id"));
    }
    const stagingDir = path.join(this.stagingRoot, uploadId);
    const stagingRelativePath = path.relative(this.managementRoot, stagingDir);
    const targetPath = path.join(stagingDir, "upload.bin");
    const fileRelativePath = path.relative(this.managementRoot, targetPath);

    try {
      await mkdir(stagingDir, { recursive: true });
      await pipeline(Readable.from(stream), createWriteStream(targetPath));
      if (isTruncated(stream)) {
        throw new AssetFileTooLargeError();
      }
      const { size } = await stat(targetPath);
      return { uploadId, stagingRelativePath, fileRelativePath, bytes: size };
    } catch (error) {
      await this.removeBestEffort(stagingRelativePath);
      throw error;
    }
  }

  async readHead(relativePath: string, byteCount: number): Promise<Buffer> {
    try {
      const file = await open(this.resolveSafe(relativePath), "r");
      try {
        const buffer = Buffer.alloc(byteCount);
        const { bytesRead } = await file.read(buffer, 0, byteCount, 0);
        return bytesRead === byteCount ? buffer : buffer.subarray(0, bytesRead);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof AssetStagingFailedError) {
        throw error;
      }
      throw new AssetStagingFailedError(error);
    }
  }

  async moveToMedia(
    relativePath: string,
    mediaRelativePath: string
  ): Promise<void> {
    const source = this.resolveSafe(relativePath);
    const destination = this.resolveSafe(mediaRelativePath);
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      const destinationExists = await stat(destination)
        .then(() => true)
        .catch(() => false);
      if (destinationExists) {
        throw new AssetStagingFailedError(
          new Error("destination file already exists")
        );
      }
      try {
        await rename(source, destination);
      } catch {
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        await rm(source, { force: true });
      }
    } catch (error) {
      if (error instanceof AssetStagingFailedError) {
        throw error;
      }
      throw new AssetStagingFailedError(error);
    }
  }

  async pathExists(relativePath: string): Promise<boolean> {
    try {
      await stat(this.resolveSafe(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async removeBestEffort(relativePath: string): Promise<void> {
    try {
      await rm(this.resolveSafe(relativePath), {
        recursive: true,
        force: true
      });
    } catch {
      // Best-effort cleanup. Failures are never surfaced to clients or logs.
    }
  }
}
