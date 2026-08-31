import type {
  LineOverlay,
  LineOverlayKind,
  LineOverlayTransform
} from "../schema/index.js";

export const MIN_LINE_OVERLAY_SIZE = 0.02;
export const MAX_LINE_OVERLAY_SIZE = 1.5;
export const MIN_LINE_OVERLAY_VISIBLE_FRACTION = 0.01;

export function lineOverlayKindLabel(kind: LineOverlayKind): string {
  switch (kind) {
    case "circle":
      return "円";
    case "box":
      return "四角";
    case "arrow":
      return "矢印";
    case "label":
      return "ラベル";
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function constrainLineOverlayTransform(
  transform: LineOverlayTransform
): LineOverlayTransform {
  const width = clamp(
    finiteOr(transform.width, 0.2),
    MIN_LINE_OVERLAY_SIZE,
    MAX_LINE_OVERLAY_SIZE
  );
  const height = clamp(
    finiteOr(transform.height, 0.2),
    MIN_LINE_OVERLAY_SIZE,
    MAX_LINE_OVERLAY_SIZE
  );
  return {
    x: clamp(
      finiteOr(transform.x, 0.1),
      -width + MIN_LINE_OVERLAY_VISIBLE_FRACTION,
      1 - MIN_LINE_OVERLAY_VISIBLE_FRACTION
    ),
    y: clamp(
      finiteOr(transform.y, 0.1),
      -height + MIN_LINE_OVERLAY_VISIBLE_FRACTION,
      1 - MIN_LINE_OVERLAY_VISIBLE_FRACTION
    ),
    width,
    height,
    rotationDeg: finiteOr(transform.rotationDeg, 0)
  };
}

function defaultTransform(
  kind: LineOverlayKind,
  index: number
): LineOverlayTransform {
  const offset = (index % 4) * 0.04;
  if (kind === "arrow") {
    return {
      x: 0.2 + offset,
      y: 0.42 + offset,
      width: 0.28,
      height: 0.08,
      rotationDeg: 0
    };
  }
  if (kind === "label") {
    return {
      x: 0.2 + offset,
      y: 0.18 + offset,
      width: 0.25,
      height: 0.1,
      rotationDeg: 0
    };
  }
  return {
    x: 0.2 + offset,
    y: 0.24 + offset,
    width: 0.24,
    height: 0.2,
    rotationDeg: 0
  };
}

export function createDefaultLineOverlay(
  id: string,
  lineId: string,
  kind: LineOverlayKind,
  index = 0
): LineOverlay {
  const base = {
    id,
    lineId,
    transform: constrainLineOverlayTransform(defaultTransform(kind, index)),
    colorToken: "accent" as const,
    animation: "none" as const
  };
  return kind === "label"
    ? { ...base, kind, text: "注目" }
    : { ...base, kind, text: null };
}

export function replaceLineOverlays(
  overlays: readonly LineOverlay[],
  lineId: string,
  nextLineOverlays: readonly LineOverlay[]
): LineOverlay[] {
  const firstIndex = overlays.findIndex((overlay) => overlay.lineId === lineId);
  const remaining = overlays.filter((overlay) => overlay.lineId !== lineId);
  if (firstIndex < 0) {
    return [...remaining, ...nextLineOverlays];
  }
  const prefixCount = overlays
    .slice(0, firstIndex)
    .filter((overlay) => overlay.lineId !== lineId).length;
  return [
    ...remaining.slice(0, prefixCount),
    ...nextLineOverlays,
    ...remaining.slice(prefixCount)
  ];
}
