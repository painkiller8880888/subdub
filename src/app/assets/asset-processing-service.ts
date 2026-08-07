import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";

import type { AssetKind } from "../../schema/asset.js";
import { AssetDatabaseError, AssetStagingFailedError } from "./asset-errors.js";
import { AssetProcessingError } from "./asset-processing-errors.js";
import type { AssetFileStore } from "./asset-file-store.js";
import {
  AssetRepository,
  type AssetProcessingKey
} from "./asset-repository.js";
import type { AssetMediaProcessingPort } from "./processing/types.js";

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
    const asset = this.repository.findAsset(assetId);
    if (asset === undefined || asset.status !== "processing") {
      return { status: "skipped" };
    }
    const versionRecord = this.repository.findAssetVersion(assetId, version);
    if (versionRecord === undefined) {
      return { status: "skipped" };
    }

    let tempRoot: string | undefined;
    const placedThumbnailPaths: string[] = [];
    try {
      const mediaPath = this.fileStore.resolvePath(
        versionRecord.libraryMediaPath
      );
      const { checksum, sizeBytes } = await hashAndSize(mediaPath);

      const processed = await this.processingPort.processMedia({
        mediaPath,
        kind: asset.kind,
        maxThumbnailEdgePx: this.maxThumbnailEdgePx
      });

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
      }
      placedThumbnailPaths.push(...finalThumbnailPaths);

      const committed = this.repository.transaction((repository) =>
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
      if (!committed) {
        for (const placedPath of placedThumbnailPaths) {
          await this.fileStore.removeBestEffort(placedPath);
        }
        return { status: "skipped" };
      }
      return { status: "processed" };
    } catch (error) {
      if (tempRoot !== undefined) {
        await this.fileStore.removeBestEffort(tempRoot);
      }
      for (const placedPath of placedThumbnailPaths) {
        await this.fileStore.removeBestEffort(placedPath);
      }
      const processingError = toProcessingError(error);
      await this.recordFailure(assetId, processingError);
      return { status: "failed" };
    }
  }

  private async recordFailure(
    assetId: string,
    error: AssetProcessingError
  ): Promise<void> {
    try {
      this.repository.markProcessingFailed({
        assetId,
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
