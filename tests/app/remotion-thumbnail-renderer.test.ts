import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  normalizeRenderAssetPath,
  stagePublicDirectory
} from "../../src/app/rendering/remotion-mp4-renderer.js";
import { RemotionThumbnailRenderer } from "../../src/app/rendering/remotion-thumbnail-renderer.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { videoProjectFixture } from "../fixtures/video-project.js";
import type { RenderManifest, VideoProject } from "../../src/schema/index.js";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const projectId = "manual-video-project";
let temporaryRoot: string | undefined;

async function createThumbnailWorkspace(): Promise<string> {
  temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "subdub-thumbnail-renderer-")
  );
  await fs.cp(
    path.join(repositoryRoot, "public", "shared-assets"),
    path.join(temporaryRoot, "public", "shared-assets"),
    { recursive: true }
  );
  const projectRoot = path.join(temporaryRoot, "projects", projectId);
  await fs.mkdir(path.join(projectRoot, "media"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "thumbnail"), { recursive: true });
  await fs.mkdir(path.join(projectRoot, "output"), { recursive: true });
  await fs.copyFile(
    path.join(repositoryRoot, "tests", "fixtures", "media", "oriented.jpg"),
    path.join(projectRoot, "media", "application-form.png")
  );
  await fs.copyFile(
    path.join(repositoryRoot, "tests", "fixtures", "media", "shot.png"),
    path.join(projectRoot, "thumbnail", "application-system.png")
  );
  return temporaryRoot;
}

function thumbnailManifest(): RenderManifest {
  return {
    ...structuredClone(renderManifestFixture),
    sourceAssetChecksums: []
  };
}

function thumbnailProject(): VideoProject {
  return structuredClone(videoProjectFixture);
}

afterEach(async () => {
  if (temporaryRoot !== undefined) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

describe("thumbnail renderer staging", () => {
  it("stages thumbnail, project media, and shared character references", async () => {
    const workspaceRoot = await createThumbnailWorkspace();
    const stagingRoot = await fs.mkdtemp(
      path.join(workspaceRoot, ".subdub-render-")
    );
    const characterPath =
      "shared-assets/characters/character-mentor/stand/stand.png";
    const publicRoot = await stagePublicDirectory(
      workspaceRoot,
      projectId,
      thumbnailManifest(),
      stagingRoot,
      {
        additionalAssetPaths: [
          "thumbnail/application-system.png",
          "media/application-form.png",
          characterPath
        ]
      }
    );

    await expect(
      fs.stat(path.join(publicRoot, "thumbnail", "application-system.png"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(publicRoot, "media", "application-form.png"))
    ).resolves.toBeTruthy();
    await expect(
      fs.stat(path.join(publicRoot, ...characterPath.split("/")))
    ).resolves.toBeTruthy();
  });

  it("rejects traversal and URL-encoded asset paths", async () => {
    expect(() => normalizeRenderAssetPath(projectId, "../outside.png")).toThrow(
      expect.objectContaining({ code: "RENDER_SOURCE_ASSET_PATH_INVALID" })
    );
    expect(() =>
      normalizeRenderAssetPath(projectId, "thumbnail/%2e%2e/outside.png")
    ).toThrow(
      expect.objectContaining({ code: "RENDER_SOURCE_ASSET_PATH_INVALID" })
    );
  });
});

describe("RemotionThumbnailRenderer", () => {
  it("normalizes missing thumbnail assets and cleans staging after failure", async () => {
    const workspaceRoot = await createThumbnailWorkspace();
    const project = thumbnailProject();
    project.thumbnail.backgroundImage = "thumbnail/missing.png";
    const renderer = new RemotionThumbnailRenderer({ workspaceRoot });

    await expect(
      renderer.render({
        projectId,
        runId: "thumbnail-missing-asset",
        project,
        manifest: thumbnailManifest(),
        outputPath: path.join(
          workspaceRoot,
          "projects",
          projectId,
          "output",
          "thumbnail.png"
        )
      })
    ).rejects.toMatchObject({ code: "RENDER_SOURCE_ASSET_MISSING" });
    const stagingEntries = (await fs.readdir(workspaceRoot)).filter((entry) =>
      entry.startsWith(".subdub-render-")
    );
    expect(stagingEntries).toEqual([]);
  }, 180_000);

  it("normalizes a Remotion still-render failure", async () => {
    const workspaceRoot = await createThumbnailWorkspace();
    const renderer = new RemotionThumbnailRenderer({ workspaceRoot });
    const outputDirectory = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "output"
    );

    await expect(
      renderer.render({
        projectId,
        runId: "thumbnail-render-failure",
        project: thumbnailProject(),
        manifest: thumbnailManifest(),
        outputPath: outputDirectory
      })
    ).rejects.toMatchObject({ code: "THUMBNAIL_RENDER_FAILED" });
    const stagingEntries = (await fs.readdir(workspaceRoot)).filter((entry) =>
      entry.startsWith(".subdub-render-")
    );
    expect(stagingEntries).toEqual([]);
  }, 180_000);

  it("renders the project thumbnail to PNG and removes staging after success", async () => {
    const workspaceRoot = await createThumbnailWorkspace();
    const manifest = thumbnailManifest();
    const mentor = manifest.characters.find(
      (character) => character.characterId === "character-mentor"
    );
    if (mentor === undefined) {
      throw new Error("thumbnail character fixture is missing");
    }
    mentor.idleVariantId = "character-mentor-speak-normal-v1";
    const outputPath = path.join(
      workspaceRoot,
      "projects",
      projectId,
      "output",
      "thumbnail.png"
    );
    const renderer = new RemotionThumbnailRenderer({ workspaceRoot });
    await renderer.render({
      projectId,
      runId: "thumbnail-run",
      project: thumbnailProject(),
      manifest,
      outputPath
    });

    const metadata = await sharp(outputPath).metadata();
    expect(metadata).toMatchObject({ format: "png", width: 1280, height: 720 });
    const stagingEntries = (await fs.readdir(workspaceRoot)).filter((entry) =>
      entry.startsWith(".subdub-render-")
    );
    expect(stagingEntries).toEqual([]);
  }, 180_000);
});
