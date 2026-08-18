import { describe, expect, it } from "vitest";

import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import {
  findScreenTemplateElement,
  moveScreenTemplateElement,
  normalizedPointerDelta,
  resizeScreenTemplateElement,
  rotationDeltaForPointer,
  screenTemplateValidationMessages,
  updateScreenTemplateElementNumericField
} from "../../src/web/screen-template-editor.js";
import { screenTemplateElementStyle } from "../../src/remotion/screen-template-layout.js";

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
    expect(resized.transform.rect.height).toBeCloseTo(0.62);
    expect(resized.transform.rect.width).toBeCloseTo(0.848125);
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
});
