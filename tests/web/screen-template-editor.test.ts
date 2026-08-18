import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  findScreenTemplateElement,
  moveScreenTemplateElement,
  normalizedPointerDelta,
  resizeScreenTemplateElement,
  rotationDeltaForPointer,
  screenTemplateValidationMessages,
  screenTemplateValidationWarningMessages,
  screenTemplateElementValidationWarningMessages,
  screenTemplateResizeHandlePosition,
  updateScreenTemplateElementNumericField
} from "../../src/web/screen-template-editor.js";
import {
  ScreenLayoutFrame,
  screenLayoutContentFrameStyle,
  screenLayoutContentInnerStyle,
  screenTemplateElementStyle,
  type ScreenLayoutPreview
} from "../../src/remotion/screen-template-layout.js";

const TIMESTAMP = "2026-08-18T00:00:00.000Z";

describe("ScreenTemplate editor geometry", () => {
  it("keeps pointer movement normalized to the logical canvas", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }

    const moved = moveScreenTemplateElement(content, 0.1, 0.05);
    expect(moved.transform.rect.x).toBeCloseTo(0.18);
    expect(moved.transform.rect.y).toBeCloseTo(0.24);
    expect(
      normalizedPointerDelta(
        { x: 100, y: 100 },
        { x: 196, y: 127 },
        { width: 960, height: 540 }
      )
    ).toEqual({ x: 0.1, y: 0.05 });
    expect(screenTemplateElementStyle(moved).left).toBe("18%");
  });

  it("keeps legacy media transforms canvas-relative while content-slot transforms stay inner", () => {
    const legacyDisplay = {
      fit: "cover",
      crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.8 },
      scale: 1.1,
      position: { x: 0.6, y: 0.4 },
      prioritizeVisual: false,
      annotations: [],
      displayCoordinateSpace: "legacy-media-frame"
    } as const;
    const relativeDisplay = {
      fit: "contain",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      scale: 1,
      position: { x: 0.5, y: 0.5 },
      prioritizeVisual: false,
      annotations: [],
      displayCoordinateSpace: "content-slot-relative"
    } as const;
    const legacy = screenLayoutContentFrameStyle(legacyDisplay);
    const relative = screenLayoutContentFrameStyle(relativeDisplay);

    expect(legacy).toMatchObject({
      height: "62%",
      left: "60%",
      top: "40%",
      width: "82%"
    });
    expect(relative).toMatchObject({
      height: "100%",
      left: "50%",
      top: "50%",
      width: "100%"
    });
    expect(screenLayoutContentInnerStyle(relativeDisplay)).toMatchObject({
      height: "100%",
      left: "0%",
      top: "0%",
      width: "100%"
    });
    expect(screenLayoutContentInnerStyle(legacyDisplay)).toMatchObject({
      height: "125%",
      left: "-50%",
      top: "-12.5%",
      width: "200%"
    });
  });

  it("renders content annotations through the shared screen layout frame", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const preview: ScreenLayoutPreview = {
      characters: {},
      content: {
        alt: "snapshot",
        src: "/snapshot.png",
        display: {
          annotations: [
            {
              id: "annotation-label",
              kind: "label",
              text: "重要な箇所",
              x: 0.2,
              y: 0.3,
              width: null,
              height: null,
              colorToken: "warning"
            }
          ],
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fit: "contain",
          position: { x: 0.5, y: 0.5 },
          prioritizeVisual: false,
          scale: 1
        }
      },
      dialogueText: "",
      sectionTitleText: ""
    };

    const markup = renderToStaticMarkup(
      createElement(ScreenLayoutFrame, { preview, template })
    );

    expect(markup).toContain("重要な箇所");
    expect(markup).toContain("font-size:1.25cqw");
  });

  it("resizes a rotated element using the element-local axes", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }
    const rotated = {
      ...content,
      transform: { ...content.transform, rotationDeg: 90 }
    };

    const resized = resizeScreenTemplateElement(
      rotated,
      "south-east",
      0,
      0.05,
      1920,
      1080
    );
    const startHandle = screenTemplateResizeHandlePosition(
      rotated,
      "south-east",
      1920,
      1080
    );
    const startAnchor = screenTemplateResizeHandlePosition(
      rotated,
      "north-west",
      1920,
      1080
    );
    const endHandle = screenTemplateResizeHandlePosition(
      resized,
      "south-east",
      1920,
      1080
    );
    const endAnchor = screenTemplateResizeHandlePosition(
      resized,
      "north-west",
      1920,
      1080
    );
    expect(resized.transform.rect.height).toBeCloseTo(0.62);
    expect(resized.transform.rect.width).toBeCloseTo(0.848125);
    expect(endHandle.x).toBeCloseTo(startHandle.x);
    expect(endHandle.y).toBeCloseTo(startHandle.y + 0.05);
    expect(endAnchor.x).toBeCloseTo(startAnchor.x);
    expect(endAnchor.y).toBeCloseTo(startAnchor.y);
  });

  it("keeps the opposite anchor fixed when a resize hits the canvas edge", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }

    const startAnchor = screenTemplateResizeHandlePosition(
      content,
      "north-west"
    );
    const resized = resizeScreenTemplateElement(content, "south-east", 0.2, 0);
    const endAnchor = screenTemplateResizeHandlePosition(resized, "north-west");
    const endHandle = screenTemplateResizeHandlePosition(resized, "south-east");

    expect(resized.transform.rect.x).toBeCloseTo(0.09);
    expect(resized.transform.rect.width).toBeCloseTo(0.91);
    expect(endAnchor.x).toBeCloseTo(startAnchor.x);
    expect(endAnchor.y).toBeCloseTo(startAnchor.y);
    expect(endHandle.x).toBeCloseTo(1);
  });

  it("does not shrink width when only the south edge exceeds the canvas", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }

    const startAnchor = screenTemplateResizeHandlePosition(
      content,
      "north-west"
    );
    const resized = resizeScreenTemplateElement(content, "south-east", 0, 0.4);
    const endAnchor = screenTemplateResizeHandlePosition(resized, "north-west");

    expect(resized.transform.rect.width).toBeCloseTo(0.82);
    expect(resized.transform.rect.height).toBeCloseTo(0.81);
    expect(endAnchor.x).toBeCloseTo(startAnchor.x);
    expect(endAnchor.y).toBeCloseTo(startAnchor.y);
  });

  it("clamps both requested axes together without collapsing either axis", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }

    const resized = resizeScreenTemplateElement(
      content,
      "south-east",
      0.2,
      0.4
    );

    expect(resized.transform.rect.width).toBeCloseTo(0.91);
    expect(resized.transform.rect.height).toBeCloseTo(0.8);
    expect(resized.transform.rect.x).toBeCloseTo(0.09);
    expect(resized.transform.rect.y).toBeCloseTo(0.19);
  });

  it("derives rotation from the pointer angle around the rect center", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const title = findScreenTemplateElement(
      template,
      "screen-template-standard-section-title"
    );
    if (title === undefined) {
      throw new Error("section title is missing");
    }

    expect(
      rotationDeltaForPointer(
        title,
        { x: 1060, y: 86.4 },
        { x: 960, y: 186.4 },
        { left: 0, top: 0, width: 1920, height: 1080 }
      )
    ).toBeCloseTo(90);
  });

  it("reports invalid geometry before a mutation is sent", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const invalid = updateScreenTemplateElementNumericField(
      template,
      "screen-template-standard-content-slot",
      "x",
      0.12
    );
    expect(screenTemplateValidationMessages(invalid)).toEqual([]);

    const invalidRotation = updateScreenTemplateElementNumericField(
      invalid,
      "screen-template-standard-section-title",
      "rotationDeg",
      45
    );
    expect(screenTemplateValidationMessages(invalidRotation)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("rotation around the rect center")
      ])
    );
  });

  it("exposes validator overlap warnings without turning them into errors", () => {
    const template = createStandardScreenTemplate(TIMESTAMP);
    const content = findScreenTemplateElement(
      template,
      "screen-template-standard-content-slot"
    );
    if (content === undefined) {
      throw new Error("content slot is missing");
    }
    const covering = {
      ...template,
      elements: template.elements.map((element) =>
        element.elementId === content.elementId
          ? {
              ...element,
              transform: {
                ...element.transform,
                rect: { x: 0, y: 0, width: 1, height: 1 }
              }
            }
          : element
      )
    };

    expect(screenTemplateValidationMessages(covering)).toEqual([]);
    expect(screenTemplateValidationWarningMessages(covering)).toEqual(
      expect.arrayContaining([expect.stringContaining("fully covers earlier")])
    );
    expect(
      screenTemplateElementValidationWarningMessages(
        covering,
        content.elementId
      )
    ).toEqual(
      expect.arrayContaining([expect.stringContaining("fully covers earlier")])
    );
  });
});
