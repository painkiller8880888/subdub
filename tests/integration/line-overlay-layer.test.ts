import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  DEFAULT_SCREEN_LAYOUT_PREVIEW,
  ScreenLayoutFrame
} from "../../src/remotion/screen-template-layout.js";
import {
  LineOverlayLayer,
  type LineOverlayLayerItem
} from "../../src/remotion/line-overlay-layer.js";
import type { LineOverlay } from "../../src/schema/index.js";

const TIMESTAMP = "2026-08-18T00:00:00.000Z";

const overlay: LineOverlay = {
  id: "line-overlay-line-one-circle-1",
  lineId: "line-one",
  kind: "circle",
  transform: {
    x: 0.2,
    y: 0.2,
    width: 0.24,
    height: 0.2,
    rotationDeg: 0
  },
  colorToken: "accent",
  text: null,
  animation: "none"
};

function zIndexForClass(markup: string, className: string): number {
  const element = new RegExp(
    `<[^>]*class="[^"]*${className}[^"]*"[^>]*style="([^"]*)"`,
    "u"
  ).exec(markup)?.[1];
  const zIndex = /(?:^|;)z-index:([^;"]+)/u.exec(element ?? "")?.[1];
  if (zIndex === undefined) {
    throw new Error(`z-index is missing for ${className}`);
  }
  return Number(zIndex);
}

function shapeStyleForKind(markup: string, kind: "circle" | "box"): string {
  const style = new RegExp(
    `<div[^>]*class="line-overlay line-overlay-${kind}"[^>]*>.*?<span aria-hidden="true" style="([^"]*)"`,
    "su"
  ).exec(markup)?.[1];
  if (style === undefined) {
    throw new Error(`shape style is missing for ${kind}`);
  }
  return style;
}

describe("LineOverlayLayer fixed z-order", () => {
  it("renders Remotion overlays above generic content and below characters", () => {
    const markup = renderToStaticMarkup(
      createElement(LineOverlayLayer, {
        overlays: [overlay as LineOverlayLayerItem]
      })
    );

    expect(zIndexForClass(markup, "line-overlay-circle")).toBe(2);
  });

  it("keeps the Web preview order background, content, overlay, character, and text", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const preview = {
      ...DEFAULT_SCREEN_LAYOUT_PREVIEW,
      characters: {
        "speaker-1": { src: "/character.png", alt: "character" }
      },
      content: { src: "/generic.png", alt: "generic" },
      dialogueText: "字幕",
      lineOverlays: [overlay],
      sectionTitleText: "タイトル"
    };
    const markup = renderToStaticMarkup(
      createElement(ScreenLayoutFrame, { preview, template })
    );

    expect([
      zIndexForClass(markup, "screen-layout-content"),
      zIndexForClass(markup, "line-overlay-circle"),
      zIndexForClass(markup, "screen-layout-character"),
      zIndexForClass(markup, "screen-layout-dialogue"),
      zIndexForClass(markup, "screen-layout-section-title")
    ]).toEqual([1, 2, 3, 5, 6]);
  });

  it("renders circles and boxes as transparent outlines that fill their bounds", () => {
    const markup = renderToStaticMarkup(
      createElement(LineOverlayLayer, {
        overlays: [
          overlay as LineOverlayLayerItem,
          {
            ...overlay,
            id: "line-overlay-line-one-box-1",
            kind: "box"
          } as LineOverlayLayerItem
        ]
      })
    );

    for (const kind of ["circle", "box"] as const) {
      const style = shapeStyleForKind(markup, kind);
      expect(style).toContain("background-color:transparent");
      expect(style).toContain("border-style:solid");
      expect(style).toContain("display:block");
      expect(style).toContain("height:100%");
      expect(style).toContain("width:100%");
    }
  });

  it("scales the arrow shaft and head together inside the overlay bounds", () => {
    const markup = renderToStaticMarkup(
      createElement(LineOverlayLayer, {
        overlays: [
          {
            ...overlay,
            id: "line-overlay-line-one-arrow-1",
            kind: "arrow"
          } as LineOverlayLayerItem
        ]
      })
    );

    expect(markup).toContain('preserveAspectRatio="none"');
    expect(markup).toContain('viewBox="0 0 100 100"');
    expect(markup).toContain('d="M4 35 H70 V10 L100 50 L70 90 V65 H4 Z"');
  });
});
