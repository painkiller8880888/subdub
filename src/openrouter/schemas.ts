import { z } from "zod";

const priceStringSchema = z.string().min(1);

const openRouterPricingTierSchema = z
  .object({
    prompt: priceStringSchema,
    completion: priceStringSchema
  })
  .passthrough();

const openRouterPricingSchema = z.union([
  openRouterPricingTierSchema,
  z.array(openRouterPricingTierSchema).min(1)
]);

const openRouterArchitectureSchema = z
  .object({
    output_modalities: z.array(z.string())
  })
  .passthrough();

export const openRouterModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    context_length: z.number().int().positive(),
    pricing: openRouterPricingSchema,
    architecture: openRouterArchitectureSchema,
    supported_parameters: z.array(z.string()),
    expiration_date: z
      .string()
      .min(1)
      .nullable()
      .refine(
        (value) => value === null || !Number.isNaN(Date.parse(value)),
        "expiration_date must be a valid date"
      )
  })
  .passthrough();

export const openRouterModelsResponseSchema = z
  .object({
    data: z.array(openRouterModelSchema)
  })
  .passthrough();

export const openRouterZdrEndpointSchema = z
  .object({
    model_id: z.string().min(1),
    supported_parameters: z.array(z.string())
  })
  .passthrough();

export const openRouterZdrEndpointsResponseSchema = z
  .object({
    data: z.array(openRouterZdrEndpointSchema)
  })
  .passthrough();

export const openRouterChatCompletionResponseSchema = z
  .object({
    model: z.string().min(1).optional(),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullable().optional(),
            message: z
              .object({
                content: z.unknown()
              })
              .passthrough()
          })
          .passthrough()
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        total_tokens: z.number().int().nonnegative().optional()
      })
      .passthrough()
      .optional(),
    openrouter_metadata: z.unknown().optional()
  })
  .passthrough();

export type OpenRouterModelResponse = z.infer<typeof openRouterModelSchema>;
export type OpenRouterZdrEndpoint = z.infer<typeof openRouterZdrEndpointSchema>;
export type OpenRouterChatCompletionResponse = z.infer<
  typeof openRouterChatCompletionResponseSchema
>;
