export type ScreenTemplateRepositoryConstraint =
  "templateId" | "elementId" | "unknown";

export class ScreenTemplateRepositoryError extends Error {
  readonly constraint: ScreenTemplateRepositoryConstraint;
  readonly cause: unknown;

  constructor(constraint: ScreenTemplateRepositoryConstraint, cause?: unknown) {
    super(`screen template repository error: ${constraint}`, { cause });
    this.name = "ScreenTemplateRepositoryError";
    this.constraint = constraint;
    this.cause = cause;
  }
}

export class ScreenTemplateNotFoundError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(`screen template was not found: ${templateId}`);
    this.name = "ScreenTemplateNotFoundError";
    this.templateId = templateId;
  }
}

export class ScreenTemplateRevisionConflictError extends Error {
  readonly templateId: string;
  readonly expectedRevision: number;
  readonly actualRevision: number;

  constructor(
    templateId: string,
    expectedRevision: number,
    actualRevision: number
  ) {
    super(
      `screen template revision conflict for ${templateId}: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "ScreenTemplateRevisionConflictError";
    this.templateId = templateId;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class ScreenTemplateInactiveError extends Error {
  readonly templateId: string;

  constructor(templateId: string) {
    super(`screen template is inactive: ${templateId}`);
    this.name = "ScreenTemplateInactiveError";
    this.templateId = templateId;
  }
}
