import { describe, expect, it } from "vitest";

import { runLogSchema } from "../../src/schema/index.js";

const hash = "a".repeat(64);
const timestamp = "2026-08-11T00:00:00.000Z";

const privacy = {
  execution: "local" as const,
  dataCollection: null,
  zdr: null,
  providerFallbacks: null
};

function common(status: "queued" | "running" | "succeeded" | "failed") {
  return {
    runId: "run-1",
    projectId: "project-1",
    projectRevision: 3,
    queuedAt: timestamp,
    startedAt: status === "queued" ? null : timestamp,
    finishedAt:
      status === "succeeded" || status === "failed" ? timestamp : null,
    status,
    inputHash: hash,
    model: null,
    engine: "Remotion",
    privacy,
    outputs: [],
    errorCode: status === "failed" ? "RENDER_FAILED" : null,
    kind: "render" as const,
    renderKind: "mp4" as const
  };
}

describe("runLogSchema", () => {
  it("accepts every common kind and status with their strict fields", () => {
    const voiceBase = { ...common("queued") };
    Reflect.deleteProperty(voiceBase, "renderKind");
    expect(
      runLogSchema.parse({
        ...voiceBase,
        kind: "voice",
        engine: "VOICEVOX",
        engineVersion: "fixture-1",
        targetCount: 0,
        generatedCount: 0,
        noOp: true,
        lineFailures: []
      }).kind
    ).toBe("voice");
    const manifestBase = { ...common("running") };
    Reflect.deleteProperty(manifestBase, "renderKind");
    expect(
      runLogSchema.parse({
        ...manifestBase,
        kind: "manifest",
        engine: "RenderManifestCompiler",
        reused: false
      }).status
    ).toBe("running");
    const aiBase = { ...common("succeeded") };
    Reflect.deleteProperty(aiBase, "renderKind");
    const aiLog = {
      ...aiBase,
      kind: "ai" as const,
      engine: null,
      model: "fixture/model",
      taskKind: "visual_search_intent" as const,
      sourceHash: hash,
      modelId: "fixture/model",
      modelSelectionSource: "default" as const,
      responseModel: "fixture/model",
      provider: "fixture-provider",
      zdr: true,
      dataCollection: "deny" as const,
      providerFallbacks: true as const,
      responseTimeMs: 10,
      httpAttemptCount: 1,
      promptTokens: 2,
      completionTokens: 3,
      totalTokens: 5,
      costCredits: 0.25,
      schemaValidation: "passed" as const,
      imageInput: false,
      tools: false,
      outputs: [{ checksum: hash }]
    };
    expect(runLogSchema.parse(aiLog).status).toBe("succeeded");
    expect(
      runLogSchema.parse({ ...aiLog, taskKind: "outline_generation" })
    ).toMatchObject({ taskKind: "outline_generation" });
    expect(runLogSchema.parse(common("failed")).errorCode).toBe(
      "RENDER_FAILED"
    );
  });

  it("enforces status invariants, normalized hashes, paths, and strict fields", () => {
    expect(() =>
      runLogSchema.parse({
        ...common("queued"),
        outputs: [{ checksum: hash }]
      })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({ ...common("running"), startedAt: null })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({ ...common("succeeded"), errorCode: "RENDER_FAILED" })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({ ...common("failed"), errorCode: "Error: secret" })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({
        ...common("succeeded"),
        inputHash: hash.toUpperCase()
      })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({
        ...common("succeeded"),
        outputs: [{ path: "C:\\workspace\\secret.mp4", checksum: hash }]
      })
    ).toThrow();
    expect(() =>
      runLogSchema.parse({ ...common("running"), unexpected: true })
    ).toThrow();
  });
});
