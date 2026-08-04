import { describe, expect, it } from "vitest";

import { resolveModel } from "../../src/openrouter/model-resolver.js";
import type { OpenRouterModelCapabilities } from "../../src/openrouter/model-service.js";

const NOW = new Date("2026-08-04T00:00:00.000Z");

const settings = {
  defaultModelId: "default/model",
  taskModelOverrides: { outline_generation: "task/model" },
  zdr: true,
  dataCollection: "deny",
  allowProviderFallbacks: true
} as const;

function model(
  id: string,
  overrides: Partial<OpenRouterModelCapabilities> = {}
): OpenRouterModelCapabilities {
  return {
    id,
    displayName: id,
    contextLength: 8192,
    inputPrice: "0.1",
    outputPrice: "0.2",
    outputModalities: ["text"],
    supportedParameters: ["structured_outputs"],
    expirationDate: null,
    structuredOutputs: true,
    zdrAvailable: true,
    ...overrides
  };
}

describe("OpenRouter model resolver", () => {
  it("resolves run, task, and default overrides in fixed order", () => {
    const models = [
      model("run/model"),
      model("task/model"),
      model("default/model")
    ];

    expect(
      resolveModel({
        settings,
        taskKind: "outline_generation",
        runOverride: "run/model",
        models,
        now: () => NOW
      })
    ).toMatchObject({ ok: true, modelId: "run/model", source: "run_override" });
    expect(
      resolveModel({
        settings,
        taskKind: "outline_generation",
        models,
        now: () => NOW
      })
    ).toMatchObject({
      ok: true,
      modelId: "task/model",
      source: "task_override"
    });
    expect(
      resolveModel({
        settings: { ...settings, taskModelOverrides: {} },
        taskKind: "outline_generation",
        models,
        now: () => NOW
      })
    ).toMatchObject({ ok: true, modelId: "default/model", source: "default" });
  });

  it("reports unselected, missing, unsupported, expired, and ZDR failures distinctly", () => {
    const baseInput = {
      taskKind: "outline_generation" as const,
      models: [
        model("textless/model", { outputModalities: ["image"] }),
        model("unstructured/model", { structuredOutputs: false }),
        model("expired/model", { expirationDate: "2026-08-03T00:00:00.000Z" }),
        model("zdr-missing/model", { zdrAvailable: false })
      ],
      now: () => NOW
    };

    expect(
      resolveModel({
        ...baseInput,
        settings: { ...settings, defaultModelId: null, taskModelOverrides: {} }
      })
    ).toEqual({ ok: false, reason: "MODEL_NOT_SELECTED" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "gone/model",
          taskModelOverrides: {}
        }
      })
    ).toEqual({ ok: false, reason: "MODEL_NOT_FOUND" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "textless/model",
          taskModelOverrides: {}
        }
      })
    ).toEqual({ ok: false, reason: "MODEL_TEXT_OUTPUT_UNSUPPORTED" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "unstructured/model",
          taskModelOverrides: {}
        }
      })
    ).toEqual({ ok: false, reason: "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "expired/model",
          taskModelOverrides: {}
        }
      })
    ).toEqual({ ok: false, reason: "MODEL_EXPIRED" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "zdr-missing/model",
          taskModelOverrides: {}
        }
      })
    ).toEqual({ ok: false, reason: "MODEL_ZDR_ENDPOINT_UNAVAILABLE" });
    expect(
      resolveModel({
        ...baseInput,
        settings: {
          ...settings,
          defaultModelId: "zdr-missing/model",
          taskModelOverrides: {},
          zdr: false
        }
      }).ok
    ).toBe(true);
  });
});
