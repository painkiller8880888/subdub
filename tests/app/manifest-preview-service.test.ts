import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { computeSourceProjectHash } from "../../src/app/rendering/render-manifest-compiler.js";
import { ManifestPreviewService } from "../../src/app/rendering/manifest-preview-service.js";
import { RenderManifestStore } from "../../src/app/rendering/render-manifest-store.js";
import { computeOutlineHash } from "../../src/app/projects/script-domain.js";
import type { VoicevoxAudioIndex } from "../../src/app/voicevox/audio-index.js";
import type { RenderManifest, VideoProject } from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { createRenderManifestAudioIndex } from "../fixtures/render-manifest-input.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = "manual-video-project";
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "subdub-preview-"));
  roots.push(root);
  return root;
}

function createProject(): VideoProject {
  const project = structuredClone(videoProjectFixture) as VideoProject;
  project.script.outlineHash = computeOutlineHash(project.outline);
  return project;
}

function createManifest(project: VideoProject): RenderManifest {
  const manifest = structuredClone(renderManifestFixture) as RenderManifest;
  const audioIndex = createRenderManifestAudioIndex(project);
  manifest.sourceProjectHash = computeSourceProjectHash(project);
  manifest.sourceAssetChecksums = [];
  manifest.lines = manifest.lines.map((line) => ({
    ...line,
    audioPath: audioIndex[line.id]?.audioPath ?? line.audioPath
  }));
  return manifest;
}

function audioStore(audioIndex: VoicevoxAudioIndex) {
  return {
    readIndex: async () => audioIndex,
    isEntryUsable: async () => true
  };
}

async function createService(
  root: string,
  project: VideoProject,
  options: {
    manifest?: RenderManifest;
    audioIndex?: VoicevoxAudioIndex;
    projectFileService?: {
      resolveFile: (
        projectId: unknown,
        relativePath: unknown
      ) => Promise<{
        filePath: string;
        size: number;
        contentType: string;
      }>;
    };
  } = {}
): Promise<ManifestPreviewService> {
  const manifestStore = new RenderManifestStore({ workspaceRoot: root });
  if (options.manifest !== undefined) {
    await manifestStore.write(projectId, options.manifest);
  }
  return new ManifestPreviewService({
    workspaceRoot: root,
    projectRepository: { read: async () => project },
    manifestStore,
    audioStore: audioStore(
      options.audioIndex ?? createRenderManifestAudioIndex(project)
    ),
    projectFileService: options.projectFileService
  });
}

describe("ManifestPreviewService", () => {
  afterEach(async () => {
    await Promise.all(
      roots
        .splice(0)
        .map((root) => fs.rm(root, { recursive: true, force: true }))
    );
  });

  it("returns a playable current manifest using the saved manifest", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });

    await expect(service.get(projectId)).resolves.toMatchObject({
      state: "current",
      canPlay: true,
      project: { id: projectId, title: project.metadata.title },
      manifest,
      blockers: []
    });
  });

  it("reports a missing manifest as a normal blocked state", async () => {
    const root = await createRoot();
    const project = createProject();
    const service = await createService(root, project);

    const result = await service.get(projectId);
    expect(result.state).toBe("missing");
    expect(result.canPlay).toBe(false);
    expect(result.manifest).toBeNull();
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_NOT_FOUND"
    );
  });

  it("keeps the previous manifest and reports project staleness", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });
    project.metadata.title = "更新後のタイトル";

    const result = await service.get(projectId);
    expect(result.state).toBe("stale");
    expect(result.canPlay).toBe(false);
    expect(result.manifest).toEqual(manifest);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_PROJECT_STALE"
    );
  });

  it.each([
    [
      "outline approval",
      (project: VideoProject) => (project.outline.status = "draft"),
      "OUTLINE_NOT_APPROVED"
    ],
    [
      "outline freshness",
      (project: VideoProject) => (project.outline.sourceHash = "f".repeat(64)),
      "OUTLINE_SOURCE_HASH_MISMATCH"
    ],
    [
      "script approval",
      (project: VideoProject) => (project.script.status = "draft"),
      "SCRIPT_NOT_APPROVED"
    ],
    [
      "script freshness",
      (project: VideoProject) => (project.script.outlineHash = "f".repeat(64)),
      "SCRIPT_OUTLINE_HASH_MISMATCH"
    ],
    [
      "visual approval",
      (project: VideoProject) => (project.visuals.status = "draft"),
      "VISUALS_NOT_APPROVED"
    ]
  ])("distinguishes %s blockers", async (_name, change, expectedCode) => {
    const root = await createRoot();
    const project = createProject();
    const manifest = createManifest(project);
    const service = await createService(root, project, { manifest });
    change(project);

    const result = await service.get(projectId);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      expectedCode
    );
  });

  it("treats invalid JSON safely without exposing a file path", async () => {
    const root = await createRoot();
    const project = createProject();
    const manifestPath = path.join(
      root,
      "projects",
      projectId,
      "cache",
      "render-manifest.json"
    );
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, "{ invalid", "utf8");
    const service = await createService(root, project);

    const result = await service.get(projectId);
    expect(result.state).toBe("invalid");
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "MANIFEST_INVALID"
    );
    expect(JSON.stringify(result)).not.toContain(root);
  });

  it("reports a checksum mismatch from the actual project asset", async () => {
    const root = await createRoot();
    const project = createProject();
    const assetPath = path.join(
      root,
      "projects",
      projectId,
      "media",
      "clip.bin"
    );
    await fs.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.writeFile(assetPath, "actual", "utf8");
    const manifest = createManifest(project);
    manifest.sourceAssetChecksums = [
      { path: "media/clip.bin", sha256: "0".repeat(64) }
    ];
    const service = await createService(root, project, {
      manifest,
      projectFileService: {
        resolveFile: async () => ({
          filePath: assetPath,
          size: 6,
          contentType: "application/octet-stream"
        })
      }
    });

    const result = await service.get(projectId);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "ASSET_CHECKSUM_MISMATCH"
    );
  });
});
