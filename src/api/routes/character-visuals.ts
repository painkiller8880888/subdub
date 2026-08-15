import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  CharacterVisualFileTooLargeError,
  CharacterVisualNotFoundError,
  CharacterVisualTooManyFilesError,
  CharacterVisualUploadInterruptedError,
  CharacterVisualValidationError,
  CharacterVariantNotFoundError
} from "../../app/character-visuals/character-visual-errors.js";
import {
  CHARACTER_VISUAL_MAX_FILE_BYTES,
  CharacterVisualCatalogService,
  type CharacterVisualStagedUpload,
  type CharacterVisualUploadFile,
  type CharacterVisualVariantInput
} from "../../app/character-visuals/character-visual-service.js";
import {
  characterVisualCatalogResponseSchema,
  characterVisualCreateRequestSchema,
  characterVisualFileParamsSchema,
  characterVisualParamsSchema,
  characterVisualResponseSchema,
  characterVisualUpdateRequestSchema,
  characterVisualVariantMultipartRequestSchema,
  characterVisualVariantParamsSchema,
  createApiSuccessResponse
} from "../../schema/api.js";

export type CharacterVisualCatalogServicePort = Pick<
  CharacterVisualCatalogService,
  | "list"
  | "get"
  | "create"
  | "update"
  | "createVariant"
  | "updateVariant"
  | "deactivateVariant"
  | "activateVariant"
  | "stageUpload"
  | "discardStaged"
  | "readManagedFile"
> &
  Partial<Pick<CharacterVisualCatalogService, "verifyFiles">>;

const metadataFieldNames = new Set(["label", "renderType", "tags"]);
const fileFieldNames = new Set(["single", "closed", "open"]);

function toCharacterVisualMultipartError(error: unknown): unknown {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (code === "FST_REQ_FILE_TOO_LARGE") {
      return new CharacterVisualFileTooLargeError();
    }
    if (code === "FST_FILES_LIMIT") {
      return new CharacterVisualTooManyFilesError();
    }
    if (
      code === "FST_MP_PREMATURE_CLOSE" ||
      code === "ERR_STREAM_PREMATURE_CLOSE"
    ) {
      return new CharacterVisualUploadInterruptedError();
    }
  }
  if (
    error instanceof Error &&
    (error.message.includes("Unexpected end of multipart data") ||
      error.message.includes("Premature close") ||
      error.message.includes("premature close"))
  ) {
    return new CharacterVisualUploadInterruptedError();
  }
  return error;
}

async function drainFile(file: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of file) {
    // Drain rejected file parts so the multipart parser can finish cleanly.
    void chunk;
  }
}

function appendField(
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

async function readVariantMultipart(
  request: FastifyRequest,
  characterVisualCatalogService: CharacterVisualCatalogServicePort
): Promise<CharacterVisualVariantInput> {
  const fields: Record<string, string | string[]> = {};
  const files: CharacterVisualUploadFile[] = [];
  const stagedUploads: CharacterVisualStagedUpload[] = [];

  try {
    for await (const part of request.parts({
      limits: {
        fileSize: CHARACTER_VISUAL_MAX_FILE_BYTES,
        files: 2,
        fields: 32,
        parts: 64
      }
    })) {
      if (part.type === "field") {
        if (
          !metadataFieldNames.has(part.fieldname) ||
          part.fieldnameTruncated ||
          part.valueTruncated
        ) {
          throw new CharacterVisualValidationError(
            "unknown or truncated character visual metadata field"
          );
        }
        appendField(fields, part.fieldname, String(part.value));
        continue;
      }

      if (!fileFieldNames.has(part.fieldname)) {
        await drainFile(part.file);
        throw new CharacterVisualValidationError(
          "unknown character visual file slot"
        );
      }
      if (files.some((file) => file.key === part.fieldname)) {
        await drainFile(part.file);
        throw new CharacterVisualValidationError(
          "character visual file slots must be unique"
        );
      }
      const staged = await characterVisualCatalogService.stageUpload({
        stream: part.file,
        mimeType: part.mimetype,
        filename: part.filename
      });
      stagedUploads.push(staged);
      files.push({
        key: part.fieldname,
        staged,
        mimeType: part.mimetype,
        filename: part.filename
      });
    }

    const metadata = characterVisualVariantMultipartRequestSchema.parse(fields);
    return { ...metadata, files };
  } catch (error) {
    await Promise.all(
      stagedUploads.map((staged) =>
        characterVisualCatalogService.discardStaged(staged)
      )
    );
    throw toCharacterVisualMultipartError(error);
  }
}

async function discardVariantStagedUploads(
  characterVisualCatalogService: CharacterVisualCatalogServicePort,
  input: CharacterVisualVariantInput
): Promise<void> {
  const stagedByPath = new Map<string, CharacterVisualStagedUpload>();
  for (const file of input.files) {
    if (file.staged !== undefined) {
      stagedByPath.set(file.staged.stagingRelativePath, file.staged);
    }
  }
  await Promise.allSettled(
    [...stagedByPath.values()].map((staged) =>
      characterVisualCatalogService.discardStaged(staged)
    )
  );
}

async function withVariantStagedUploadsCleaned<T>(
  characterVisualCatalogService: CharacterVisualCatalogServicePort,
  input: CharacterVisualVariantInput,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } finally {
    await discardVariantStagedUploads(characterVisualCatalogService, input);
  }
}

