import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { VoicevoxAdjustmentFingerprint } from "../../src/app/voicevox/adjustment-fingerprint.js";

const projectId = "adjustment-fingerprint-project";
const lineId = "line-one";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("VoicevoxAdjustmentFingerprint", () => {
  it("returns null when the line has no adjustment file", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-voice-adjustment-")
    );
    roots.push(workspaceRoot);
    const provider = new VoicevoxAdjustmentFingerprint({ workspaceRoot });

    await expect(provider.getChecksum({ projectId, lineId })).resolves.toBe(
      null
    );
  });

  it("hashes only the addressed adjustment file contents", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(tmpdir(), "subdub-voice-adjustment-")
    );
    roots.push(workspaceRoot);
    const adjustmentDirectory = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "voice-adjustments"
    );
    await fs.mkdir(adjustmentDirectory, { recursive: true });
    const contents = Buffer.from('{"adjustmentVersion":"1.0.0"}\n');
    await fs.writeFile(
      path.join(adjustmentDirectory, `${lineId}.json`),
      contents
    );
    const provider = new VoicevoxAdjustmentFingerprint({ workspaceRoot });

    await expect(provider.getChecksum({ projectId, lineId })).resolves.toBe(
      createHash("sha256").update(contents).digest("hex")
    );
    await expect(
      provider.getChecksum({ projectId, lineId: "other-line" })
    ).resolves.toBe(null);
  });
});
