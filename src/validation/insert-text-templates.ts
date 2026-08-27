import {
  insertTextTemplateSchema,
  type InsertTextTemplate
} from "../schema/insert-text-template.js";

export type InsertTextTemplateValidationIssue = Readonly<{
  path: readonly (string | number)[];
  message: string;
}>;

export class InsertTextTemplateValidationError extends Error {
  readonly issues: readonly InsertTextTemplateValidationIssue[];

  constructor(issues: readonly InsertTextTemplateValidationIssue[]) {
    super(
      issues.length === 0
        ? "insert text template validation failed"
        : issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")
    );
    this.name = "InsertTextTemplateValidationError";
    this.issues = issues;
  }
}

export function assertValidInsertTextTemplate(
  input: unknown
): InsertTextTemplate {
  const result = insertTextTemplateSchema.safeParse(input);
  if (!result.success) {
    throw new InsertTextTemplateValidationError(
      result.error.issues.map((issue) => ({
        path: issue.path.filter(
          (part): part is string | number =>
            typeof part === "string" || typeof part === "number"
        ),
        message: issue.message
      }))
    );
  }
  return result.data;
}
