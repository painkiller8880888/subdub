import type { ReactNode } from "react";

import type { RenderLine, RenderManifest } from "../schema/index";
import { REMOTION_FONT_FAMILY } from "./font";
import { DESIGN_COLORS } from "./layout";
import {
  resolveSubtitleContent,
  subtitleContainerStyle,
  subtitleTypographyScale
} from "./layout-helpers";

export function SubtitleLayer({
  manifest,
  lines
}: {
  manifest: RenderManifest;
  lines: readonly RenderLine[];
}): ReactNode {
  const line = lines[0];
  if (line === undefined || line.subtitleText.length === 0) {
    return null;
  }

  const { displayName, side, speakerColor, subtitleText } =
    resolveSubtitleContent(manifest, line);
  const typographyScale = subtitleTypographyScale(displayName, subtitleText);

  return (
    <div style={subtitleContainerStyle(side)}>
      <div
        style={{
          width: "fit-content",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          maxHeight: "100%",
          padding: "16px 30px",
          borderRadius: 16,
          backgroundColor: DESIGN_COLORS.subtitleBackground,
          color: DESIGN_COLORS.card,
          fontFamily: REMOTION_FONT_FAMILY,
          fontWeight: 700,
          lineHeight: 1.4,
          textAlign: side === "left" ? "left" : "right",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          display: "flex",
          flexDirection: "column",
          alignItems: side === "left" ? "flex-start" : "flex-end"
        }}
      >
        <div
          style={{
            color: speakerColor,
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: 4,
            maxWidth: "100%",
            minWidth: 0,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            fontSize: 26 * typographyScale
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: 38 * typographyScale,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            wordBreak: "break-word"
          }}
        >
          {subtitleText}
        </div>
      </div>
    </div>
  );
}
