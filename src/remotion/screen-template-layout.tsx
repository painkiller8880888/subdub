import type { CSSProperties, ReactNode } from "react";

import type {
  CommonDisplay,
  DisplayCoordinateSpace,
  StaticAnnotation
} from "../schema/common";
import {
  SCREEN_TEMPLATE_CANVAS_WIDTH,
  type ScreenTemplate,
  type ScreenTemplateElement
} from "../schema/screen-template";
import type { ResolvedScreenElement } from "../schema/index";
import { resolveScreenTemplateLayout } from "../screen-layout-resolver";
import { AnnotationLayer } from "./layout";
import {
  SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX,
  SECTION_TITLE_LINE_HEIGHT,
  SUBTITLE_BODY_LINE_HEIGHT,
  SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX,
  SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX,
  SUBTITLE_LABEL_FONT_SIZE_RATIO,
  SUBTITLE_LABEL_LINE_HEIGHT,
  SUBTITLE_LABEL_MARGIN_BOTTOM_PX
} from "../screen-template-typography";

export type ScreenCharacterSlot = "speaker-1" | "speaker-2";

export type ScreenLayoutCharacterPreview = Readonly<{
  src: string | null;
  alt: string;
}>;

export type ScreenLayoutContentDisplay = Readonly<
  Pick<
    CommonDisplay,
    "fit" | "crop" | "scale" | "position" | "prioritizeVisual"
  > & {
    annotations: readonly StaticAnnotation[];
    displayCoordinateSpace?: DisplayCoordinateSpace;
  }
>;

export type ScreenLayoutContentPreview = Readonly<{
  src: string | null;
  alt: string;
  display?: ScreenLayoutContentDisplay;
}>;

export type ScreenLayoutBackground = Readonly<{
  src: string | null;
  fit: "contain" | "cover";
}>;

export type ScreenLayoutPreview = Readonly<{
  dialogueText: string;
  speakerNameText?: string;
  sectionTitleText: string;
  characters: Readonly<
    Partial<Record<ScreenCharacterSlot, ScreenLayoutCharacterPreview>>
  >;
  content: ScreenLayoutContentPreview;
  contents?: readonly ScreenLayoutContentPreview[];
  background?: ScreenLayoutBackground;
}>;

export const DEFAULT_SCREEN_LAYOUT_PREVIEW: ScreenLayoutPreview = {
  dialogueText: "ここにサンプルセリフが表示されます。",
  speakerNameText: "話者名",
  sectionTitleText: "セクション名",
  characters: {},
  content: {
    src: null,
    alt: "コンテンツ preview"
  }
};

function percentage(value: number): string {
  return `${Number((value * 100).toFixed(6))}%`;
}

export function screenTemplateElementStyle(
  element: Pick<ScreenTemplateElement, "transform">
): CSSProperties {
  const { rect, rotationDeg } = element.transform;
  return {
    boxSizing: "border-box",
    height: percentage(rect.height),
    left: percentage(rect.x),
    position: "absolute",
    top: percentage(rect.y),
    transform: `rotate(${rotationDeg}deg)`,
    transformOrigin: "center center",
    width: percentage(rect.width)
  };
}

export function screenLayoutContentFrameStyle(
  display: ScreenLayoutContentDisplay | undefined
): CSSProperties {
  const coordinateSpace =
    display?.displayCoordinateSpace ?? "content-slot-relative";
  const position = display?.position ?? { x: 0.5, y: 0.5 };
  const scale = display?.scale ?? 1;
  const width = coordinateSpace === "legacy-media-frame" ? 0.82 : 1;
  const height = coordinateSpace === "legacy-media-frame" ? 0.62 : 1;

  return {
    backgroundColor: "#fff",
    boxSizing: "border-box",
    height: percentage(height),
    left: percentage(position.x),
    overflow: "hidden",
    position: "absolute",
    top: percentage(position.y),
    transform: `translate(-50%, -50%) scale(${scale})`,
    transformOrigin: "center center",
    width: percentage(width)
  };
}

export function screenLayoutContentInnerStyle(
  display: ScreenLayoutContentDisplay | undefined
): CSSProperties {
  if (display === undefined) {
    return {
      height: "100%",
      width: "100%"
    };
  }

  const { crop } = display;
  return {
    height: `${(1 / crop.height) * 100}%`,
    left: `${(-crop.x / crop.width) * 100}%`,
    position: "absolute",
    top: `${(-crop.y / crop.height) * 100}%`,
    width: `${(1 / crop.width) * 100}%`
  };
}

function previewOrDefault(
  preview: ScreenLayoutPreview | undefined
): ScreenLayoutPreview {
  return preview ?? DEFAULT_SCREEN_LAYOUT_PREVIEW;
}

function contentPreviews(
  preview: ScreenLayoutPreview
): readonly ScreenLayoutContentPreview[] {
  return preview.contents === undefined || preview.contents.length === 0
    ? [preview.content]
    : preview.contents;
}

