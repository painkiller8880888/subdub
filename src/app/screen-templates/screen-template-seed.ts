import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH,
  type ScreenTemplate,
  type ScreenTemplateElement
} from "../../schema/screen-template.js";
import { assertValidScreenTemplate } from "../../validation/screen-templates.js";

export const STANDARD_SCREEN_TEMPLATE_ID = "screen-template-standard" as const;

const CHARACTER_WIDTH = 0.25;
const CHARACTER_HEIGHT = 0.48;
const CHARACTER_LEFT = 0.04;
const CHARACTER_RIGHT = 1 - CHARACTER_LEFT - CHARACTER_WIDTH;
const CHARACTER_BOTTOM_PX = 124;
const CHARACTER_TOP =
  1 - CHARACTER_BOTTOM_PX / SCREEN_TEMPLATE_CANVAS_HEIGHT - CHARACTER_HEIGHT;

const STANDARD_ELEMENTS: readonly ScreenTemplateElement[] = [
  {
    elementId: "screen-template-standard-section-title",
    type: "section-title",
    transform: {
      rect: { x: 0.05, y: 0.03, width: 0.9, height: 0.1 },
      rotationDeg: 0
    },
    fontSize: 48
  },
  {
    elementId: "screen-template-standard-dialogue-window",
    type: "dialogue-window",
    transform: {
      rect: {
        x: 60 / SCREEN_TEMPLATE_CANVAS_WIDTH,
        y: 60 / SCREEN_TEMPLATE_CANVAS_HEIGHT,
        width:
          (SCREEN_TEMPLATE_CANVAS_WIDTH - 120) / SCREEN_TEMPLATE_CANVAS_WIDTH,
        height: 960 / SCREEN_TEMPLATE_CANVAS_HEIGHT
      },
      rotationDeg: 0
    },
    fontSize: 38
  },
  {
    elementId: "screen-template-standard-content-slot",
    type: "content-slot",
    transform: {
      rect: { x: 0.09, y: 0.19, width: 0.82, height: 0.62 },
      rotationDeg: 0
    },
    slot: "primary"
  },
  {
    elementId: "screen-template-standard-character-speaker-1",
    type: "character-visual",
    transform: {
      rect: {
        x: CHARACTER_LEFT,
        y: CHARACTER_TOP,
        width: CHARACTER_WIDTH,
        height: CHARACTER_HEIGHT
      },
      rotationDeg: 0
    },
    slot: "speaker-1",
    flipX: false
  },
  {
    elementId: "screen-template-standard-character-speaker-2",
    type: "character-visual",
    transform: {
      rect: {
        x: CHARACTER_RIGHT,
        y: CHARACTER_TOP,
        width: CHARACTER_WIDTH,
        height: CHARACTER_HEIGHT
      },
      rotationDeg: 0
    },
    slot: "speaker-2",
    flipX: false
  }
];

function cloneElement(element: ScreenTemplateElement): ScreenTemplateElement {
  return {
    ...element,
    transform: {
      ...element.transform,
      rect: { ...element.transform.rect }
    }
  };
}

/**
 * Returns the immutable canonical layout definition used by the standard
 * seed. Callers receive fresh objects so a user-edited template can never
 * mutate the reset source or the next startup seed.
 */
export function canonicalScreenTemplateDefaultElements(): ScreenTemplateElement[] {
  return STANDARD_ELEMENTS.map(cloneElement);
}

function canonicalElementOfType<TType extends ScreenTemplateElement["type"]>(
  elements: readonly ScreenTemplateElement[],
  type: TType
): Extract<ScreenTemplateElement, { type: TType }> | undefined {
  return elements.find(
    (element): element is Extract<ScreenTemplateElement, { type: TType }> =>
      element.type === type
  );
}

/**
 * Applies only canonical layout-editable values while preserving the
 * template's element IDs, order, and any metadata owned by the current row.
 */
export function resetScreenTemplateElementsToCanonicalDefaults(
  elements: readonly ScreenTemplateElement[]
): ScreenTemplateElement[] {
  const defaults = canonicalScreenTemplateDefaultElements();
  return elements.map((element) => {
    if (element.type === "dialogue-window") {
      const canonical = canonicalElementOfType(defaults, "dialogue-window");
      if (canonical === undefined) {
        return cloneElement(element);
      }
      return {
        ...element,
        transform: {
          ...element.transform,
          rect: { ...canonical.transform.rect },
          rotationDeg: canonical.transform.rotationDeg
        },
        fontSize: canonical.fontSize
      };
    }
    if (element.type === "section-title") {
      const canonical = canonicalElementOfType(defaults, "section-title");
      if (canonical === undefined) {
        return cloneElement(element);
      }
      return {
        ...element,
        transform: {
          ...element.transform,
          rect: { ...canonical.transform.rect },
          rotationDeg: canonical.transform.rotationDeg
        },
        fontSize: canonical.fontSize
      };
    }
    if (element.type === "content-slot") {
      const canonical = canonicalElementOfType(defaults, "content-slot");
      if (canonical === undefined) {
        return cloneElement(element);
      }
      return {
        ...element,
        transform: {
          ...element.transform,
          rect: { ...canonical.transform.rect },
          rotationDeg: canonical.transform.rotationDeg
        }
      };
    }

    const canonical = defaults.find(
      (
        candidate
      ): candidate is Extract<
        ScreenTemplateElement,
        { type: "character-visual" }
      > =>
        candidate.type === "character-visual" && candidate.slot === element.slot
    );
    if (canonical === undefined) {
      return cloneElement(element);
    }
    return {
      ...element,
      transform: {
        ...element.transform,
        rect: { ...canonical.transform.rect },
        rotationDeg: canonical.transform.rotationDeg
      },
      flipX: canonical.flipX
    };
  });
}

/**
 * The standard seed is an input fixture, not a runtime catalog. Existing
 * rows always win once the stable ID has been registered in SQLite.
 *
 * Geometry sources:
 * - dialogue-window: SubtitleLayer safe area (60px on each side/top/bottom),
 *   and the current 38px subtitle body font.
 * - content-slot: the documented legacy MediaFrame (82% x 62%) bounds.
 * - character-visual: characterLayerStyle's 4% side inset, 25% width, 48%
 *   height, and 124px normal-mode bottom offset.
 * - section-title: new canonical top band required by ST-00; it is not an
 *   extraction from an existing composition layer. The 5% side inset, 3% top
 *   inset, 10% height, and 48px title size are recorded design constants.
 */
export function createStandardScreenTemplate(
  timestamp: string
): ScreenTemplate {
  return assertValidScreenTemplate({
    templateId: STANDARD_SCREEN_TEMPLATE_ID,
    name: "Standard",
    description:
      "Canonical baseline for the current Remotion layout and the ST-00 section-title top band.",
    status: "active",
    canvasWidth: SCREEN_TEMPLATE_CANVAS_WIDTH,
    canvasHeight: SCREEN_TEMPLATE_CANVAS_HEIGHT,
    revision: 1,
    elements: canonicalScreenTemplateDefaultElements(),
    createdAt: timestamp,
    updatedAt: timestamp
  });
}
