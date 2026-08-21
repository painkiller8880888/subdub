import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import type { AssetKind } from "../../schema/asset.js";
import {
  AssetDatabaseError,
  AssetProcessingRaceError,
  AssetStagingFailedError
} from "./asset-errors.js";
import { AssetProcessingError } from "./asset-processing-errors.js";
import type { AssetFileStore } from "./asset-file-store.js";
import {
  AssetRepository,
  type AssetProcessingKey
} from "./asset-repository.js";
import type {
  AssetMediaAnalysis,
  AssetMediaProcessingPort
} from "./processing/types.js";

export const DEFAULT_MAX_THUMBNAIL_EDGE_PX = 480;
export const THUMBNAIL_TEMP_ROOT = "thumbnails-tmp" as const;

export type AssetProcessingServiceOptions = {
  repository: AssetRepository;
  fileStore: AssetFileStore;
  processingPort: AssetMediaProcessingPort;
  maxThumbnailEdgePx?: number;
  now?: () => Date;
};

export type AssetProcessingOutcome =
  { status: "processed" } | { status: "skipped" } | { status: "failed" };

function isErrnoCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}

async function hashAndSize(absolutePath: string): Promise<{
  checksum: string;
  sizeBytes: number;
}> {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(absolutePath);
      stream.on("data", (chunk: Buffer | string) => {
        hash.update(chunk);
        sizeBytes +=
          typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      });
      stream.on("end", resolve);
      stream.on("error", reject);
    });
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      throw new AssetProcessingError("PROCESSING_MEDIA_NOT_FOUND", {
        cause: error
      });
    }
    throw new AssetProcessingError("PROCESSING_INTERNAL_FAILED", {
      cause: error
    });
  }
  return { checksum: hash.digest("hex"), sizeBytes };
}

function thumbnailFileNames(kind: AssetKind, count: number): string[] {
  if (count === 0) {
    return [];
  }
  if (kind === "document_scan") {
    return Array.from(
      { length: count },
      (_, index) => `page-${String(index + 1).padStart(4, "0")}.png`
    );
  }
  return [kind === "photo" ? "image.png" : "frame.png"];
}

