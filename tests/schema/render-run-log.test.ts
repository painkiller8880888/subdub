import { describe, expect, it } from "vitest";

import { renderRunLogSchema } from "../../src/schema/index.js";

const queuedLog = {
  runId: "run-1",
  projectId: "project-1",
  kind: "mp4" as const,
  projectRevision: 3,
  queuedAt: "2026-08-11T00:00:00.000Z",
  status: "queued" as const,
  startedAt: null,
  completedAt: null
};

describe("renderRunLogSchema", () => {
  it("accepts the queued, running, succeeded, and failed variants", () => {
    expect(renderRunLogSchema.parse(queuedLog).status).toBe("queued");
    expect(
      renderRunLogSchema.parse({
        ...queuedLog,
        status: "running",
        startedAt: "2026-08-11T00:00:01.000Z"
      }).status
    ).toBe("running");
    expect(
      renderRunLogSchema.parse({
        ...queuedLog,
        status: "succeeded",
        startedAt: "2026-08-11T00:00:01.000Z",
        completedAt: "2026-08-11T00:00:02.000Z",
        outputPath: "output/render-run-1.mp4",
        outputChecksum: "a".repeat(64)
      }).status
    ).toBe("succeeded");
    expect(
      renderRunLogSchema.parse({
        ...queuedLog,
        status: "failed",
        completedAt: "2026-08-11T00:00:02.000Z",
        errorCode: "MP4_RENDER_FAILED"
      }).status
    ).toBe("failed");
  });

  it("strictly couples output fields to succeeded and error fields to failed", () => {
    expect(() =>
      renderRunLogSchema.parse({
        ...queuedLog,
        outputPath: "output/render-run-1.mp4",
        outputChecksum: "a".repeat(64)
      })
    ).toThrow();
    expect(() =>
      renderRunLogSchema.parse({
        ...queuedLog,
        status: "failed",
        completedAt: "2026-08-11T00:00:02.000Z",
        errorCode: "MP4_RENDER_FAILED",
        outputPath: "output/render-run-1.mp4"
      })
    ).toThrow();
    expect(() =>
      renderRunLogSchema.parse({ ...queuedLog, extra: true })
    ).toThrow();
  });
});
