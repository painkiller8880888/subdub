import { createHash } from "node:crypto";

import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "../../schema/screen-template.js";

type RenderContentElement = {
  readonly orderIndex: number;
  readonly type: ScreenTemplateElement["type"];
  readonly rect: ScreenTemplateElement["transform"]["rect"];
  readonly rotationDeg: number;
  readonly fontSize?: number;
  readonly backgroundColor?: string;
  readonly backgroundOpacity?: number;
  readonly slot?: string;
  readonly flipX?: boolean;
};

function renderContentElement(
  element: ScreenTemplateElement,
  orderIndex: number,
  includeDialogueWindowSurface: boolean
): RenderContentElement {
  const base = {
    orderIndex,
    type: element.type,
    rect: element.transform.rect,
    rotationDeg: element.transform.rotationDeg
  };

  if (element.type === "dialogue-window") {
    return {
      ...base,
      fontSize: element.fontSize,
      ...(includeDialogueWindowSurface
        ? {
            backgroundColor: element.backgroundColor,
            backgroundOpacity: element.backgroundOpacity
          }
        : {})
    };
  }
  if (element.type === "section-title") {
    return { ...base, fontSize: element.fontSize };
  }
  if (element.type === "character-visual") {
    return { ...base, slot: element.slot, flipX: element.flipX };
  }
  return { ...base, slot: element.slot };
}

function contentHash(
  template: ScreenTemplate,
  includeDialogueWindowSurface: boolean
): string {
  const canonical = {
    templateId: template.templateId,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    elements: template.elements.map((element, orderIndex) =>
      renderContentElement(element, orderIndex, includeDialogueWindowSurface)
    )
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Computes the current hash of render-affecting template content. Status,
 * revision, timestamps, name, description, and element IDs are deliberately
 * excluded so freshness can distinguish a semantic content change from
 * bookkeeping or catalog metadata updates. RF-01 dialogue-window surface
 * settings are part of the current render identity.
 */
export function screenTemplateContentHash(template: ScreenTemplate): string {
  return contentHash(template, true);
}

/**
 * Computes the frozen pre-RF-01 hash used by RenderManifest 2.4.0 and 2.5.0.
 * The dialogue-window surface settings are intentionally excluded from this
 * compatibility identity.
 */
export function screenTemplateLegacyContentHash(
  template: ScreenTemplate
): string {
  return contentHash(template, false);
}
