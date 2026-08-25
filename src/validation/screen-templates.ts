import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH,
  screenTemplateSchema,
  type ScreenTemplate,
  type ScreenTemplateElement
} from "../schema/screen-template.js";
import {
  estimateWrappedTextLineCount,
  SECTION_TITLE_HORIZONTAL_PADDING_PX,
  SECTION_TITLE_LINE_HEIGHT,
  subtitleTypographyMetricsForFontSize,
  SUBTITLE_CARD_HORIZONTAL_PADDING_PX,
  SUBTITLE_CARD_VERTICAL_PADDING_PX
} from "../screen-template-typography.js";
import type { ResolvedScreenLayout } from "../schema/render-manifest.js";

export type ScreenTemplateValidationPath = readonly (string | number)[];

export type ScreenTemplateValidationIssue = Readonly<{
  path: ScreenTemplateValidationPath;
  message: string;
}>;

export type ScreenTemplateTextContent = Readonly<{
  dialogueText?: string;
  speakerNameText?: string;
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

type ScreenElementWithTransform = Readonly<{
  readonly transform: Readonly<{
    readonly rect: Readonly<{
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }>;
    readonly rotationDeg: number;
  }>;
}>;

const TRIGONOMETRY_EPSILON = 1e-12;
const CANVAS_BOUNDS_EPSILON = 1e-9;

/**
 * Returns the canvas-relative AABB after rotating around the rect center.
 * Width and height are converted to pixels first because the canvas is not
 * square. This mirrors CSS transform-origin: 50% 50% on a 1920x1080 canvas.
 */
export function rotatedScreenRectBounds(
  element: ScreenElementWithTransform,
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

function intersectsCanvas(bounds: RotatedScreenRectBounds): boolean {
  return !(
    bounds.right <= CANVAS_BOUNDS_EPSILON ||
    bounds.bottom <= CANVAS_BOUNDS_EPSILON ||
    bounds.left >= 1 - CANVAS_BOUNDS_EPSILON ||
    bounds.top >= 1 - CANVAS_BOUNDS_EPSILON
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

function textIssuesForElement(
  element: Extract<
    ScreenTemplateElement,
    { type: "dialogue-window" | "section-title" }
  >,
  index: number,
  textContent: ScreenTemplateTextContent
): ScreenTemplateValidationIssue[] {
  const widthPx = element.transform.rect.width * SCREEN_TEMPLATE_CANVAS_WIDTH;
  const heightPx =
    element.transform.rect.height * SCREEN_TEMPLATE_CANVAS_HEIGHT;
  const path = ["elements", index, "transform", "rect"] as const;

  if (element.type === "dialogue-window") {
    if (textContent.dialogueText === undefined) {
      return [];
    }

    const metrics = subtitleTypographyMetricsForFontSize(
      textContent.dialogueText ?? "",
      element.fontSize,
      { widthPx, heightPx }
    );
    if (widthPx <= SUBTITLE_CARD_HORIZONTAL_PADDING_PX) {
      return [
        {
          path,
          message:
            "dialogue text does not fit inside the production subtitle window padding"
        }
      ];
    }
    if (heightPx <= SUBTITLE_CARD_VERTICAL_PADDING_PX) {
      return [
        {
          path,
          message:
            "dialogue text does not fit inside the production subtitle window padding"
        }
      ];
    }
    if (metrics.estimatedTextHeightPx > metrics.availableTextHeightPx) {
      return [
        {
          path,
          message: `dialogue text overflows the element bounds (${metrics.estimatedTextHeightPx.toFixed(1)}px exceeds ${metrics.availableTextHeightPx.toFixed(1)}px at the template font size)`
        }
      ];
    }
    return [];
  }

  const text = textContent.sectionTitleText;
  if (text === undefined || text.length === 0) {
    return [];
  }

  const availableWidth = widthPx - SECTION_TITLE_HORIZONTAL_PADDING_PX;
  if (availableWidth <= 0) {
    return [
      {
        path,
        message: "section title text overflows the production title padding"
      }
    ];
  }

  const lineCount = estimateWrappedTextLineCount(
    text,
    availableWidth,
    element.fontSize
  );
  const estimatedTextHeight =
    lineCount * element.fontSize * SECTION_TITLE_LINE_HEIGHT;
  if (estimatedTextHeight <= heightPx) {
    return [];
  }

  return [
    {
      path,
      message: `section title text overflows the element bounds (${lineCount} wrapped lines exceed ${heightPx.toFixed(1)}px)`
    }
  ];
}

export function screenTemplateTextValidationIssues(
  template: ScreenTemplate,
  textContent: ScreenTemplateTextContent = {}
): readonly ScreenTemplateValidationIssue[] {
  return template.elements.flatMap((element, index) => {
    if (element.type === "dialogue-window") {
      return textIssuesForElement(element, index, textContent);
    }
    if (element.type === "section-title") {
      return textIssuesForElement(element, index, textContent);
    }
    return [];
  });
}

/**
 * Validate geometry after a layout policy has been applied. Template
 * validation covers the source geometry, but policies such as
 * `prioritizeVisual` can change a character rect without changing the
 * template itself.
 */
export function resolvedScreenLayoutValidationIssues(
  layout: ResolvedScreenLayout
): readonly ScreenTemplateValidationIssue[] {
  return layout.elements.flatMap((element, index) => {
    if (
      element.type !== "character-visual" ||
      intersectsCanvas(
        rotatedScreenRectBounds(
          element,
          layout.canvasWidth,
          layout.canvasHeight
        )
      )
    ) {
      return [];
    }

    return [
      {
        path: ["elements", index, "transform", "rotationDeg"],
        message: "character visual bounds must intersect the canvas"
      }
    ];
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
    if (element.type === "character-visual") {
      if (!intersectsCanvas(bounds)) {
        errors.push({
          path: ["elements", index, "transform", "rotationDeg"],
          message: "character visual bounds must intersect the canvas"
        });
      }
      continue;
    }
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
