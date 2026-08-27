import type {
  ScreenRect,
  ScreenTemplate,
  ScreenTemplateElement
} from "../schema/screen-template.js";
import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH
} from "../schema/screen-template.js";
import {
  screenTemplateTextValidationIssues,
  screenTemplateValidationReport,
  type ScreenTemplateTextContent
} from "../validation/screen-templates.js";

export type ResizeHandle =
  "north-west" | "north-east" | "south-east" | "south-west";

export type NumericElementField =
  | "x"
  | "y"
  | "width"
  | "height"
  | "rotationDeg"
  | "fontSize"
  | "backgroundOpacity";

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

type ResizeCornerSigns = Readonly<{
  x: -1 | 1;
  y: -1 | 1;
}>;

type PixelPoint = Readonly<{
  x: number;
  y: number;
}>;

function resizeCornerSigns(handle: ResizeHandle): ResizeCornerSigns {
  return {
    x: handle.includes("west") ? -1 : 1,
    y: handle.includes("north") ? -1 : 1
  };
}

function oppositeResizeHandle(handle: ResizeHandle): ResizeHandle {
  switch (handle) {
    case "north-west":
      return "south-east";
    case "north-east":
      return "south-west";
    case "south-east":
      return "north-west";
    case "south-west":
      return "north-east";
  }
}

function rotatePixelVector(point: PixelPoint, rotationDeg: number): PixelPoint {
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return {
    x: point.x * cosine - point.y * sine,
    y: point.x * sine + point.y * cosine
  };
}

