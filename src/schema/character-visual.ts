import { z } from "zod";

import {
  idSchema,
  isoUtcDateTimeSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
  relativePosixPathSchema,
  sha256Schema,
  strictObject
} from "./primitives.js";

export const characterVisualStatusSchema = z.enum(["active", "inactive"]);

export const characterVariantRenderTypeSchema = z.enum([
  "single-image",
  "mouth-pair"
]);

const characterVisualFileKeySchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "must be a lower-kebab-case slot key");

const characterVisualTagSchema = z.string().min(1);

export const characterVisualFileSchema = strictObject({
  key: characterVisualFileKeySchema,
  libraryPath: relativePosixPathSchema,
  mimeType: z.literal("image/png"),
  checksum: sha256Schema,
  sizeBytes: nonNegativeIntegerSchema,
  width: positiveIntegerSchema,
  height: positiveIntegerSchema
});

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export const characterVariantSchema = strictObject({
  variantId: idSchema,
  label: z.string().min(1),
  renderType: characterVariantRenderTypeSchema,
  tags: z.array(characterVisualTagSchema),
  files: z.array(characterVisualFileSchema)
}).superRefine((variant, ctx) => {
  if (!hasUniqueValues(variant.tags)) {
    ctx.addIssue({
      code: "custom",
      path: ["tags"],
      message: "tags must be unique"
    });
  }

  const expectedKeys =
    variant.renderType === "single-image" ? ["single"] : ["closed", "open"];
  const keys = variant.files.map((file) => file.key);
  if (keys.length !== expectedKeys.length || !hasUniqueValues(keys)) {
    ctx.addIssue({
      code: "custom",
      path: ["files"],
      message: `a ${variant.renderType} variant must contain exactly one file for each required slot`
    });
    return;
  }

  for (const expectedKey of expectedKeys) {
    if (!keys.includes(expectedKey)) {
      ctx.addIssue({
        code: "custom",
        path: ["files"],
        message: `a ${variant.renderType} variant requires the ${expectedKey} file slot`
      });
    }
  }
});

export const characterVisualSetSchema = strictObject({
  visualId: idSchema,
  name: z.string().min(1),
  description: z.string(),
  status: characterVisualStatusSchema,
  baseWidth: positiveIntegerSchema.nullable(),
  baseHeight: positiveIntegerSchema.nullable(),
  variants: z.array(characterVariantSchema),
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
}).superRefine((visual, ctx) => {
  if ((visual.baseWidth === null) !== (visual.baseHeight === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["baseWidth"],
      message: "baseWidth and baseHeight must be set together"
    });
  }

  if (visual.variants.length > 0 && visual.baseWidth === null) {
    ctx.addIssue({
      code: "custom",
      path: ["variants"],
      message: "a visual with variants must have a base canvas size"
    });
  }

  const variantIds = new Set<string>();
  const libraryPaths = new Set<string>();
  for (const [variantIndex, variant] of visual.variants.entries()) {
    if (variantIds.has(variant.variantId)) {
      ctx.addIssue({
        code: "custom",
        path: ["variants", variantIndex, "variantId"],
        message: "variantId must be unique within the catalog"
      });
    }
    variantIds.add(variant.variantId);

    for (const [fileIndex, file] of variant.files.entries()) {
      if (libraryPaths.has(file.libraryPath)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", variantIndex, "files", fileIndex, "libraryPath"],
          message: "libraryPath must be unique within the catalog"
        });
      }
      libraryPaths.add(file.libraryPath);

      const expectedPrefix = `library/character-visuals/${visual.visualId}/${variant.variantId}/`;
      if (!file.libraryPath.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", variantIndex, "files", fileIndex, "libraryPath"],
          message: `libraryPath must be under ${expectedPrefix}`
        });
      } else {
        const fileName = file.libraryPath.slice(expectedPrefix.length);
        if (
          fileName.length === 0 ||
          fileName.includes("/") ||
          !fileName.endsWith(".png")
        ) {
          ctx.addIssue({
            code: "custom",
            path: ["variants", variantIndex, "files", fileIndex, "libraryPath"],
            message:
              "libraryPath must name one PNG directly inside the variant directory"
          });
        }
      }

      if (
        visual.baseWidth !== null &&
        (file.width !== visual.baseWidth || file.height !== visual.baseHeight)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["variants", variantIndex, "files", fileIndex],
          message: "file canvas must match the visual base canvas"
        });
      }
    }
  }
});

export const characterVisualCatalogSnapshotSchema = z.array(
  characterVisualSetSchema
);

export type CharacterVisualStatus = z.infer<typeof characterVisualStatusSchema>;
export type CharacterVariantRenderType = z.infer<
  typeof characterVariantRenderTypeSchema
>;
export type CharacterVisualFile = z.infer<typeof characterVisualFileSchema>;
export type CharacterVariant = z.infer<typeof characterVariantSchema>;
export type CharacterVisualSet = z.infer<typeof characterVisualSetSchema>;
export type CharacterVisualCatalogSnapshot = z.infer<
  typeof characterVisualCatalogSnapshotSchema
>;
