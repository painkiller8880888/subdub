import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
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

export const schema = { terminologyTerms } as const;
