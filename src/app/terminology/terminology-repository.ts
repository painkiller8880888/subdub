import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import type { WorkspaceDatabase } from "../../db/client.js";
import { terminologyTerms } from "../../db/schema.js";
import {
  type TerminologyTerm,
  terminologyTermSchema
} from "../../schema/terminology.js";

export type TerminologyRepositoryConstraint = "surface" | "termId" | "unknown";

export class TerminologyRepositoryError extends Error {
  readonly code = "TERMINOLOGY_REPOSITORY_ERROR" as const;
  readonly constraint: TerminologyRepositoryConstraint;

  constructor(constraint: TerminologyRepositoryConstraint, cause?: unknown) {
    super("The terminology database operation failed.", { cause });
    this.name = "TerminologyRepositoryError";
    this.stack = undefined;
    this.constraint = constraint;
  }
}

export type TerminologyRepositoryFilters = {
  readonly surface?: string;
  readonly reading?: string;
  readonly category?: string;
  readonly status?: TerminologyTerm["status"];
};

export type TerminologyRepositoryInsert = Pick<
  TerminologyTerm,
  | "termId"
  | "surface"
  | "normalizedSurface"
  | "readingKatakana"
  | "category"
  | "priority"
  | "notes"
  | "status"
  | "createdAt"
  | "updatedAt"
>;

export type TerminologyRepositoryUpdate = Pick<
  TerminologyTerm,
  | "surface"
  | "normalizedSurface"
  | "readingKatakana"
  | "category"
  | "priority"
  | "notes"
  | "status"
  | "updatedAt"
>;

type TerminologyDatabase = WorkspaceDatabase;

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

function uniqueConstraintFor(
  error: unknown
): TerminologyRepositoryConstraint | undefined {
  const code = getSqliteErrorCode(error);
  const message = getSqliteErrorMessage(error);
  if (
    code !== "SQLITE_CONSTRAINT_UNIQUE" &&
    code !== "SQLITE_CONSTRAINT_PRIMARYKEY" &&
    code !== "SQLITE_CONSTRAINT"
  ) {
    return undefined;
  }

  if (
    message.includes("terminology_terms.normalized_surface") ||
    message.includes("terminology_terms_surface_uq")
  ) {
    return "surface";
  }

  if (message.includes("terminology_terms.term_id")) {
    return "termId";
  }

  return "unknown";
}

function toTerm(row: typeof terminologyTerms.$inferSelect): TerminologyTerm {
  return terminologyTermSchema.parse({
    termId: row.termId,
    surface: row.surface,
    normalizedSurface: row.normalizedSurface,
    readingKatakana: row.readingKatakana,
    category: row.category,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  });
}

function databaseError(error: unknown): TerminologyRepositoryError {
  return new TerminologyRepositoryError(
    uniqueConstraintFor(error) ?? "unknown",
    error
  );
}

function withDatabaseErrors<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof TerminologyRepositoryError) {
      throw error;
    }
    throw databaseError(error);
  }
}

export class TerminologyRepository {
  private readonly database: TerminologyDatabase;

  constructor(database: TerminologyDatabase) {
    this.database = database;
  }

  list(filters: TerminologyRepositoryFilters = {}): TerminologyTerm[] {
    return withDatabaseErrors(() => {
      const conditions: SQL[] = [];
      if (filters.surface !== undefined) {
        conditions.push(
          sql`instr(${terminologyTerms.surface}, ${filters.surface}) > 0`
        );
      }
      if (filters.reading !== undefined) {
        conditions.push(
          sql`instr(${terminologyTerms.readingKatakana}, ${filters.reading}) > 0`
        );
      }
      if (filters.category !== undefined) {
        conditions.push(eq(terminologyTerms.category, filters.category));
      }
      if (filters.status !== undefined) {
        conditions.push(eq(terminologyTerms.status, filters.status));
      }

      const rows = this.database
        .select()
        .from(terminologyTerms)
        .where(conditions.length === 0 ? undefined : and(...conditions))
        .orderBy(
          asc(terminologyTerms.normalizedSurface),
          asc(terminologyTerms.termId)
        )
        .all();
      return rows.map(toTerm);
    });
  }

  findById(termId: string): TerminologyTerm | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(terminologyTerms)
        .where(eq(terminologyTerms.termId, termId))
        .get();
      return row === undefined ? undefined : toTerm(row);
    });
  }

  findByNormalizedSurface(
    normalizedSurface: string
  ): TerminologyTerm | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .select()
        .from(terminologyTerms)
        .where(eq(terminologyTerms.normalizedSurface, normalizedSurface))
        .get();
      return row === undefined ? undefined : toTerm(row);
    });
  }

  insert(values: TerminologyRepositoryInsert): TerminologyTerm {
    return withDatabaseErrors(() => {
      const row = this.database
        .insert(terminologyTerms)
        .values(values)
        .returning()
        .get();
      if (row === undefined) {
        throw new TerminologyRepositoryError("unknown");
      }
      return toTerm(row);
    });
  }

  update(
    termId: string,
    values: TerminologyRepositoryUpdate
  ): TerminologyTerm | undefined {
    return withDatabaseErrors(() => {
      const row = this.database
        .update(terminologyTerms)
        .set({
          surface: values.surface,
          normalizedSurface: values.normalizedSurface,
          readingKatakana: values.readingKatakana,
          category: values.category,
          priority: values.priority,
          notes: values.notes,
          status: values.status,
          updatedAt: values.updatedAt
        })
        .where(eq(terminologyTerms.termId, termId))
        .returning()
        .get();
      return row === undefined ? undefined : toTerm(row);
    });
  }

  transaction<T>(operation: (repository: TerminologyRepository) => T): T {
    try {
      return this.database.transaction((transaction) =>
        operation(
          new TerminologyRepository(
            transaction as unknown as TerminologyDatabase
          )
        )
      );
    } catch (error) {
      if (error instanceof TerminologyRepositoryError) {
        throw error;
      }
      throw error;
    }
  }
}
