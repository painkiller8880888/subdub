import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  VoicevoxAdjustmentStore,
  VoicevoxAdjustmentStoreError
} from "../../src/app/voicevox/adjustment-store.js";
import type { VoicevoxAdjustmentFile } from "../../src/voicevox/schemas.js";
import { syntheticVoicevoxStyleId } from "../fixtures/voicevox.js";

const projectId = "adjustment-store-project";
const lineId = "line-one";
const fixtureStyleId = syntheticVoicevoxStyleId();
const roots: string[] = [];

function adjustment(
  overrides: Partial<VoicevoxAdjustmentFile> = {}
): VoicevoxAdjustmentFile {
  return {
    adjustmentVersion: "1.0.0",
    lineId,
    base: {
      baseHash: "a".repeat(64),
      resolvedSpokenText: "テストです。",
      speakerUuid: "speaker-fixture-uuid",
      styleName: "ノーマル",
      resolvedStyleId: fixtureStyleId,
      voicevoxEngineVersion: "engine-fixture-1"
    },
    scalarOverrides: { speedScale: 1.1 },
    accentPhrases: null,
    editedAt: "2026-08-10T00:00:00.000Z",
    ...overrides
  };
}

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(
    path.join(tmpdir(), "subdub-adjustment-store-")
  );
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VoicevoxAdjustmentStore", () => {
  it("saves, reloads, and deletes a strict adjustment file atomically", async () => {
    const workspaceRoot = await createRoot();
    const store = new VoicevoxAdjustmentStore({ workspaceRoot });

    await expect(store.read({ projectId, lineId })).resolves.toBeNull();
    await expect(
      store.write({ projectId, lineId }, adjustment())
    ).resolves.toMatchObject({ lineId, adjustmentVersion: "1.0.0" });
    await expect(store.read({ projectId, lineId })).resolves.toEqual(
      adjustment()
    );
    await store.delete({ projectId, lineId });
    await expect(store.read({ projectId, lineId })).resolves.toBeNull();
    await expect(store.delete({ projectId, lineId })).resolves.toBeUndefined();
  });

  it("rejects unknown keys, malformed JSON, and mismatched line IDs", async () => {
    const workspaceRoot = await createRoot();
    const store = new VoicevoxAdjustmentStore({ workspaceRoot });

    await expect(
      store.write({ projectId, lineId }, { ...adjustment(), unexpected: true })
    ).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_SCHEMA_INVALID"
    });

    const adjustmentPath = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "voice-adjustments",
      `${lineId}.json`
    );
    await fs.mkdir(path.dirname(adjustmentPath), { recursive: true });
    await fs.writeFile(adjustmentPath, "{broken", "utf8");
    await expect(store.read({ projectId, lineId })).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_JSON_INVALID"
    });

    await fs.writeFile(
      adjustmentPath,
      JSON.stringify(adjustment({ lineId: "other-line" })),
      "utf8"
    );
    await expect(store.read({ projectId, lineId })).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_LINE_ID_MISMATCH"
    });
  });

  it("keeps the previous valid file when write or rename fails", async () => {
    const workspaceRoot = await createRoot();
    const initial = adjustment({ scalarOverrides: { volumeScale: 0.8 } });
    const store = new VoicevoxAdjustmentStore({ workspaceRoot });
    await store.write({ projectId, lineId }, initial);

    const writeFailure = new VoicevoxAdjustmentStore({
      workspaceRoot,
      fileSystem: {
        writeFile: async () => {
          throw new Error("write failed");
        }
      }
    });
    await expect(
      writeFailure.write({ projectId, lineId }, adjustment())
    ).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_WRITE_FAILED"
    });
    await expect(store.read({ projectId, lineId })).resolves.toEqual(initial);

    const renameFailure = new VoicevoxAdjustmentStore({
      workspaceRoot,
      fileSystem: {
        rename: async () => {
          throw new Error("rename failed");
        }
      }
    });
    await expect(
      renameFailure.write({ projectId, lineId }, adjustment())
    ).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_RENAME_FAILED"
    });
    await expect(store.read({ projectId, lineId })).resolves.toEqual(initial);
  });

  it("rejects path traversal before touching the filesystem", async () => {
    const workspaceRoot = await createRoot();
    const store = new VoicevoxAdjustmentStore({ workspaceRoot });

    expect(() =>
      store.getAdjustmentPath({ projectId: "../outside", lineId })
    ).toThrowError(VoicevoxAdjustmentStoreError);
    await expect(
      store.read({ projectId, lineId: "../outside" })
    ).rejects.toMatchObject({
      code: "VOICEVOX_ADJUSTMENT_STORE_INPUT_INVALID"
    });
  });
});
