import type { ReactNode } from "react";

import type { ResolvedScreenLayout } from "../schema/index";
import { screenTransformStyle } from "../screen-layout-resolver";
import { REMOTION_FONT_FAMILY } from "./font";
import { DESIGN_COLORS } from "./layout";

export function SectionTitleLayer({
  layout,
  title
}: {
  layout?: ResolvedScreenLayout;
  title?: string;
}): ReactNode {
  if (layout === undefined || title === undefined || title.length === 0) {
    return null;
  }
  const element = layout.elements.find(
    (
      candidate
    ): candidate is Extract<
      ResolvedScreenLayout["elements"][number],
      { type: "section-title" }
    > => candidate.type === "section-title"
  );
  if (element === undefined) {
    return null;
  }
  return (
    <div
      aria-hidden="true"
      style={{
        ...screenTransformStyle(element.transform),
        alignItems: "center",
        color: DESIGN_COLORS.card,
        display: "flex",
        fontFamily: REMOTION_FONT_FAMILY,
        fontSize: element.fontSize,
        fontWeight: 800,
        justifyContent: "center",
        lineHeight: 1.2,
        overflow: "hidden",
        padding: "0 24px",
        textAlign: "center",
        zIndex: 6
      }}
    >
      {title}
    </div>
  );
}
