import type { CSSProperties } from "react";

import type {
  RenderCharacter,
  RenderLine,
  RenderManifest
} from "../schema/index.js";
import {
  SUBTITLE_BODY_FONT_SIZE_PX,
  SUBTITLE_SAFE_AREA_PX,
  subtitleTypographyMetricsForFontSize
} from "../screen-template-typography";
export {
  estimateWrappedTextLineCount,
  SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX,
  SECTION_TITLE_HORIZONTAL_PADDING_PX,
  SECTION_TITLE_LINE_HEIGHT,
  SUBTITLE_BODY_FONT_SIZE_PX,
  SUBTITLE_BODY_LINE_HEIGHT,
  SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX,
  SUBTITLE_CARD_HORIZONTAL_PADDING_PX,
  SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX,
  SUBTITLE_CARD_VERTICAL_PADDING_PX,
  SUBTITLE_LABEL_FONT_SIZE_PX,
  SUBTITLE_LABEL_FONT_SIZE_RATIO,
  SUBTITLE_LABEL_LINE_HEIGHT,
  SUBTITLE_LABEL_MARGIN_BOTTOM_PX,
  SUBTITLE_SAFE_AREA_HEIGHT_PX,
  SUBTITLE_SAFE_AREA_PX,
  SUBTITLE_SAFE_AREA_WIDTH_PX,
  subtitleTypographyMetricsForFontSize
} from "../screen-template-typography";
export type {
  SubtitleTypographyBounds,
  SubtitleTypographyMetrics
} from "../screen-template-typography";

export const DESIGN_COLORS = {
  background: "#17243a",
  accent: "#64b5f6",
  caution: "#ffb74d",
  warning: "#ef5350",
  card: "#ffffff",
  text: "#17212f",
  subtitleBackground: "rgba(10, 18, 31, 0.84)",
  "character.metan": "#e78ac3",
  "character.zundamon": "#75c97a"
} as const;

export type CharacterSide = "left" | "right";

export function characterSideForIndex(index: number): CharacterSide {
  if (index === 0) {
    return "left";
  }
  if (index === 1) {
    return "right";
  }
  throw new RangeError(`MVP character index is not supported: ${index}`);
}

export function resolveCharacterThemeColor(
  token: RenderCharacter["themeColorToken"] | string
): string {
  if (token === "character.metan") {
    return DESIGN_COLORS["character.metan"];
  }
  if (token === "character.zundamon") {
    return DESIGN_COLORS["character.zundamon"];
  }
  throw new Error(`Unknown character theme color token: ${token}`);
}

export function characterLayerStyle(
  index: number,
  prioritizeVisual: boolean,
  themeColorToken: string
): CSSProperties {
  const side = characterSideForIndex(index);
  const size = prioritizeVisual ? "18%" : "25%";
  return {
    position: "absolute",
    zIndex: 3,
    bottom: prioritizeVisual ? 142 : 124,
    [side]: "4%",
    width: size,
    height: "48%",
    objectFit: "contain",
    objectPosition: "bottom center",
    filter: "drop-shadow(0 12px 18px rgba(7, 16, 31, 0.28))",
    borderBottom: `7px solid ${resolveCharacterThemeColor(themeColorToken)}`
  };
}

export function subtitleContainerStyle(side: CharacterSide): CSSProperties {
  return {
    position: "absolute",
    zIndex: 5,
    left: SUBTITLE_SAFE_AREA_PX,
    right: SUBTITLE_SAFE_AREA_PX,
    top: SUBTITLE_SAFE_AREA_PX,
    bottom: SUBTITLE_SAFE_AREA_PX,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: side === "left" ? "flex-start" : "flex-end",
    pointerEvents: "none"
  };
}

export function subtitleTypographyScale(
  displayName: string,
  subtitleText: string
): number {
  return subtitleTypographyScaleForFontSize(
    displayName,
    subtitleText,
    SUBTITLE_BODY_FONT_SIZE_PX
  );
}

export function subtitleTypographyScaleForFontSize(
  displayName: string,
  subtitleText: string,
  bodyFontSizePx: number
): number {
  return subtitleTypographyMetricsForFontSize(
    displayName,
    subtitleText,
    bodyFontSizePx
  ).scale;
}

export type ResolvedSubtitleContent = Readonly<{
  displayName: string;
  subtitleText: string;
  side: CharacterSide;
  speakerColor: string;
}>;

export function resolveSubtitleContent(
  manifest: RenderManifest,
  line: RenderLine
): ResolvedSubtitleContent {
  const characterIndex = manifest.characters.findIndex(
    (character) => character.characterId === line.speakerId
  );
  if (characterIndex < 0) {
    throw new Error(
      `subtitle speaker is missing from the render manifest: ${line.speakerId}`
    );
  }
  const character = manifest.characters[characterIndex];
  if (character === undefined) {
    throw new Error(`subtitle speaker index is invalid: ${line.speakerId}`);
  }
  return {
    displayName: character.displayName,
    subtitleText: line.subtitleText,
    side: characterSideForIndex(characterIndex),
    speakerColor: resolveCharacterThemeColor(character.themeColorToken)
  };
}
