import type { ReactNode } from "react";

import type { ResolvedScreenLayout } from "../schema/index";
import { screenTransformStyle } from "../screen-layout-resolver";
import { REMOTION_FONT_FAMILY } from "./font";
import { DESIGN_COLORS } from "./layout-helpers";
import {
  SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX,
  SECTION_TITLE_LINE_HEIGHT
} from "../screen-template-typography";

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
        lineHeight: SECTION_TITLE_LINE_HEIGHT,
        overflow: "hidden",
        overflowWrap: "anywhere",
        padding: `0 ${SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX}px`,
        textAlign: "center",
        whiteSpace: "normal",
        zIndex: 6
      }}
    >
      {title}
    </div>
  );
}
