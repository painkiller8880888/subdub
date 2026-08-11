import { afterEach, describe, expect, it } from "vitest";

import { fetchProjectManifest } from "../../src/web/lib/api-client.js";
import type { ManifestPreviewData } from "../../src/schema/api.js";
import { renderManifestFixture } from "../fixtures/render-manifest.js";
import {
  createPreviewPlayerProps,
  createPreviewViewModel
} from "../../src/web/preview-state.js";
import { createProjectManifestAssetUrlResolver } from "../../src/web/preview-asset-url.js";

function data(
  overrides: Partial<ManifestPreviewData> = {}
): ManifestPreviewData {
  return {
    project: {
      id: "manual-video-project",
      title: "Preview fixture"
    },
    state: "current",
    canPlay: true,
    manifest: structuredClone(renderManifestFixture),
    blockers: [],
    ...overrides
  };
}

describe("preview state helpers", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("validates the preview API response in the client", async () => {
    const responseData = data();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ data: responseData }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });

    await expect(fetchProjectManifest("manual-video-project")).resolves.toEqual(
      responseData
    );
  });

  it("passes every Player dimension and input prop from the same manifest", () => {
    const responseData = data();
    const originalManifest = responseData.manifest;
    const props = createPreviewPlayerProps(
      responseData,
      "manual-video-project"
    );

    expect(props).toMatchObject({
      durationInFrames: originalManifest?.durationInFrames,
      fps: originalManifest?.fps,
      compositionWidth: originalManifest?.width,
      compositionHeight: originalManifest?.height
    });
    if (props === null || !("manifest" in props.inputProps)) {
      throw new Error("expected manifest input props");
    }
    expect(props.inputProps.manifest).toBe(originalManifest);
    expect(responseData.manifest).toEqual(originalManifest);
  });

  it("keeps execution disabled for blocked states and preserves old success output", () => {
    const responseData = data({
      state: "stale",
      canPlay: false,
      blockers: [
        {
          code: "SCRIPT_OUTLINE_HASH_MISMATCH",
          message: "compiler text must not be the primary display",
          target: { kind: "script" }
        },
        {
          code: "FUTURE_BLOCKER",
          message: "untrusted compiler text",
          target: { kind: "voice", lineId: "line-main-1" }
        }
      ]
    });

    const viewModel = createPreviewViewModel(
      responseData,
      "manual-video-project"
    );
    expect(viewModel.canPlay).toBe(false);
    expect(viewModel.previousSuccess).toBe(true);
    expect(
      createPreviewPlayerProps(responseData, "manual-video-project")
    ).toBeNull();
    expect(viewModel.blockers[0]?.message).toContain("構成案が更新");
    expect(viewModel.blockers[0]?.href).toBe(
      "/projects/manual-video-project/script"
    );
    expect(viewModel.blockers[1]?.message).toContain("FUTURE_BLOCKER");
  });

  it("maps real fix targets and separates shared and project assets", () => {
    const resolver = createProjectManifestAssetUrlResolver(
      "manual-video-project"
    );
    expect(
      resolver("shared-assets/characters/character-mentor/stand/stand.png")
    ).toBe("/shared-assets/characters/character-mentor/stand/stand.png");
    expect(resolver("media/application-demo.mp4")).toBe(
      "/api/projects/manual-video-project/files/media/application-demo.mp4"
    );
    expect(
      resolver("projects/manual-video-project/audio/voice/line-main-1.wav")
    ).toBe(
      "/api/projects/manual-video-project/files/audio/voice/line-main-1.wav"
    );
    expect(() => resolver("projects/other-project/media/clip.mp4")).toThrow();
  });
});
