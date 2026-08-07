import { and, desc, eq, inArray } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import { assetTags, assetVersions, assets, tags } from "../../db/schema.js";
import {
  assetDetailSchema,
  assetTagSchema,
  type AssetDetail,
  type AssetKind,
  type AssetStatus,
  type AssetTag
} from "../../schema/index.js";
import type { AssetProcessingErrorCode } from "../../schema/asset.js";
import {
  AssetDatabaseError,
  AssetProcessingRaceError
} from "./asset-errors.js";

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
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetVersionRecord = {
  assetId: string;
  version: number;
  libraryMediaPath: string;
  mimeType: string;
  checksum: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  thumbnailPaths: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetProcessingSuccessValues = {
  assetId: string;
  version: number;
  checksum: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  thumbnailPaths: string[];
  updatedAt: string;
};

export type AssetProcessingFailureValues = {
  assetId: string;
  errorCode: AssetProcessingErrorCode;
  errorMessage: string;
  updatedAt: string;
};

export type AssetProcessingKey = {
  assetId: string;
  version: number;
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
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
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
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    pageCount: row.pageCount,
    thumbnailPaths: row.thumbnailPaths,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function parseThumbnailPaths(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof AssetDatabaseError) {
      throw error;
    }
    if (error instanceof AssetProcessingRaceError) {
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

  findProcessingAssetKeys(): AssetProcessingKey[] {
    return withDatabaseErrors(() => {
      const rows = this.database
        .select()
        .from(assets)
        .where(eq(assets.status, "processing"))
        .orderBy(assets.createdAt)
        .all();
      const keys: AssetProcessingKey[] = [];
      for (const row of rows) {
        const version = this.database
          .select({ version: assetVersions.version })
          .from(assetVersions)
          .where(eq(assetVersions.assetId, row.assetId))
          .orderBy(desc(assetVersions.version))
          .limit(1)
          .get();
        if (version !== undefined) {
          keys.push({ assetId: row.assetId, version: version.version });
        }
      }
      return keys;
    });
  }

  findAssetDetail(assetId: string): AssetDetail | undefined {
    return withDatabaseErrors(() => {
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, assetId))
        .get();
      if (asset === undefined) {
        return undefined;
      }
      const version = this.database
        .select()
        .from(assetVersions)
        .where(eq(assetVersions.assetId, assetId))
        .orderBy(desc(assetVersions.version))
        .limit(1)
        .get();
      if (version === undefined) {
        return undefined;
      }
      return assetDetailSchema.parse({
        assetId: asset.assetId,
        version: version.version,
        kind: asset.kind,
        title: asset.title,
        description: asset.description,
        confidentiality: asset.confidentiality,
        department: asset.department,
        system: asset.system,
        mimeType: version.mimeType,
        libraryMediaPath: version.libraryMediaPath,
        checksum: version.checksum,
        sizeBytes: version.sizeBytes,
        width: version.width,
        height: version.height,
        durationMs: version.durationMs,
        pageCount: version.pageCount,
        thumbnailPaths: parseThumbnailPaths(version.thumbnailPaths),
        status: asset.status,
        errorCode: asset.errorCode,
        errorMessage: asset.errorMessage,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt
      });
    });
  }

  markProcessingSucceeded(values: AssetProcessingSuccessValues): void {
    withDatabaseErrors(() => {
      this.database
        .update(assetVersions)
        .set({
          checksum: values.checksum,
          sizeBytes: values.sizeBytes,
          width: values.width,
          height: values.height,
          durationMs: values.durationMs,
          pageCount: values.pageCount,
          thumbnailPaths:
            values.thumbnailPaths.length === 0
              ? null
              : JSON.stringify(values.thumbnailPaths),
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assetVersions.assetId, values.assetId),
            eq(assetVersions.version, values.version)
          )
        )
        .run();
      const result = this.database
        .update(assets)
        .set({
          status: "active",
          errorCode: null,
          errorMessage: null,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assets.assetId, values.assetId),
            eq(assets.status, "processing")
          )
        )
        .run();
      if ((result.changes ?? 0) === 0) {
        throw new AssetProcessingRaceError();
      }
    });
  }

  markProcessingFailed(values: AssetProcessingFailureValues): boolean {
    return withDatabaseErrors(() => {
      const result = this.database
        .update(assets)
        .set({
          status: "error",
          errorCode: values.errorCode,
          errorMessage: values.errorMessage,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assets.assetId, values.assetId),
            eq(assets.status, "processing")
          )
        )
        .run();
      return (result.changes ?? 0) > 0;
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
