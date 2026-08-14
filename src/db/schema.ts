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

export const aiGenerationCandidates = sqliteTable(
  "ai_generation_candidates",
  {
    candidateId: text("candidate_id").primaryKey(),
    generationRunId: text("generation_run_id").notNull(),
    projectId: text("project_id").notNull(),
    projectRevision: integer("project_revision").notNull(),
    taskKind: text("task_kind", {
      enum: ["outline_generation", "visual_search_intent"]
    }).notNull(),
    targetKind: text("target_kind", {
      enum: ["outline", "visual_line_range"]
    }).notNull(),
    targetId: text("target_id").notNull(),
    candidateKey: text("candidate_key").notNull(),
    candidateJson: text("candidate_json").notNull(),
    candidateChecksum: text("candidate_checksum").notNull(),
    modelId: text("model_id").notNull(),
    responseModel: text("response_model"),
    promptVersion: text("prompt_version").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("ai_generation_candidates_run_key_uq").on(
      table.generationRunId,
      table.candidateKey
    ),
    index("ai_generation_candidates_project_task_model_run_idx").on(
      table.projectId,
      table.taskKind,
      table.modelId,
      table.generationRunId
    ),
    index("ai_generation_candidates_project_target_idx").on(
      table.projectId,
      table.targetKind,
      table.targetId
    ),
    check(
      "ai_generation_candidates_task_kind_check",
      sql`${table.taskKind} IN ('outline_generation', 'visual_search_intent')`
    ),
    check(
      "ai_generation_candidates_target_kind_check",
      sql`${table.targetKind} IN ('outline', 'visual_line_range')`
    )
  ]
);

export const improvementDecisions = sqliteTable(
  "improvement_decisions",
  {
    decisionId: text("decision_id").primaryKey(),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => aiGenerationCandidates.candidateId),
    projectId: text("project_id").notNull(),
    projectRevisionBefore: integer("project_revision_before").notNull(),
    projectRevisionAfter: integer("project_revision_after").notNull(),
    taskKind: text("task_kind", {
      enum: ["outline_generation", "visual_search_intent"]
    }).notNull(),
    targetKind: text("target_kind", {
      enum: ["outline", "visual_line_range"]
    }).notNull(),
    targetId: text("target_id").notNull(),
    decision: text("decision", { enum: ["accepted", "rejected"] }).notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json"),
    reason: text("reason"),
    modelId: text("model_id").notNull(),
    promptVersion: text("prompt_version").notNull(),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("improvement_decisions_candidate_uq").on(table.candidateId),
    index("improvement_decisions_project_task_idx").on(
      table.projectId,
      table.taskKind,
      table.targetKind,
      table.createdAt
    ),
    index("improvement_decisions_candidate_idx").on(table.candidateId),
    check(
      "improvement_decisions_task_kind_check",
      sql`${table.taskKind} IN ('outline_generation', 'visual_search_intent')`
    ),
    check(
      "improvement_decisions_target_kind_check",
      sql`${table.targetKind} IN ('outline', 'visual_line_range')`
    ),
    check(
      "improvement_decisions_decision_check",
      sql`${table.decision} IN ('accepted', 'rejected')`
    ),
    check(
      "improvement_decisions_after_json_check",
      sql`(${table.decision} = 'rejected' AND ${table.afterJson} IS NULL) OR (${table.decision} = 'accepted' AND ${table.afterJson} IS NOT NULL)`
    )
  ]
);

