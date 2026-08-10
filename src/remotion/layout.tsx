import type { CSSProperties, ReactNode } from "react";

import type { CommonDisplay, StaticAnnotation } from "../schema/index";

export const DESIGN_COLORS = {
  background: "#17243a",
  accent: "#64b5f6",
  caution: "#ffb74d",
  warning: "#ef5350",
  card: "#ffffff",
  text: "#17212f",
  subtitleBackground: "rgba(10, 18, 31, 0.84)"
} as const;

const visualWidth = "82%";
const visualHeight = "62%";

export const mediaAssetStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  objectPosition: "center center"
};

function annotationColor(annotation: StaticAnnotation): string {
  return DESIGN_COLORS[annotation.colorToken];
}

function annotationStyle(annotation: StaticAnnotation): CSSProperties {
  return {
    position: "absolute",
    left: `${annotation.x * 100}%`,
    top: `${annotation.y * 100}%`,
    color: annotationColor(annotation),
    pointerEvents: "none"
  };
}

function AnnotationLayer({
  annotations
}: {
  annotations: readonly StaticAnnotation[];
}): ReactNode {
  return annotations.map((annotation) => {
    const baseStyle = annotationStyle(annotation);
    if (annotation.kind === "box") {
      return (
        <div
          key={annotation.id}
          style={{
            ...baseStyle,
            width: `${(annotation.width ?? 0.2) * 100}%`,
            height: `${(annotation.height ?? 0.2) * 100}%`,
            border: `4px solid ${annotationColor(annotation)}`,
            borderRadius: 8,
            boxSizing: "border-box"
          }}
        />
      );
    }

    if (annotation.kind === "arrow") {
      const width = annotation.width ?? 0.2;
      const height = annotation.height ?? 0;
      const angle = (Math.atan2(height, width) * 180) / Math.PI;
      return (
        <div
          key={annotation.id}
          style={{
            ...baseStyle,
            width: `${Math.hypot(width, height) * 100}%`,
            height: 5,
            backgroundColor: annotationColor(annotation),
            transformOrigin: "left center",
            transform: `translateY(-50%) rotate(${angle}deg)`
          }}
        />
      );
    }

    return (
      <div
        key={annotation.id}
        style={{
          ...baseStyle,
          transform: "translate(-50%, -50%)",
          padding: "8px 14px",
          borderRadius: 8,
          backgroundColor: "rgba(10, 18, 31, 0.86)",
          color: DESIGN_COLORS.card,
          fontSize: 24,
          fontWeight: 700,
          whiteSpace: "nowrap"
        }}
      >
        {annotation.text ?? ""}
      </div>
    );
  });
}

function cropInnerStyle(display: CommonDisplay): CSSProperties {
  const { crop } = display;
  return {
    position: "absolute",
    left: `${(-crop.x / crop.width) * 100}%`,
    top: `${(-crop.y / crop.height) * 100}%`,
    width: `${(1 / crop.width) * 100}%`,
    height: `${(1 / crop.height) * 100}%`
  };
}

export function mediaFrameStyle(display: CommonDisplay): CSSProperties {
  return {
    position: "absolute",
    left: `${display.position.x * 100}%`,
    top: `${display.position.y * 100}%`,
    width: visualWidth,
    height: visualHeight,
    transform: `translate(-50%, -50%) scale(${display.scale})`,
    transformOrigin: "center center",
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: DESIGN_COLORS.card,
    boxShadow: "0 18px 50px rgba(5, 12, 24, 0.32)"
  };
}

export function MediaFrame({
  display,
  children
}: {
  display: CommonDisplay;
  children: ReactNode;
}): ReactNode {
  return (
    <div style={mediaFrameStyle(display)}>
      <div style={cropInnerStyle(display)}>{children}</div>
      <AnnotationLayer annotations={display.annotations} />
    </div>
  );
}
