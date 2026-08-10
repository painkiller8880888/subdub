import type { ReactNode } from "react";

import type { RenderLine, RenderManifest } from "../schema/index";
import { DESIGN_COLORS } from "./layout";
import {
  resolveSubtitleContent,
  subtitleContainerStyle
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

  return (
    <div style={subtitleContainerStyle(side)}>
      <div
        style={{
          width: "fit-content",
          maxWidth: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          padding: "16px 30px",
          borderRadius: 16,
          backgroundColor: DESIGN_COLORS.subtitleBackground,
          color: DESIGN_COLORS.card,
          fontFamily: "Noto Sans JP, Arial, sans-serif",
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
            fontSize: 26,
            fontWeight: 800,
            lineHeight: 1.2,
            marginBottom: 4,
            whiteSpace: "nowrap"
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: 38,
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
