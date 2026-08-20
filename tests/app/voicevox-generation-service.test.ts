import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSpokenText } from "../../src/app/terminology/spoken-text-resolver.js";
import { VoicevoxAudioStore } from "../../src/app/voicevox/audio-store.js";
import { VoicevoxGenerationService } from "../../src/app/voicevox/generation-service.js";
import { VoicevoxQueryService } from "../../src/app/voicevox/query-service.js";
import { runLogSchema } from "../../src/schema/index.js";
import { VoicevoxAdapterError } from "../../src/voicevox/errors.js";
import {
  createVoicevoxSpeakersFixture,
  createVoicevoxAudioQueryFixture,
  createVoicevoxWavFixture
} from "../fixtures/voicevox.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = videoProjectFixture.metadata.id;
const roots: string[] = [];

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitForJob(
  service: VoicevoxGenerationService,
  runId: string
): Promise<"succeeded" | "failed"> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await service.getStatus(projectId);
    const job = status.jobs.find((candidate) => candidate.runId === runId);
    if (job?.status === "succeeded" || job?.status === "failed") {
      return job.status;
    }
    await nextTurn();
  }
  throw new Error(`job ${runId} did not finish`);
}

async function createHarness(
  options: {
    readonly adjustmentChecksums?: Map<string, string>;
    readonly persistLogs?: boolean;
  } = {}
) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-voicevox-generation-")
  );
  roots.push(workspaceRoot);
  await fs.mkdir(path.join(workspaceRoot, "projects", projectId), {
    recursive: true
  });

  let project = structuredClone(videoProjectFixture);
  let nextRunId = 0;
  const client = {
    getSpeakers: vi.fn(async () =>
      createVoicevoxSpeakersFixture({
        metanStyleId: 10_001,
        zundamonStyleId: 10_002
      })
    ),
    getVersion: vi.fn(async () => "engine-fixture-1"),
    getAudioQuery: vi.fn(async () => createVoicevoxAudioQueryFixture()),
    synthesize: vi.fn(async () => createVoicevoxWavFixture())
  };
  const terminologyService = {
    preview: vi.fn((input: unknown) => {
      const request = input as Parameters<typeof resolveSpokenText>[0];
      return resolveSpokenText({ ...request, terms: [] });
    })
  };
  const queryService = new VoicevoxQueryService({
    client,
    terminologyService,
    workspaceRoot,
    adjustmentFingerprintProvider: {
      getChecksum: ({ lineId }) =>
        options.adjustmentChecksums?.get(lineId) ?? null
    }
  });
  const audioStore = new VoicevoxAudioStore({ workspaceRoot });
  const service = new VoicevoxGenerationService({
    repository: {
      read: async () => project
    },
    client,
    queryService,
    audioStore,
    workspaceRoot: options.persistLogs ? workspaceRoot : undefined,
    createId: () => {
      nextRunId += 1;
      return `voice-run-${nextRunId}`;
    }
  });

  return {
    workspaceRoot,
    client,
    audioStore,
    service,
    getProject: () => project,
    setProject: (nextProject: typeof project) => {
      project = nextProject;
    }
  };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VoicevoxGenerationService", { timeout: 30_000 }, () => {
  it("persists a failed run when VOICEVOX context resolution fails", async () => {
    const harness = await createHarness({ persistLogs: true });
    harness.client.getVersion.mockRejectedValueOnce(
      new VoicevoxAdapterError("VOICEVOX_CONNECTION_FAILED")
    );

    await expect(harness.service.generateAll(projectId)).rejects.toMatchObject({
      code: "VOICEVOX_CONNECTION_FAILED"
    });

    const raw = await fs.readFile(
      path.join(
        harness.workspaceRoot,
        "projects",
        projectId,
        "runs",
        "voice-run-1.json"
      ),
      "utf8"
    );
    const run = runLogSchema.parse(JSON.parse(raw));
    expect(run).toMatchObject({
      kind: "voice",
      status: "failed",
      startedAt: null,
      engine: "VOICEVOX",
      engineVersion: "unknown",
      errorCode: "VOICEVOX_CONNECTION_FAILED",
      outputs: []
    });
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("persists a common run with deterministic multi-WAV outputs and no spoken text", async () => {
    const harness = await createHarness({ persistLogs: true });
    const accepted = await harness.service.generateAll(projectId);
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "succeeded"
    );

    const raw = await fs.readFile(
      path.join(
        harness.workspaceRoot,
        "projects",
        projectId,
        "runs",
        `${accepted.runId}.json`
      ),
      "utf8"
    );
    const run = runLogSchema.parse(JSON.parse(raw));
    expect(run).toMatchObject({
      kind: "voice",
      status: "succeeded",
      projectRevision: videoProjectFixture.revision,
      engine: "VOICEVOX",
      engineVersion: "engine-fixture-1",
      targetCount: accepted.lineIds.length,
      generatedCount: accepted.lineIds.length,
      noOp: false
    });
    expect(run.outputs).toHaveLength(accepted.lineIds.length);
    expect(raw).not.toContain(
      videoProjectFixture.script.sections[0]!.lines[0]!.spokenText
    );
    expect(raw).not.toContain("Error");
  });

  it("records an all-current no-op as a terminal run", async () => {
    const harness = await createHarness({ persistLogs: true });
    const first = await harness.service.generateAll(projectId);
    await waitForJob(harness.service, first.runId);
    const accepted = await harness.service.generateAll(projectId);
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "succeeded"
    );

    const raw = await fs.readFile(
      path.join(
        harness.workspaceRoot,
        "projects",
        projectId,
        "runs",
        `${accepted.runId}.json`
      ),
      "utf8"
    );
    expect(runLogSchema.parse(JSON.parse(raw))).toMatchObject({
      kind: "voice",
      status: "succeeded",
      targetCount: 0,
      generatedCount: 0,
      noOp: true,
      outputs: []
    });
  });

  it("reports current lines without calling audio_query or synthesis", async () => {
    const harness = await createHarness();
    const accepted = await harness.service.generateAll(projectId);
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "succeeded"
    );
    harness.client.getVersion.mockClear();
    harness.client.getAudioQuery.mockClear();
    harness.client.synthesize.mockClear();

    const status = await harness.service.getStatus(projectId);

    expect(status.available).toBe(true);
    expect(status.lines.every((line) => line.status === "current")).toBe(true);
    expect(
      status.lines.every(
        (line) =>
          line.audioPath?.startsWith(`projects/${projectId}/audio/voice/`) ===
          true
      )
    ).toBe(true);
    expect(harness.client.getVersion).toHaveBeenCalledTimes(1);
    expect(harness.client.getAudioQuery).not.toHaveBeenCalled();
    expect(harness.client.synthesize).not.toHaveBeenCalled();
  }, 15_000);

  it("reports generating while the selected line job is in flight", async () => {
    const harness = await createHarness();
    const line = harness.getProject().script.sections[0]!.lines[0]!;
    let releaseSynthesis!: (audio: Uint8Array) => void;
    let signalSynthesisStarted!: () => void;
    const synthesisStarted = new Promise<void>((resolve) => {
      signalSynthesisStarted = resolve;
    });
    const synthesis = new Promise<Uint8Array>((resolve) => {
      releaseSynthesis = resolve;
    });
    harness.client.synthesize.mockImplementationOnce(async () => {
      signalSynthesisStarted();
      return synthesis;
    });

    const accepted = await harness.service.generate(projectId, {
      lineIds: [line.id]
    });
    await synthesisStarted;

    const generating = await harness.service.getStatus(projectId);
    expect(
      generating.lines.find((candidate) => candidate.lineId === line.id)
    ).toEqual({
      lineId: line.id,
      status: "generating"
    });

    releaseSynthesis(createVoicevoxWavFixture());
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "succeeded"
    );
  });

  it("regenerates only the changed line in generate-all", async () => {
    const harness = await createHarness();
    const initial = await harness.service.generateAll(projectId);
    await waitForJob(harness.service, initial.runId);
    harness.client.getAudioQuery.mockClear();
    harness.client.synthesize.mockClear();

    const changedProject = harness.getProject();
    const changedLine = changedProject.script.sections[0]!.lines[0]!;
    changedLine.spokenText = `${changedLine.spokenText} 変更`;
    harness.setProject(changedProject);

    const accepted = await harness.service.generateAll(projectId);

    expect(accepted.lineIds).toEqual([changedLine.id]);
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "succeeded"
    );
    expect(harness.client.getAudioQuery).toHaveBeenCalledTimes(1);
    expect(harness.client.synthesize).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous index and WAV when the changed line fails", async () => {
    const harness = await createHarness();
    const initial = await harness.service.generateAll(projectId);
    await waitForJob(harness.service, initial.runId);
    const beforeIndex = await harness.audioStore.readIndex(projectId);
    const changedProject = harness.getProject();
    const changedLine = changedProject.script.sections[0]!.lines[0]!;
    changedLine.spokenText = `${changedLine.spokenText} 失敗試験`;
    harness.setProject(changedProject);
    const priorEntry = beforeIndex[changedLine.id];
    if (priorEntry === undefined) {
      throw new Error("prior audio index entry is required");
    }
    harness.client.synthesize.mockRejectedValueOnce(
      new Error("synthetic failure")
    );

    const accepted = await harness.service.generate(projectId, {
      lineIds: [changedLine.id]
    });
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "failed"
    );

    const afterIndex = await harness.audioStore.readIndex(projectId);
    expect(afterIndex[changedLine.id]).toEqual(priorEntry);
    await expect(
      fs.stat(
        path.join(harness.workspaceRoot, ...priorEntry.audioPath.split("/"))
      )
    ).resolves.toBeDefined();
    const status = await harness.service.getStatus(projectId);
    expect(status.lines.find((line) => line.lineId === changedLine.id)).toEqual(
      {
        lineId: changedLine.id,
        status: "failed",
        errorCode: "VOICEVOX_GENERATION_FAILED"
      }
    );
  });

  it("makes a changed adjustment fingerprint stale without generating it", async () => {
    const adjustmentChecksums = new Map<string, string>();
    const harness = await createHarness({ adjustmentChecksums });
    const initial = await harness.service.generateAll(projectId);
    await waitForJob(harness.service, initial.runId);
    const changedLine = harness.getProject().script.sections[0]!.lines[0]!;
    const priorIndex = await harness.audioStore.readIndex(projectId);
    adjustmentChecksums.set(changedLine.id, "adjustment-v2");
    harness.client.getAudioQuery.mockClear();
    harness.client.synthesize.mockClear();

    const status = await harness.service.getStatus(projectId);
    expect(
      status.lines.find((line) => line.lineId === changedLine.id)?.status
    ).toBe("stale");
    expect(
      status.lines
        .filter((line) => line.lineId !== changedLine.id)
        .every((line) => line.status === "current")
    ).toBe(true);
    expect(harness.client.getAudioQuery).not.toHaveBeenCalled();

    const accepted = await harness.service.generate(projectId, {
      lineIds: [changedLine.id]
    });
    await expect(waitForJob(harness.service, accepted.runId)).resolves.toBe(
      "failed"
    );
    expect(harness.client.getAudioQuery).not.toHaveBeenCalled();
    expect(harness.client.synthesize).not.toHaveBeenCalled();
    expect(await harness.audioStore.readIndex(projectId)).toEqual(priorIndex);
  });
});
