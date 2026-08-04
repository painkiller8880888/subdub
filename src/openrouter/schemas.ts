import { z } from "zod";

const decimalStringSchema = z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/);

const openRouterPricingSchema = z
  .object({
    prompt: decimalStringSchema,
    completion: decimalStringSchema
  })
  .passthrough();

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
    model_id: z.string().min(1)
  })
  .passthrough();

export const openRouterZdrEndpointsResponseSchema = z
  .object({
    data: z.array(openRouterZdrEndpointSchema)
  })
  .passthrough();

export type OpenRouterModelResponse = z.infer<typeof openRouterModelSchema>;
export type OpenRouterZdrEndpoint = z.infer<typeof openRouterZdrEndpointSchema>;