function requireVisual(
  characterVisualCatalogService: CharacterVisualCatalogServicePort,
  visualId: string
) {
  const visual = characterVisualCatalogService.get(visualId);
  if (visual === undefined) {
    throw new CharacterVisualNotFoundError();
  }
  return visual;
}

export function registerCharacterVisualRoutes(
  app: FastifyInstance,
  characterVisualCatalogService: CharacterVisualCatalogServicePort
): void {
  app.get("/api/character-visuals", async () =>
    characterVisualCatalogResponseSchema.parse(
      createApiSuccessResponse(characterVisualCatalogService.list())
    )
  );

  app.post("/api/character-visuals", async (request) => {
    const input = characterVisualCreateRequestSchema.parse(request.body);
    return characterVisualResponseSchema.parse(
      createApiSuccessResponse(characterVisualCatalogService.create(input))
    );
  });

  app.get<{ Params: { visualId: string } }>(
    "/api/character-visuals/:visualId",
    async (request) => {
      const params = characterVisualParamsSchema.parse(request.params);
      return characterVisualResponseSchema.parse(
        createApiSuccessResponse(
          requireVisual(characterVisualCatalogService, params.visualId)
        )
      );
    }
  );

  app.put<{ Params: { visualId: string } }>(
    "/api/character-visuals/:visualId",
    async (request) => {
      const params = characterVisualParamsSchema.parse(request.params);
      const input = characterVisualUpdateRequestSchema.parse(request.body);
      return characterVisualResponseSchema.parse(
        createApiSuccessResponse(
          characterVisualCatalogService.update(params.visualId, input)
        )
      );
    }
  );

  async function parseVariantMultipart(
    request: FastifyRequest
  ): Promise<CharacterVisualVariantInput> {
    try {
      return await readVariantMultipart(request, characterVisualCatalogService);
    } catch (error) {
      throw toCharacterVisualMultipartError(error);
    }
  }

  app.post<{ Params: { visualId: string } }>(
    "/api/character-visuals/:visualId/variants",
    async (request) => {
      const params = characterVisualParamsSchema.parse(request.params);
      requireVisual(characterVisualCatalogService, params.visualId);
      const input = await parseVariantMultipart(request);
      return withVariantStagedUploadsCleaned(
        characterVisualCatalogService,
        input,
        async () =>
          characterVisualResponseSchema.parse(
            createApiSuccessResponse(
              await characterVisualCatalogService.createVariant(
                params.visualId,
                input
              )
            )
          )
      );
    }
  );

  app.put<{ Params: { visualId: string; variantId: string } }>(
    "/api/character-visuals/:visualId/variants/:variantId",
    async (request) => {
      const params = characterVisualVariantParamsSchema.parse(request.params);
      const visual = requireVisual(
        characterVisualCatalogService,
        params.visualId
      );
      if (
        !visual.variants.some(
          (variant) => variant.variantId === params.variantId
        )
      ) {
        throw new CharacterVariantNotFoundError();
      }
      const input = await parseVariantMultipart(request);
      return withVariantStagedUploadsCleaned(
        characterVisualCatalogService,
        input,
        async () =>
          characterVisualResponseSchema.parse(
            createApiSuccessResponse(
              await characterVisualCatalogService.updateVariant(
                params.visualId,
                params.variantId,
                input
              )
            )
          )
      );
    }
  );

  app.post<{ Params: { visualId: string; variantId: string } }>(
    "/api/character-visuals/:visualId/variants/:variantId/deactivate",
    async (request) => {
      const params = characterVisualVariantParamsSchema.parse(request.params);
      const visual = requireVisual(
        characterVisualCatalogService,
        params.visualId
      );
      if (
        !visual.variants.some(
          (variant) => variant.variantId === params.variantId
        )
      ) {
        throw new CharacterVariantNotFoundError();
      }
      return characterVisualResponseSchema.parse(
        createApiSuccessResponse(
          characterVisualCatalogService.deactivateVariant(
            params.visualId,
            params.variantId
          )
        )
      );
    }
  );

  app.post<{ Params: { visualId: string; variantId: string } }>(
    "/api/character-visuals/:visualId/variants/:variantId/activate",
    async (request) => {
      const params = characterVisualVariantParamsSchema.parse(request.params);
      const visual = requireVisual(
        characterVisualCatalogService,
        params.visualId
      );
      if (
        !visual.variants.some(
          (variant) => variant.variantId === params.variantId
        )
      ) {
        throw new CharacterVariantNotFoundError();
      }
      return characterVisualResponseSchema.parse(
        createApiSuccessResponse(
          characterVisualCatalogService.activateVariant(
            params.visualId,
            params.variantId
          )
        )
      );
    }
  );

  app.get<{
    Params: {
      visualId: string;
      variantId: string;
      fileKey: string;
    };
  }>(
    "/api/character-visuals/:visualId/:variantId/:fileKey",
    async (request, reply) => {
      const params = characterVisualFileParamsSchema.parse(request.params);
      const visual = requireVisual(
        characterVisualCatalogService,
        params.visualId
      );
      const variant = visual.variants.find(
        (candidate) => candidate.variantId === params.variantId
      );
      if (variant === undefined) {
        throw new CharacterVariantNotFoundError();
      }
      const file = await characterVisualCatalogService.readManagedFile(
        params.visualId,
        params.variantId,
        params.fileKey
      );
      if (file === undefined) {
        throw new CharacterVisualNotFoundError();
      }
      return reply.type(file.mimeType).send(file.content);
    }
  );
}
