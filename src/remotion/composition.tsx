import type { ReactNode } from "react";

import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";

import type { RenderManifest } from "../schema/index";
import { BackgroundVisual } from "./background";
import { CharacterLayer } from "./characters";
import { DocumentVisual } from "./document-visual";
import { DESIGN_COLORS } from "./layout";
import {
  selectActiveBackground,
  selectActiveLines,
  selectActiveVisuals
} from "./selection";
import { SubtitleLayer } from "./subtitle";
import { PhotoVisual, VideoVisual } from "./visuals";

function RenderVisual({
  manifest,
  visual
}: {
  manifest: RenderManifest;
  visual: RenderManifest["visuals"][number];
}): ReactNode {
  if (visual.kind === "video") {
    return <VideoVisual visual={visual} fps={manifest.fps} />;
  }
  if (visual.kind === "photo") {
    return <PhotoVisual visual={visual} />;
  }
  return <DocumentVisual visual={visual} />;
}

export function RenderManifestComposition(manifest: RenderManifest): ReactNode {
  const frame = useCurrentFrame();
  const background = selectActiveBackground(manifest, frame);
  const activeVisuals = selectActiveVisuals(manifest, frame);
  const activeLines = selectActiveLines(manifest, frame);
  const prioritizeVisual = activeVisuals.some(
    (visual) => visual.display.prioritizeVisual
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: DESIGN_COLORS.background,
        overflow: "hidden",
        fontFamily: "Noto Sans JP, Arial, sans-serif"
      }}
    >
      <BackgroundVisual background={background?.background} />
      {activeVisuals.map((visual) => (
        <Sequence
          key={visual.id}
          from={visual.from}
          durationInFrames={visual.durationInFrames}
          layout="none"
          name={visual.id}
        >
          <RenderVisual manifest={manifest} visual={visual} />
        </Sequence>
      ))}
      <CharacterLayer
        manifest={manifest}
        frame={frame}
        prioritizeVisual={prioritizeVisual}
      />
      <SubtitleLayer manifest={manifest} lines={activeLines} />
    </AbsoluteFill>
  );
}
