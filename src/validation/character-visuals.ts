import { z } from "zod";

import {
  characterVisualCatalogSnapshotSchema,
  characterVisualSetSchema,
  type CharacterVisualCatalogSnapshot,
  type CharacterVisualSet
} from "../schema/character-visual.js";

export type CharacterVisualValidationIssue = {
  readonly path: readonly (string | number)[];
  readonly message: string;
};

export type CharacterVisualValidationResult = {
  readonly valid: boolean;
  readonly catalog: CharacterVisualCatalogSnapshot | null;
  readonly issues: readonly CharacterVisualValidationIssue[];
};

function formatZodIssue(
  issue: z.core.$ZodIssue
): CharacterVisualValidationIssue {
  return {
    path: issue.path.filter(
      (part): part is string | number =>
        typeof part === "string" || typeof part === "number"
    ),
    message: issue.message
  };
}

function validateManagedPath(
  visual: CharacterVisualSet,
  variantIndex: number,
  fileIndex: number,
  libraryPath: string
): CharacterVisualValidationIssue | undefined {
  const prefix = `library/character-visuals/${visual.visualId}/${visual.variants[variantIndex]?.variantId ?? ""}/`;
  if (!libraryPath.startsWith(prefix)) {
    return {
      path: ["variants", variantIndex, "files", fileIndex, "libraryPath"],
      message: `libraryPath must be under ${prefix}`
    };
  }

  const fileName = libraryPath.slice(prefix.length);
  if (
    fileName.length === 0 ||
    fileName.includes("/") ||
    !fileName.endsWith(".png")
  ) {
    return {
      path: ["variants", variantIndex, "files", fileIndex, "libraryPath"],
      message:
        "libraryPath must name one PNG directly inside the variant directory"
    };
  }

  return undefined;
}

function validateSet(
  visual: CharacterVisualSet,
  setIndex: number,
  issues: CharacterVisualValidationIssue[]
): void {
  const paths = new Set<string>();
  for (const [variantIndex, variant] of visual.variants.entries()) {
    for (const [fileIndex, file] of variant.files.entries()) {
      const pathIssue = validateManagedPath(
        visual,
        variantIndex,
        fileIndex,
        file.libraryPath
      );
      if (pathIssue !== undefined) {
        issues.push({
          ...pathIssue,
          path: [setIndex, ...pathIssue.path]
        });
      }

      if (paths.has(file.libraryPath)) {
        issues.push({
          path: [setIndex, "variants", variantIndex, "files", fileIndex],
          message: "libraryPath must be unique within the catalog"
        });
      }
      paths.add(file.libraryPath);
    }
  }
}

export function validateCharacterVisualCatalog(
  input: unknown
): CharacterVisualValidationResult {
  const parsed = characterVisualCatalogSnapshotSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      catalog: null,
      issues: parsed.error.issues.map(formatZodIssue)
    };
  }

  const issues: CharacterVisualValidationIssue[] = [];
  const visualIds = new Set<string>();
  const variantIds = new Set<string>();
  const libraryPaths = new Set<string>();

  for (const [setIndex, visual] of parsed.data.entries()) {
    if (visualIds.has(visual.visualId)) {
      issues.push({
        path: [setIndex, "visualId"],
        message: "visualId must be unique"
      });
    }
    visualIds.add(visual.visualId);
    validateSet(visual, setIndex, issues);

    for (const [variantIndex, variant] of visual.variants.entries()) {
      if (variantIds.has(variant.variantId)) {
        issues.push({
          path: [setIndex, "variants", variantIndex, "variantId"],
          message: "variantId must be unique"
        });
      }
      variantIds.add(variant.variantId);

      for (const [fileIndex, file] of variant.files.entries()) {
        if (libraryPaths.has(file.libraryPath)) {
          issues.push({
            path: [setIndex, "variants", variantIndex, "files", fileIndex],
            message: "libraryPath must be unique"
          });
        }
        libraryPaths.add(file.libraryPath);
      }
    }
  }

  return {
    valid: issues.length === 0,
    catalog: issues.length === 0 ? parsed.data : null,
    issues
  };
}

export function assertCharacterVisualCatalog(
  input: unknown
): CharacterVisualCatalogSnapshot {
  const result = validateCharacterVisualCatalog(input);
  if (!result.valid || result.catalog === null) {
    const message = result.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid character visual catalog: ${message}`);
  }
  return result.catalog;
}

export function expectedCharacterVariantFileKeys(
  renderType: "single-image" | "mouth-pair"
): readonly string[] {
  return renderType === "single-image" ? ["single"] : ["closed", "open"];
}

export function formatCharacterVisualIssues(
  issues: readonly CharacterVisualValidationIssue[]
): string {
  return issues
    .map((issue) => `[${issue.path.join(".")}] ${issue.message}`)
    .join("\n");
}

export function validateCharacterVisualSet(input: unknown): CharacterVisualSet {
  return characterVisualSetSchema.parse(input);
}
