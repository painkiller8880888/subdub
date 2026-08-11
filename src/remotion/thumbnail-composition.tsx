import type { CSSProperties, ReactNode } from "react";

import { AbsoluteFill, Img, staticFile } from "remotion";

import { REMOTION_FONT_FAMILY, RemotionFontLoader } from "./font";
import { DESIGN_COLORS } from "./layout-helpers";
import type { StandardThumbnailCompositionInput } from "./thumbnail-spec";

function hasOptionalText(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function titleFontSize(title: string): number {
  const characterCount = Math.max(1, Array.from(title).length);
  const estimatedSize = Math.sqrt((300 * 760) / (characterCount * 1.12));
  return Math.max(28, Math.min(86, Math.floor(estimatedSize)));
}

function imageSource(relativePath: string): string {
  return staticFile(relativePath);
}

function OptionalText({
  children,
  style
}: {
  children: string;
  style: CSSProperties;
}): ReactNode {
  return <div style={style}>{children}</div>;
}

export function StandardThumbnailComposition({
  thumbnail,
  characterImagePath
}: StandardThumbnailCompositionInput): ReactNode {
  const subtitle = hasOptionalText(thumbnail.subtitle)
    ? thumbnail.subtitle
    : null;
  const manualVersion = hasOptionalText(thumbnail.manualVersion)
    ? thumbnail.manualVersion
    : null;
  const titleSize = titleFontSize(thumbnail.title);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: DESIGN_COLORS.background,
        color: DESIGN_COLORS.card,
        overflow: "hidden",
        fontFamily: REMOTION_FONT_FAMILY
      }}
    >
      <RemotionFontLoader />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(135deg, #17243a 0%, #234b70 54%, #3b315d 100%)"
        }}
      />
      {thumbnail.backgroundImage !== null ? (
        <Img
          src={imageSource(thumbnail.backgroundImage)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            opacity: 0.5,
            filter: "saturate(0.75) contrast(1.08)"
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(12, 23, 40, 0.94) 0%, rgba(18, 38, 64, 0.72) 53%, rgba(18, 26, 52, 0.38) 100%)"
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -210,
          right: -140,
          width: 560,
          height: 560,
          border: `2px solid ${DESIGN_COLORS.accent}`,
          borderRadius: "50%",
          opacity: 0.42
        }}
      />
      <div
        style={{
          position: "absolute",
          top: -110,
          right: 80,
          width: 420,
          height: 420,
          border: `1px solid ${DESIGN_COLORS.caution}`,
          borderRadius: "50%",
          opacity: 0.3
        }}
      />

      <div
        style={{
          position: "absolute",
          zIndex: 3,
          left: 78,
          top: 72,
          width: 760,
          height: 570,
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start"
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            maxWidth: 700,
            padding: "9px 18px",
            border: `1px solid ${DESIGN_COLORS.accent}`,
            borderRadius: 999,
            backgroundColor: "rgba(23, 36, 58, 0.72)",
            color: "#d9efff",
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "0.03em",
            lineHeight: 1.2,
            overflowWrap: "anywhere"
          }}
        >
          {thumbnail.departmentOrSystem}
        </div>
        <div
          style={{
            width: "100%",
            maxHeight: 320,
            marginTop: 24,
            color: DESIGN_COLORS.card,
            fontSize: titleSize,
            fontWeight: 800,
            letterSpacing: "0.01em",
            lineHeight: 1.08,
            overflow: "hidden",
            overflowWrap: "anywhere",
            wordBreak: "break-word",
            textShadow: "0 4px 14px rgba(4, 12, 24, 0.42)"
          }}
        >
          {thumbnail.title}
        </div>
        {subtitle !== null ? (
          <OptionalText
            style={{
              maxWidth: 700,
              marginTop: 22,
              color: "#d9e8f5",
              fontSize: 29,
              fontWeight: 500,
              lineHeight: 1.3,
              overflowWrap: "anywhere",
              wordBreak: "break-word"
            }}
          >
            {subtitle}
          </OptionalText>
        ) : null}
        <div
          style={{
            width: 142,
            height: 7,
            marginTop: 24,
            borderRadius: 999,
            backgroundColor: DESIGN_COLORS.caution
          }}
        />
        {manualVersion !== null ? (
          <OptionalText
            style={{
              position: "absolute",
              left: 0,
              bottom: 4,
              color: "#c7d8e8",
              fontSize: 23,
              fontWeight: 600,
              letterSpacing: "0.04em"
            }}
          >
            {`マニュアル ${manualVersion}`}
          </OptionalText>
        ) : null}
      </div>

      {thumbnail.representativeVisualPath !== null ? (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            top: 126,
            right: 70,
            width: 370,
            height: 244,
            padding: 10,
            boxSizing: "border-box",
            border: "2px solid rgba(255, 255, 255, 0.72)",
            borderRadius: 18,
            backgroundColor: "rgba(255, 255, 255, 0.18)",
            boxShadow: "0 16px 28px rgba(4, 12, 24, 0.3)"
          }}
        >
          <Img
            src={imageSource(thumbnail.representativeVisualPath)}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              borderRadius: 10,
              objectFit: "cover"
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 22,
              bottom: 20,
              padding: "5px 10px",
              borderRadius: 6,
              backgroundColor: "rgba(10, 18, 31, 0.82)",
              color: DESIGN_COLORS.card,
              fontSize: 17,
              fontWeight: 700
            }}
          >
            代表ビジュアル
          </div>
        </div>
      ) : null}

      {characterImagePath !== null ? (
        <Img
          src={imageSource(characterImagePath)}
          style={{
            position: "absolute",
            zIndex: 4,
            right: 26,
            bottom: -4,
            width: 330,
            height: 420,
            objectFit: "contain",
            objectPosition: "bottom center",
            filter: "drop-shadow(0 14px 18px rgba(4, 12, 24, 0.34))"
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          zIndex: 5,
          left: 78,
          right: 78,
          bottom: 34,
          height: 2,
          backgroundColor: "rgba(217, 239, 255, 0.34)"
        }}
      />
    </AbsoluteFill>
  );
}