function isPositiveMetadataValue(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function validateEditingAssetMetadata(
  kind: AssetKind,
  metadata: AssetMediaAnalysis
): void {
  if (
    kind === "video" &&
    (!isPositiveMetadataValue(metadata.width) ||
      !isPositiveMetadataValue(metadata.height) ||
      !isPositiveMetadataValue(metadata.durationMs))
  ) {
    throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
  }
  if (
    kind === "bgm" &&
    (!isPositiveMetadataValue(metadata.durationMs) ||
      metadata.width !== null ||
      metadata.height !== null)
  ) {
    throw new AssetProcessingError("PROCESSING_METADATA_FAILED");
  }
}

function toProcessingError(error: unknown): AssetProcessingError {
  if (error instanceof AssetProcessingError) {
    return error;
  }
  if (error instanceof AssetDatabaseError) {
    return new AssetProcessingError("PROCESSING_DATABASE_FAILED", {
      cause: error
    });
  }
  if (error instanceof AssetStagingFailedError) {
    return new AssetProcessingError("PROCESSING_THUMBNAIL_FAILED", {
      cause: error
    });
  }
  return new AssetProcessingError("PROCESSING_INTERNAL_FAILED", {
    cause: error
  });
}

export class AssetProcessingService {
  private readonly repository: AssetRepository;
  private readonly fileStore: AssetFileStore;
  private readonly processingPort: AssetMediaProcessingPort;
  private readonly maxThumbnailEdgePx: number;
  private readonly now: () => Date;
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(options: AssetProcessingServiceOptions) {
    this.repository = options.repository;
    this.fileStore = options.fileStore;
    this.processingPort = options.processingPort;
    this.maxThumbnailEdgePx =
      options.maxThumbnailEdgePx ?? DEFAULT_MAX_THUMBNAIL_EDGE_PX;
    this.now = options.now ?? (() => new Date());
  }

  listProcessingAssetKeys(): Promise<readonly AssetProcessingKey[]> {
    return Promise.resolve(this.repository.findProcessingAssetKeys());
  }

  async processAsset(
    assetId: string,
    version: number
  ): Promise<AssetProcessingOutcome> {
    const key = `${assetId}:${version}`;
    return this.runExclusive(key, () =>
      this.processAssetUnlocked(assetId, version)
    );
  }

  private async runExclusive<T>(
    key: string,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.inFlight.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => gate);
    this.inFlight.set(key, next);
    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.inFlight.get(key) === next) {
        this.inFlight.delete(key);
      }
    }
  }

  private async processAssetUnlocked(
    assetId: string,
    version: number
  ): Promise<AssetProcessingOutcome> {
    const asset = this.repository.findAsset(assetId);
    if (asset === undefined) {
      return { status: "skipped" };
    }
    const versionRecord = this.repository.findAssetVersion(assetId, version);
    if (versionRecord === undefined || versionRecord.status !== "processing") {
      return { status: "skipped" };
    }

    let tempRoot: string | undefined;
    const placedThumbnailPaths: string[] = [];
    let movedCandidateMedia = false;
    try {
      const stagedPath = versionRecord.stagingPath;
      const stagedExists =
        stagedPath !== null && (await this.fileStore.pathExists(stagedPath));
      const sourceRelativePath =
        stagedExists && stagedPath !== null
          ? stagedPath
          : versionRecord.libraryMediaPath;
      const mediaPath = this.fileStore.resolvePath(sourceRelativePath);
      const { checksum, sizeBytes } = await hashAndSize(mediaPath);

      const processed = await this.processingPort.processMedia({
        mediaPath,
        kind: asset.kind,
        maxThumbnailEdgePx: this.maxThumbnailEdgePx
      });
      validateEditingAssetMetadata(asset.kind, processed.metadata);

      const names = thumbnailFileNames(asset.kind, processed.thumbnails.length);
      tempRoot = `${THUMBNAIL_TEMP_ROOT}/${randomUUID().toLowerCase()}`;
      for (let index = 0; index < names.length; index++) {
        await this.fileStore.writeFile(
          `${tempRoot}/${names[index]}`,
          processed.thumbnails[index]
        );
      }

      const finalThumbnailPaths: string[] = [];
      for (const name of names) {
        const finalPath = `thumbnails/${assetId}/v${version}/${name}`;
        await this.fileStore.moveToMedia(`${tempRoot}/${name}`, finalPath);
        finalThumbnailPaths.push(finalPath);
        placedThumbnailPaths.push(finalPath);
      }

      if (stagedExists && stagedPath !== null) {
        if (
          !(await this.fileStore.pathExists(versionRecord.libraryMediaPath))
        ) {
          await this.fileStore.moveToMedia(
            stagedPath,
            versionRecord.libraryMediaPath
          );
          movedCandidateMedia = true;
        } else {
          await this.fileStore.removeBestEffort(stagedPath);
        }
      }

      try {
        const activated = this.repository.transaction((repository) =>
          repository.markProcessingSucceeded({
            assetId,
            version,
            checksum,
            sizeBytes,
            width: processed.metadata.width,
            height: processed.metadata.height,
            durationMs: processed.metadata.durationMs,
            pageCount: processed.metadata.pageCount,
            thumbnailPaths: finalThumbnailPaths,
            updatedAt: this.now().toISOString()
          })
        );
        if (!activated) {
          for (const placedPath of placedThumbnailPaths) {
            await this.fileStore.removeBestEffort(placedPath);
          }
          if (movedCandidateMedia) {
            await this.fileStore.removeBestEffort(
              versionRecord.libraryMediaPath
            );
          }
          return { status: "failed" };
        }
      } catch (error) {
        if (error instanceof AssetProcessingRaceError) {
          for (const placedPath of placedThumbnailPaths) {
            await this.fileStore.removeBestEffort(placedPath);
          }
          if (movedCandidateMedia) {
            await this.fileStore.removeBestEffort(
              versionRecord.libraryMediaPath
            );
          }
          return { status: "skipped" };
        }
        throw error;
      }
      return { status: "processed" };
    } catch (error) {
      for (const placedPath of placedThumbnailPaths) {
        await this.fileStore.removeBestEffort(placedPath);
      }
      if (movedCandidateMedia) {
        await this.fileStore.removeBestEffort(versionRecord.libraryMediaPath);
      }
      const processingError = toProcessingError(error);
      await this.recordFailure(assetId, version, processingError);
      if (versionRecord.stagingPath !== null) {
        await this.fileStore.removeBestEffort(versionRecord.stagingPath);
      }
      return { status: "failed" };
    } finally {
      if (tempRoot !== undefined) {
        await this.fileStore.removeBestEffort(tempRoot);
      }
    }
  }

  private async recordFailure(
    assetId: string,
    version: number,
    error: AssetProcessingError
  ): Promise<void> {
    try {
      this.repository.markProcessingFailed({
        assetId,
        version,
        errorCode: error.code,
        errorMessage: error.message,
        updatedAt: this.now().toISOString()
      });
    } catch (recordError) {
      console.error(
        `failed to persist processing failure for asset ${assetId}`,
        recordError
      );
    }
  }
}
