import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import {
  assetTags,
  assetVersions,
  assets,
  tagAliases,
  tags
} from "../../db/schema.js";
import {
  assetDetailSchema,
  assetListItemSchema,
  assetTagSchema,
  type AssetDetail,
  type AssetKind,
  type AssetListItem,
  type AssetListResult,
  type AssetStatus,
  type AssetTag
} from "../../schema/index.js";
import type {
  AssetProcessingErrorCode,
  AssetTagAxis
} from "../../schema/asset.js";
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

export type AssetRepositoryListFilters = {
  readonly q?: string;
  readonly kind?: AssetKind;
  readonly department?: string;
  readonly system?: string;
  readonly status: AssetStatus;
  readonly tagIds: readonly string[];
  readonly page: number;
  readonly pageSize: number;
};

export type AssetTagDictionaryEntry = {
  readonly tagId: string;
  readonly axis: AssetTagAxis;
  readonly canonicalName: string;
  readonly normalizedName: string;
  readonly aliases: {
    readonly alias: string;
    readonly normalizedAlias: string;
  }[];
};

export type AssetRepositoryVisualSearchFilters = {
  readonly requiredTagIds: readonly string[];
  readonly optionalTagIds: readonly string[];
  readonly excludedTagIds: readonly string[];
  readonly kinds: readonly Exclude<AssetKind, "sound_effect">[];
  readonly q?: string;
  readonly limit: number;
};

export type AssetRepositoryVisualSearchResult = {
  readonly items: readonly AssetListItem[];
  readonly total: number;
};

