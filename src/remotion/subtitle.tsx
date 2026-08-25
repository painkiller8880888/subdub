import type { ReactNode } from "react";

import type { CSSProperties } from "react";
import type {
  RenderLine,
  RenderManifest,
  ResolvedScreenLayoutV26
} from "../schema/index";
import { screenTransformStyle } from "../screen-layout-resolver";
import {
  DEFAULT_DIALOGUE_WINDOW_GLOW_COLOR,
  dialogueWindowBackgroundColor,
  dialogueWindowTextShadow
} from "../screen-template-style";
import { REMOTION_FONT_FAMILY } from "./font";
import { DESIGN_COLORS } from "./layout";
import {
  SUBTITLE_BODY_LINE_HEIGHT,
  SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX,
  SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX
} from "../screen-template-typography";
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
  layout?: ResolvedScreenLayoutV26;
}): ReactNode {
  const line = lines[0];
  const subtitleText = line?.subtitleText ?? "";
  const glowColor =
    line === undefined
      ? DEFAULT_DIALOGUE_WINDOW_GLOW_COLOR
      : resolveSubtitleContent(manifest, line).glowColor;
  const dialogueElement =
    layout === undefined
      ? undefined
      : layout.elements.find(
          (
            element
          ): element is Extract<
            ResolvedScreenLayoutV26["elements"][number],
            { type: "dialogue-window" }
          > => element.type === "dialogue-window"
        );
  const dialogueFontSize = dialogueElement?.fontSize ?? 38;
  // Legacy manifests do not have a resolved ScreenTemplate layout and keep
  // the existing safe-area scaler. ScreenTemplate fontSize is authoritative;
  // overflow is reported before rendering instead of shrinking it here.
  const typographyScale =
    layout === undefined
      ? subtitleTypographyScaleForFontSize(subtitleText, dialogueFontSize)
      : 1;
  const containerStyle: CSSProperties =
    dialogueElement === undefined
      ? {
          ...subtitleContainerStyle("left"),
          alignItems: "center",
          backgroundColor: dialogueWindowBackgroundColor("#000000", 0.4),
          boxSizing: "border-box",
          borderRadius: 16,
          justifyContent: "center",
          overflow: "hidden",
          padding: `${SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX}px ${SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX}px`
        }
      : {
          ...screenTransformStyle(dialogueElement.transform),
          zIndex: 5,
          alignItems: "center",
          backgroundColor: dialogueWindowBackgroundColor(
            dialogueElement.backgroundColor,
            dialogueElement.backgroundOpacity
          ),
          boxSizing: "border-box",
          borderRadius: 16,
          display: "flex",
          justifyContent: "center",
          overflow: "hidden",
          padding: `${SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX}px ${SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX}px`,
          pointerEvents: "none"
        };

  return (
    <div style={containerStyle}>
      {subtitleText.length > 0 ? (
        <div
          style={{
            color: DESIGN_COLORS.card,
            fontFamily: REMOTION_FONT_FAMILY,
            fontSize: dialogueFontSize * typographyScale,
            fontWeight: 700,
            lineHeight: SUBTITLE_BODY_LINE_HEIGHT,
            maxWidth: "100%",
            minWidth: 0,
            overflowWrap: "anywhere",
            textAlign: "center",
            textShadow: dialogueWindowTextShadow(glowColor),
            whiteSpace: "pre-wrap",
            wordBreak: "break-word"
          }}
        >
          {subtitleText}
        </div>
      ) : null}
    </div>
  );
}
