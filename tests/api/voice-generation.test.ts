import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import {
  apiErrorResponseSchema,
  voiceGenerationAcceptedResponseSchema,
  voiceGenerationStatusResponseSchema
} from "../../src/schema/api.js";
import {
  VOICEVOX_GENERATION_ERROR_CODE,
  VoicevoxGenerationError
} from "../../src/app/voicevox/generation-service.js";

describe("project voice generation API", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("accepts explicit lines as an asynchronous job", async () => {
    const app = buildApp({
      voiceGenerationService: {
        generate: async (_projectId, input) => ({
          runId: "voice-run-1",
          status: "queued",
          lineIds: (input as { lineIds: string[] }).lineIds
        }),
        generateAll: async () => ({
          runId: "voice-run-2",
          status: "queued",
          lineIds: []
        }),
        getStatus: async () => ({
          available: true,
          lines: [
            { lineId: "line-one", status: "current" as const },
            {
              lineId: "line-two",
              status: "failed" as const,
              errorCode: "VOICEVOX_TIMEOUT"
            }
          ],
          jobs: []
        })
      }
    });
    apps.push(app);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/projects/project-one/voice/generate",
      payload: { lineIds: ["line-one"] }
    });

    expect(accepted.statusCode).toBe(202);
    expect(
      voiceGenerationAcceptedResponseSchema.parse(accepted.json())
    ).toEqual({
      data: { runId: "voice-run-1", status: "queued", lineIds: ["line-one"] }
    });
  });

  it("uses a strict empty request for generate-all and exposes safe status data", async () => {
    const app = buildApp({
      voiceGenerationService: {
        generate: async () => ({
          runId: "voice-run-1",
          status: "queued" as const,
          lineIds: []
        }),
        generateAll: async () => ({
          runId: "voice-run-2",
          status: "queued" as const,
          lineIds: ["line-two"]
        }),
        getStatus: async () => ({
          available: true,
          lines: [
            { lineId: "line-one", status: "current" as const },
            {
              lineId: "line-two",
              status: "failed" as const,
              errorCode: "VOICEVOX_TIMEOUT"
            }
          ],
          jobs: [
            {
              runId: "voice-run-2",
              status: "failed" as const,
              lineIds: ["line-two"],
              failedLineIds: ["line-two"]
            }
          ]
        })
      }
    });
    apps.push(app);

    const accepted = await app.inject({
      method: "POST",
      url: "/api/projects/project-one/voice/generate-all",
      payload: {}
    });
    const status = await app.inject({
      method: "GET",
      url: "/api/projects/project-one/voice/status"
    });

    expect(accepted.statusCode).toBe(202);
    expect(
      voiceGenerationAcceptedResponseSchema.parse(accepted.json()).data.lineIds
    ).toEqual(["line-two"]);
    expect(status.statusCode).toBe(200);
    expect(
      voiceGenerationStatusResponseSchema.parse(status.json()).data.lines[1]
    ).toEqual({
      lineId: "line-two",
      status: "failed",
      errorCode: "VOICEVOX_TIMEOUT"
    });
  });

  it("rejects unknown request keys and maps unavailable errors without internals", async () => {
    const app = buildApp({
      voiceGenerationService: {
        generate: async () => {
          throw new VoicevoxGenerationError(
            VOICEVOX_GENERATION_ERROR_CODE.unavailable,
            503,
            "internal engine path must not leak"
          );
        },
        generateAll: async () => ({
          runId: "voice-run-1",
          status: "queued" as const,
          lineIds: []
        }),
        getStatus: async () => ({ available: false, lines: [], jobs: [] })
      }
    });
    apps.push(app);

    const invalid = await app.inject({
      method: "POST",
      url: "/api/projects/project-one/voice/generate",
      payload: { lineIds: ["line-one"], force: true }
    });
    const unavailable = await app.inject({
      method: "POST",
      url: "/api/projects/project-one/voice/generate",
      payload: { lineIds: ["line-one"] }
    });

    expect(invalid.statusCode).toBe(422);
    expect(unavailable.statusCode).toBe(503);
    const error = apiErrorResponseSchema.parse(unavailable.json()).error;
    expect(error.code).toBe("VOICEVOX_UNAVAILABLE");
    expect(JSON.stringify(unavailable.json())).not.toContain(
      "internal engine path"
    );
    expect(JSON.stringify(unavailable.json())).not.toContain("stack");
  });
});