function renderCharacterPreview(
  element: Extract<ResolvedScreenElement, { type: "character-visual" }>,
  preview: ScreenLayoutPreview
): ReactNode {
  const character = preview.characters[element.slot];
  if (character?.src === null || character === undefined) {
    return (
      <span className="screen-layout-placeholder">
        {element.slot === "speaker-1" ? "話者1" : "話者2"}
      </span>
    );
  }

  return (
    <img
      alt={character.alt}
      className="screen-layout-character-image"
      draggable={false}
      src={character.src}
      style={{ transform: element.flipX ? "scaleX(-1)" : undefined }}
    />
  );
}

function renderScreenTemplateElement(
  element: ResolvedScreenElement,
  preview: ScreenLayoutPreview
): ReactNode {
  const contentPreviewsForLayout = contentPreviews(preview);
  const baseStyle = {
    ...screenTemplateElementStyle(element),
    zIndex:
      element.type === "content-slot"
        ? 1
        : element.type === "character-visual"
          ? 3
          : element.type === "dialogue-window"
            ? 5
            : 6
  };

  if (element.type === "dialogue-window") {
    const speakerNameText = preview.speakerNameText ?? "";
    return (
      <div
        aria-hidden="true"
        className="screen-layout-element screen-layout-dialogue"
        key={element.elementId}
        style={baseStyle}
      >
        <span
          className="screen-layout-dialogue-card"
          style={{
            fontSize: `${(element.fontSize / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw`,
            lineHeight: SUBTITLE_BODY_LINE_HEIGHT,
            padding: `${(SUBTITLE_CARD_VERTICAL_PADDING_PER_SIDE_PX / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw ${(SUBTITLE_CARD_HORIZONTAL_PADDING_PER_SIDE_PX / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw`
          }}
        >
          {speakerNameText.length > 0 ? (
            <span
              className="screen-layout-dialogue-speaker"
              style={{
                fontSize: `${
                  ((element.fontSize * SUBTITLE_LABEL_FONT_SIZE_RATIO) /
                    SCREEN_TEMPLATE_CANVAS_WIDTH) *
                  100
                }cqw`,
                lineHeight: SUBTITLE_LABEL_LINE_HEIGHT,
                marginBottom: `${(SUBTITLE_LABEL_MARGIN_BOTTOM_PX / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw`
              }}
            >
              {speakerNameText}
            </span>
          ) : null}
          <span>{preview.dialogueText}</span>
        </span>
      </div>
    );
  }

  if (element.type === "section-title") {
    return (
      <div
        aria-hidden="true"
        className="screen-layout-element screen-layout-section-title"
        key={element.elementId}
        style={{
          ...baseStyle,
          fontSize: `${(element.fontSize / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw`,
          lineHeight: SECTION_TITLE_LINE_HEIGHT,
          padding: `0 ${(SECTION_TITLE_HORIZONTAL_PADDING_PER_SIDE_PX / SCREEN_TEMPLATE_CANVAS_WIDTH) * 100}cqw`
        }}
      >
        {preview.sectionTitleText}
      </div>
    );
  }

  if (element.type === "character-visual") {
    return (
      <div
        aria-hidden="true"
        className="screen-layout-element screen-layout-character"
        key={element.elementId}
        style={baseStyle}
      >
        {renderCharacterPreview(element, preview)}
      </div>
    );
  }

  const hasContentSlotRelativePreview = contentPreviewsForLayout.some(
    (content) =>
      content.display?.displayCoordinateSpace !== "legacy-media-frame"
  );
  if (hasContentSlotRelativePreview) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="screen-layout-element screen-layout-content"
      key={element.elementId}
      style={baseStyle}
    />
  );
}

function renderScreenLayoutContent(
  content: ScreenLayoutContentPreview,
  key: string
): ReactNode {
  return (
    <div
      className="screen-layout-content-frame"
      key={key}
      style={{
        ...screenLayoutContentFrameStyle(content.display),
        ...(content.display?.displayCoordinateSpace === "legacy-media-frame"
          ? { zIndex: 1 }
          : {})
      }}
    >
      <div
        className="screen-layout-content-inner"
        style={screenLayoutContentInnerStyle(content.display)}
      >
        {content.src === null ? (
          <span className="screen-layout-content-label">primary content</span>
        ) : (
          <img
            alt={content.alt}
            className="screen-layout-content-image"
            draggable={false}
            src={content.src}
            style={{ objectFit: content.display?.fit ?? "cover" }}
          />
        )}
      </div>
      <AnnotationLayer
        annotations={content.display?.annotations ?? []}
        responsive
      />
    </div>
  );
}

