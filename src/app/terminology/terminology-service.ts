import { randomUUID } from "node:crypto";

import {
  terminologyCreateRequestSchema,
  terminologyListQuerySchema,
  terminologyPreviewRequestSchema,
  terminologyUpdateRequestSchema
} from "../../schema/api.js";
import { idSchema, type TerminologyTerm } from "../../schema/index.js";
import {
  TerminologyDuplicateError,
  TerminologyNotFoundError
} from "./terminology-errors.js";
import {
  TerminologyRepository,
  TerminologyRepositoryError,
  type TerminologyRepositoryInsert,
  type TerminologyRepositoryUpdate
} from "./terminology-repository.js";
import {
  resolveSpokenText,
  type ResolvedSpokenText
} from "./spoken-text-resolver.js";

export type TerminologyServiceOptions = {
  repository: TerminologyRepository;
  now?: () => Date;
  createId?: () => string;
  maxCreateAttempts?: number;
};

function isSurfaceConstraint(
  error: unknown
): error is TerminologyRepositoryError {
  return (
    error instanceof TerminologyRepositoryError &&
    error.constraint === "surface"
  );
}

function isTermIdConstraint(
  error: unknown
): error is TerminologyRepositoryError {
  return (
    error instanceof TerminologyRepositoryError && error.constraint === "termId"
  );
}

function throwDuplicate(term: TerminologyTerm | undefined): never {
  throw new TerminologyDuplicateError(term?.termId);
}

export class TerminologyService {
  private readonly repository: TerminologyRepository;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly maxCreateAttempts: number;

  constructor(options: TerminologyServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID().toLowerCase());
    this.maxCreateAttempts = Math.max(
      1,
      Math.floor(options.maxCreateAttempts ?? 5)
    );
  }

  list(input: unknown = {}): TerminologyTerm[] {
    const query = terminologyListQuerySchema.parse(input);
    return this.repository.list(query);
  }

  preview(input: unknown): ResolvedSpokenText {
    const request = terminologyPreviewRequestSchema.parse(input);
    const activeTerms = this.repository.list({ status: "active" });
    return resolveSpokenText({
      spokenText: request.spokenText,
      pronunciation: request.pronunciation,
      terms: activeTerms
    });
  }

  get(termId: unknown): TerminologyTerm {
    const safeTermId = idSchema.parse(termId);
    const term = this.repository.findById(safeTermId);
    if (term === undefined) {
      throw new TerminologyNotFoundError();
    }
    return term;
  }

  create(input: unknown): TerminologyTerm {
    const request = terminologyCreateRequestSchema.parse(input);
    let lastIdCollision: TerminologyRepositoryError | undefined;

    for (let attempt = 0; attempt < this.maxCreateAttempts; attempt += 1) {
      const termId = idSchema.parse(this.createId());
      const now = this.now().toISOString();

      try {
        return this.repository.transaction((repository) => {
          const existing = repository.findByNormalizedSurface(request.surface);
          if (existing !== undefined) {
            if (existing.status === "active") {
              throwDuplicate(existing);
            }

            return this.updateExisting(repository, existing, {
              surface: request.surface,
              normalizedSurface: request.surface,
              readingKatakana: request.readingKatakana,
              category: request.category,
              priority: request.priority,
              notes: request.notes,
              status: "active",
              updatedAt: now
            });
          }

          const values: TerminologyRepositoryInsert = {
            termId,
            surface: request.surface,
            normalizedSurface: request.surface,
            readingKatakana: request.readingKatakana,
            category: request.category,
            priority: request.priority,
            notes: request.notes,
            status: "active",
            createdAt: now,
            updatedAt: now
          };
          return repository.insert(values);
        });
      } catch (error) {
        if (isTermIdConstraint(error)) {
          lastIdCollision = error;
          continue;
        }
        if (isSurfaceConstraint(error)) {
          const existing = this.repository.findByNormalizedSurface(
            request.surface
          );
          if (existing !== undefined) {
            throwDuplicate(existing);
          }
        }
        throw error;
      }
    }

    if (lastIdCollision !== undefined) {
      throw lastIdCollision;
    }
    throw new Error("Terminology creation did not produce an ID.");
  }

  update(termId: unknown, input: unknown): TerminologyTerm {
    const safeTermId = idSchema.parse(termId);
    const request = terminologyUpdateRequestSchema.parse(input);
    const now = this.now().toISOString();

    try {
      return this.repository.transaction((repository) => {
        const existing = repository.findById(safeTermId);
        if (existing === undefined) {
          throw new TerminologyNotFoundError();
        }

        const duplicate = repository.findByNormalizedSurface(request.surface);
        if (duplicate !== undefined && duplicate.termId !== safeTermId) {
          throwDuplicate(duplicate);
        }

        return this.updateExisting(repository, existing, {
          surface: request.surface,
          normalizedSurface: request.surface,
          readingKatakana: request.readingKatakana,
          category: request.category,
          priority: request.priority,
          notes: request.notes,
          status: existing.status,
          updatedAt: now
        });
      });
    } catch (error) {
      if (isSurfaceConstraint(error)) {
        throwDuplicate(
          this.repository.findByNormalizedSurface(request.surface)
        );
      }
      throw error;
    }
  }

  deactivate(termId: unknown): TerminologyTerm {
    return this.changeStatus(termId, "inactive");
  }

  activate(termId: unknown): TerminologyTerm {
    return this.changeStatus(termId, "active");
  }

  private changeStatus(
    termId: unknown,
    status: TerminologyTerm["status"]
  ): TerminologyTerm {
    const safeTermId = idSchema.parse(termId);
    const now = this.now().toISOString();
    return this.repository.transaction((repository) => {
      const existing = repository.findById(safeTermId);
      if (existing === undefined) {
        throw new TerminologyNotFoundError();
      }
      if (existing.status === status) {
        return existing;
      }

      return this.updateExisting(repository, existing, {
        surface: existing.surface,
        normalizedSurface: existing.normalizedSurface,
        readingKatakana: existing.readingKatakana,
        category: existing.category,
        priority: existing.priority,
        notes: existing.notes,
        status,
        updatedAt: now
      });
    });
  }

  private updateExisting(
    repository: TerminologyRepository,
    existing: TerminologyTerm,
    values: TerminologyRepositoryUpdate
  ): TerminologyTerm {
    const updated = repository.update(existing.termId, values);
    if (updated === undefined) {
      throw new TerminologyNotFoundError();
    }
    return updated;
  }
}
