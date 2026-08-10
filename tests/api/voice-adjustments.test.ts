import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  voiceAdjustmentSnapshotResponseSchema,
  voiceAdjustmentStatusSchema
} from "../../src/schema/api.js";
import type { VoicevoxAdjustmentServicePort } from "../../src/app/voicevox/adjustment-service.js";
import { createVoicevoxAudioQueryFixture } from "../fixtures/voicevox.js";
import { syntheticVoicevoxStyleId } from "../fixtures/voicevox.js";

const fixtureStyleId = syntheticVoicevoxStyleId();

const snapshot = {
  lineId: "line-one",
  status: "current" as const,
  query: createVoicevoxAudioQueryFixture(),
  adjustment: null,
  currentBase: {
    baseHash: "a".repeat(64),
    resolvedSpokenText: "テストです。",
    speakerUuid: "speaker-fixture-uuid",
    styleName: "ノーマル",
    resolvedStyleId: fixtureStyleId,
    voicevoxEngineVersion: "engine-fixture-1"
  }
};

function serviceStub(
  overrides: Partial<VoicevoxAdjustmentServicePort> = {}
): VoicevoxAdjustmentServicePort {
  return {
    get: async () => snapshot,
    save: async () => snapshot,
    preview: async () => ({ previewId: "preview-one" }),
    readPreview: async () => new Uint8Array([1, 2, 3]),
    discard: async () => undefined,
    resetAll: async () => ({
      projectId: "project-one",
      resetLineIds: ["line-one"]
    }),
    ...overrides
  };
}

describe("voice adjustment API", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("serves the current query and rejects unknown request keys", async () => {
    const app = buildApp({ voiceAdjustmentService: serviceStub() });
    apps.push(app);

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/projects/project-one/voice/adjustments/line-one"
    });
    expect(getResponse.statusCode).toBe(200);
    expect(
      voiceAdjustmentSnapshotResponseSchema.parse(getResponse.json()).data
    ).toEqual(snapshot);
    expect(voiceAdjustmentStatusSchema.parse(snapshot.status)).toBe("current");

    const invalidSave = await app.inject({
      method: "PUT",
      url: "/api/projects/project-one/voice/adjustments/line-one",
      payload: {
        adjustment: {
          adjustmentVersion: "1.0.0",
          lineId: "line-one",
          base: snapshot.currentBase,
          scalarOverrides: {},
          accentPhrases: null,
          editedAt: "2026-08-10T00:00:00.000Z"
        },
        unexpected: true
      }
    });
    expect(invalidSave.statusCode).toBe(422);
  });

  it("keeps preview bytes separate from adjustment mutations", async () => {
    const app = buildApp({ voiceAdjustmentService: serviceStub() });
    apps.push(app);

    const preview = await app.inject({
      method: "POST",
      url: "/api/projects/project-one/voice/adjustments/line-one/preview",
      payload: { query: snapshot.query }
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toEqual({ data: { previewId: "preview-one" } });

    const wav = await app.inject({
      method: "GET",
      url: "/api/projects/project-one/voice/adjustments/line-one/preview/preview-one"
    });
    expect(wav.statusCode).toBe(200);
    expect(wav.headers["content-type"]).toContain("audio/wav");
    expect([...wav.rawPayload]).toEqual([1, 2, 3]);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/projects/project-one/voice/adjustments/line-one"
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toEqual({ data: { lineId: "line-one" } });

    const reset = await app.inject({
      method: "DELETE",
      url: "/api/projects/project-one/voice/adjustments"
    });
    expect(reset.statusCode).toBe(200);
    expect(reset.json()).toEqual({
      data: { projectId: "project-one", resetLineIds: ["line-one"] }
    });
  });

  it("does not expose internal errors or paths", async () => {
    const app = buildApp({
      voiceAdjustmentService: serviceStub({
        get: async () => {
          throw new Error("C:\\secret\\voice-adjustments\\line-one.json");
        }
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/projects/project-one/voice/adjustments/line-one"
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("stack");
  });
});
