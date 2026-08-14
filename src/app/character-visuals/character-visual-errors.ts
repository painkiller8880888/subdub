export type CharacterVisualRepositoryConstraint =
  "visualId" | "variantId" | "libraryPath" | "unknown";

export class CharacterVisualRepositoryError extends Error {
  readonly code = "CHARACTER_VISUAL_REPOSITORY_ERROR" as const;
  readonly constraint: CharacterVisualRepositoryConstraint;

  constructor(
    constraint: CharacterVisualRepositoryConstraint = "unknown",
    cause?: unknown
  ) {
    super("The character visual database operation failed.", { cause });
    this.name = "CharacterVisualRepositoryError";
    this.stack = undefined;
    this.constraint = constraint;
  }
}

export class CharacterVisualValidationError extends Error {
  readonly code = "CHARACTER_VISUAL_VALIDATION_ERROR" as const;

  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CharacterVisualValidationError";
    this.stack = undefined;
  }
}

export class CharacterVisualSeedConflictError extends Error {
  readonly code = "CHARACTER_VISUAL_SEED_CONFLICT" as const;

  constructor(message: string) {
    super(message);
    this.name = "CharacterVisualSeedConflictError";
    this.stack = undefined;
  }
}
