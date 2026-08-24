import type { CSSProperties, ReactNode } from "react";

import type {
  CommonDisplay,
  RenderResolvedVisualDisplay,
  RenderResolvedVideoDisplayV25,
  StaticAnnotation
} from "../schema/index";

import { DESIGN_COLORS } from "./layout-helpers";

export { DESIGN_COLORS } from "./layout-helpers";

const ANNOTATION_CANVAS_WIDTH = 1920;
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

function annotationLength(value: number, responsive: boolean): string {
  return responsive
    ? `${(value / ANNOTATION_CANVAS_WIDTH) * 100}cqw`
    : `${value}px`;
}

export function AnnotationLayer({
  annotations,
  responsive = false
}: {
  annotations: readonly StaticAnnotation[];
  responsive?: boolean;
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
            border: `${annotationLength(4, responsive)} solid ${annotationColor(annotation)}`,
            borderRadius: annotationLength(8, responsive),
            boxSizing: "border-box"
          }}
        />
      );
    }

    if (annotation.kind === "arrow") {
      const width = annotation.width ?? 0.2;
      const height = annotation.height ?? 0;
      const angle = (Math.atan2(height, width) * 180) / Math.PI;
      const color = annotationColor(annotation);
      return (
        <div
          key={annotation.id}
          style={{
            ...baseStyle,
            width: `${Math.hypot(width, height) * 100}%`,
            height: annotationLength(22, responsive),
            transformOrigin: "left center",
            transform: `translateY(-50%) rotate(${angle}deg)`
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: annotationLength(14, responsive),
              top: "50%",
              height: annotationLength(5, responsive),
              transform: "translateY(-50%)",
              backgroundColor: color
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "50%",
              width: annotationLength(24, responsive),
              height: annotationLength(24, responsive),
              transform: "translateY(-50%)",
              backgroundColor: color,
              clipPath: "polygon(0 0, 100% 50%, 0 100%)"
            }}
          />
        </div>
      );
    }

    return (
      <div
        key={annotation.id}
        style={{
          ...baseStyle,
          transform: "translate(-50%, -50%)",
          padding: `${annotationLength(8, responsive)} ${annotationLength(14, responsive)}`,
          borderRadius: annotationLength(8, responsive),
          backgroundColor: "rgba(10, 18, 31, 0.86)",
          color: DESIGN_COLORS.card,
          fontSize: annotationLength(24, responsive),
          fontWeight: 700,
          whiteSpace: "nowrap"
        }}
      >
        {annotation.text ?? ""}
      </div>
    );
  });
}

function cropInnerStyle(display: Pick<CommonDisplay, "crop">): CSSProperties {
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

export function resolvedMediaFrameStyle(
  display: RenderResolvedVisualDisplay | RenderResolvedVideoDisplayV25
): CSSProperties {
  const { rect } = display.outerFrame;
  return {
    position: "absolute",
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.width * 100}%`,
    height: `${rect.height * 100}%`,
    transform: `rotate(${display.outerFrame.rotationDeg}deg)`,
    transformOrigin: "center center",
    overflow: "hidden",
    borderRadius: 24,
    backgroundColor: DESIGN_COLORS.card,
    boxShadow: "0 18px 50px rgba(5, 12, 24, 0.32)"
  };
}

function resolvedContentClipPath(
  display: RenderResolvedVisualDisplay | RenderResolvedVideoDisplayV25
): string {
  const { rect, rotationDeg } = display.contentClip.transform;
  const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height }
  ];
  const radians = (rotationDeg * Math.PI) / 180;
  return `polygon(${corners
    .map((corner) => {
      const dx = (corner.x - center.x) * 1920;
      const dy = (corner.y - center.y) * 1080;
      const x =
        center.x + (dx * Math.cos(radians) - dy * Math.sin(radians)) / 1920;
      const y =
        center.y + (dx * Math.sin(radians) + dy * Math.cos(radians)) / 1080;
      return `${x * 100}% ${y * 100}%`;
    })
    .join(", ")})`;
}

export function ResolvedMediaFrame({
  display,
  children
}: {
  display: RenderResolvedVisualDisplay | RenderResolvedVideoDisplayV25;
  children: ReactNode;
}): ReactNode {
  const frame = (
    <div style={resolvedMediaFrameStyle(display)}>
      <div style={cropInnerStyle(display)}>{children}</div>
      <AnnotationLayer annotations={display.annotations} />
    </div>
  );
  if (!display.contentClip.enabled) {
    return frame;
  }
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        clipPath: resolvedContentClipPath(display)
      }}
    >
      {frame}
    </div>
  );
}

export function MediaFrame({
  display,
  children
}: {
  display:
    CommonDisplay | RenderResolvedVisualDisplay | RenderResolvedVideoDisplayV25;
  children: ReactNode;
}): ReactNode {
  if ("outerFrame" in display) {
    return (
      <ResolvedMediaFrame display={display}>{children}</ResolvedMediaFrame>
    );
  }
  return (
    <div style={mediaFrameStyle(display)}>
      <div style={cropInnerStyle(display)}>{children}</div>
      <AnnotationLayer annotations={display.annotations} />
    </div>
  );
}
