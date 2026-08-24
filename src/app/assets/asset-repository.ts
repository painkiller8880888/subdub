import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

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
  type AssetListStatus,
  type AssetListItem,
  type AssetListResult,
  type AssetStatus,
  type AssetTag,
  type AssetVersionStatus,
  type AssetVersionSummary
} from "../../schema/index.js";
import type {
  AssetProcessingErrorCode,
  AssetTagAxis
} from "../../schema/asset.js";
import {
  AssetError,
  AssetDatabaseError,
  AssetInvalidFieldError,
  AssetInvalidStateError,
  AssetNotFoundError,
  AssetProcessingRaceError,
  AssetRevisionConflictError,
  AssetTagNotFoundError,
  AssetVersionNotReadyError
} from "./asset-errors.js";
import { ASSET_FORMATS, type AssetFormat } from "./asset-formats.js";

const SOUND_EFFECT_USAGE_TAGS = new Set(["confirm", "attention", "warning"]);

function hasRequiredSoundEffectUsageTag(tags: readonly AssetTag[]): boolean {
  return tags.some(
    (tag) =>
      SOUND_EFFECT_USAGE_TAGS.has(tag.canonicalName) ||
      SOUND_EFFECT_USAGE_TAGS.has(tag.tagId)
  );
}

export type AssetInsert = {
  assetId: string;
  revision?: number;
  currentVersion?: number | null;
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
  status?: AssetVersionStatus;
  baseRevision?: number;
  baseCurrentVersion?: number | null;
  stagingPath?: string | null;
  libraryMediaPath: string;
  mimeType: string;
  errorCode?: AssetProcessingErrorCode | null;
  errorMessage?: string | null;
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
  revision: number;
  currentVersion: number | null;
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
  status: AssetVersionStatus;
  baseRevision: number;
  baseCurrentVersion: number | null;
  stagingPath: string | null;
  libraryMediaPath: string;
  mimeType: string;
  checksum: string | null;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  thumbnailPaths: string | null;
  errorCode: AssetProcessingErrorCode | null;
  errorMessage: string | null;
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
  version: number;
  errorCode: AssetProcessingErrorCode;
  errorMessage: string;
  updatedAt: string;
};

export type AssetProcessingKey = {
  assetId: string;
  version: number;
};

export type AssetMetadataUpdateValues = {
  assetId: string;
  expectedRevision: number;
  title: string;
  description: string;
  confidentiality: string;
  department: string | null;
  system: string | null;
  tagIds: readonly string[];
  updatedAt: string;
};

export type AssetStatusChangeValues = {
  assetId: string;
  expectedRevision: number;
  status: "active" | "inactive";
  updatedAt: string;
};

export type AssetReplacementReservationValues = {
  assetId: string;
  expectedRevision: number;
  stagingPath: string;
  libraryMediaPath: string;
  mimeType: string;
  updatedAt: string;
};

export type AssetReplacementReservation = {
  assetId: string;
  version: number;
  revision: number;
  currentVersion: number | null;
  kind: AssetKind;
  status: "processing";
  createdAt: string;
  updatedAt: string;
};

export type AssetRepositoryListFilters = {
  readonly q?: string;
  readonly kind?: AssetKind;
  readonly format?: AssetFormat;
  readonly department?: string;
  readonly system?: string;
  readonly status: AssetListStatus;
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
  readonly kinds: readonly Exclude<AssetKind, "sound_effect" | "bgm">[];
  readonly q?: string;
  readonly limit: number;
};

export type AssetRepositoryVisualSearchResult = {
  readonly items: readonly AssetListItem[];
  readonly total: number;
};