type AssetListRow = {
  assetId: string;
  version: number | null;
  kind: AssetKind;
  title: string;
  description: string;
  confidentiality: string;
  department: string | null;
  system: string | null;
  mimeType: string | null;
  checksum: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  thumbnailPaths: string | null;
  tagsJson: string;
  tagIdsJson: string;
  status: AssetStatus;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type AssetRepositorySearchFilters = {
  readonly q?: string;
  readonly kinds?: readonly AssetKind[];
  readonly department?: string;
  readonly system?: string;
  readonly status: AssetStatus;
  readonly requiredTagIds: readonly string[];
  readonly excludedTagIds: readonly string[];
  readonly optionalTagIds: readonly string[];
  readonly page: number;
  readonly pageSize: number;
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

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (value === null || value === undefined) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function buildFtsQuery(query: string): string {
  return query
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" AND ");
}

function canUseFtsQuery(query: string): boolean {
  return query
    .split(" ")
    .filter((token) => token.length > 0)
    .every((token) => [...token].length >= 3);
}

function substringSearchCondition(query: string): SQL {
  const tokens = query.split(" ").filter((token) => token.length > 0);
  return sql.join(
    tokens.map((token) => {
      const fields = [
        sql`asset_search.title`,
        sql`asset_search.description`,
        sql`asset_search.department`,
        sql`asset_search.system`,
        sql`asset_search.tags`
      ];
      return sql`(${sql.join(
        fields.map((field) => sql`instr(lower(${field}), lower(${token})) > 0`),
        sql` OR `
      )})`;
    }),
    sql` AND `
  );
}

function toAssetListItem(row: AssetListRow): AssetListItem {
  return assetListItemSchema.parse({
    assetId: row.assetId,
    version: row.version,
    kind: row.kind,
    title: row.title,
    description: row.description,
    confidentiality: row.confidentiality,
    department: row.department,
    system: row.system,
    mimeType: row.mimeType,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    pageCount: row.pageCount,
    thumbnailPaths: parseThumbnailPaths(row.thumbnailPaths),
    tags: parseJsonArray(row.tagsJson),
    tagIds: parseJsonArray(row.tagIdsJson),
    status: row.status,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
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

  findActiveTagDictionary(): AssetTagDictionaryEntry[] {
    return withDatabaseErrors(() => {
      const rows = this.database
        .select({
          tagId: tags.tagId,
          axis: tags.axis,
          canonicalName: tags.canonicalName,
          normalizedName: tags.normalizedName,
          alias: tagAliases.alias,
          normalizedAlias: tagAliases.normalizedAlias
        })
        .from(tags)
        .leftJoin(tagAliases, eq(tagAliases.tagId, tags.tagId))
        .where(eq(tags.status, "active"))
        .orderBy(
          tags.canonicalName,
          tags.tagId,
          tagAliases.alias,
          tagAliases.aliasId
        )
        .all();

      const byTagId = new Map<string, AssetTagDictionaryEntry>();
      for (const row of rows) {
        const existing = byTagId.get(row.tagId);
        if (existing !== undefined) {
          if (
            row.alias !== null &&
            row.normalizedAlias !== null &&
            !existing.aliases.some(
              (alias) => alias.normalizedAlias === row.normalizedAlias
            )
          ) {
            existing.aliases.push({
              alias: row.alias,
              normalizedAlias: row.normalizedAlias
            });
          }
          continue;
        }

        byTagId.set(row.tagId, {
          tagId: row.tagId,
          axis: row.axis,
          canonicalName: row.canonicalName,
          normalizedName: row.normalizedName,
          aliases:
            row.alias === null || row.normalizedAlias === null
              ? []
              : [
                  {
                    alias: row.alias,
                    normalizedAlias: row.normalizedAlias
                  }
                ]
        });
      }

      return [...byTagId.values()];
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

  list(filters: AssetRepositoryListFilters): AssetListResult {
    return this.listSearch({
      q: filters.q,
      kinds: filters.kind === undefined ? undefined : [filters.kind],
      department: filters.department,
      system: filters.system,
      status: filters.status,
      requiredTagIds: filters.tagIds,
      excludedTagIds: [],
      optionalTagIds: [],
      page: filters.page,
      pageSize: filters.pageSize
    });
  }

  searchVisual(
    filters: AssetRepositoryVisualSearchFilters
  ): AssetRepositoryVisualSearchResult {
    const visualKinds = (filters.kinds as readonly AssetKind[]).filter(
      (kind): kind is Exclude<AssetKind, "sound_effect"> =>
        kind !== "sound_effect"
    );
    if (visualKinds.length === 0) {
      return { items: [], total: 0 };
    }
    const result = this.listSearch({
      q: filters.q,
      kinds: visualKinds,
      status: "active",
      requiredTagIds: filters.requiredTagIds,
      excludedTagIds: filters.excludedTagIds,
      optionalTagIds: filters.optionalTagIds,
      page: 1,
      pageSize: filters.limit
    });
    return { items: result.items, total: result.total };
  }

  private listSearch(filters: AssetRepositorySearchFilters): AssetListResult {
    return withDatabaseErrors(() => {
      const valueList = (values: readonly string[]) =>
        sql.join(
          values.map((value) => sql`${value}`),
          sql`, `
        );
      const conditions: SQL[] = [sql`${assets.status} = ${filters.status}`];
      if (filters.kinds !== undefined && filters.kinds.length > 0) {
        conditions.push(sql`${assets.kind} IN (${valueList(filters.kinds)})`);
      }
      if (filters.department !== undefined) {
        conditions.push(sql`${assets.department} = ${filters.department}`);
      }
      if (filters.system !== undefined) {
        conditions.push(sql`${assets.system} = ${filters.system}`);
      }
      for (const tagId of filters.requiredTagIds) {
        conditions.push(sql`
          EXISTS (
            SELECT 1
            FROM asset_tags AS required_asset_tags
            INNER JOIN tags AS required_tags
              ON required_tags.tag_id = required_asset_tags.tag_id
             AND required_tags.status = 'active'
            WHERE required_asset_tags.asset_id = ${assets.assetId}
              AND required_asset_tags.tag_id = ${tagId}
          )
        `);
      }
      if (filters.excludedTagIds.length > 0) {
        conditions.push(sql`
          NOT EXISTS (
            SELECT 1
            FROM asset_tags AS excluded_asset_tags
            INNER JOIN tags AS excluded_tags
              ON excluded_tags.tag_id = excluded_asset_tags.tag_id
             AND excluded_tags.status = 'active'
            WHERE excluded_asset_tags.asset_id = ${assets.assetId}
              AND excluded_asset_tags.tag_id IN (${valueList(filters.excludedTagIds)})
          )
        `);
      }

      const hasQuery = filters.q !== undefined && filters.q.length > 0;
      const useFts = hasQuery && canUseFtsQuery(filters.q);
      const searchJoin = hasQuery
        ? sql`INNER JOIN asset_search
            ON asset_search.asset_id = ${assets.assetId}`
        : sql``;
      if (hasQuery) {
        conditions.push(
          useFts
            ? sql`asset_search MATCH ${buildFtsQuery(filters.q)}`
            : substringSearchCondition(filters.q)
        );
      }

      const optionalMatchScore =
        filters.optionalTagIds.length === 0
          ? sql`0`
          : sql`(
              SELECT COUNT(*)
              FROM asset_tags AS optional_asset_tags
              INNER JOIN tags AS optional_tags
                ON optional_tags.tag_id = optional_asset_tags.tag_id
               AND optional_tags.status = 'active'
              WHERE optional_asset_tags.asset_id = ${assets.assetId}
                AND optional_asset_tags.tag_id IN (${valueList(filters.optionalTagIds)})
            )`;
      const orderParts: SQL[] = [];
      if (useFts) {
        orderParts.push(sql`asset_search.rank ASC`);
      }
      if (filters.optionalTagIds.length > 0) {
        orderParts.push(sql`${optionalMatchScore} DESC`);
      }
      orderParts.push(sql`assets.updated_at DESC`, sql`assets.asset_id ASC`);

      const where = sql.join(conditions, sql` AND `);
      const totalRow = this.database.get<{ total: number }>(sql`
        SELECT COUNT(*) AS total
        FROM assets
        ${searchJoin}
        WHERE ${where}
      `);
      const total = Number(totalRow?.total ?? 0);
      const offset = (filters.page - 1) * filters.pageSize;
      const orderBy = sql.join(orderParts, sql`, `);

      const rows = this.database.all<AssetListRow>(sql`
        SELECT
          assets.asset_id AS assetId,
          latest_version.version AS version,
          assets.kind AS kind,
          assets.title AS title,
          assets.description AS description,
          assets.confidentiality AS confidentiality,
          assets.department AS department,
          assets.system AS system,
          latest_version.mime_type AS mimeType,
          latest_version.checksum AS checksum,
          latest_version.size_bytes AS sizeBytes,
          latest_version.width AS width,
          latest_version.height AS height,
          latest_version.duration_ms AS durationMs,
          latest_version.page_count AS pageCount,
          latest_version.thumbnail_paths AS thumbnailPaths,
          COALESCE(
            (
              SELECT json_group_array(json_object(
                'tagId', ordered_tags.tag_id,
                'axis', ordered_tags.axis,
                'canonicalName', ordered_tags.canonical_name
              ))
              FROM (
                SELECT DISTINCT tags.tag_id, tags.axis, tags.canonical_name
                FROM asset_tags
                INNER JOIN tags ON tags.tag_id = asset_tags.tag_id
                WHERE asset_tags.asset_id = assets.asset_id
                  AND tags.status = 'active'
                ORDER BY tags.canonical_name, tags.tag_id
              ) AS ordered_tags
            ),
            '[]'
          ) AS tagsJson,
          COALESCE(
            (
              SELECT json_group_array(ordered_tag_ids.tag_id)
              FROM (
                SELECT DISTINCT tags.tag_id
                FROM asset_tags
                INNER JOIN tags ON tags.tag_id = asset_tags.tag_id
                WHERE asset_tags.asset_id = assets.asset_id
                  AND tags.status = 'active'
                ORDER BY tags.tag_id
              ) AS ordered_tag_ids
            ),
            '[]'
          ) AS tagIdsJson,
          assets.status AS status,
          assets.error_code AS errorCode,
          assets.error_message AS errorMessage,
          assets.created_at AS createdAt,
          assets.updated_at AS updatedAt
        FROM assets
        ${searchJoin}
        LEFT JOIN asset_versions AS latest_version
          ON latest_version.asset_id = assets.asset_id
         AND latest_version.version = (
           SELECT MAX(version)
           FROM asset_versions
           WHERE asset_versions.asset_id = assets.asset_id
         )
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${filters.pageSize} OFFSET ${offset}
      `);

      const items = rows.map(toAssetListItem);
      return {
        items,
        page: filters.page,
        pageSize: filters.pageSize,
        total,
        hasNextPage: offset + items.length < total
      };
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
