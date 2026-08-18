import type { CSSProperties, ReactNode } from "react";

import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "../schema/screen-template";

export type ScreenCharacterSlot = "speaker-1" | "speaker-2";

export type ScreenLayoutCharacterPreview = Readonly<{
  src: string | null;
  alt: string;
}>;

export type ScreenLayoutPreview = Readonly<{
  dialogueText: string;
  sectionTitleText: string;
  characters: Readonly<
    Partial<Record<ScreenCharacterSlot, ScreenLayoutCharacterPreview>>
  >;
  content: Readonly<{
    src: string | null;
    alt: string;
  }>;
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

  return (
    <div
      aria-hidden="true"
      className="screen-layout-element screen-layout-content"
      key={element.elementId}
      style={baseStyle}
    >
      {preview.content.src === null ? (
        <span className="screen-layout-content-label">primary content</span>
      ) : (
        <img
          alt={preview.content.alt}
          className="screen-layout-content-image"
          draggable={false}
          src={preview.content.src}
        />
      )}
    </div>
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
        containerType: "inline-size"
      }}
    >
      {template.elements.map((element) =>
        renderScreenTemplateElement(element, resolvedPreview)
      )}
    </div>
  );
}
