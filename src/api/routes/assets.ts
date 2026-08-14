import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";

import {
  AssetFieldTooLargeError,
  AssetFileMissingError,
  AssetFileTooLargeError,
  AssetInvalidFieldError,
  AssetTooManyFieldsError,
  AssetTooManyFilesError,
  AssetTooManyPartsError,
  AssetUploadInterruptedError
} from "../../app/assets/asset-errors.js";
import {
  AssetService,
  type StagedUpload
} from "../../app/assets/asset-service.js";
import {
  DEFAULT_ASSET_UPLOAD_LIMITS,
  type AssetUploadLimits
} from "../../app/assets/asset-upload-limits.js";
import {
  assetDetailResponseSchema,
  assetIdParamsSchema,
  assetThumbnailParamsSchema,
  assetListQuerySchema,
  assetListResponseSchema,
  assetUploadResponseSchema,
  createApiSuccessResponse
} from "../../schema/api.js";

export type AssetServicePort = Pick<
  AssetService,
  "stageUpload" | "commitUpload" | "discardStaged" | "findDetail" | "list"
> &
  Partial<Pick<AssetService, "getThumbnailPath">>;

const allowedFieldNames = new Set([
  "kind",
  "title",
  "description",
  "department",
  "system",
  "confidentiality",
  "tagIds"
]);

function toDomainError(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") {
      switch (code) {
        case "FST_PARTS_LIMIT":
          return new AssetTooManyPartsError();
        case "FST_FILES_LIMIT":
          return new AssetTooManyFilesError();
        case "FST_FIELDS_LIMIT":
          return new AssetTooManyFieldsError();
        case "FST_REQ_FILE_TOO_LARGE":
          return new AssetFileTooLargeError();
        case "FST_PROTO_VIOLATION":
          return new AssetInvalidFieldError();
        case "FST_INVALID_MULTIPART_CONTENT_TYPE":
          return new AssetInvalidFieldError();
        case "FST_MP_PREMATURE_CLOSE":
        case "ERR_STREAM_PREMATURE_CLOSE":
          return new AssetUploadInterruptedError();
      }
    }
  }
  if (error instanceof Error) {
    if (
      error.message.includes("Unexpected end of multipart data") ||
      error.message.includes("Premature close") ||
      error.message.includes("premature close")
    ) {
      return new AssetUploadInterruptedError();
    }
  }
  return error;
}

function accumulateField(
  fields: Record<string, string | string[]>,
  name: string,
  value: string
): void {
  const current = fields[name];
  if (current === undefined) {
    fields[name] = value;
  } else if (Array.isArray(current)) {
    current.push(value);
  } else {
    fields[name] = [current, value];
  }
}

export function registerAssetRoutes(
  app: FastifyInstance,
  assetService: AssetServicePort,
  options: { limits?: AssetUploadLimits } = {}
): void {
  const limits = options.limits ?? DEFAULT_ASSET_UPLOAD_LIMITS;

  app.get("/api/assets", async (request) => {
    const query = assetListQuerySchema.parse(request.query);
    return assetListResponseSchema.parse(
      createApiSuccessResponse(assetService.list(query))
    );
  });

  app.post("/api/assets", async (request) => {
    const fields: Record<string, string | string[]> = {};
    let staged: StagedUpload | undefined;
    let fieldCount = 0;
    let partCount = 0;
    let fileCount = 0;

    try {
      for await (const part of request.parts()) {
        partCount++;
        if (partCount > limits.maxPartCount) {
          throw new AssetTooManyPartsError();
        }
        if (part.type === "field") {
          fieldCount++;
          if (fieldCount > limits.maxFieldCount) {
            throw new AssetTooManyFieldsError();
          }
          if (!allowedFieldNames.has(part.fieldname)) {
            throw new AssetInvalidFieldError();
          }
          if (part.fieldnameTruncated) {
            throw new AssetInvalidFieldError();
          }
          if (part.valueTruncated) {
            throw new AssetFieldTooLargeError();
          }
          accumulateField(fields, part.fieldname, String(part.value));
        } else {
          fileCount++;
          if (fileCount > limits.maxFileCount) {
            throw new AssetTooManyFilesError();
          }
          if (part.fieldname !== "file") {
            throw new AssetInvalidFieldError();
          }
          if (staged !== undefined) {
            throw new AssetTooManyFilesError();
          }
          staged = await assetService.stageUpload({
            stream: part.file,
            mimeType: part.mimetype,
            filename: part.filename
          });
        }
      }

      if (staged === undefined) {
        throw new AssetFileMissingError();
      }

      const receipt = await assetService.commitUpload(fields, staged);
      return assetUploadResponseSchema.parse(createApiSuccessResponse(receipt));
    } catch (error) {
      if (staged !== undefined) {
        await assetService.discardStaged(staged);
      }
      throw toDomainError(error);
    }
  });

  app.get<{ Params: { assetId: string } }>(
    "/api/assets/:assetId",
    async (request) => {
      const params = assetIdParamsSchema.parse(request.params);
      return assetDetailResponseSchema.parse(
        createApiSuccessResponse(assetService.findDetail(params.assetId))
      );
    }
  );

  if (assetService.getThumbnailPath !== undefined) {
    app.get<{
      Params: { assetId: string; thumbnailIndex: string };
    }>(
      "/api/assets/:assetId/thumbnails/:thumbnailIndex",
      async (request, reply) => {
        const params = assetThumbnailParamsSchema.parse(request.params);
        const thumbnailPath = assetService.getThumbnailPath?.(
          params.assetId,
          params.thumbnailIndex
        );
        if (thumbnailPath === undefined) {
          throw new Error("Asset thumbnail service is unavailable.");
        }
        return reply.type("image/png").send(createReadStream(thumbnailPath));
      }
    );
  }
}
