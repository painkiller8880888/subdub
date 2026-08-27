import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  remotionOptionsFromProject,
  stagePublicDirectory
} from "../../src/app/rendering/remotion-mp4-renderer.js";
import {
  renderManifestSchema,
  type RenderManifest,
  videoProjectSchema
} from "../../src/schema/index.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import { videoProjectFixture } from "../fixtures/video-project.js";

const projectId = "manual-video-project";
let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot !== undefined) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    temporaryRoot = undefined;
  }
});

describe("Remotion MP4 public staging", () => {
  it("keeps production options unchanged and applies the fixed preview profile", () => {
    const project = videoProjectSchema.parse(videoProjectFixture);

    expect(remotionOptionsFromProject(project)).toEqual({
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      sampleRate: 48000
    });
    expect(
      remotionOptionsFromProject(project, {
        kind: "preview",
        previewPreset: "sd"
      })
    ).toEqual({
      codec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      sampleRate: 48000,
      audioBitrate: "128k",
      crf: 23,
      x264Preset: "veryfast",
      scale: 0.5
    });
  });

  it("preserves the project-prefixed VOICEVOX audio path used by the manifest", async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "subdub-remotion-staging-")
    );
    const audioPath = path.join(
      temporaryRoot,
      "projects",
      projectId,
      "audio",
      "voice",
      "line-1.wav"
    );
    await fs.mkdir(path.dirname(audioPath), { recursive: true });
    await fs.writeFile(audioPath, "voice-data");

    const manifestInput = structuredClone(
      renderManifestFixture
    ) as RenderManifest;
    manifestInput.sourceAssetChecksums = [];
    manifestInput.lines = manifestInput.lines.map((line, index) =>
      index === 0
        ? {
            ...line,
            audioPath: `projects/${projectId}/audio/voice/line-1.wav`
          }
        : line
    );
    const manifest = renderManifestSchema.parse(manifestInput);
    const stagingRoot = await fs.mkdtemp(
      path.join(temporaryRoot, ".subdub-render-")
    );

    const publicRoot = await stagePublicDirectory(
      temporaryRoot,
      projectId,
      manifest,
      stagingRoot
    );

    await expect(
      fs.readFile(
        path.join(
          publicRoot,
          "projects",
          projectId,
          "audio",
          "voice",
          "line-1.wav"
        ),
        "utf8"
      )
    ).resolves.toBe("voice-data");
    await expect(
      fs.readFile(path.join(publicRoot, "audio", "voice", "line-1.wav"), "utf8")
    ).resolves.toBe("voice-data");
  });

  it("stages SQLite-managed character visual files from the workspace library", async () => {
    temporaryRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "subdub-remotion-library-staging-")
    );
    const libraryPath =
      "library/character-visuals/visual-custom/variant-custom/single.png";
    const sourcePath = path.join(temporaryRoot, ...libraryPath.split("/"));
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, "character-data");

    const manifestInput = structuredClone(
      renderManifestFixture
    ) as RenderManifest;
    manifestInput.sourceAssetChecksums = [
      { path: libraryPath, sha256: "a".repeat(64) }
    ];
    const manifest = renderManifestSchema.parse(manifestInput);
    const stagingRoot = await fs.mkdtemp(
      path.join(temporaryRoot, ".subdub-render-")
    );

    const publicRoot = await stagePublicDirectory(
      temporaryRoot,
      projectId,
      manifest,
      stagingRoot
    );

    await expect(
      fs.readFile(path.join(publicRoot, ...libraryPath.split("/")), "utf8")
    ).resolves.toBe("character-data");
  });
});
