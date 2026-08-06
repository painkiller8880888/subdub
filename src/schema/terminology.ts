import { z } from "zod";

import {
  finiteNumberSchema,
  idSchema,
  isoUtcDateTimeSchema,
  strictObject
} from "./primitives.js";

export const terminologyStatusSchema = z.enum(["active", "inactive"]);

export const terminologyCategorySuggestions = [
  "person",
  "department",
  "system",
  "product",
  "location",
  "operation",
  "other"
] as const;

const terminologyReadingPattern = /^[\u30a1-\u30fa\u30fd-\u30ffー・ \u3000]+$/u;

export function normalizeTerminologySurface(value: string): string {
  return value.normalize("NFC").trim();
}

export function normalizeTerminologyReading(value: string): string {
  return value.normalize("NFC").trim();
}

export function normalizeTerminologySearchValue(
  value: string
): string | undefined {
  const normalized = value.normalize("NFC").trim();
  return normalized.length === 0 ? undefined : normalized;
}

export function isTerminologyReadingKatakana(value: string): boolean {
  const normalized = normalizeTerminologyReading(value);
  return normalized.length > 0 && terminologyReadingPattern.test(normalized);
}

export const terminologySurfaceInputSchema = z
  .string()
  .transform(normalizeTerminologySurface)
  .refine((value) => value.length > 0, "表記は必須です。");

export const terminologyReadingInputSchema = z
  .string()
  .transform(normalizeTerminologyReading)
  .refine((value) => value.length > 0, "読みは必須です。")
  .refine(
    isTerminologyReadingKatakana,
    "読みは全角カタカナで入力してください。"
  );

export const terminologyCategoryInputSchema = z
  .string()
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, "カテゴリは必須です。");

export const terminologyTermSchema = strictObject({
  termId: idSchema,
  surface: z.string().min(1),
  normalizedSurface: z.string().min(1),
  readingKatakana: z.string().min(1),
  category: z.string().min(1),
  priority: finiteNumberSchema.int(),
  notes: z.string(),
  status: terminologyStatusSchema,
  createdAt: isoUtcDateTimeSchema,
  updatedAt: isoUtcDateTimeSchema
});

export type TerminologyStatus = z.infer<typeof terminologyStatusSchema>;
export type TerminologyTerm = z.infer<typeof terminologyTermSchema>;
