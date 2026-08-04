export const openRouterModelsFixture = {
  data: [
    {
      id: "eligible/model",
      name: "Eligible Model",
      context_length: 131072,
      pricing: {
        prompt: "0.000001234567890123",
        completion: "0.000009876543210987",
        image: "0",
        request: "0"
      },
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
        modality: "text->text"
      },
      supported_parameters: ["max_tokens", "structured_outputs"],
      expiration_date: null,
      unknown_field: { allowed: true }
    },
    {
      id: "image-only/model",
      name: "Image Only Model",
      context_length: 8192,
      pricing: { prompt: "0.1", completion: "0.2" },
      architecture: { output_modalities: ["image"] },
      supported_parameters: ["structured_outputs"],
      expiration_date: null
    },
    {
      id: "no-structured/model",
      name: "No Structured Model",
      context_length: 8192,
      pricing: { prompt: "0.1", completion: "0.2" },
      architecture: { output_modalities: ["text"] },
      supported_parameters: ["max_tokens"],
      expiration_date: null
    },
    {
      id: "expired/model",
      name: "Expired Model",
      context_length: 8192,
      pricing: { prompt: "0.1", completion: "0.2" },
      architecture: { output_modalities: ["text"] },
      supported_parameters: ["structured_outputs"],
      expiration_date: "2026-08-03T23:59:59.000Z"
    }
  ]
} as const;

export const openRouterZdrFixture = {
  data: [
    {
      model_id: "eligible/model",
      provider_name: "Fixture Provider",
      supported_parameters: ["structured_outputs"],
      unknown_field: "allowed"
    }
  ]
} as const;
