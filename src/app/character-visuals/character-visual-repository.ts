import { asc, eq } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import {
  characterVariantFiles,
  characterVariants,
  characterVisuals
} from "../../db/schema.js";
import {
  characterVisualCatalogSnapshotSchema,
  type CharacterVariant,
  type CharacterVisualCatalogSnapshot,
  type CharacterVisualFile,
  type CharacterVisualSet,
  type CharacterVisualStatus
} from "../../schema/character-visual.js";
import { CharacterVisualRepositoryError } from "./character-visual-errors.js";

export type CharacterVisualInsert = {
  readonly visualId: string;
  readonly name: string;
  readonly description: string;
  readonly status: CharacterVisualStatus;
  readonly baseWidth: number | null;
  readonly baseHeight: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CharacterVariantInsert = {
  readonly variantId: string;
  readonly visualId: string;
  readonly label: string;
  readonly renderType: CharacterVariant["renderType"];
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type CharacterVisualFileInsert = {
  readonly variantId: string;
  readonly fileKey: CharacterVisualFile["key"];
  readonly libraryPath: CharacterVisualFile["libraryPath"];
  readonly mimeType: CharacterVisualFile["mimeType"];
  readonly checksum: CharacterVisualFile["checksum"];
  readonly sizeBytes: CharacterVisualFile["sizeBytes"];
  readonly width: CharacterVisualFile["width"];
  readonly height: CharacterVisualFile["height"];
  readonly createdAt: string;
  readonly updatedAt: string;
};

type CharacterVisualDatabase = WorkspaceDatabase;

function getSqliteErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = error.code;
  return typeof code === "string" ? code : undefined;
}

function getSqliteErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

function constraintFor(
  error: unknown
): CharacterVisualRepositoryError["constraint"] {
  const code = getSqliteErrorCode(error);
  const message = getSqliteErrorMessage(error);
  if (
    code !== "SQLITE_CONSTRAINT_UNIQUE" &&
    code !== "SQLITE_CONSTRAINT_PRIMARYKEY" &&
    code !== "SQLITE_CONSTRAINT"
  ) {
    return "unknown";
  }
  if (
    message.includes("character_visuals.visual_id") ||
    message.includes("character_visuals")
  ) {
    return "visualId";
  }
  if (
    message.includes("character_variants.variant_id") ||
    message.includes("character_variants")
  ) {
    return "variantId";
  }
  if (
    message.includes("character_variant_files.library_path") ||
    message.includes("character_variant_files_library_path_uq")
  ) {
    return "libraryPath";
  }
  return "unknown";
}

function parseTags(value: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new CharacterVisualRepositoryError("unknown", error);
  }
  if (!Array.isArray(parsed) || parsed.some((tag) => typeof tag !== "string")) {
    throw new CharacterVisualRepositoryError(
      "unknown",
      new Error("character variant tags are not a string array")
    );
  }
  return parsed;
}

function toFile(
  row: typeof characterVariantFiles.$inferSelect
): CharacterVisualFile {
  return {
    key: row.fileKey,
    libraryPath: row.libraryPath,
    mimeType: row.mimeType as "image/png",
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height
  };
}

function toSnapshot(
  visualRows: (typeof characterVisuals.$inferSelect)[],
  variantRows: (typeof characterVariants.$inferSelect)[],
  fileRows: (typeof characterVariantFiles.$inferSelect)[]
): CharacterVisualCatalogSnapshot {
  const filesByVariantId = new Map<string, CharacterVisualFile[]>();
  for (const row of fileRows) {
    const files = filesByVariantId.get(row.variantId) ?? [];
    files.push(toFile(row));
    filesByVariantId.set(row.variantId, files);
  }

  const variantsByVisualId = new Map<string, CharacterVariant[]>();
  for (const row of variantRows) {
    const variants = variantsByVisualId.get(row.visualId) ?? [];
    variants.push({
      variantId: row.variantId,
      label: row.label,
      renderType: row.renderType,
      tags: parseTags(row.tags),
      files: (filesByVariantId.get(row.variantId) ?? []).sort((left, right) =>
        left.key.localeCompare(right.key)
      )
    });
    variantsByVisualId.set(row.visualId, variants);
  }

  const snapshot = visualRows.map((row) => ({
    visualId: row.visualId,
    name: row.name,
    description: row.description,
    status: row.status,
    baseWidth: row.baseWidth,
    baseHeight: row.baseHeight,
    variants: (variantsByVisualId.get(row.visualId) ?? []).sort((left, right) =>
      left.variantId.localeCompare(right.variantId)
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }));

  try {
    return characterVisualCatalogSnapshotSchema.parse(snapshot);
  } catch (error) {
    throw new CharacterVisualRepositoryError("unknown", error);
  }
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof CharacterVisualRepositoryError) {
      throw error;
    }
    throw new CharacterVisualRepositoryError(constraintFor(error), error);
  }
}

export class CharacterVisualRepository {
  private readonly database: CharacterVisualDatabase;

  constructor(database: CharacterVisualDatabase) {
    this.database = database;
  }

  list(): CharacterVisualCatalogSnapshot {
    return withDatabaseErrors(() => {
      const visualRows = this.database
        .select()
        .from(characterVisuals)
        .orderBy(asc(characterVisuals.visualId))
        .all();
      const variantRows = this.database
        .select()
        .from(characterVariants)
        .orderBy(
          asc(characterVariants.visualId),
          asc(characterVariants.variantId)
        )
        .all();
      const fileRows = this.database
        .select()
        .from(characterVariantFiles)
        .orderBy(
          asc(characterVariantFiles.variantId),
          asc(characterVariantFiles.fileKey)
        )
        .all();
      return toSnapshot(visualRows, variantRows, fileRows);
    });
  }

  findById(visualId: string): CharacterVisualSet | undefined {
    return withDatabaseErrors(() => {
      const visual = this.database
        .select()
        .from(characterVisuals)
        .where(eq(characterVisuals.visualId, visualId))
        .get();
      if (visual === undefined) {
        return undefined;
      }
      return this.list().find((candidate) => candidate.visualId === visualId);
    });
  }

  insertVisual(values: CharacterVisualInsert): CharacterVisualSet {
    return withDatabaseErrors(() => {
      this.database.insert(characterVisuals).values(values).run();
      const inserted = this.findById(values.visualId);
      if (inserted === undefined) {
        throw new CharacterVisualRepositoryError("visualId");
      }
      return inserted;
    });
  }

  updateBaseCanvas(
    visualId: string,
    baseWidth: number,
    baseHeight: number,
    updatedAt: string
  ): void {
    withDatabaseErrors(() => {
      this.database
        .update(characterVisuals)
        .set({ baseWidth, baseHeight, updatedAt })
        .where(eq(characterVisuals.visualId, visualId))
        .run();
    });
  }

  insertVariant(values: CharacterVariantInsert): void {
    withDatabaseErrors(() => {
      this.database
        .insert(characterVariants)
        .values({ ...values, tags: JSON.stringify(values.tags) })
        .run();
    });
  }

  insertFile(values: CharacterVisualFileInsert): void {
    withDatabaseErrors(() => {
      this.database.insert(characterVariantFiles).values(values).run();
    });
  }

  transaction<T>(operation: (repository: CharacterVisualRepository) => T): T {
    return this.database.transaction((transaction) =>
      operation(
        new CharacterVisualRepository(
          transaction as unknown as CharacterVisualDatabase
        )
      )
    );
  }
}
