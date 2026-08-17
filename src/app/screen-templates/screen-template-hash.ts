import { createHash } from "node:crypto";

import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "../../schema/screen-template.js";

type RenderContentElement = {
  readonly elementId: string;
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
    elementId: element.elementId,
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
 * and timestamps are deliberately excluded so freshness can distinguish a
 * semantic content change from bookkeeping-only updates.
 */
export function screenTemplateContentHash(template: ScreenTemplate): string {
  const canonical = {
    templateId: template.templateId,
    name: template.name,
    description: template.description,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    elements: template.elements.map(renderContentElement)
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
