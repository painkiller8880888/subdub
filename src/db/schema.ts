import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";

export const terminologyTerms = sqliteTable(
  "terminology_terms",
  {
    termId: text("term_id").primaryKey(),
    surface: text("surface").notNull(),
    normalizedSurface: text("normalized_surface").notNull(),
    readingKatakana: text("reading_katakana").notNull(),
    category: text("category").notNull(),
    priority: integer("priority").notNull().default(0),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("terminology_terms_surface_uq").on(table.normalizedSurface),
    index("terminology_terms_status_idx").on(table.status),
    // Drizzle does not infer this constraint from the enum type alone.
    check(
      "terminology_terms_status_check",
      sql`${table.status} IN ('active', 'inactive')`
    )
  ]
);

export const assets = sqliteTable(
  "assets",
  {
    assetId: text("asset_id").primaryKey(),
    kind: text("kind", {
      enum: ["video", "photo", "document_scan", "sound_effect"]
    }).notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    confidentiality: text("confidentiality").notNull().default("internal"),
    department: text("department"),
    system: text("system"),
    status: text("status", {
      enum: ["processing", "active", "inactive", "error"]
    }).notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("assets_status_idx").on(table.status),
    check(
      "assets_kind_check",
      sql`${table.kind} IN ('video', 'photo', 'document_scan', 'sound_effect')`
    ),
    check(
      "assets_status_check",
      sql`${table.status} IN ('processing', 'active', 'inactive', 'error')`
    )
  ]
);

export const assetVersions = sqliteTable(
  "asset_versions",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId),
    version: integer("version").notNull(),
    libraryMediaPath: text("library_media_path").notNull(),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum"),
    sizeBytes: integer("size_bytes"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    pageCount: integer("page_count"),
    thumbnailPaths: text("thumbnail_paths"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.version] }),
    index("asset_versions_asset_id_idx").on(table.assetId)
  ]
);

export const tags = sqliteTable(
  "tags",
  {
    tagId: text("tag_id").primaryKey(),
    axis: text("axis", {
      enum: [
        "department",
        "system",
        "task",
        "action",
        "object",
        "location",
        "documentType",
        "status"
      ]
    }).notNull(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    uniqueIndex("tags_normalized_name_uq").on(table.normalizedName),
    index("tags_status_idx").on(table.status),
    check(
      "tags_axis_check",
      sql`${table.axis} IN ('department', 'system', 'task', 'action', 'object', 'location', 'documentType', 'status')`
    ),
    check("tags_status_check", sql`${table.status} IN ('active', 'inactive')`)
  ]
);

export const tagAliases = sqliteTable(
  "tag_aliases",
  {
    aliasId: text("alias_id").primaryKey(),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.tagId),
    alias: text("alias").notNull(),
    normalizedAlias: text("normalized_alias").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("tag_aliases_tag_alias_uq").on(
      table.tagId,
      table.normalizedAlias
    ),
    index("tag_aliases_tag_id_idx").on(table.tagId)
  ]
);

export const assetTags = sqliteTable(
  "asset_tags",
  {
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.assetId),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.tagId),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.assetId, table.tagId] }),
    index("asset_tags_tag_id_idx").on(table.tagId)
  ]
);

export const schema = {
  terminologyTerms,
  assets,
  assetVersions,
  tags,
  tagAliases,
  assetTags
} as const;
