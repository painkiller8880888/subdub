export type CharacterVisualRepositoryConstraint =
  "visualId" | "variantId" | "libraryPath" | "unknown";

export type CharacterVisualApiErrorCode =
  | "CHARACTER_VISUAL_NOT_FOUND"
  | "CHARACTER_VARIANT_NOT_FOUND"
  | "CHARACTER_VISUAL_UNSUPPORTED_FILE_TYPE"
  | "CHARACTER_VISUAL_INVALID_PNG"
  | "CHARACTER_VISUAL_MISSING_SLOT"
  | "CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH"
  | "CHARACTER_VISUAL_UNSAFE_PATH"
  | "CHARACTER_VISUAL_CONFLICT"
  | "CHARACTER_VISUAL_STORAGE_FAILED"
  | "CHARACTER_VISUAL_UPLOAD_INTERRUPTED";

export type CharacterVisualApiErrorStatus = 400 | 404 | 409 | 422 | 500;

export class CharacterVisualApiError extends Error {
  readonly code: CharacterVisualApiErrorCode;
  readonly status: CharacterVisualApiErrorStatus;
  readonly shouldLog: boolean;

  constructor(
    code: CharacterVisualApiErrorCode,
    status: CharacterVisualApiErrorStatus,
    message: string,
    options: { readonly shouldLog?: boolean; readonly cause?: unknown } = {}
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause }
    );
    this.name = "CharacterVisualApiError";
    this.code = code;
    this.status = status;
    this.shouldLog = options.shouldLog ?? status >= 500;
  }
}

export class CharacterVisualNotFoundError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_NOT_FOUND",
      404,
      "The character visual does not exist."
    );
    this.name = "CharacterVisualNotFoundError";
  }
}

export class CharacterVariantNotFoundError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VARIANT_NOT_FOUND",
      404,
      "The character visual variant does not exist."
    );
    this.name = "CharacterVariantNotFoundError";
  }
}

export class CharacterVisualUnsupportedFileTypeError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_UNSUPPORTED_FILE_TYPE",
      422,
      "Only PNG character visual files are supported."
    );
    this.name = "CharacterVisualUnsupportedFileTypeError";
  }
}

export class CharacterVisualInvalidPngError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_INVALID_PNG",
      422,
      "The uploaded file is not a valid transparent PNG."
    );
    this.name = "CharacterVisualInvalidPngError";
  }
}

export class CharacterVisualMissingSlotError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_MISSING_SLOT",
      422,
      "The variant does not contain exactly the required file slots."
    );
    this.name = "CharacterVisualMissingSlotError";
  }
}

export class CharacterVisualCanvasSizeMismatchError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH",
      422,
      "The uploaded canvas does not match the character visual canvas."
    );
    this.name = "CharacterVisualCanvasSizeMismatchError";
  }
}

export class CharacterVisualUnsafePathError extends CharacterVisualApiError {
  constructor(message = "The character visual path is not safe.") {
    super("CHARACTER_VISUAL_UNSAFE_PATH", 422, message);
    this.name = "CharacterVisualUnsafePathError";
  }
}

export class CharacterVisualConflictError extends CharacterVisualApiError {
  constructor(
    message = "The character visual registration conflicts with existing data."
  ) {
    super("CHARACTER_VISUAL_CONFLICT", 409, message);
    this.name = "CharacterVisualConflictError";
  }
}

export class CharacterVisualStorageError extends CharacterVisualApiError {
  constructor(cause?: unknown) {
    super(
      "CHARACTER_VISUAL_STORAGE_FAILED",
      500,
      "The character visual file operation failed.",
      { cause }
    );
    this.name = "CharacterVisualStorageError";
  }
}

export class CharacterVisualUploadInterruptedError extends CharacterVisualApiError {
  constructor() {
    super(
      "CHARACTER_VISUAL_UPLOAD_INTERRUPTED",
      400,
      "The character visual upload was interrupted."
    );
    this.name = "CharacterVisualUploadInterruptedError";
  }
}

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
