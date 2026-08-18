import type {
  DisplayV13,
  RenderResolvedVisualDisplay,
  ResolvedScreenLayout,
  ResolvedScreenElement,
  ScreenTransform
} from "./schema/index.js";
import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "./schema/screen-template.js";

export const SCREEN_LAYOUT_PRIORITY_SCALE = 0.72 as const;
export const LEGACY_MEDIA_FRAME_WIDTH = 0.82 as const;
export const LEGACY_MEDIA_FRAME_HEIGHT = 0.62 as const;

type CharacterIds = Readonly<{
  readonly "speaker-1"?: string;
  readonly "speaker-2"?: string;
}>;

export type ScreenLayoutResolutionOptions = Readonly<{
  readonly characterIds?: CharacterIds;
  readonly prioritizeVisual?: boolean;
}>;

function scaledRect(
  rect: ScreenTransform["rect"],
  scale: number
): ScreenTransform["rect"] {
  const width = rect.width * scale;
  const height = rect.height * scale;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height
  };
}

function resolvedElement(
  element: ScreenTemplateElement,
  characterIds: CharacterIds | undefined,
  prioritizeVisual: boolean
): ResolvedScreenElement {
  const transform = {
    ...element.transform,
    ...(element.type === "character-visual" && prioritizeVisual
      ? {
          rect: scaledRect(element.transform.rect, SCREEN_LAYOUT_PRIORITY_SCALE)
        }
      : {})
  };

  if (element.type === "dialogue-window") {
    return {
      elementId: element.elementId,
      type: element.type,
      transform,
      fontSize: element.fontSize
    };
  }
  if (element.type === "section-title") {
    return {
      elementId: element.elementId,
      type: element.type,
      transform,
      fontSize: element.fontSize
    };
  }
  if (element.type === "content-slot") {
    return {
      elementId: element.elementId,
      type: element.type,
      slot: element.slot,
      transform
    };
  }
  return {
    elementId: element.elementId,
    type: element.type,
    slot: element.slot,
    characterId: characterIds?.[element.slot] ?? "",
    transform,
    flipX: element.flipX
  };
}

/**
 * Resolve a validated ScreenTemplate into the renderer-facing layout model.
 * The function is deliberately pure: it does not read the catalog, project
 * JSON, or any asset metadata.
 */
export function resolveScreenTemplateLayout(
  template: Pick<ScreenTemplate, "canvasWidth" | "canvasHeight" | "elements">,
  options: ScreenLayoutResolutionOptions = {}
): ResolvedScreenLayout {
  return {
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    elements: template.elements.map((element) =>
      resolvedElement(
        element,
        options.characterIds,
        options.prioritizeVisual === true
      )
    )
  };
}

function rotatePointAroundCenter(
  point: { readonly x: number; readonly y: number },
  center: { readonly x: number; readonly y: number },
  rotationDeg: number,
  canvasWidth: number,
  canvasHeight: number
): { x: number; y: number } {
  const radians = (rotationDeg * Math.PI) / 180;
  const dx = (point.x - center.x) * canvasWidth;
  const dy = (point.y - center.y) * canvasHeight;
  const rotatedX = dx * Math.cos(radians) - dy * Math.sin(radians);
  const rotatedY = dx * Math.sin(radians) + dy * Math.cos(radians);
  return {
    x: center.x + rotatedX / canvasWidth,
    y: center.y + rotatedY / canvasHeight
  };
}

function legacyOuterFrame(display: DisplayV13): ScreenTransform {
  return {
    rect: {
      x: display.position.x - (LEGACY_MEDIA_FRAME_WIDTH * display.scale) / 2,
      y: display.position.y - (LEGACY_MEDIA_FRAME_HEIGHT * display.scale) / 2,
      width: LEGACY_MEDIA_FRAME_WIDTH * display.scale,
      height: LEGACY_MEDIA_FRAME_HEIGHT * display.scale
    },
    rotationDeg: 0
  };
}

function contentSlotRelativeOuterFrame(
  display: DisplayV13,
  contentSlot: Extract<ResolvedScreenElement, { type: "content-slot" }>,
  canvasWidth: number,
  canvasHeight: number
): ScreenTransform {
  const slotRect = contentSlot.transform.rect;
  const slotCenter = {
    x: slotRect.x + slotRect.width / 2,
    y: slotRect.y + slotRect.height / 2
  };
  const localCenter = {
    x: slotRect.x + slotRect.width * display.position.x,
    y: slotRect.y + slotRect.height * display.position.y
  };
  const center = rotatePointAroundCenter(
    localCenter,
    slotCenter,
    contentSlot.transform.rotationDeg,
    canvasWidth,
    canvasHeight
  );
  const width = slotRect.width * display.scale;
  const height = slotRect.height * display.scale;
  return {
    rect: {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height
    },
    rotationDeg: contentSlot.transform.rotationDeg
  };
}

function contentSlotForLayout(
  layout: ResolvedScreenLayout
): Extract<ResolvedScreenElement, { type: "content-slot" }> {
  const contentSlot = layout.elements.find(
    (
      element
    ): element is Extract<ResolvedScreenElement, { type: "content-slot" }> =>
      element.type === "content-slot" && element.slot === "primary"
  );
  if (contentSlot === undefined) {
    throw new Error(
      "resolved screen layout is missing the primary content slot"
    );
  }
  return contentSlot;
}

/**
 * Bake the project-side inner display transform into a final manifest display.
 * Remotion consumes the returned values directly and never reinterprets the
 * project coordinate-space flag.
 */
export function resolveVisualDisplay(
  display: DisplayV13,
  layout: ResolvedScreenLayout
): RenderResolvedVisualDisplay {
  const contentSlot = contentSlotForLayout(layout);
  const contentClip = {
    transform: contentSlot.transform,
    enabled: display.displayCoordinateSpace === "content-slot-relative"
  };
  const outerFrame =
    display.displayCoordinateSpace === "content-slot-relative"
      ? contentSlotRelativeOuterFrame(
          display,
          contentSlot,
          layout.canvasWidth,
          layout.canvasHeight
        )
      : legacyOuterFrame(display);
  const common = {
    outerFrame,
    contentClip,
    fit: display.fit,
    crop: display.crop,
    annotations: display.annotations
  };

  if (display.kind === "video") {
    return {
      kind: display.kind,
      ...common,
      startMs: display.startMs,
      endMs: display.endMs,
      playbackRate: display.playbackRate,
      volume: display.volume
    };
  }
  if (display.kind === "photo") {
    return { kind: display.kind, ...common };
  }
  return { kind: display.kind, ...common, page: display.page };
}

export function findResolvedScreenElement(
  layout: ResolvedScreenLayout,
  type: ResolvedScreenElement["type"]
): ResolvedScreenElement | undefined {
  return layout.elements.find((element) => element.type === type);
}

export function screenTransformStyle(
  transform: ScreenTransform
): Record<string, string | number> {
  const { rect, rotationDeg } = transform;
  return {
    boxSizing: "border-box",
    height: `${rect.height * 100}%`,
    left: `${rect.x * 100}%`,
    position: "absolute",
    top: `${rect.y * 100}%`,
    transform: `rotate(${rotationDeg}deg)`,
    transformOrigin: "center center",
    width: `${rect.width * 100}%`
  };
}
