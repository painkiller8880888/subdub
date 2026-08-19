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

export type ScreenTemplateTextContent = Readonly<{
  dialogueText?: string;
  sectionTitleText?: string;
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

const TRIGONOMETRY_EPSILON = 1e-12;
const CANVAS_BOUNDS_EPSILON = 1e-9;

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
  const normalizedRotationDeg =
    ((element.transform.rotationDeg % 360) + 360) % 360;
  const radians = (normalizedRotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const absCosine =
    Math.abs(cosine) < TRIGONOMETRY_EPSILON ? 0 : Math.abs(cosine);
  const absSine = Math.abs(sine) < TRIGONOMETRY_EPSILON ? 0 : Math.abs(sine);
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

const TEXT_LINE_HEIGHT = 1.4;
const TEXT_HORIZONTAL_PADDING = 0.03;

function estimatedTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce((width, character) => {
    if (/\s/u.test(character)) {
      return width + fontSize * 0.35;
    }
    if ((character.codePointAt(0) ?? Number.POSITIVE_INFINITY) <= 0xff) {
      return width + fontSize * 0.55;
    }
    return width + fontSize;
  }, 0);
}

function wrappedLineCount(
  text: string,
  maxWidth: number,
  fontSize: number
): number {
  return text.split("\n").reduce((count, line) => {
    if (line.length === 0) {
      return count + 1;
    }
    let lineWidth = 0;
    let wrappedLines = 1;
    for (const character of Array.from(line)) {
      const characterWidth = estimatedTextWidth(character, fontSize);
      if (lineWidth > 0 && lineWidth + characterWidth > maxWidth) {
        wrappedLines += 1;
        lineWidth = characterWidth;
      } else {
        lineWidth += characterWidth;
      }
    }
    return count + wrappedLines;
  }, 0);
}

function textIssuesForElement(
  element: Extract<
    ScreenTemplateElement,
    { type: "dialogue-window" | "section-title" }
  >,
  index: number,
  text: string | undefined
): ScreenTemplateValidationIssue[] {
  const widthPx = element.transform.rect.width * SCREEN_TEMPLATE_CANVAS_WIDTH;
  const heightPx =
    element.transform.rect.height * SCREEN_TEMPLATE_CANVAS_HEIGHT;
  const lineHeightPx = element.fontSize * TEXT_LINE_HEIGHT;
  const path = ["elements", index, "fontSize"] as const;
  const label =
    element.type === "dialogue-window" ? "dialogue" : "section title";

  if (lineHeightPx > heightPx) {
    return [
      {
        path,
        message: `${label} text line height must fit inside the element bounds`
      }
    ];
  }

  if (text === undefined || text.length === 0) {
    return [];
  }

  const availableWidth = widthPx * (1 - TEXT_HORIZONTAL_PADDING);
  if (
    element.type === "section-title" &&
    estimatedTextWidth(text, element.fontSize) > availableWidth
  ) {
    return [
      {
        path: ["elements", index, "transform", "rect"],
        message: `${label} text overflows the element bounds`
      }
    ];
  }

  const lineCount = wrappedLineCount(text, availableWidth, element.fontSize);
  const maxLines = Math.max(1, Math.floor(heightPx / lineHeightPx));
  if (lineCount <= maxLines) {
    return [];
  }

  return [
    {
      path: ["elements", index, "transform", "rect"],
      message: `${label} text overflows the element bounds (${lineCount} lines, ${maxLines} fit)`
    }
  ];
}

export function screenTemplateTextValidationIssues(
  template: ScreenTemplate,
  textContent: ScreenTemplateTextContent = {}
): readonly ScreenTemplateValidationIssue[] {
  return template.elements.flatMap((element, index) => {
    if (element.type === "dialogue-window") {
      return textIssuesForElement(element, index, textContent.dialogueText);
    }
    if (element.type === "section-title") {
      return textIssuesForElement(element, index, textContent.sectionTitleText);
    }
    return [];
  });
}

export function screenTemplateValidationReport(
  input: unknown,
  textContent: ScreenTemplateTextContent = {}
): ScreenTemplateValidationReport {
  const parsed = screenTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { errors: zodIssues(parsed.error), warnings: [] };
  }

  const errors: ScreenTemplateValidationIssue[] = [];
  const warnings: ScreenTemplateValidationIssue[] = [];
  const elements = parsed.data.elements;

  errors.push(...screenTemplateTextValidationIssues(parsed.data, textContent));

  for (const [index, element] of elements.entries()) {
    const bounds = elementBounds(element);
    if (
      bounds.left < -CANVAS_BOUNDS_EPSILON ||
      bounds.top < -CANVAS_BOUNDS_EPSILON ||
      bounds.right > 1 + CANVAS_BOUNDS_EPSILON ||
      bounds.bottom > 1 + CANVAS_BOUNDS_EPSILON
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
