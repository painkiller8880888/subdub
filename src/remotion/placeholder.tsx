import type { ReactNode } from "react";

import { AbsoluteFill } from "remotion";

import type { RenderInsert } from "../schema/index";
import { DESIGN_COLORS } from "./layout-helpers";

export function PlaceholderLayer({
  insert
}: {
  insert: RenderInsert;
}): ReactNode {
  return (
    <AbsoluteFill
      data-placeholder-slot={insert.slot}
      style={{
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: DESIGN_COLORS.background,
        color: DESIGN_COLORS.card,
        fontFamily: "Noto Sans JP, Arial, sans-serif"
      }}
    >
      <div
        style={{
          padding: "20px 36px",
          border: `2px solid ${DESIGN_COLORS.accent}`,
          borderRadius: 16,
          color: DESIGN_COLORS.card,
          fontSize: 48,
          fontWeight: 700,
          letterSpacing: "0.08em"
        }}
      >
        {insert.label}
      </div>
    </AbsoluteFill>
  );
}
