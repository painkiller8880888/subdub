import { describe, expect, it } from "vitest";

import {
  getPreviewPresetDefinition,
  previewPresetDefinitions,
  previewPresetSchema,
  renderProfileSchema
} from "../../src/schema/index.js";

describe("render profiles", () => {
  it("accepts only the fixed SD, HD, and FHD preview presets", () => {
    expect(previewPresetDefinitions).toEqual([
      { preset: "sd", width: 854, height: 480 },
      { preset: "hd", width: 1280, height: 720 },
      { preset: "fhd", width: 1920, height: 1080 }
    ]);
    expect(previewPresetSchema.safeParse("sd").success).toBe(true);
    expect(previewPresetSchema.safeParse("4k").success).toBe(false);
    expect(getPreviewPresetDefinition("fhd")).toEqual({
      preset: "fhd",
      width: 1920,
      height: 1080
    });
  });

  it("keeps preview profile data out of production profile values", () => {
    expect(renderProfileSchema.parse({ kind: "production" })).toEqual({
      kind: "production"
    });
    expect(
      renderProfileSchema.parse({
        kind: "preview",
        previewPreset: "hd"
      })
    ).toEqual({
      kind: "preview",
      previewPreset: "hd"
    });
    expect(() =>
      renderProfileSchema.parse({ kind: "preview", previewPreset: "4k" })
    ).toThrow();
    expect(() =>
      renderProfileSchema.parse({
        kind: "preview",
        previewPreset: "sd",
        width: 854
      })
    ).toThrow();
  });
});
