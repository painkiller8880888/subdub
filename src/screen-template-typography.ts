export const SUBTITLE_SAFE_AREA_PX = 60 as const;
export const SUBTITLE_SAFE_AREA_WIDTH_PX = 1800 as const;
export const SUBTITLE_SAFE_AREA_HEIGHT_PX = 960 as const;

/** Horizontal padding is the combined left and right value. */
export const SUBTITLE_CARD_HORIZONTAL_PADDING_PX = 60 as const;
export const SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX =
  SUBTITLE_CARD_HORIZONTAL_PADDING_PX / 2;
export const SUBTITLE_CARD_VERTICAL_PADDING_PX = 32 as const;
export const SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX =
  SUBTITLE_CARD_VERTICAL_PADDING_PX / 2;

const SUBTITLE_ESTIMATED_GLYPH_WIDTH_EM = 2 as const;
export const SUBTITLE_BODY_FONT_SIZE_PX = 38 as const;
export const SUBTITLE_BODY_LINE_HEIGHT = 1.4 as const;
export const SUBTITLE_LABEL_FONT_SIZE_PX = 26 as const;
export const SUBTITLE_LABEL_FONT_SIZE_RATIO =
  SUBTITLE_LABEL_FONT_SIZE_PX / SUBTITLE_BODY_FONT_SIZE_PX;
export const SUBTITLE_LABEL_LINE_HEIGHT = 1.2 as const;
export const SUBTITLE_LABEL_MARGIN_BOTTOM_PX = 4 as const;

/** Horizontal padding is the combined left and right value. */
export const SECTION_TITLE_HORIZONTAL_PADDING_PX = 48 as const;
export const SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX =
  SECTION_TITLE_HORIZONTAL_PADDING_PX / 2;
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

export function estimateWrappedTextLineCount(
  text: string,
  maxWidthPx: number,
  fontSizePx: number,
  glyphWidthEm = 1
): number {
  if (text.length === 0) {
    return 0;
  }

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
  const labelFontSizePx = safeBodyFontSizePx * SUBTITLE_LABEL_FONT_SIZE_RATIO;
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
  const estimatedLabelHeight =
    labelLineCount === 0
      ? 0
      : labelLineCount * labelFontSizePx * SUBTITLE_LABEL_LINE_HEIGHT +
        SUBTITLE_LABEL_MARGIN_BOTTOM_PX;
  const estimatedTextHeightPx =
    estimatedLabelHeight +
    bodyLineCount * safeBodyFontSizePx * SUBTITLE_BODY_LINE_HEIGHT;
  const availableTextHeightPx =
    safeBounds.heightPx - SUBTITLE_CARD_VERTICAL_PADDING_PX;

  return {
    scale:
      estimatedTextHeightPx <= 0
        ? 1
        : Math.min(
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
