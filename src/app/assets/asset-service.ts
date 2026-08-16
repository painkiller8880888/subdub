import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import * as path from "node:path";

import {
  assetListQuerySchema,
  assetUploadFieldsSchema
} from "../../schema/api.js";
import {
  idSchema,
  type AssetDetail,
  type AssetListResult,
  type AssetKind,
  type AssetUploadReceipt
} from "../../schema/index.js";
import {
  AssetFileEmptyError,
  AssetFileTooLargeError,
  AssetFormatMismatchError,
  AssetInvalidFieldError,
  AssetNotFoundError,
  AssetTagNotFoundError,
  AssetUnsupportedFormatError
} from "./asset-errors.js";
import {
  ASSET_DETECTION_HEAD_BYTES,
  ASSET_FORMATS,
  ASSET_KIND_FORMATS,
  assetFormatForMimeType,
  detectAssetFormat
} from "./asset-formats.js";
import {
  NodeAssetFileStore,
  type AssetFileStore,
  type StagedUploadRecord
} from "./asset-file-store.js";
import { AssetRepository } from "./asset-repository.js";
import {
  DEFAULT_ASSET_UPLOAD_LIMITS,
  type AssetUploadLimits
} from "./asset-upload-limits.js";

export type AssetUploadFile = {
  stream: Readable;
  mimeType?: string;
  filename?: string;
};

export type StagedUpload = StagedUploadRecord & {
  mimeType: string | undefined;
  filename: string | undefined;
};

export type AssetServiceOptions = {
  repository: AssetRepository;
  managementRoot?: string;
  fileStore?: AssetFileStore;
  limits?: AssetUploadLimits;
  now?: () => Date;
  createId?: () => string;
};

function resolveManagementRoot(managementRoot: string | undefined): string {
  return path.resolve(managementRoot ?? "library");
}

function hasRequiredEditingAssetExtension(
  kind: AssetKind,
  filename: string | undefined,
  extension: string
): boolean {
  if (kind !== "video" && kind !== "bgm") {
    return true;
  }
  if (filename === undefined) {
    return false;
  }
  return path.extname(filename).toLowerCase() === `.${extension}`;
}

function maxUploadBytesForKind(
  limits: AssetUploadLimits,
  kind: AssetKind
): number {
  if (kind === "bgm") {
    return (
      limits.perKindMaxBytes.bgm ??
      DEFAULT_ASSET_UPLOAD_LIMITS.perKindMaxBytes.bgm!
    );
  }
  return limits.perKindMaxBytes[kind];
}

export class AssetService {
  private readonly repository: AssetRepository;
  private readonly fileStore: AssetFileStore;
  private readonly limits: AssetUploadLimits;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(options: AssetServiceOptions) {
    this.repository = options.repository;
    this.fileStore =
      options.fileStore ??
      new NodeAssetFileStore(resolveManagementRoot(options.managementRoot));
    this.limits = options.limits ?? DEFAULT_ASSET_UPLOAD_LIMITS;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
  }

  async stageUpload(file: AssetUploadFile): Promise<StagedUpload> {
    const uploadId = randomUUID().toLowerCase();
    const record = await this.fileStore.stageUpload(uploadId, file.stream);
    return {
      ...record,
      mimeType: file.mimeType,
      filename: file.filename
    };
  }

  async discardStaged(staged: StagedUpload): Promise<void> {
    await this.fileStore.removeBestEffort(staged.stagingRelativePath);
  }

  findDetail(assetId: string, requestedVersion?: number): AssetDetail {
    const detail = this.repository.findAssetDetail(assetId, requestedVersion);
    if (detail === undefined) {
      throw new AssetNotFoundError();
    }
    return detail;
  }

  getThumbnailPath(
    assetId: string,
    thumbnailIndex: number,
    requestedVersion?: number
  ): string {
    const detail = this.findDetail(assetId, requestedVersion);
    const thumbnailPath = detail.thumbnailPaths[thumbnailIndex];
    if (thumbnailPath === undefined) {
      throw new AssetNotFoundError();
    }
    return this.fileStore.resolvePath(thumbnailPath);
  }

  list(input: unknown): AssetListResult {
    const query = assetListQuerySchema.parse(input);
    return this.repository.list(query);
  }

