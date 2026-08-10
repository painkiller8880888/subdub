import type { ReactNode } from "react";

import { Audio, Sequence } from "remotion";

import type {
  RenderAudioTrack,
  RenderManifest,
  RenderSoundEffect
} from "../schema/index";
import {
  audioTrackSequenceProps,
  audioTrackVolumeAtFrame,
  soundEffectSequenceProps
} from "./audio";

function AudioTrackSequence({ track }: { track: RenderAudioTrack }): ReactNode {
  const sequence = audioTrackSequenceProps(track);
  return (
    <Sequence
      from={sequence.from}
      durationInFrames={sequence.durationInFrames}
      layout="none"
      name={`bgm:${track.id}`}
    >
      <Audio
        src={sequence.src}
        loop={sequence.loop}
        volume={(frame) => audioTrackVolumeAtFrame(track, frame)}
      />
    </Sequence>
  );
}

function SoundEffectSequence({
  effect
}: {
  effect: RenderSoundEffect;
}): ReactNode {
  const sequence = soundEffectSequenceProps(effect);
  return (
    <Sequence
      from={sequence.from}
      durationInFrames={sequence.durationInFrames}
      layout="none"
      name={`sfx:${effect.id}`}
    >
      <Audio src={sequence.src} volume={sequence.volume} />
    </Sequence>
  );
}

export function ManifestAudioLayer({
  manifest
}: {
  manifest: RenderManifest;
}): ReactNode {
  return (
    <>
      {manifest.audioTracks.map((track) => (
        <AudioTrackSequence key={track.id} track={track} />
      ))}
      {manifest.soundEffects.map((effect) => (
        <SoundEffectSequence key={effect.id} effect={effect} />
      ))}
    </>
  );
}
