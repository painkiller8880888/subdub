import type { CSSProperties, ReactNode } from "react";

import type {
  LineOverlay,
  LineOverlayAnimation,
  LineOverlayColorToken,
  RenderLineOverlay
} from "../schema/index";
import { DESIGN_COLORS } from "./layout-helpers";

export type LineOverlayLayerItem = Readonly<
  Omit<LineOverlay, "transform"> & {
    transform: LineOverlay["transform"];
  }
>;

const BLINK_PERIOD_FRAMES = 30;
const PULSE_PERIOD_FRAMES = 36;

export function lineOverlayAnimationOpacity(
  animation: LineOverlayAnimation,
  frame: number,
  from = 0
): number {
  const phaseFrame = Math.max(0, frame - from);
  if (animation === "blink") {
    return phaseFrame % BLINK_PERIOD_FRAMES < BLINK_PERIOD_FRAMES / 2
      ? 1
      : 0.18;
  }
  if (animation === "pulse") {
    return (
      0.55 +
      0.45 *
        ((1 + Math.sin((phaseFrame / PULSE_PERIOD_FRAMES) * Math.PI * 2)) / 2)
    );
  }
  return 1;
}

export function renderManifestLineOverlayToLayerItem(
  overlay: RenderLineOverlay,
  canvasWidth: number,
  canvasHeight: number
): LineOverlayLayerItem {
  return {
    id: overlay.id,
    lineId: overlay.lineId,
    kind: overlay.kind,
    transform: {
      x: overlay.resolvedTransform.x / canvasWidth,
      y: overlay.resolvedTransform.y / canvasHeight,
      width: overlay.resolvedTransform.width / canvasWidth,
      height: overlay.resolvedTransform.height / canvasHeight,
      rotationDeg: overlay.resolvedTransform.rotationDeg
    },
    colorToken: overlay.colorToken,
    text: overlay.text,
    animation: overlay.animation
  } as LineOverlayLayerItem;
}

function colorForToken(token: LineOverlayColorToken): string {
  return DESIGN_COLORS[token];
}

function overlayFrameStyle(
  overlay: LineOverlayLayerItem,
  frame: number,
  from: number
): CSSProperties {
  const { x, y, width, height, rotationDeg } = overlay.transform;
  return {
    boxSizing: "border-box",
    height: `${height * 100}%`,
    left: `${x * 100}%`,
    opacity: lineOverlayAnimationOpacity(overlay.animation, frame, from),
    pointerEvents: "none",
    position: "absolute",
    top: `${y * 100}%`,
    transform: `rotate(${rotationDeg}deg)`,
    transformOrigin: "center center",
    width: `${width * 100}%`,
    zIndex: 2
  };
}

function renderOverlayShape(
  overlay: LineOverlayLayerItem,
  color: string
): ReactNode {
  const strokeStyle: CSSProperties = {
    backgroundColor: "transparent",
    borderColor: color,
    borderStyle: "solid",
    borderWidth: "0.35cqw",
    boxSizing: "border-box",
    display: "block",
    height: "100%",
    width: "100%"
  };

  if (overlay.kind === "circle") {
    return (
      <span
        aria-hidden="true"
        style={{ ...strokeStyle, borderRadius: "50%" }}
      />
    );
  }
  if (overlay.kind === "box") {
    return <span aria-hidden="true" style={strokeStyle} />;
  }
  if (overlay.kind === "arrow") {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        preserveAspectRatio="none"
        style={{
          display: "block",
          height: "100%",
          width: "100%"
        }}
        viewBox="0 0 100 100"
      >
        <path d="M4 35 H70 V10 L100 50 L70 90 V65 H4 Z" fill={color} />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        alignItems: "center",
        backgroundColor: "rgba(10, 18, 31, 0.84)",
        border: `0.3cqw solid ${color}`,
        borderRadius: "0.7cqw",
        boxSizing: "border-box",
        color: "#fff",
        display: "flex",
        fontSize: "3cqw",
        fontWeight: 700,
        height: "100%",
        justifyContent: "center",
        lineHeight: 1.2,
        overflow: "hidden",
        padding: "0.8cqw 1.2cqw",
        textAlign: "center",
        whiteSpace: "pre-wrap",
        width: "100%"
      }}
    >
      {overlay.text}
    </span>
  );
}

export function LineOverlayLayer({
  overlays,
  frame = 0,
  from = 0
}: {
  readonly overlays: readonly LineOverlayLayerItem[];
  readonly frame?: number;
  readonly from?: number;
}): ReactNode {
  return overlays.map((overlay) => (
    <div
      aria-hidden="true"
      className={`line-overlay line-overlay-${overlay.kind}`}
      key={overlay.id}
      style={overlayFrameStyle(overlay, frame, from)}
    >
      {renderOverlayShape(overlay, colorForToken(overlay.colorToken))}
    </div>
  ));
}
