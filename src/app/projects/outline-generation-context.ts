export const OUTLINE_GENERATION_RESERVED_OUTPUT_TOKENS = 4096;
export const OUTLINE_GENERATION_CONTEXT_ESTIMATE_METHOD =
  "UTF-8 bytes: ASCII bytes / 4 plus non-ASCII UTF-8 bytes / 2, rounded up; message framing and reserved output are added. This is a conservative estimate, not a model tokenizer.";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function estimateUtf8TokenCount(value: string): number {
  let asciiBytes = 0;
  let nonAsciiBytes = 0;

  for (const character of value) {
    const bytes = utf8ByteLength(character);
    if (bytes === 1) {
      asciiBytes += 1;
    } else {
      nonAsciiBytes += bytes;
    }
  }

  return Math.max(
    1,
    Math.ceil(asciiBytes / 4 + nonAsciiBytes / 2)
  );
}

export type OutlineGenerationContextEstimateInput = {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly jsonSchema: unknown;
  readonly reservedOutputTokens?: number;
};

export type OutlineGenerationContextEstimate = {
  readonly systemPromptTokens: number;
  readonly userPromptTokens: number;
  readonly jsonSchemaTokens: number;
  readonly messageFramingTokens: number;
  readonly reservedOutputTokens: number;
  readonly estimatedTokens: number;
};

export function estimateOutlineGenerationContext(
  input: OutlineGenerationContextEstimateInput
): OutlineGenerationContextEstimate {
  const systemPromptTokens = estimateUtf8TokenCount(input.systemPrompt);
  const userPromptTokens = estimateUtf8TokenCount(input.userPrompt);
  const jsonSchemaTokens = estimateUtf8TokenCount(
    JSON.stringify(input.jsonSchema)
  );
  const messageFramingTokens = 32;
  const reservedOutputTokens =
    input.reservedOutputTokens ?? OUTLINE_GENERATION_RESERVED_OUTPUT_TOKENS;

  return {
    systemPromptTokens,
    userPromptTokens,
    jsonSchemaTokens,
    messageFramingTokens,
    reservedOutputTokens,
    estimatedTokens:
      systemPromptTokens +
      userPromptTokens +
      jsonSchemaTokens +
      messageFramingTokens +
      reservedOutputTokens
  };
}
