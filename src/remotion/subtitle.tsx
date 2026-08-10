import type { ReactNode } from "react";

import type { RenderLine } from "../schema/index";
import { DESIGN_COLORS } from "./layout";

export function SubtitleLayer({
  lines
}: {
  lines: readonly RenderLine[];
}): ReactNode {
  const line = lines[0];
  if (line === undefined || line.subtitleText.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        position: "absolute",
        zIndex: 5,
        left: "9%",
        right: "9%",
        bottom: 48,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none"
      }}
    >
      <div
        style={{
          maxWidth: "82%",
          padding: "16px 30px",
          borderRadius: 16,
          backgroundColor: DESIGN_COLORS.subtitleBackground,
          color: DESIGN_COLORS.card,
          fontFamily: "Noto Sans JP, Arial, sans-serif",
          fontSize: 38,
          fontWeight: 700,
          lineHeight: 1.4,
          textAlign: "center",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere"
        }}
      >
        {line.subtitleText}
      </div>
    </div>
  );
}
