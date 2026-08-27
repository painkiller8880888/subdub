import { z } from "zod";

import { strictObject } from "./primitives.js";

export const previewPresetSchema = z.enum(["sd", "hd", "fhd"]);

export const previewPresetDefinitions = [
  { preset: "sd", width: 854, height: 480 },
  { preset: "hd", width: 1280, height: 720 },
  { preset: "fhd", width: 1920, height: 1080 }
] as const satisfies readonly {
  readonly preset: PreviewPreset;
  readonly width: number;
  readonly height: number;
}[];

export const renderProfileSchema = z.discriminatedUnion("kind", [
  strictObject({ kind: z.literal("production") }),
  strictObject({
    kind: z.literal("preview"),
    previewPreset: previewPresetSchema
  })
]);

export type PreviewPreset = z.infer<typeof previewPresetSchema>;
export type RenderProfile = z.infer<typeof renderProfileSchema>;

export const productionRenderProfile: RenderProfile = {
  kind: "production"
};

export function getPreviewPresetDefinition(
  preset: PreviewPreset
): (typeof previewPresetDefinitions)[number] {
  const definition = previewPresetDefinitions.find(
    (candidate) => candidate.preset === preset
  );
  if (definition === undefined) {
    throw new Error(`Unknown preview preset: ${preset}`);
  }
  return definition;
}
