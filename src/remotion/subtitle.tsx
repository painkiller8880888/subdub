import type { ReactNode } from "react";

import type { CSSProperties } from "react";
import type {
  RenderLine,
  RenderManifest,
  ResolvedScreenLayout
} from "../schema/index";
import { screenTransformStyle } from "../screen-layout-resolver";
import { REMOTION_FONT_FAMILY } from "./font";
import { DESIGN_COLORS } from "./layout";
import {
  resolveSubtitleContent,
  subtitleContainerStyle,
  subtitleTypographyScaleForFontSize
} from "./layout-helpers";

export function SubtitleLayer({
  manifest,
  lines,
  layout
}: {
  manifest: RenderManifest;
  lines: readonly RenderLine[];
  layout?: ResolvedScreenLayout;
}): ReactNode {
  const line = lines[0];
  if (line === undefined || line.subtitleText.length === 0) {
    return null;
  }

  const { displayName, side, speakerColor, subtitleText } =
    resolveSubtitleContent(manifest, line);
  const dialogueElement =
    layout === undefined
      ? undefined
      : layout.elements.find(
          (
            element
          ): element is Extract<
            ResolvedScreenLayout["elements"][number],
            { type: "dialogue-window" }
          > => element.type === "dialogue-window"
        );
  const dialogueFontSize = dialogueElement?.fontSize ?? 38;
  const typographyScale = subtitleTypographyScaleForFontSize(
    displayName,
    subtitleText,
    dialogueFontSize
  );
  const containerStyle: CSSProperties =
    dialogueElement === undefined
      ? subtitleContainerStyle(side)
      : {
          ...screenTransformStyle(dialogueElement.transform),
          zIndex: 5,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: side === "left" ? "flex-start" : "flex-end",
          pointerEvents: "none"
        };

  return (
    <div style={containerStyle}>
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
            fontSize: dialogueFontSize * (26 / 38) * typographyScale
          }}
        >
          {displayName}
        </div>
        <div
          style={{
            fontSize: dialogueFontSize * typographyScale,
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