function addPixelPoints(left: PixelPoint, right: PixelPoint): PixelPoint {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtractPixelPoints(left: PixelPoint, right: PixelPoint): PixelPoint {
  return { x: left.x - right.x, y: left.y - right.y };
}

function rectCenterInPixels(
  element: ScreenTemplateElement,
  canvasWidth: number,
  canvasHeight: number
): PixelPoint {
  const { rect } = element.transform;
  return {
    x: (rect.x + rect.width / 2) * canvasWidth,
    y: (rect.y + rect.height / 2) * canvasHeight
  };
}

function resizeCornerPositionInPixels(
  element: ScreenTemplateElement,
  handle: ResizeHandle,
  canvasWidth: number,
  canvasHeight: number
): PixelPoint {
  const { rect, rotationDeg } = element.transform;
  const signs = resizeCornerSigns(handle);
  const localHalfSize = {
    x: (signs.x * (rect.width * canvasWidth)) / 2,
    y: (signs.y * (rect.height * canvasHeight)) / 2
  };
  return addPixelPoints(
    rectCenterInPixels(element, canvasWidth, canvasHeight),
    rotatePixelVector(localHalfSize, rotationDeg)
  );
}

export function screenTemplateResizeHandlePosition(
  element: ScreenTemplateElement,
  handle: ResizeHandle,
  canvasWidth = SCREEN_TEMPLATE_CANVAS_WIDTH,
  canvasHeight = SCREEN_TEMPLATE_CANVAS_HEIGHT
): PixelPoint {
  const position = resizeCornerPositionInPixels(
    element,
    handle,
    canvasWidth,
    canvasHeight
  );
  return {
    x: position.x / canvasWidth,
    y: position.y / canvasHeight
  };
}

function rectFromFixedCorner(
  anchor: PixelPoint,
  signs: ResizeCornerSigns,
  widthPx: number,
  heightPx: number,
  rotationDeg: number,
  canvasWidth: number,
  canvasHeight: number
): ScreenRect {
  const center = addPixelPoints(
    anchor,
    rotatePixelVector(
      {
        x: (signs.x * widthPx) / 2,
        y: (signs.y * heightPx) / 2
      },
      rotationDeg
    )
  );
  return {
    height: heightPx / canvasHeight,
    width: widthPx / canvasWidth,
    x: (center.x - widthPx / 2) / canvasWidth,
    y: (center.y - heightPx / 2) / canvasHeight
  };
}

function isRectInsideCanvas(rect: ScreenRect): boolean {
  const epsilon = 1e-8;
  return !(
    rect.x < -epsilon ||
    rect.y < -epsilon ||
    rect.x + rect.width > 1 + epsilon ||
    rect.y + rect.height > 1 + epsilon
  );
}

function clampResizeDimensions(
  startWidthPx: number,
  startHeightPx: number,
  requestedWidthPx: number,
  requestedHeightPx: number,
  minimumWidthPx: number,
  minimumHeightPx: number,
  anchor: PixelPoint,
  signs: ResizeCornerSigns,
  rotationDeg: number,
  canvasWidth: number,
  canvasHeight: number
): { readonly widthPx: number; readonly heightPx: number } {
  const requested = {
    heightPx: Math.max(minimumHeightPx, requestedHeightPx),
    widthPx: Math.max(minimumWidthPx, requestedWidthPx)
  };
  const isInside = (widthPx: number, heightPx: number): boolean =>
    isRectInsideCanvas(
      rectFromFixedCorner(
        anchor,
        signs,
        widthPx,
        heightPx,
        rotationDeg,
        canvasWidth,
        canvasHeight
      )
    );

  if (isInside(requested.widthPx, requested.heightPx)) {
    return requested;
  }

  const start = {
    heightPx: Math.max(minimumHeightPx, startHeightPx),
    widthPx: Math.max(minimumWidthPx, startWidthPx)
  };
  if (!isInside(start.widthPx, start.heightPx)) {
    return start;
  }

  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 32; index += 1) {
    const middle = (lower + upper) / 2;
    const widthPx =
      start.widthPx + (requested.widthPx - start.widthPx) * middle;
    const heightPx =
      start.heightPx + (requested.heightPx - start.heightPx) * middle;
    if (isInside(widthPx, heightPx)) {
      lower = middle;
    } else {
      upper = middle;
    }
  }

  return {
    heightPx: start.heightPx + (requested.heightPx - start.heightPx) * lower,
    widthPx: start.widthPx + (requested.widthPx - start.widthPx) * lower
  };
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

    if (field === "backgroundOpacity") {
      return element.type === "dialogue-window"
        ? { ...element, backgroundOpacity: value }
        : element;
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
  const requestedRect = {
    ...rect,
    x: rect.x + deltaX,
    y: rect.y + deltaY
  };
  return {
    ...element,
    transform: {
      ...element.transform,
      // Character visuals intentionally keep their overflow geometry. The
      // contained element policy remains unchanged for dialogue, title, and
      // content slot elements.
      rect:
        element.type === "character-visual"
          ? requestedRect
          : clampScreenRect(requestedRect)
    }
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
  const signs = resizeCornerSigns(handle);
  const anchor = resizeCornerPositionInPixels(
    element,
    oppositeResizeHandle(handle),
    canvasWidth,
    canvasHeight
  );
  const startHandle = resizeCornerPositionInPixels(
    element,
    handle,
    canvasWidth,
    canvasHeight
  );
  const nextHandle = {
    x: startHandle.x + deltaX * canvasWidth,
    y: startHandle.y + deltaY * canvasHeight
  };
  const localHandleVector = rotatePixelVector(
    subtractPixelPoints(nextHandle, anchor),
    -element.transform.rotationDeg
  );
  const minimumWidthPx = SCREEN_TEMPLATE_MIN_ELEMENT_SIZE * canvasWidth;
  const minimumHeightPx = SCREEN_TEMPLATE_MIN_ELEMENT_SIZE * canvasHeight;
  const requestedWidthPx = signs.x * localHandleVector.x;
  const requestedHeightPx = signs.y * localHandleVector.y;
  const { widthPx, heightPx } =
    element.type === "character-visual"
      ? {
          widthPx: Math.max(minimumWidthPx, requestedWidthPx),
          heightPx: Math.max(minimumHeightPx, requestedHeightPx)
        }
      : clampResizeDimensions(
          element.transform.rect.width * canvasWidth,
          element.transform.rect.height * canvasHeight,
          requestedWidthPx,
          requestedHeightPx,
          minimumWidthPx,
          minimumHeightPx,
          anchor,
          signs,
          element.transform.rotationDeg,
          canvasWidth,
          canvasHeight
        );

  const nextRect = rectFromFixedCorner(
    anchor,
    signs,
    widthPx,
    heightPx,
    element.transform.rotationDeg,
    canvasWidth,
    canvasHeight
  );

  return {
    ...element,
    transform: {
      ...element.transform,
      rect: {
        ...nextRect,
        x: Math.abs(nextRect.x) < 1e-10 ? 0 : nextRect.x,
        y: Math.abs(nextRect.y) < 1e-10 ? 0 : nextRect.y
      }
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
  template: ScreenTemplate,
  textContent: ScreenTemplateTextContent = {}
): string[] {
  return screenTemplateValidationReport(template, textContent).errors.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
}

export function screenTemplateTextValidationMessages(
  template: ScreenTemplate,
  textContent: ScreenTemplateTextContent
): string[] {
  return screenTemplateTextValidationIssues(template, textContent).map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  );
}

export function screenTemplateValidationWarningMessages(
  template: ScreenTemplate
): string[] {
  return screenTemplateValidationReport(template).warnings.map(
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

export function screenTemplateElementValidationWarningMessages(
  template: ScreenTemplate,
  elementId: string
): string[] {
  return screenTemplateValidationReport(template)
    .warnings.filter((issue) => issue.path.includes("elements"))
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
