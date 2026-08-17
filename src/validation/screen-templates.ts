import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH,
  screenTemplateSchema,
  type ScreenTemplate,
  type ScreenTemplateElement
} from "../schema/screen-template.js";

export type ScreenTemplateValidationPath = readonly (string | number)[];

export type ScreenTemplateValidationIssue = Readonly<{
  path: ScreenTemplateValidationPath;
  message: string;
}>;

export type ScreenTemplateValidationReport = Readonly<{
  errors: readonly ScreenTemplateValidationIssue[];
  warnings: readonly ScreenTemplateValidationIssue[];
}>;

export class ScreenTemplateValidationError extends Error {
  readonly issues: readonly ScreenTemplateValidationIssue[];

  constructor(issues: readonly ScreenTemplateValidationIssue[]) {
    super(
      issues.length === 0
        ? "screen template validation failed"
        : issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("; ")
    );
    this.name = "ScreenTemplateValidationError";
    this.issues = issues;
  }
}

export type RotatedScreenRectBounds = Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}>;

/**
 * Returns the canvas-relative AABB after rotating around the rect center.
 * Width and height are converted to pixels first because the canvas is not
 * square. This mirrors CSS transform-origin: 50% 50% on a 1920x1080 canvas.
 */
export function rotatedScreenRectBounds(
  element: ScreenTemplateElement,
  canvasWidth = SCREEN_TEMPLATE_CANVAS_WIDTH,
  canvasHeight = SCREEN_TEMPLATE_CANVAS_HEIGHT
): RotatedScreenRectBounds {
  const { rect } = element.transform;
  const radians = (element.transform.rotationDeg * Math.PI) / 180;
  const absCosine = Math.abs(Math.cos(radians));
  const absSine = Math.abs(Math.sin(radians));
  const rotatedWidth =
    rect.width * canvasWidth * absCosine + rect.height * canvasHeight * absSine;
  const rotatedHeight =
    rect.width * canvasWidth * absSine + rect.height * canvasHeight * absCosine;
  const centerX = (rect.x + rect.width / 2) * canvasWidth;
  const centerY = (rect.y + rect.height / 2) * canvasHeight;

  return {
    left: (centerX - rotatedWidth / 2) / canvasWidth,
    top: (centerY - rotatedHeight / 2) / canvasHeight,
    right: (centerX + rotatedWidth / 2) / canvasWidth,
    bottom: (centerY + rotatedHeight / 2) / canvasHeight
  };
}

function elementBounds(
  element: ScreenTemplateElement
): RotatedScreenRectBounds {
  return rotatedScreenRectBounds(element);
}

function contains(
  outer: RotatedScreenRectBounds,
  inner: RotatedScreenRectBounds
): boolean {
  return (
    outer.left <= inner.left &&
    outer.top <= inner.top &&
    outer.right >= inner.right &&
    outer.bottom >= inner.bottom
  );
}

function zodIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): ScreenTemplateValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map((part) =>
      typeof part === "string" || typeof part === "number" ? part : String(part)
    ),
    message: issue.message
  }));
}

export function screenTemplateValidationReport(
  input: unknown
): ScreenTemplateValidationReport {
  const parsed = screenTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: zodIssues(parsed.error), warnings: [] };
  }

  const errors: ScreenTemplateValidationIssue[] = [];
  const warnings: ScreenTemplateValidationIssue[] = [];
  const elements = parsed.data.elements;

  for (const [index, element] of elements.entries()) {
    const bounds = elementBounds(element);
    if (
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.right > 1 ||
      bounds.bottom > 1
    ) {
      errors.push({
        path: ["elements", index, "transform", "rotationDeg"],
        message: "rotation around the rect center must stay inside the canvas"
      });
    }
  }

  for (let lowerIndex = 0; lowerIndex < elements.length; lowerIndex += 1) {
    const lower = elements[lowerIndex];
    if (lower === undefined) {
      continue;
    }
    const lowerBounds = elementBounds(lower);
    for (
      let upperIndex = lowerIndex + 1;
      upperIndex < elements.length;
      upperIndex += 1
    ) {
      const upper = elements[upperIndex];
      if (upper === undefined || !contains(elementBounds(upper), lowerBounds)) {
        continue;
      }
      warnings.push({
        path: ["elements", upperIndex],
        message: `element ${upper.elementId} fully covers earlier element ${lower.elementId} at its render order`
      });
    }
  }

  return { errors, warnings };
}

export function assertValidScreenTemplate(input: unknown): ScreenTemplate {
  const report = screenTemplateValidationReport(input);
  if (report.errors.length > 0) {
    throw new ScreenTemplateValidationError(report.errors);
  }

  return screenTemplateSchema.parse(input);
}
