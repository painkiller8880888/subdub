export type TerminologyErrorCode =
  "TERMINOLOGY_NOT_FOUND" | "TERMINOLOGY_DUPLICATE";

export class TerminologyNotFoundError extends Error {
  readonly code = "TERMINOLOGY_NOT_FOUND" as const;
  readonly status = 404 as const;

  constructor() {
    super("The terminology term does not exist.");
    this.name = "TerminologyNotFoundError";
    this.stack = undefined;
  }
}

export class TerminologyDuplicateError extends Error {
  readonly code = "TERMINOLOGY_DUPLICATE" as const;
  readonly status = 409 as const;
  readonly existingTermId: string | undefined;

  constructor(existingTermId?: string) {
    super("The normalized terminology surface already exists.");
    this.name = "TerminologyDuplicateError";
    this.stack = undefined;
    this.existingTermId = existingTermId;
  }
}