export const goldenExamples = sqliteTable(
  "golden_examples",
  {
    exampleId: text("example_id").primaryKey(),
    exampleKind: text("example_kind", {
      enum: ["approved_outline", "approved_script_bundle"]
    }).notNull(),
    projectId: text("project_id").notNull(),
    projectRevision: integer("project_revision").notNull(),
    targetId: text("target_id").notNull(),
    sourceHash: text("source_hash").notNull(),
    outlineHash: text("outline_hash"),
    payloadJson: text("payload_json").notNull(),
    payloadChecksum: text("payload_checksum").notNull(),
    generationRunId: text("generation_run_id"),
    modelId: text("model_id"),
    promptVersion: text("prompt_version"),
    createdAt: text("created_at").notNull()
  },
  (table) => [
    uniqueIndex("golden_examples_project_kind_payload_uq").on(
      table.projectId,
      table.exampleKind,
      table.payloadChecksum
    ),
    index("golden_examples_project_kind_revision_idx").on(
      table.projectId,
      table.exampleKind,
      table.projectRevision
    ),
    index("golden_examples_project_model_idx").on(
      table.projectId,
      table.modelId,
      table.createdAt
    ),
    check(
      "golden_examples_kind_check",
      sql`${table.exampleKind} IN ('approved_outline', 'approved_script_bundle')`
    ),
    check(
      "golden_examples_generation_metadata_check",
      sql`(${table.generationRunId} IS NULL AND ${table.modelId} IS NULL AND ${table.promptVersion} IS NULL) OR (${table.generationRunId} IS NOT NULL AND ${table.modelId} IS NOT NULL AND ${table.promptVersion} IS NOT NULL)`
    )
  ]
);

export const characterVisuals = sqliteTable(
  "character_visuals",
  {
    visualId: text("visual_id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] }).notNull(),
    baseWidth: integer("base_width"),
    baseHeight: integer("base_height"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("character_visuals_status_idx").on(table.status),
    check(
      "character_visuals_status_check",
      sql`${table.status} IN ('active', 'inactive')`
    ),
    check(
      "character_visuals_base_canvas_check",
      sql`(${table.baseWidth} IS NULL AND ${table.baseHeight} IS NULL) OR (${table.baseWidth} IS NOT NULL AND ${table.baseHeight} IS NOT NULL AND ${table.baseWidth} > 0 AND ${table.baseHeight} > 0)`
    )
  ]
);

export const characterVariants = sqliteTable(
  "character_variants",
  {
    variantId: text("variant_id").primaryKey(),
    visualId: text("visual_id")
      .notNull()
      .references(() => characterVisuals.visualId, { onDelete: "cascade" }),
    label: text("label").notNull(),
    renderType: text("render_type", {
      enum: ["single-image", "mouth-pair"]
    }).notNull(),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    tags: text("tags").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    index("character_variants_visual_id_idx").on(table.visualId),
    check(
      "character_variants_render_type_check",
      sql`${table.renderType} IN ('single-image', 'mouth-pair')`
    ),
    check(
      "character_variants_status_check",
      sql`${table.status} IN ('active', 'inactive')`
    )
  ]
);

export const characterVariantFiles = sqliteTable(
  "character_variant_files",
  {
    variantId: text("variant_id")
      .notNull()
      .references(() => characterVariants.variantId, { onDelete: "cascade" }),
    fileKey: text("file_key").notNull(),
    libraryPath: text("library_path").notNull(),
    mimeType: text("mime_type").notNull(),
    checksum: text("checksum").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.fileKey] }),
    uniqueIndex("character_variant_files_library_path_uq").on(
      table.libraryPath
    ),
    index("character_variant_files_variant_id_idx").on(table.variantId),
    check(
      "character_variant_files_mime_type_check",
      sql`${table.mimeType} = 'image/png'`
    ),
    check(
      "character_variant_files_checksum_check",
      sql`length(${table.checksum}) = 64`
    ),
    check(
      "character_variant_files_dimensions_check",
      sql`${table.sizeBytes} >= 0 AND ${table.width} > 0 AND ${table.height} > 0`
    )
  ]
);

export const schema = {
  terminologyTerms,
  assets,
  assetVersions,
  tags,
  tagAliases,
  assetTags,
  aiGenerationCandidates,
  improvementDecisions,
  goldenExamples,
  characterVisuals,
  characterVariants,
  characterVariantFiles
} as const;
