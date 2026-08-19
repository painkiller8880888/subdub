import type { CSSProperties } from "react";

import type {
  RenderCharacter,
  RenderLine,
  RenderManifest
} from "../schema/index.js";

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

export const SUBTITLE_SAFE_AREA_PX = 60 as const;
export const SUBTITLE_SAFE_AREA_WIDTH_PX = 1800 as const;
export const SUBTITLE_SAFE_AREA_HEIGHT_PX = 960 as const;

export const SUBTITLE_CARD_HORIZONTAL_PADDING_PX = 60 as const;
export const SUBTITLE_CARD_VERTICAL_PADDING_PX = 32 as const;
const SUBTITLE_ESTIMATED_GLYPH_WIDTH_EM = 2 as const;
const SUBTITLE_BODY_FONT_SIZE_PX = 38 as const;
export const SUBTITLE_BODY_LINE_HEIGHT = 1.4 as const;
const SUBTITLE_LABEL_FONT_SIZE_PX = 26 as const;
export const SUBTITLE_LABEL_LINE_HEIGHT = 1.2 as const;
export const SUBTITLE_LABEL_MARGIN_BOTTOM_PX = 4 as const;

export const SECTION_TITLE_HORIZONTAL_PADDING_PX = 48 as const;
export const SECTION_TITLE_LINE_HEIGHT = 1.2 as const;

export type SubtitleTypographyBounds = Readonly<{
  widthPx: number;
  heightPx: number;
}>;

export type SubtitleTypographyMetrics = Readonly<{
  scale: number;
  contentWidthPx: number;
  availableTextHeightPx: number;
  labelLineCount: number;
  bodyLineCount: number;
  estimatedTextHeightPx: number;
}>;

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

export function estimateWrappedTextLineCount(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  glyphWidthEm = 1
): number {
  const charactersPerLine = Math.max(
    1,
    Math.floor(maxWidthPx / (fontSizePx * glyphWidthEm))
  );

  return text.split(/\r\n|\r|\n/).reduce((lineCount, line) => {
    const characterCount = Array.from(line).length;
    return (
      lineCount + Math.max(1, Math.ceil(characterCount / charactersPerLine))
    );
  }, 0);
}

function subtitleTypographyBounds(
  bounds: SubtitleTypographyBounds | undefined
): SubtitleTypographyBounds {
  return (
    bounds ?? {
      widthPx: SUBTITLE_SAFE_AREA_WIDTH_PX,
      heightPx: SUBTITLE_SAFE_AREA_HEIGHT_PX
    }
  );
}

export function subtitleTypographyMetricsForFontSize(
  displayName: string,
  subtitleText: string,
  bodyFontSizePx: number,
  bounds?: SubtitleTypographyBounds
): SubtitleTypographyMetrics {
  const safeBodyFontSizePx = Math.max(1, bodyFontSizePx);
  const safeBounds = subtitleTypographyBounds(bounds);
  const contentWidthPx = Math.max(
    0,
    safeBounds.widthPx - SUBTITLE_CARD_HORIZONTAL_PADDING_PX
  );
  const labelFontSizePx =
    safeBodyFontSizePx *
    (SUBTITLE_LABEL_FONT_SIZE_PX / SUBTITLE_BODY_FONT_SIZE_PX);
  const labelLineCount = estimateWrappedTextLineCount(
    displayName,
    contentWidthPx,
    labelFontSizePx,
    SUBTITLE_ESTIMATED_GLYPH_WIDTH_EM
  );
  const bodyLineCount = estimateWrappedTextLineCount(
    subtitleText,
    contentWidthPx,
    safeBodyFontSizePx,
    SUBTITLE_ESTIMATED_GLYPH_WIDTH_EM
  );
  const estimatedTextHeightPx =
    labelLineCount * labelFontSizePx * SUBTITLE_LABEL_LINE_HEIGHT +
    SUBTITLE_LABEL_MARGIN_BOTTOM_PX +
    bodyLineCount * safeBodyFontSizePx * SUBTITLE_BODY_LINE_HEIGHT;
  const availableTextHeightPx =
    safeBounds.heightPx - SUBTITLE_CARD_VERTICAL_PADDING_PX;

  return {
    scale: Math.min(
      1,
      Math.max(0, availableTextHeightPx / estimatedTextHeightPx)
    ),
    contentWidthPx,
    availableTextHeightPx,
    labelLineCount,
    bodyLineCount,
    estimatedTextHeightPx
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
  bodyFontSizePx: number,
  bounds?: SubtitleTypographyBounds
): number {
  return subtitleTypographyMetricsForFontSize(
    displayName,
    subtitleText,
    bodyFontSizePx,
    bounds
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
