import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../../src/api/app.js";
import { initializeServer } from "../../src/api/server.js";
import { ProjectRepository } from "../../src/app/projects/project-repository.js";
import { VoicevoxClient } from "../../src/voicevox/client.js";
import {
  apiErrorResponseSchema,
  voiceGenerationAcceptedResponseSchema,
  voiceGenerationStatusResponseSchema
} from "../../src/schema/api.js";
import {
  VOICEVOX_GENERATION_ERROR_CODE,
  VoicevoxGenerationError
} from "../../src/app/voicevox/generation-service.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxSpeakersFixture,
  createVoicevoxWavFixture,
  syntheticVoicevoxStyleId
} from "../fixtures/voicevox.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForProductionVoiceJob(
  app: Awaited<ReturnType<typeof initializeServer>>["app"],
  projectId: string,
  runId: string
): Promise<"succeeded" | "failed"> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectId}/voice/status`
    });
    const status = voiceGenerationStatusResponseSchema.parse(
      response.json()
    ).data;
    const job = status.jobs.find((candidate) => candidate.runId === runId);
    if (job?.status === "succeeded" || job?.status === "failed") {
      return job.status;
    }
    await nextTurn();
  }
  throw new Error(`voice job ${runId} did not finish`);
}

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

  it("uses persisted adjustments in the default server wiring", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-voice-generation-server-")
    );
    const projectRepository = new ProjectRepository({ workspaceRoot });
    const initialized = await initializeServer({
      workspaceRoot,
      projectRepository
    });
    const project = structuredClone(videoProjectFixture);
    const changedLine = project.script.sections[0]?.lines[0];
    if (changedLine === undefined) {
      throw new Error("fixture line is required");
    }
    const metanStyleId = syntheticVoicevoxStyleId();
    const zundamonStyleId = syntheticVoicevoxStyleId();

    const getSpeakers = vi
      .spyOn(VoicevoxClient.prototype, "getSpeakers")
      .mockResolvedValue(
        createVoicevoxSpeakersFixture({
          metanStyleId,
          zundamonStyleId
        })
      );
    const getVersion = vi
      .spyOn(VoicevoxClient.prototype, "getVersion")
      .mockResolvedValue("engine-fixture-1");
    const getAudioQuery = vi
      .spyOn(VoicevoxClient.prototype, "getAudioQuery")
      .mockResolvedValue(createVoicevoxAudioQueryFixture());
    const synthesize = vi
      .spyOn(VoicevoxClient.prototype, "synthesize")
      .mockResolvedValue(createVoicevoxWavFixture());

    try {
      await projectRepository.create(project);
      const acceptedResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/projects/${project.metadata.id}/voice/generate-all`,
        payload: {}
      });
      expect(acceptedResponse.statusCode).toBe(202);
      const accepted = voiceGenerationAcceptedResponseSchema.parse(
        acceptedResponse.json()
      ).data;
      await expect(
        waitForProductionVoiceJob(
          initialized.app,
          project.metadata.id,
          accepted.runId
        )
      ).resolves.toBe("succeeded");

      getAudioQuery.mockClear();
      synthesize.mockClear();
      const adjustmentDirectory = path.join(
        workspaceRoot,
        "projects",
        project.metadata.id,
        "voice-adjustments"
      );
      await fs.mkdir(adjustmentDirectory, { recursive: true });
      await fs.writeFile(
        path.join(adjustmentDirectory, `${changedLine.id}.json`),
        `${JSON.stringify({
          adjustmentVersion: "1.0.0",
          lineId: changedLine.id,
          base: {
            baseHash: "f".repeat(64),
            resolvedSpokenText: changedLine.spokenText,
            speakerUuid: "metan-fixture-uuid",
            styleName: "ノーマル",
            resolvedStyleId: metanStyleId,
            voicevoxEngineVersion: "engine-fixture-1"
          },
          scalarOverrides: {},
          accentPhrases: null,
          editedAt: "2026-08-10T00:00:00.000Z"
        })}\n`,
        "utf8"
      );

      const statusResponse = await initialized.app.inject({
        method: "GET",
        url: `/api/projects/${project.metadata.id}/voice/status`
      });
      const status = voiceGenerationStatusResponseSchema.parse(
        statusResponse.json()
      ).data;
      expect(
        status.lines.find((line) => line.lineId === changedLine.id)
      ).toEqual({ lineId: changedLine.id, status: "needs_review" });
      expect(
        status.lines
          .filter((line) => line.lineId !== changedLine.id)
          .every((line) => line.status === "current")
      ).toBe(true);

      const incrementalResponse = await initialized.app.inject({
        method: "POST",
        url: `/api/projects/${project.metadata.id}/voice/generate-all`,
        payload: {}
      });
      const incremental = voiceGenerationAcceptedResponseSchema.parse(
        incrementalResponse.json()
      ).data;
      expect(incremental.lineIds).toEqual([changedLine.id]);
      await expect(
        waitForProductionVoiceJob(
          initialized.app,
          project.metadata.id,
          incremental.runId
        )
      ).resolves.toBe("failed");
      expect(getAudioQuery).not.toHaveBeenCalled();
      expect(synthesize).not.toHaveBeenCalled();
    } finally {
      getSpeakers.mockRestore();
      getVersion.mockRestore();
      getAudioQuery.mockRestore();
      synthesize.mockRestore();
      await initialized.app.close();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
