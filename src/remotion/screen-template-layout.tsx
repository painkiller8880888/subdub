import type { CSSProperties, ReactNode } from "react";

import type { CommonDisplay, DisplayCoordinateSpace } from "../schema/common";
import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "../schema/screen-template";

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
  sectionTitleText: string;
  characters: Readonly<
    Partial<Record<ScreenCharacterSlot, ScreenLayoutCharacterPreview>>
  >;
  content: ScreenLayoutContentPreview;
  background?: ScreenLayoutBackground;
}>;

export const DEFAULT_SCREEN_LAYOUT_PREVIEW: ScreenLayoutPreview = {
  dialogueText: "ここにサンプルセリフが表示されます。",
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
  element: ScreenTemplateElement
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

function renderCharacterPreview(
  element: Extract<ScreenTemplateElement, { type: "character-visual" }>,
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
  element: ScreenTemplateElement,
  preview: ScreenLayoutPreview
): ReactNode {
  const prioritizeVisual =
    element.type === "character-visual" &&
    preview.content.display?.prioritizeVisual === true;
  const baseStyle = {
    ...screenTemplateElementStyle(element),
    ...(prioritizeVisual
      ? {
          transform: `${screenTemplateElementStyle(element).transform} scale(0.72)`
        }
      : {}),
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
    return (
      <div
        aria-hidden="true"
        className="screen-layout-element screen-layout-dialogue"
        key={element.elementId}
        style={baseStyle}
      >
        <span
          className="screen-layout-dialogue-card"
          style={{ fontSize: `${(element.fontSize / 1920) * 100}cqw` }}
        >
          {preview.dialogueText}
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
          fontSize: `${(element.fontSize / 1920) * 100}cqw`
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

  if (
    preview.content.display?.displayCoordinateSpace === "legacy-media-frame"
  ) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="screen-layout-element screen-layout-content"
      key={element.elementId}
      style={baseStyle}
    >
      {renderScreenLayoutContent(preview)}
    </div>
  );
}

function renderScreenLayoutContent(
  preview: ScreenLayoutPreview,
  className = "screen-layout-content-frame"
): ReactNode {
  return (
    <div
      className={className}
      style={{
        ...screenLayoutContentFrameStyle(preview.content.display),
        ...(preview.content.display?.displayCoordinateSpace ===
        "legacy-media-frame"
          ? { zIndex: 1 }
          : {})
      }}
    >
      <div
        className="screen-layout-content-inner"
        style={screenLayoutContentInnerStyle(preview.content.display)}
      >
        {preview.content.src === null ? (
          <span className="screen-layout-content-label">primary content</span>
        ) : (
          <img
            alt={preview.content.alt}
            className="screen-layout-content-image"
            draggable={false}
            src={preview.content.src}
            style={{ objectFit: preview.content.display?.fit ?? "cover" }}
          />
        )}
      </div>
    </div>
  );
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

export function ScreenLayoutFrame({
  template,
  preview,
  className,
  ariaLabel = "16対9 ScreenTemplate preview"
}: {
  readonly template: Pick<
    ScreenTemplate,
    "canvasWidth" | "canvasHeight" | "elements"
  >;
  readonly preview?: ScreenLayoutPreview;
  readonly className?: string;
  readonly ariaLabel?: string;
}): ReactNode {
  const resolvedPreview = previewOrDefault(preview);
  const classes = ["screen-layout-frame", className]
    .filter((value): value is string => value !== undefined)
    .join(" ");

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
      {template.elements.map((element) =>
        renderScreenTemplateElement(element, resolvedPreview)
      )}
      {resolvedPreview.content.display?.displayCoordinateSpace ===
      "legacy-media-frame"
        ? renderScreenLayoutContent(resolvedPreview)
        : null}
    </div>
  );
}
