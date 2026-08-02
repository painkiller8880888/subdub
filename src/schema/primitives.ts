import { z } from "zod";

const lowerKebabCasePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sha256Pattern = /^[0-9a-fA-F]{64}$/;
const controlCharacterPattern = /[\u0000-\u001F\u007F]/;

export const strictObject = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).strict();

export const idSchema = z
  .string()
  .regex(lowerKebabCasePattern, "must be a lower-kebab-case identifier");

export const isoUtcDateTimeSchema = z.iso.datetime({ offset: false });

export const sha256Schema = z
  .string()
  .regex(sha256Pattern, "must be a 64-character hexadecimal SHA-256 hash");

export const finiteNumberSchema = z.number().finite();
export const nonNegativeIntegerSchema = finiteNumberSchema
  .int()
  .nonnegative();
export const positiveIntegerSchema = finiteNumberSchema.int().positive();
export const positiveNumberSchema = finiteNumberSchema.positive();
export const unitIntervalSchema = finiteNumberSchema.min(0).max(1);
export const positiveUnitIntervalSchema = finiteNumberSchema.gt(0).max(1);

export const relativePosixPathSchema = z.string().superRefine((value, ctx) => {
  if (value.length === 0) {
    ctx.addIssue({ code: "custom", message: "path must not be empty" });
    return;
  }

  if (value.includes("\\")) {
    ctx.addIssue({
      code: "custom",
      message: "path must use POSIX separators"
    });
  }

  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) {
    ctx.addIssue({
      code: "custom",
      message: "path must be relative"
    });
  }

  if (controlCharacterPattern.test(value)) {
    ctx.addIssue({
      code: "custom",
      message: "path must not contain control characters"
    });
  }

  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0)) {
    ctx.addIssue({
      code: "custom",
      message: "path must be normalized"
    });
  }

  if (segments.some((segment) => segment === "." || segment === "..")) {
    ctx.addIssue({
      code: "custom",
      message: "path must not contain dot segments"
    });
  }
});
