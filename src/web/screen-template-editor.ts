import type {
  ScreenRect,
  ScreenTemplate,
  ScreenTemplateElement
} from "../schema/screen-template.js";
import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH
} from "../schema/screen-template.js";
import { screenTemplateValidationReport } from "../validation/screen-templates.js";

export type ResizeHandle =
  "north-west" | "north-east" | "south-east" | "south-west";

export type NumericElementField =
  "x" | "y" | "width" | "height" | "rotationDeg" | "fontSize";

export const SCREEN_TEMPLATE_MIN_ELEMENT_SIZE = 0.01;

export const SCREEN_TEMPLATE_ELEMENT_LABELS = {
  "dialogue-window": "セリフウィンドウ",
  "section-title": "セクション名",
  "character-visual": "話者ビジュアル",
  "content-slot": "コンテンツ予約領域"
} as const;

export function screenTemplateElementLabel(
  element: ScreenTemplateElement
): string {
  if (element.type === "character-visual") {
    return `${SCREEN_TEMPLATE_ELEMENT_LABELS[element.type]}（${element.slot}）`;
  }
  return SCREEN_TEMPLATE_ELEMENT_LABELS[element.type];
}

export function screenTemplateElementDescription(
  element: ScreenTemplateElement
): string {
  switch (element.type) {
    case "dialogue-window":
      return "サンプルセリフを表示する領域";
    case "section-title":
      return "サンプルセクション名を表示する領域";
    case "character-visual":
      return `${element.slot} の一時 preview 領域`;
    case "content-slot":
      return "primary content の一時 preview 領域";
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampScreenRect(
  rect: ScreenRect,
  minimumSize = SCREEN_TEMPLATE_MIN_ELEMENT_SIZE
): ScreenRect {
  const width = clamp(rect.width, minimumSize, 1);
  const height = clamp(rect.height, minimumSize, 1);
  return {
    height,
    width,
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height)
  };
}

function replaceElement(
  template: ScreenTemplate,
  elementId: string,
  replace: (element: ScreenTemplateElement) => ScreenTemplateElement
): ScreenTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.elementId === elementId ? replace(element) : element
    )
  };
}

export function findScreenTemplateElement(
  template: ScreenTemplate,
  elementId: string
): ScreenTemplateElement | undefined {
  return template.elements.find((element) => element.elementId === elementId);
}

export function updateScreenTemplateElementRect(
  template: ScreenTemplate,
  elementId: string,
  rect: ScreenRect
): ScreenTemplate {
  return replaceElement(template, elementId, (element) => ({
    ...element,
    transform: {
      ...element.transform,
      rect
    }
  }));
}

export function updateScreenTemplateElementRotation(
  template: ScreenTemplate,
  elementId: string,
  rotationDeg: number
): ScreenTemplate {
  return replaceElement(template, elementId, (element) => ({
    ...element,
    transform: {
      ...element.transform,
      rotationDeg
    }
  }));
}

export function updateScreenTemplateElementNumericField(
  template: ScreenTemplate,
  elementId: string,
  field: NumericElementField,
  value: number
): ScreenTemplate {
  if (!Number.isFinite(value)) {
    return template;
  }

  return replaceElement(template, elementId, (element) => {
    if (field === "rotationDeg") {
      return {
        ...element,
        transform: { ...element.transform, rotationDeg: value }
      };
    }

    if (field === "fontSize") {
      if (
        element.type !== "dialogue-window" &&
        element.type !== "section-title"
      ) {
        return element;
      }
      return { ...element, fontSize: value };
    }

    return {
      ...element,
      transform: {
        ...element.transform,
        rect: {
          ...element.transform.rect,
          [field]: value
        }
      }
    };
  });
}

export function moveScreenTemplateElement(
  element: ScreenTemplateElement,
  deltaX: number,
  deltaY: number
): ScreenTemplateElement {
  const rect = element.transform.rect;
  return {
    ...element,
    transform: {
      ...element.transform,
      rect: clampScreenRect({
        ...rect,
        x: rect.x + deltaX,
        y: rect.y + deltaY
      })
    }
  };
}

