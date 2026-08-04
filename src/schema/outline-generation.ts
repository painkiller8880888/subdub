import { z } from "zod";

import { sectionRoleSchema } from "./common.js";
import { positiveIntegerSchema } from "./primitives.js";

// This is intentionally separate from Outline. The model must not be able to
// choose project IDs, revisions, hashes, statuses, or run IDs.
export const outlineGenerationSourceRefSchema = z.object({
  headingPath: z.array(z.string().min(1))
});

export const outlineGenerationQuestionSchema = z.object({
  question: z.string().min(1)
});

export const outlineGenerationSectionSchema = z.object({
  role: sectionRoleSchema,
  title: z.string().min(1),
  overview: z.string(),
  keyPoints: z.array(z.string()),
  targetDurationSec: positiveIntegerSchema,
  sourceRefs: z.array(outlineGenerationSourceRefSchema),
  openQuestions: z.array(outlineGenerationQuestionSchema)
});

export const outlineGenerationCandidateSchema = z.object({
  openQuestions: z.array(outlineGenerationQuestionSchema),
  sections: z.array(outlineGenerationSectionSchema)
});

export type OutlineGenerationCandidate = z.infer<
  typeof outlineGenerationCandidateSchema
>;

export const outlineGenerationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["openQuestions", "sections"],
  properties: {
    openQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question"],
        properties: {
          question: { type: "string", minLength: 1 }
        }
      }
    },
    sections: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "role",
          "title",
          "overview",
          "keyPoints",
          "targetDurationSec",
          "sourceRefs",
          "openQuestions"
        ],
        properties: {
          role: { type: "string", enum: ["intro", "main", "outro"] },
          title: { type: "string", minLength: 1 },
          overview: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
          targetDurationSec: { type: "integer", exclusiveMinimum: 0 },
          sourceRefs: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["headingPath"],
              properties: {
                headingPath: {
                  type: "array",
                  items: { type: "string", minLength: 1 }
                }
              }
            }
          },
          openQuestions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["question"],
              properties: {
                question: { type: "string", minLength: 1 }
              }
            }
          }
        }
      }
    }
  }
} as const;
