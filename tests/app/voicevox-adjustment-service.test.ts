import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { VoicevoxAdjustmentService } from "../../src/app/voicevox/adjustment-service.js";
import { VoicevoxAdjustmentStore } from "../../src/app/voicevox/adjustment-store.js";
import {
  createVoicevoxAudioQueryFixture,
  createVoicevoxSpeakersFixture,
  createVoicevoxWavFixture,
  syntheticVoicevoxStyleId
} from "../fixtures/voicevox.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const roots: string[] = [];

async function createHarness() {
  const workspaceRoot = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-voice-adjustment-service-")
  );
  roots.push(workspaceRoot);
  const line = videoProjectFixture.script.sections[0]?.lines[0];
  const character = videoProjectFixture.characters.find(
    (candidate) => candidate.id === line?.speakerId
  );
  if (line === undefined || character === undefined) {
    throw new Error("fixture line and character are required");
  }
  const resolvedSpeaker = {
    speakerName: character.voicevox.speakerName,
    speakerUuid: "metan-fixture-uuid",
    styleName: character.voicevox.styleName,
    resolvedStyleId: syntheticVoicevoxStyleId()
  };
  const zundamonStyleId = syntheticVoicevoxStyleId();
  const prepared = {
    cached: true,
    cacheKey: "a".repeat(64),
    queryPath: `projects/${videoProjectFixture.metadata.id}/cache/voicevox-query/${line.id}-${"b".repeat(64)}.json`,
    query: createVoicevoxAudioQueryFixture(),
    resolvedSpokenText: line.spokenText,
    appliedTerms: [],
    voicevoxEngineVersion: "engine-fixture-1",
    resolvedSpeaker,
    adjustmentChecksum: null,
    baseHash: "c".repeat(64),
    adjustmentStatus: "current" as const,
    adjustment: null
  };
  const client = {
    getSpeakers: vi.fn(async () =>
      createVoicevoxSpeakersFixture({
        metanStyleId: resolvedSpeaker.resolvedStyleId,
        zundamonStyleId
      })
    ),
    getVersion: vi.fn(async () => "engine-fixture-1"),
    getAudioQuery: vi.fn(async () => createVoicevoxAudioQueryFixture()),
    synthesize: vi.fn(async () => createVoicevoxWavFixture())
  };
  const store = new VoicevoxAdjustmentStore({ workspaceRoot });
  const service = new VoicevoxAdjustmentService({
    repository: { read: async () => structuredClone(videoProjectFixture) },
    client,
    queryService: { prepareUnadjusted: async () => prepared },
    adjustmentStore: store,
    workspaceRoot
  });
  return { workspaceRoot, line, prepared, client, store, service };
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VoicevoxAdjustmentService", () => {
  it("returns current query/base data and explicitly saves a matching adjustment", async () => {
    const { line, prepared, client, store, service } = await createHarness();
    const snapshot = await service.get(
      videoProjectFixture.metadata.id,
      line.id
    );

    expect(snapshot.status).toBe("current");
    expect(snapshot.adjustment).toBeNull();
    expect(snapshot.currentBase.baseHash).toBe(prepared.baseHash);
    expect(client.getSpeakers).toHaveBeenCalledTimes(1);

    const saved = await service.save(videoProjectFixture.metadata.id, line.id, {
      adjustmentVersion: "1.0.0",
      lineId: line.id,
      base: snapshot.currentBase,
      scalarOverrides: { speedScale: 1.25 },
      accentPhrases: null,
      editedAt: "2026-08-10T00:00:00.000Z"
    });
    expect(saved.adjustment?.scalarOverrides).toEqual({ speedScale: 1.25 });
    await expect(
      store.read({
        projectId: videoProjectFixture.metadata.id,
        lineId: line.id
      })
    ).resolves.toMatchObject({ scalarOverrides: { speedScale: 1.25 } });
  });

  it("rejects stale saves, writes preview bytes separately, and resets only adjustments", async () => {
    const { workspaceRoot, line, prepared, client, store, service } =
      await createHarness();
    const preview = await service.preview(
      videoProjectFixture.metadata.id,
      line.id,
      createVoicevoxAudioQueryFixture()
    );
    await expect(
      service.readPreview(
        videoProjectFixture.metadata.id,
        line.id,
        preview.previewId
      )
    ).resolves.toEqual(createVoicevoxWavFixture());
    expect(
      await fs
        .readdir(
          path.join(workspaceRoot, "projects", videoProjectFixture.metadata.id)
        )
        .then((entries) => entries.includes("audio-index.json"))
    ).toBe(false);

    await expect(
      service.save(videoProjectFixture.metadata.id, line.id, {
        adjustmentVersion: "1.0.0",
        lineId: line.id,
        base: {
          baseHash: "f".repeat(64),
          resolvedSpokenText: "古い文",
          speakerUuid: "metan-fixture-uuid",
          styleName: "ノーマル",
          resolvedStyleId: prepared.resolvedSpeaker.resolvedStyleId,
          voicevoxEngineVersion: "engine-fixture-1"
        },
        scalarOverrides: {},
        accentPhrases: null,
        editedAt: "2026-08-10T00:00:00.000Z"
      })
    ).rejects.toMatchObject({ code: "VOICEVOX_ADJUSTMENT_BASE_STALE" });

    await store.write(
      { projectId: videoProjectFixture.metadata.id, lineId: line.id },
      {
        adjustmentVersion: "1.0.0",
        lineId: line.id,
        base: {
          baseHash: "c".repeat(64),
          resolvedSpokenText: line.spokenText,
          speakerUuid: "metan-fixture-uuid",
          styleName: "ノーマル",
          resolvedStyleId: prepared.resolvedSpeaker.resolvedStyleId,
          voicevoxEngineVersion: "engine-fixture-1"
        },
        scalarOverrides: {},
        accentPhrases: null,
        editedAt: "2026-08-10T00:00:00.000Z"
      }
    );
    await service.discard(videoProjectFixture.metadata.id, line.id);
    await expect(
      store.read({
        projectId: videoProjectFixture.metadata.id,
        lineId: line.id
      })
    ).resolves.toBeNull();
    expect(client.getSpeakers).toHaveBeenCalledTimes(2);
  });
});