function rotateVectorToLocal(
  deltaX: number,
  deltaY: number,
  rotationDeg: number,
  canvasWidth: number,
  canvasHeight: number
): { readonly x: number; readonly y: number } {
  const radians = (-rotationDeg * Math.PI) / 180;
  const pixelX = deltaX * canvasWidth;
  const pixelY = deltaY * canvasHeight;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const localPixelX = pixelX * cosine - pixelY * sine;
  const localPixelY = pixelX * sine + pixelY * cosine;
  return {
    x: localPixelX / canvasWidth,
    y: localPixelY / canvasHeight
  };
}

export function resizeScreenTemplateElement(
  element: ScreenTemplateElement,
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  canvasWidth = SCREEN_TEMPLATE_CANVAS_WIDTH,
  canvasHeight = SCREEN_TEMPLATE_CANVAS_HEIGHT
): ScreenTemplateElement {
  const rect = element.transform.rect;
  const localDelta = rotateVectorToLocal(
    deltaX,
    deltaY,
    element.transform.rotationDeg,
    canvasWidth,
    canvasHeight
  );
  let nextRect = { ...rect };

  if (handle.includes("west")) {
    nextRect = {
      ...nextRect,
      x: rect.x + localDelta.x,
      width: rect.width - localDelta.x
    };
  } else if (handle.includes("east")) {
    nextRect = { ...nextRect, width: rect.width + localDelta.x };
  }

  if (handle.includes("north")) {
    nextRect = {
      ...nextRect,
      y: rect.y + localDelta.y,
      height: rect.height - localDelta.y
    };
  } else if (handle.includes("south")) {
    nextRect = { ...nextRect, height: rect.height + localDelta.y };
  }

  return {
    ...element,
    transform: {
      ...element.transform,
      rect: clampScreenRect(nextRect)
    }
  };
}

function pointerAngle(
  centerX: number,
  centerY: number,
  x: number,
  y: number
): number {
  return (Math.atan2(y - centerY, x - centerX) * 180) / Math.PI;
}

function shortestRotationDelta(start: number, current: number): number {
  return ((current - start + 540) % 360) - 180;
}

export function rotationDeltaForPointer(
  element: ScreenTemplateElement,
  startPointer: Readonly<{ x: number; y: number }>,
  currentPointer: Readonly<{ x: number; y: number }>,
  canvasRect: Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>
): number {
  const rect = element.transform.rect;
  const centerX =
    canvasRect.left + (rect.x + rect.width / 2) * canvasRect.width;
  const centerY =
    canvasRect.top + (rect.y + rect.height / 2) * canvasRect.height;
  const startAngle = pointerAngle(
    centerX,
    centerY,
    startPointer.x,
    startPointer.y
  );
  const currentAngle = pointerAngle(
    centerX,
    centerY,
    currentPointer.x,
    currentPointer.y
  );
  return shortestRotationDelta(startAngle, currentAngle);
}

export function normalizedPointerDelta(
  startPointer: Readonly<{ x: number; y: number }>,
  currentPointer: Readonly<{ x: number; y: number }>,
  canvasRect: Readonly<{ width: number; height: number }>
): { readonly x: number; readonly y: number } {
  return {
    x: (currentPointer.x - startPointer.x) / canvasRect.width,
    y: (currentPointer.y - startPointer.y) / canvasRect.height
  };
}

export function screenTemplateValidationMessages(
  template: ScreenTemplate
): string[] {
  return screenTemplateValidationReport(template).errors.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
}

export function screenTemplateElementValidationMessages(
  template: ScreenTemplate,
  elementId: string
): string[] {
  return screenTemplateValidationReport(template)
    .errors.filter((issue) => issue.path.includes("elements"))
    .filter((issue) => {
      const elementIndex = issue.path.indexOf("elements");
      const index = issue.path[elementIndex + 1];
      return (
        typeof index === "number" &&
        template.elements[index]?.elementId === elementId
      );
    })
    .map((issue) => issue.message);
}
