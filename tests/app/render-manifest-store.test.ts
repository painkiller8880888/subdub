import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, afterEach } from "vitest";

import { type RenderManifestAssetMetadata } from "../../src/app/rendering/render-manifest-compiler.js";
import {
  isCurrentRenderManifestCache,
  RenderManifestStore,
  RenderManifestStoreError
} from "../../src/app/rendering/render-manifest-store.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";
import type { VideoProject } from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { createRenderManifestInput } from "../fixtures/render-manifest-input.js";

const projectId = "manual-video-project";
let temporaryRoot: string | undefined;

async function createRoot(): Promise<string> {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "subdub-render-manifest-")
  );
  return temporaryRoot;
}

async function removeRoot(): Promise<void> {
  if (temporaryRoot !== undefined) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
}

function targetPath(root: string): string {
  return path.join(
    root,
    "projects",
    projectId,
    "cache",
    "render-manifest.json"
  );
}

function cacheInput() {
  return createRenderManifestInput();
}

describe("RenderManifestStore", () => {
  afterEach(removeRoot);

  it("writes a schema-checked manifest atomically and reads it back", async () => {
    const root = await createRoot();
    const store = new RenderManifestStore({ workspaceRoot: root });

    await store.write(projectId, renderManifestFixture);

    await expect(store.read(projectId)).resolves.toEqual(renderManifestFixture);
    const raw = await fs.readFile(targetPath(root), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toBe(`${JSON.stringify(renderManifestFixture, null, 2)}\n`);
    expect(
      isCurrentRenderManifestCache(renderManifestFixture, renderManifestFixture)
    ).toBe(true);
  });

  it("reuses identical input and invalidates project, audio, asset, catalog, and mapping changes", async () => {
    const root = await createRoot();
    const store = new RenderManifestStore({ workspaceRoot: root });
    const input = cacheInput();

    await expect(
      store.compileAndStore(projectId, input)
    ).resolves.toMatchObject({
      status: "compiled",
      reused: false
    });
    await expect(
      store.compileAndStore(projectId, structuredClone(input))
    ).resolves.toMatchObject({
      status: "reused",
      reused: true
    });

    const changedProject = structuredClone(input.project) as VideoProject;
    changedProject.metadata.title += " changed";
    await expect(
      store.compileAndStore(projectId, { ...input, project: changedProject })
    ).resolves.toMatchObject({ status: "compiled", reused: false });

    const changedAudio = structuredClone(
      input.audioIndex
    ) as VoicevoxAudioIndex;
    const firstAudioLine = Object.keys(changedAudio)[0];
    if (firstAudioLine === undefined) {
      throw new Error("fixture audio index must not be empty");
    }
    changedAudio[firstAudioLine] = {
      ...changedAudio[firstAudioLine],
      durationMs: 1_100
    };
    const changedAudioAssets = [
      ...((input.assetMetadata ?? []) as readonly RenderManifestAssetMetadata[])
    ].map((asset) =>
      asset.path === changedAudio[firstAudioLine]?.audioPath
        ? { ...asset, durationMs: 1_100 }
        : asset
    );
    await expect(
      store.compileAndStore(projectId, {
        ...input,
        audioIndex: changedAudio,
        assetMetadata: changedAudioAssets
      })
    ).resolves.toMatchObject({ status: "compiled", reused: false });

    const changedCharacterAsset = [
      ...((input.assetMetadata ?? []) as readonly RenderManifestAssetMetadata[])
    ].map((asset) =>
      asset.path.endsWith("character-mentor/stand/stand.png")
        ? { ...asset, sha256: "9".repeat(64) }
        : asset
    );
    await expect(
      store.compileAndStore(projectId, {
        ...input,
        assetMetadata: changedCharacterAsset
      })
    ).resolves.toMatchObject({ status: "compiled", reused: false });

    await expect(
      store.compileAndStore(projectId, {
        ...input,
        characterCatalogVersion: "1.0.1"
      })
    ).resolves.toMatchObject({ status: "compiled", reused: false });
    await expect(
      store.compileAndStore(projectId, {
        ...input,
        characterMappingVersion: "1.0.1"
      })
    ).resolves.toMatchObject({ status: "compiled", reused: false });
  });

  it("treats malformed and 1.0.0 caches as misses", async () => {
    const root = await createRoot();
    const store = new RenderManifestStore({ workspaceRoot: root });
    const cacheDirectory = path.dirname(targetPath(root));
    await fs.mkdir(cacheDirectory, { recursive: true });

    await fs.writeFile(
      targetPath(root),
      JSON.stringify({ manifestVersion: "1.0.0" }),
      "utf8"
    );
    await expect(
      store.compileAndStore(projectId, cacheInput())
    ).resolves.toMatchObject({
      status: "compiled",
      reused: false
    });

    await fs.writeFile(targetPath(root), "not json", "utf8");
    await expect(
      store.compileAndStore(projectId, cacheInput())
    ).resolves.toMatchObject({
      status: "compiled",
      reused: false
    });
  });

  it("keeps the existing manifest when compilation fails", async () => {
    const root = await createRoot();
    const store = new RenderManifestStore({ workspaceRoot: root });
    await store.write(projectId, renderManifestFixture);
    const before = await fs.readFile(targetPath(root), "utf8");

    const result = await store.compileAndStore(projectId, {
      ...cacheInput(),
      audioIndex: {}
    });

    expect(result.status).toBe("failed");
    await expect(fs.readFile(targetPath(root), "utf8")).resolves.toBe(before);
  });

  it("keeps the existing manifest on write and rename failures", async () => {
    const root = await createRoot();
    const destination = targetPath(root);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, "existing manifest\n", "utf8");

    const writeFailure = new RenderManifestStore({
      workspaceRoot: root,
      fileSystem: {
        writeFile: async () => {
          throw new Error("write failure");
        }
      }
    });
    await expect(
      writeFailure.write(projectId, renderManifestFixture)
    ).rejects.toMatchObject({
      code: "RENDER_MANIFEST_WRITE_FAILED"
    } satisfies Partial<RenderManifestStoreError>);
    await expect(fs.readFile(destination, "utf8")).resolves.toBe(
      "existing manifest\n"
    );

    const renameFailure = new RenderManifestStore({
      workspaceRoot: root,
      fileSystem: {
        rename: async () => {
          throw new Error("rename failure");
        }
      }
    });
    await expect(
      renameFailure.write(projectId, renderManifestFixture)
    ).rejects.toMatchObject({
      code: "RENDER_MANIFEST_RENAME_FAILED"
    });
    await expect(fs.readFile(destination, "utf8")).resolves.toBe(
      "existing manifest\n"
    );
  });

  it("handles a temporary filename collision without overwriting the colliding file", async () => {
    const root = await createRoot();
    const cacheDirectory = path.dirname(targetPath(root));
    await fs.mkdir(cacheDirectory, { recursive: true });
    const collisionPath = path.join(
      cacheDirectory,
      ".render-manifest.json.collision.tmp"
    );
    await fs.writeFile(collisionPath, "keep this file", "utf8");
    const ids = ["collision", "fresh"];
    const store = new RenderManifestStore({
      workspaceRoot: root,
      createId: () => ids.shift() ?? "fallback"
    });

    await store.write(projectId, renderManifestFixture);

    await expect(fs.readFile(collisionPath, "utf8")).resolves.toBe(
      "keep this file"
    );
    await expect(store.read(projectId)).resolves.toEqual(renderManifestFixture);
  });
});