type AssetListRow = {
  assetId: string;
  revision: number;
  currentVersion: number | null;
  version: number | null;
  versionStatus: AssetVersionStatus | null;
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
  readonly format?: AssetFormat;
  readonly department?: string;
  readonly system?: string;
  readonly status: AssetListStatus;
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
    revision: row.revision,
    currentVersion: row.currentVersion,
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
    status: row.status,
    baseRevision: row.baseRevision,
    baseCurrentVersion: row.baseCurrentVersion,
    stagingPath: row.stagingPath,
    libraryMediaPath: row.libraryMediaPath,
    mimeType: row.mimeType,
    checksum: row.checksum,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    pageCount: row.pageCount,
    thumbnailPaths: row.thumbnailPaths,
    errorCode: row.errorCode as AssetProcessingErrorCode | null,
    errorMessage: row.errorMessage,
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
    revision: row.revision,
    currentVersion: row.currentVersion,
    version: row.version,
    versionStatus: row.versionStatus,
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
    if (error instanceof AssetError) {
      throw error;
    }
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
      return this.database
        .select({
          assetId: assetVersions.assetId,
          version: assetVersions.version
        })
        .from(assetVersions)
        .where(eq(assetVersions.status, "processing"))
        .orderBy(
          assetVersions.createdAt,
          assetVersions.assetId,
          assetVersions.version
        )
        .all();
    });
  }

  private findAssetVersionSummaries(assetId: string): AssetVersionSummary[] {
    const rows = this.database
      .select({
        version: assetVersions.version,
        status: assetVersions.status,
        checksum: assetVersions.checksum,
        errorCode: assetVersions.errorCode,
        errorMessage: assetVersions.errorMessage,
        createdAt: assetVersions.createdAt,
        updatedAt: assetVersions.updatedAt
      })
      .from(assetVersions)
      .where(eq(assetVersions.assetId, assetId))
      .orderBy(desc(assetVersions.version))
      .all();
    return rows.map((row) => ({
      version: row.version,
      status: row.status,
      checksum: row.checksum,
      errorCode: row.errorCode as AssetProcessingErrorCode | null,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }));
  }

  findAssetDetail(
    assetId: string,
    requestedVersion?: number
  ): AssetDetail | undefined {
    return withDatabaseErrors(() => {
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, assetId))
        .get();
      if (asset === undefined) {
        return undefined;
      }
      const versionCondition =
        requestedVersion === undefined
          ? asset.currentVersion === null
            ? eq(assetVersions.assetId, assetId)
            : and(
                eq(assetVersions.assetId, assetId),
                eq(assetVersions.version, asset.currentVersion)
              )
          : and(
              eq(assetVersions.assetId, assetId),
              eq(assetVersions.version, requestedVersion)
            );
      const version = this.database
        .select()
        .from(assetVersions)
        .where(versionCondition)
        .orderBy(desc(assetVersions.version))
        .limit(1)
        .get();
      if (version === undefined) {
        return undefined;
      }
      const versionHistory = this.findAssetVersionSummaries(assetId);
      const linkedTagIds = this.findAssetTagIds(assetId);
      const detailTags = this.findActiveTags(linkedTagIds).map((tag) => ({
        tagId: tag.tagId,
        axis: tag.axis,
        canonicalName: tag.canonicalName
      }));
      const currentVersion = asset.currentVersion;
      const pendingVersion =
        currentVersion === null
          ? null
          : (versionHistory.find(
              (summary) =>
                summary.version > currentVersion && summary.status !== "ready"
            ) ?? null);
      return assetDetailSchema.parse({
        assetId: asset.assetId,
        revision: asset.revision,
        currentVersion: asset.currentVersion,
        version: version.version,
        versionStatus: version.status,
        versionHistory,
        versions: versionHistory,
        pendingVersion,
        tags: detailTags,
        tagIds: detailTags.map((tag) => tag.tagId),
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
        errorCode: version.errorCode ?? asset.errorCode,
        errorMessage: version.errorMessage ?? asset.errorMessage,
        createdAt: asset.createdAt,
        updatedAt: asset.updatedAt
      });
    });
  }

  list(filters: AssetRepositoryListFilters): AssetListResult {
    return this.listSearch({
      q: filters.q,
      kinds: filters.kind === undefined ? undefined : [filters.kind],
      format: filters.format,
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
      (kind): kind is Exclude<AssetKind, "sound_effect" | "bgm"> =>
        kind !== "sound_effect" && kind !== "bgm"
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
      const conditions: SQL[] =
        filters.status === "all"
          ? []
          : [sql`${assets.status} = ${filters.status}`];
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
      const latestVersionJoin = sql`
        LEFT JOIN asset_versions AS latest_version
          ON latest_version.asset_id = assets.asset_id
         AND latest_version.version = (
           SELECT COALESCE(
             assets.current_version,
             MAX(version)
           )
           FROM asset_versions
           WHERE asset_versions.asset_id = assets.asset_id
         )
      `;
      if (hasQuery) {
        conditions.push(
          useFts
            ? sql`asset_search MATCH ${buildFtsQuery(filters.q)}`
            : substringSearchCondition(filters.q)
        );
      }
      if (filters.format !== undefined) {
        const format = ASSET_FORMATS[filters.format];
        conditions.push(sql`latest_version.mime_type = ${format.mimeType}`);
        conditions.push(sql`
          lower(substr(
            latest_version.library_media_path,
            -${format.extension.length + 1}
          )) = ${`.${format.extension}`}
        `);
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

      const where =
        conditions.length === 0 ? sql`1 = 1` : sql.join(conditions, sql` AND `);
      const totalRow = this.database.get<{ total: number }>(sql`
        SELECT COUNT(*) AS total
        FROM assets
        ${searchJoin}
        ${latestVersionJoin}
        WHERE ${where}
      `);
      const total = Number(totalRow?.total ?? 0);
      const offset = (filters.page - 1) * filters.pageSize;
      const orderBy = sql.join(orderParts, sql`, `);

      const rows = this.database.all<AssetListRow>(sql`
        SELECT
          assets.asset_id AS assetId,
          assets.revision AS revision,
          assets.current_version AS currentVersion,
          latest_version.version AS version,
          latest_version.status AS versionStatus,
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
        ${latestVersionJoin}
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

  markProcessingSucceeded(values: AssetProcessingSuccessValues): boolean {
    return withDatabaseErrors(() => {
      const version = this.database
        .select()
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.assetId, values.assetId),
            eq(assetVersions.version, values.version)
          )
        )
        .get();
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (
        asset === undefined ||
        version === undefined ||
        version.status !== "processing"
      ) {
        throw new AssetProcessingRaceError();
      }

      const baseMatches =
        asset.revision === version.baseRevision &&
        asset.currentVersion === version.baseCurrentVersion;
      const initialActivation =
        version.baseCurrentVersion === null &&
        asset.status === "processing" &&
        asset.currentVersion === null;
      if (!baseMatches && !initialActivation) {
        if (version.baseCurrentVersion !== null) {
          this.database
            .update(assetVersions)
            .set({
              status: "error",
              errorCode: "REPLACEMENT_REVISION_CONFLICT",
              errorMessage:
                "差し替え受付後に素材が更新されたため、差し替えを適用できませんでした。",
              stagingPath: null,
              updatedAt: values.updatedAt
            })
            .where(
              and(
                eq(assetVersions.assetId, values.assetId),
                eq(assetVersions.version, values.version),
                eq(assetVersions.status, "processing")
              )
            )
            .run();
          return false;
        }
        throw new AssetProcessingRaceError();
      }

      this.database
        .update(assetVersions)
        .set({
          status: "ready",
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
          errorCode: null,
          errorMessage: null,
          stagingPath: null,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assetVersions.assetId, values.assetId),
            eq(assetVersions.version, values.version),
            eq(assetVersions.status, "processing")
          )
        )
        .run();

      const nextStatus =
        asset.status === "processing" ? "active" : asset.status;
      const currentVersionCondition =
        asset.currentVersion === null
          ? isNull(assets.currentVersion)
          : eq(assets.currentVersion, asset.currentVersion);
      const result = this.database
        .update(assets)
        .set({
          currentVersion: values.version,
          status: nextStatus,
          revision: asset.revision + 1,
          errorCode: null,
          errorMessage: null,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assets.assetId, values.assetId),
            eq(assets.revision, asset.revision),
            currentVersionCondition
          )
        )
        .run();
      if ((result.changes ?? 0) === 0) {
        throw new AssetProcessingRaceError();
      }
      return true;
    });
  }

  markProcessingFailed(values: AssetProcessingFailureValues): boolean {
    return withDatabaseErrors(() => {
      const version = this.database
        .select()
        .from(assetVersions)
        .where(
          and(
            eq(assetVersions.assetId, values.assetId),
            eq(assetVersions.version, values.version),
            eq(assetVersions.status, "processing")
          )
        )
        .get();
      if (version === undefined) {
        return false;
      }
      this.database
        .update(assetVersions)
        .set({
          status: "error",
          errorCode: values.errorCode,
          errorMessage: values.errorMessage,
          stagingPath: null,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assetVersions.assetId, values.assetId),
            eq(assetVersions.version, values.version),
            eq(assetVersions.status, "processing")
          )
        )
        .run();
      if (version.baseCurrentVersion === null) {
        const result = this.database
          .update(assets)
          .set({
            status: "error",
            currentVersion: null,
            errorCode: values.errorCode,
            errorMessage: values.errorMessage,
            updatedAt: values.updatedAt
          })
          .where(
            and(
              eq(assets.assetId, values.assetId),
              eq(assets.status, "processing"),
              isNull(assets.currentVersion)
            )
          )
          .run();
        if ((result.changes ?? 0) === 0) {
          throw new AssetProcessingRaceError();
        }
      }
      return true;
    });
  }

  insertAsset(values: AssetInsert): void {
    withDatabaseErrors(() => {
      this.database
        .insert(assets)
        .values({
          assetId: values.assetId,
          revision: values.revision ?? 1,
          currentVersion: values.currentVersion ?? null,
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
          status: values.status ?? "processing",
          baseRevision: values.baseRevision ?? 1,
          baseCurrentVersion: values.baseCurrentVersion ?? null,
          stagingPath: values.stagingPath ?? null,
          libraryMediaPath: values.libraryMediaPath,
          mimeType: values.mimeType,
          errorCode: values.errorCode ?? null,
          errorMessage: values.errorMessage ?? null,
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

  updateMetadata(values: AssetMetadataUpdateValues): AssetRecord {
    return withDatabaseErrors(() => {
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (asset === undefined) {
        throw new AssetNotFoundError();
      }
      if (asset.revision !== values.expectedRevision) {
        throw new AssetRevisionConflictError();
      }

      const activeTags = this.findActiveTags([...values.tagIds]);
      const activeTagIds = new Set(activeTags.map((tag) => tag.tagId));
      if (values.tagIds.some((tagId) => !activeTagIds.has(tagId))) {
        throw new AssetTagNotFoundError();
      }
      if (
        asset.kind === "sound_effect" &&
        !hasRequiredSoundEffectUsageTag(activeTags)
      ) {
        throw new AssetInvalidFieldError();
      }

      const linkedTagIds = this.findAssetTagIds(values.assetId);
      const linkedActiveTagIds = this.findActiveTags(linkedTagIds).map(
        (tag) => tag.tagId
      );

      const nextRevision = asset.revision + 1;
      const result = this.database
        .update(assets)
        .set({
          title: values.title,
          description: values.description,
          confidentiality: values.confidentiality,
          department: values.department,
          system: values.system,
          revision: nextRevision,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assets.assetId, values.assetId),
            eq(assets.revision, values.expectedRevision)
          )
        )
        .run();
      if ((result.changes ?? 0) === 0) {
        throw new AssetRevisionConflictError();
      }

      if (linkedActiveTagIds.length > 0) {
        this.database
          .delete(assetTags)
          .where(
            and(
              eq(assetTags.assetId, values.assetId),
              inArray(assetTags.tagId, linkedActiveTagIds)
            )
          )
          .run();
      }
      if (values.tagIds.length > 0) {
        this.insertAssetTags(
          values.tagIds.map((tagId) => ({
            assetId: values.assetId,
            tagId,
            createdAt: values.updatedAt
          }))
        );
      }

      const updated = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (updated === undefined) {
        throw new AssetDatabaseError();
      }
      return toAssetRecord(updated);
    });
  }

  changeStatus(values: AssetStatusChangeValues): AssetRecord {
    return withDatabaseErrors(() => {
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (asset === undefined) {
        throw new AssetNotFoundError();
      }
      if (asset.revision !== values.expectedRevision) {
        throw new AssetRevisionConflictError();
      }
      if (asset.status === values.status) {
        return toAssetRecord(asset);
      }
      if (
        asset.status !== (values.status === "active" ? "inactive" : "active")
      ) {
        throw new AssetInvalidStateError();
      }
      if (values.status === "active") {
        if (asset.currentVersion === null) {
          throw new AssetVersionNotReadyError();
        }
        const current = this.database
          .select({ status: assetVersions.status })
          .from(assetVersions)
          .where(
            and(
              eq(assetVersions.assetId, asset.assetId),
              eq(assetVersions.version, asset.currentVersion)
            )
          )
          .get();
        if (current?.status !== "ready") {
          throw new AssetVersionNotReadyError();
        }
      }

      const result = this.database
        .update(assets)
        .set({
          status: values.status,
          revision: asset.revision + 1,
          updatedAt: values.updatedAt
        })
        .where(
          and(
            eq(assets.assetId, values.assetId),
            eq(assets.revision, values.expectedRevision)
          )
        )
        .run();
      if ((result.changes ?? 0) === 0) {
        throw new AssetRevisionConflictError();
      }
      const updated = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (updated === undefined) {
        throw new AssetDatabaseError();
      }
      return toAssetRecord(updated);
    });
  }

  reserveReplacement(
    values: AssetReplacementReservationValues
  ): AssetReplacementReservation {
    return withDatabaseErrors(() => {
      const asset = this.database
        .select()
        .from(assets)
        .where(eq(assets.assetId, values.assetId))
        .get();
      if (asset === undefined) {
        throw new AssetNotFoundError();
      }
      if (asset.revision !== values.expectedRevision) {
        throw new AssetRevisionConflictError();
      }
      if (asset.status !== "active" && asset.status !== "inactive") {
        throw new AssetInvalidStateError();
      }

      const latest = this.database
        .select({ version: assetVersions.version })
        .from(assetVersions)
        .where(eq(assetVersions.assetId, asset.assetId))
        .orderBy(desc(assetVersions.version))
        .limit(1)
        .get();
      const version = (latest?.version ?? 0) + 1;
      const nextRevision = asset.revision + 1;
      this.insertAssetVersion({
        assetId: asset.assetId,
        version,
        status: "processing",
        baseRevision: nextRevision,
        baseCurrentVersion: asset.currentVersion,
        stagingPath: values.stagingPath,
        libraryMediaPath: values.libraryMediaPath.replace(
          "{version}",
          String(version)
        ),
        mimeType: values.mimeType,
        createdAt: values.updatedAt,
        updatedAt: values.updatedAt
      });
      const result = this.database
        .update(assets)
        .set({ revision: nextRevision, updatedAt: values.updatedAt })
        .where(
          and(
            eq(assets.assetId, asset.assetId),
            eq(assets.revision, values.expectedRevision)
          )
        )
        .run();
      if ((result.changes ?? 0) === 0) {
        throw new AssetRevisionConflictError();
      }
      return {
        assetId: asset.assetId,
        version,
        revision: nextRevision,
        currentVersion: asset.currentVersion,
        kind: asset.kind,
        status: "processing",
        createdAt: values.updatedAt,
        updatedAt: values.updatedAt
      };
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
