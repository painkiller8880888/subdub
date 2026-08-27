import { createHash } from "node:crypto";

import type { InsertTextTemplate } from "../../schema/insert-text-template.js";

/** Hash only the fields that affect the rendered overlay. */
export function insertTextTemplateContentHash(
  template: InsertTextTemplate
): string {
  const canonical = {
    templateId: template.templateId,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    textRect: template.textRect,
    rotationDeg: template.rotationDeg,
    fontSize: template.fontSize,
    fontWeight: template.fontWeight,
    textColor: template.textColor,
    textAlign: template.textAlign,
    verticalAlign: template.verticalAlign
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}