  async commitUpload(
    fields: unknown,
    staged: StagedUpload
  ): Promise<AssetUploadReceipt> {
    const request = assetUploadFieldsSchema.parse(fields);
    const kind: AssetKind = request.kind;
    const limits = this.limits;

    let movedMediaPath: string | undefined;
    try {
      if (staged.bytes === 0) {
        throw new AssetFileEmptyError();
      }
      if (
        staged.filename !== undefined &&
        staged.filename.length > limits.maxFileNameLength
      ) {
        throw new AssetInvalidFieldError();
      }
      if (staged.bytes > maxUploadBytesForKind(limits, kind)) {
        throw new AssetFileTooLargeError();
      }

      const head = await this.fileStore.readHead(
        staged.fileRelativePath,
        ASSET_DETECTION_HEAD_BYTES
      );
      const detection = detectAssetFormat(head);
      if (detection.status !== "matched") {
        throw new AssetUnsupportedFormatError();
      }

      const declaredFormat = assetFormatForMimeType(staged.mimeType);
      if (declaredFormat === undefined) {
        throw new AssetUnsupportedFormatError();
      }
      if (!ASSET_KIND_FORMATS[kind].includes(declaredFormat)) {
        throw new AssetFormatMismatchError();
      }
      if (!ASSET_KIND_FORMATS[kind].includes(detection.format)) {
        throw new AssetFormatMismatchError();
      }
      if (declaredFormat !== detection.format) {
        throw new AssetFormatMismatchError();
      }

      const format = ASSET_FORMATS[detection.format];
      if (
        !hasRequiredEditingAssetExtension(
          kind,
          staged.filename,
          format.extension
        )
      ) {
        throw new AssetFormatMismatchError();
      }

      const assetId = idSchema.parse(this.createId());
      const version = 1;
      const now = this.now().toISOString();
      const mediaRelativePath = `media/${assetId}/v${version}.${format.extension}`;

      const tagIds = request.tagIds;
      const activeTags =
        tagIds.length === 0 ? [] : this.repository.findActiveTags(tagIds);
      const activeTagIdSet = new Set(activeTags.map((tag) => tag.tagId));
      const missingTag = tagIds.find((tagId) => !activeTagIdSet.has(tagId));
      if (missingTag !== undefined) {
        throw new AssetTagNotFoundError();
      }

      if (kind === "sound_effect") {
        const requiredSoundEffectUsageTags = new Set([
          "confirm",
          "attention",
          "warning"
        ]);
        const hasRequiredTag = activeTags.some(
          (tag) =>
            requiredSoundEffectUsageTags.has(tag.canonicalName) ||
            requiredSoundEffectUsageTags.has(tag.tagId)
        );
        if (!hasRequiredTag) {
          throw new AssetInvalidFieldError();
        }
      }

      await this.fileStore.moveToMedia(
        staged.fileRelativePath,
        mediaRelativePath
      );
      movedMediaPath = mediaRelativePath;

      this.repository.transaction((repository) => {
        repository.insertAsset({
          assetId,
          kind,
          title: request.title,
          description: request.description,
          confidentiality: request.confidentiality ?? "internal",
          department: request.department ?? null,
          system: request.system ?? null,
          status: "processing",
          createdAt: now,
          updatedAt: now
        });
        repository.insertAssetVersion({
          assetId,
          version,
          libraryMediaPath: mediaRelativePath,
          mimeType: format.mimeType,
          createdAt: now,
          updatedAt: now
        });
        if (tagIds.length > 0) {
          repository.insertAssetTags(
            tagIds.map((tagId) => ({ assetId, tagId, createdAt: now }))
          );
        }
      });

      return {
        assetId,
        version,
        kind,
        title: request.title,
        description: request.description,
        mimeType: format.mimeType,
        confidentiality: request.confidentiality ?? "internal",
        department: request.department ?? null,
        system: request.system ?? null,
        tagIds,
        status: "processing",
        createdAt: now,
        updatedAt: now
      };
    } catch (error) {
      if (movedMediaPath !== undefined) {
        await this.fileStore.removeBestEffort(movedMediaPath);
      }
      throw error;
    } finally {
      await this.fileStore.removeBestEffort(staged.stagingRelativePath);
    }
  }
}
