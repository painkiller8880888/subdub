export type InsertTextTemplateRepositoryConstraint = "templateId" | "unknown";

export class InsertTextTemplateRepositoryError extends Error {
  readonly constraint: InsertTextTemplateRepositoryConstraint;
  readonly cause: unknown;

  constructor(
    constraint: InsertTextTemplateRepositoryConstraint,
    cause?: unknown
  ) {
    super(`insert text template repository error: ${constraint}`, { cause });
    this.name = "InsertTextTemplateRepositoryError";
    this.constraint = constraint;
    this.cause = cause;
  }
}

export class InsertTextTemplateNotFoundError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(`insert text template was not found: ${templateId}`);
    this.name = "InsertTextTemplateNotFoundError";
    this.templateId = templateId;
  }
}

export class InsertTextTemplateRevisionConflictError extends Error {
  readonly templateId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(
    templateId: string,
    expectedRevision: number,
    actualRevision: number
  ) {
    super(
      `insert text template revision conflict for ${templateId}: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "InsertTextTemplateRevisionConflictError";
    this.templateId = templateId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}