function renderScreenLayoutContents(
  elements: readonly ResolvedScreenElement[],
  contents: readonly ScreenLayoutContentPreview[]
): ReactNode {
  const contentSlot = elements.find(
    (
      element
    ): element is Extract<ResolvedScreenElement, { type: "content-slot" }> =>
      element.type === "content-slot"
  );
  let relativeContentIndex = 0;

  return contents.map((content, index) => {
    if (content.display?.displayCoordinateSpace === "legacy-media-frame") {
      return renderScreenLayoutContent(content, `content-${index}`);
    }
    if (contentSlot === undefined) {
      return null;
    }

    const showContentSlotSurface = relativeContentIndex === 0;
    relativeContentIndex += 1;
    return (
      <div
        aria-hidden="true"
        className={
          showContentSlotSurface
            ? "screen-layout-element screen-layout-content"
            : "screen-layout-element"
        }
        key={`content-slot-${index}`}
        style={{
          ...screenTemplateElementStyle(contentSlot),
          zIndex: 1
        }}
      >
        {renderScreenLayoutContent(content, `content-${index}`)}
      </div>
    );
  });
}

function renderScreenLayoutBackground(
  background: ScreenLayoutBackground | undefined
): ReactNode {
  if (background?.src === undefined || background.src === null) {
    return null;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="screen-layout-background-image"
      draggable={false}
      src={background.src}
      style={{ objectFit: background.fit }}
    />
  );
}

export function screenLayoutElementBounds(
  element: Pick<ScreenTemplateElement, "transform">,
  canvasWidth: number,
  canvasHeight: number
): Readonly<{ x: number; y: number; width: number; height: number }> {
  const { rect, rotationDeg } = element.transform;
  const radians = (rotationDeg * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const width =
    cosine * rect.width + sine * rect.height * (canvasHeight / canvasWidth);
  const height =
    sine * rect.width * (canvasWidth / canvasHeight) + cosine * rect.height;
  return {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height
  };
}

function renderDialogueOnlyFrame({
  resolvedLayout,
  preview,
  className,
  ariaLabel
}: {
  readonly resolvedLayout: ReturnType<typeof resolveScreenTemplateLayout>;
  readonly preview: ScreenLayoutPreview;
  readonly className: string;
  readonly ariaLabel: string;
}): ReactNode {
  const dialogueElement = resolvedLayout.elements.find(
    (
      element
    ): element is Extract<ResolvedScreenElement, { type: "dialogue-window" }> =>
      element.type === "dialogue-window"
  );
  if (dialogueElement === undefined) {
    return (
      <div aria-label={ariaLabel} className={className} role="img">
        <span className="screen-layout-placeholder">
          dialogue preview unavailable
        </span>
      </div>
    );
  }

  const bounds = screenLayoutElementBounds(
    dialogueElement,
    resolvedLayout.canvasWidth,
    resolvedLayout.canvasHeight
  );
  const dialogueWidth = bounds.width * resolvedLayout.canvasWidth;
  const dialogueHeight = bounds.height * resolvedLayout.canvasHeight;
  const dialogueAspectRatio = dialogueWidth / dialogueHeight;
  const innerStyle: CSSProperties = {
    containerType: "inline-size",
    height: percentage(1 / bounds.height),
    left: percentage(-bounds.x / bounds.width),
    position: "absolute",
    top: percentage(-bounds.y / bounds.height),
    width: percentage(1 / bounds.width)
  };

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      role="img"
      style={{
        aspectRatio: `${dialogueWidth} / ${dialogueHeight}`,
        isolation: "isolate",
        maxWidth: `min(100%, ${dialogueAspectRatio * 7}rem)`
      }}
    >
      <div
        className="screen-layout-frame screen-layout-dialogue-only-canvas"
        style={innerStyle}
      >
        {renderScreenTemplateElement(dialogueElement, preview)}
      </div>
    </div>
  );
}

export function ScreenLayoutFrame({
  template,
  preview,
  className,
  ariaLabel = "16対9 ScreenTemplate preview",
  mode = "full"
}: {
  readonly template: Pick<
    ScreenTemplate,
    "canvasWidth" | "canvasHeight" | "elements"
  >;
  readonly preview?: ScreenLayoutPreview;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly mode?: "full" | "dialogue-only";
}): ReactNode {
  const resolvedPreview = previewOrDefault(preview);
  const contentPreviewsForLayout = contentPreviews(resolvedPreview);
  const resolvedLayout = resolveScreenTemplateLayout(template, {
    prioritizeVisual: contentPreviewsForLayout.some(
      (content) => content.display?.prioritizeVisual === true
    )
  });
  const classes = ["screen-layout-frame", className]
    .filter((value): value is string => value !== undefined)
    .join(" ");

  if (mode === "dialogue-only") {
    return renderDialogueOnlyFrame({
      resolvedLayout,
      preview: resolvedPreview,
      className: `${classes} screen-layout-dialogue-only-frame`,
      ariaLabel
    });
  }

  return (
    <div
      aria-label={ariaLabel}
      className={classes}
      role="img"
      style={{
        aspectRatio: `${template.canvasWidth} / ${template.canvasHeight}`,
        containerType: "inline-size",
        isolation: "isolate"
      }}
    >
      {renderScreenLayoutBackground(resolvedPreview.background)}
      {resolvedLayout.elements.map((element) =>
        renderScreenTemplateElement(element, resolvedPreview)
      )}
      {renderScreenLayoutContents(
        resolvedLayout.elements,
        contentPreviewsForLayout
      )}
    </div>
  );
}
