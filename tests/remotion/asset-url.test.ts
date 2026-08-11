import { describe, expect, it } from "vitest";

import {
  audioTrackSequenceProps,
  soundEffectSequenceProps
} from "../../src/remotion/audio.js";
import { resolveManifestAssetUrl } from "../../src/remotion/asset-url.js";
import type {
  RenderAudioTrack,
  RenderSoundEffect
} from "../../src/schema/index.js";

describe("RenderManifest asset URL boundary", () => {
  const resolver = (relativePath: string) => `/project-file/${relativePath}`;

  it("uses the injected resolver for audio, BGM, and sound effects", () => {
    const track: RenderAudioTrack = {
      id: "bgm-main",
      sectionId: "section-main",
      from: 0,
      durationInFrames: 30,
      src: "audio/bgm.ogg",
      volume: 0.5,
      loop: true,
      fadeInFrames: 0,
      fadeOutFrames: 0
    };
    const effect: RenderSoundEffect = {
      id: "effect-confirm",
      lineId: "main-learner-1",
      category: "confirm",
      from: 10,
      durationInFrames: 5,
      src: "media/confirm.wav",
      volume: 0.2
    };

    expect(audioTrackSequenceProps(track, resolver).src).toBe(
      "/project-file/audio/bgm.ogg"
    );
    expect(soundEffectSequenceProps(effect, resolver).src).toBe(
      "/project-file/media/confirm.wav"
    );
    expect(
      resolveManifestAssetUrl("shared-assets/characters/a.png", resolver)
    ).toBe("/project-file/shared-assets/characters/a.png");
  });
});
