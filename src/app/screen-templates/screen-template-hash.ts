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
  readonly slot?: string;
  readonly flipX?: boolean;
};

function renderContentElement(
  element: ScreenTemplateElement,
  orderIndex: number
): RenderContentElement {
  const base = {
    orderIndex,
    type: element.type,
    rect: element.transform.rect,
    rotationDeg: element.transform.rotationDeg
  };

  if (element.type === "dialogue-window" || element.type === "section-title") {
    return { ...base, fontSize: element.fontSize };
  }
  if (element.type === "character-visual") {
    return { ...base, slot: element.slot, flipX: element.flipX };
  }
  return { ...base, slot: element.slot };
}

/**
 * Computes the hash of render-affecting template content. Status, revision,
 * timestamps, name, description, and element IDs are deliberately excluded
 * so freshness can distinguish a semantic content change from bookkeeping or
 * catalog metadata updates.
 */
export function screenTemplateContentHash(template: ScreenTemplate): string {
  const canonical = {
    templateId: template.templateId,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    elements: template.elements.map(renderContentElement)
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
