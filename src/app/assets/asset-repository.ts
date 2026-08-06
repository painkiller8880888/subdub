import { and, eq, inArray } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import { assetTags, assetVersions, assets, tags } from "../../db/schema.js";
import {
  assetTagSchema,
  type AssetKind,
  type AssetStatus,
  type AssetTag
} from "../../schema/index.js";
import { AssetDatabaseError } from "./asset-errors.js";

export type AssetInsert = {
  assetId: string;
  kind: AssetKind;
  title: string;
  description: string;
  confidentiality: string;
  department: string | null;
  system: string | null;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type AssetVersionInsert = {
  assetId: string;
  version: number;
  libraryMediaPath: string;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetTagLinkInsert = {
  assetId: string;
  tagId: string;
  createdAt: string;
};

export type AssetRecord = {
  assetId: string;
  kind: AssetKind;
  title: string;
  description: string;
  confidentiality: string;
  department: string | null;
  system: string | null;
  status: AssetStatus;
  createdAt: string;
  updatedAt: string;
};

export type AssetVersionRecord = {
  assetId: string;
  version: number;
  libraryMediaPath: string;
  mimeType: string;
  checksum: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  thumbnailPaths: string | null;
  createdAt: string;
  updatedAt: string;
};

function toTag(row: typeof tags.$inferSelect): AssetTag {
  return assetTagSchema.parse({
    tagId: row.tagId,
    axis: row.axis,
    canonicalName: row.canonicalName,
    normalizedName: row.normalizedName,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function toAssetRecord(row: typeof assets.$inferSelect): AssetRecord {
  return {
    assetId: row.assetId,
    kind: row.kind,
    title: row.title,
    description: row.description,
    confidentiality: row.confidentiality,
    department: row.department,
    system: row.system,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toAssetVersionRecord(
  row: typeof assetVersions.$inferSelect
): AssetVersionRecord {
  return {
    assetId: row.assetId,
    version: row.version,
    libraryMediaPath: row.libraryMediaPath,
    mimeType: row.mimeType,
    checksum: row.checksum,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    pageCount: row.pageCount,
    thumbnailPaths: row.thumbnailPaths,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AssetDatabaseError) {
      throw error;
    }
    throw new AssetDatabaseError(error);
  }
}

export class AssetRepository {
  private readonly database: WorkspaceDatabase;

  constructor(database: WorkspaceDatabase) {
    this.database = database;
  }

  findActiveTags(tagIds: string[]): AssetTag[] {
    return withDatabaseErrors(() => {
      const rows = this.database
        .select()
        .from(tags)
        .where(and(inArray(tags.tagId, tagIds), eq(tags.status, "active")))
        .all();
      return rows.map(toTag);
    });
  }

  findAsset(assetId: string): AssetRecord | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, assetId))
        .get();
      return row === undefined ? undefined : toAssetRecord(row);
    });
  }

  findAssetVersion(
    assetId: string,
    version: number
  ): AssetVersionRecord | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.assetId, assetId),
            eq(assetVersions.version, version)
          )
        )
        .get();
      return row === undefined ? undefined : toAssetVersionRecord(row);
    });
  }

  findAssetTagIds(assetId: string): string[] {
    return withDatabaseErrors(() => {
      const rows = this.database
        .select({ tagId: assetTags.tagId })
        .from(assetTags)
        .where(eq(assetTags.assetId, assetId))
        .orderBy(assetTags.tagId)
        .all();
      return rows.map((row) => row.tagId);
    });
  }

  insertAsset(values: AssetInsert): void {
    withDatabaseErrors(() => {
      this.database
        .insert(assets)
        .values({
          assetId: values.assetId,
          kind: values.kind,
          title: values.title,
          description: values.description,
          confidentiality: values.confidentiality,
          department: values.department,
          system: values.system,
          status: values.status,
          createdAt: values.createdAt,
          updatedAt: values.updatedAt
        })
        .run();
    });
  }

  insertAssetVersion(values: AssetVersionInsert): void {
    withDatabaseErrors(() => {
      this.database
        .insert(assetVersions)
        .values({
          assetId: values.assetId,
          version: values.version,
          libraryMediaPath: values.libraryMediaPath,
          mimeType: values.mimeType,
          createdAt: values.createdAt,
          updatedAt: values.updatedAt
        })
        .run();
    });
  }

  insertAssetTags(links: readonly AssetTagLinkInsert[]): void {
    withDatabaseErrors(() => {
      this.database
        .insert(assetTags)
        .values(
          links.map((link) => ({
            assetId: link.assetId,
            tagId: link.tagId,
            createdAt: link.createdAt
          }))
        )
        .run();
    });
  }

  transaction<T>(operation: (repository: AssetRepository) => T): T {
    return this.database.transaction((transaction) =>
      operation(
        new AssetRepository(transaction as unknown as WorkspaceDatabase)
      )
    );
  }
}
