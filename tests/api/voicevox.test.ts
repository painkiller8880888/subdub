import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { API_ERROR_CODE } from "../../src/api/errors/api-error.js";
import {
  apiErrorResponseSchema,
  voicevoxStatusResponseSchema
} from "../../src/schema/api.js";
import type { VoicevoxStatusServicePort } from "../../src/api/routes/voicevox.js";
import { createVoicevoxSpeakersFixture } from "../fixtures/voicevox.js";
import { VoicevoxStatusService } from "../../src/voicevox/service.js";
import {
  VoicevoxAdapterError,
  VOICEVOX_ERROR_CODE
} from "../../src/voicevox/errors.js";
import { mapApiError } from "../../src/api/errors/api-error.js";

function availableService(): VoicevoxStatusServicePort {
  const speakers = createVoicevoxSpeakersFixture();
  return new VoicevoxStatusService({
    client: {
      getSpeakers: async () => speakers
    }
  });
}

describe("VOICEVOX status API", () => {
  const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("returns both runtime-resolved speakers and style IDs", async () => {
    const app = buildApp({ voicevoxService: availableService() });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/voicevox/status"
    });

    expect(response.statusCode).toBe(200);
    const parsed = voicevoxStatusResponseSchema.parse(response.json());
    expect(parsed.data.available).toBe(true);
    expect(parsed.data.speakers).toHaveLength(2);
    expect(parsed.data.speakers.map((speaker) => speaker.speakerName)).toEqual([
      "四国めたん",
      "ずんだもん"
    ]);
  });

  it("returns a safe non-500 unavailable response", async () => {
    const app = buildApp({
      voicevoxService: {
        getStatus: async () => ({
          available: false as const,
          reason: "VOICEVOX_CONNECTION_FAILED" as const
        })
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/voicevox/status"
    });

    expect(response.statusCode).toBe(503);
    const error = apiErrorResponseSchema.parse(response.json()).error;
    expect(error.code).toBe(API_ERROR_CODE.voicevoxUnavailable);
    expect(error.message).toBe("VOICEVOX audio is unavailable.");
    expect(JSON.stringify(response.json())).not.toContain(
      "VOICEVOX_CONNECTION_FAILED"
    );
    expect(JSON.stringify(response.json())).not.toContain("stack");
    expect(JSON.stringify(response.json())).not.toContain(
      "VOICEVOX_ENGINE_URL"
    );
  });

  it("maps adapter errors to the same safe unavailable API state", () => {
    expect(
      mapApiError(
        new VoicevoxAdapterError(VOICEVOX_ERROR_CODE.responseInvalidJson)
      )
    ).toMatchObject({
      code: API_ERROR_CODE.voicevoxUnavailable,
      status: 503,
      shouldLog: false
    });
  });

  it("keeps health available and does not call an injected voice service for health", async () => {
    let calls = 0;
    const app = buildApp({
      voicevoxService: {
        getStatus: async () => {
          calls += 1;
          return {
            available: false as const,
            reason: "VOICEVOX_TIMEOUT" as const
          };
        }
      }
    });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ data: { status: "ok" } });
    expect(calls).toBe(0);
  });
});
