export const DEFAULT_DIALOGUE_WINDOW_GLOW_COLOR = "#ffffff" as const;

export const DIALOGUE_WINDOW_BORDER_RADIUS_PX = 16 as const;

const SCREEN_TEMPLATE_CANVAS_WIDTH_PX = 1920 as const;

export type DialogueWindowStyleUnit = "px" | "cqw";

export type DialogueWindowSurfaceStyle = Readonly<{
  backgroundColor: string;
  border: "none";
  borderRadius: number | string;
  boxShadow: "none";
}>;

function canvasScaledLength(
  value: number,
  unit: DialogueWindowStyleUnit
): number | string {
  return unit === "px"
    ? value
    : `${(value / SCREEN_TEMPLATE_CANVAS_WIDTH_PX) * 100}cqw`;
}

function canvasScaledShadowLength(
  value: number,
  unit: DialogueWindowStyleUnit
): string {
  return unit === "px"
    ? `${value}px`
    : `${(value / SCREEN_TEMPLATE_CANVAS_WIDTH_PX) * 100}cqw`;
}

export function rgbaFromHexColor(hexColor: string, opacity: number): string {
  const red = Number.parseInt(hexColor.slice(1, 3), 16);
  const green = Number.parseInt(hexColor.slice(3, 5), 16);
  const blue = Number.parseInt(hexColor.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function dialogueWindowBackgroundColor(
  backgroundColor: string,
  backgroundOpacity: number
): string {
  return rgbaFromHexColor(backgroundColor, backgroundOpacity);
}

export function dialogueWindowSurfaceStyle(
  backgroundColor: string,
  backgroundOpacity: number,
  unit: DialogueWindowStyleUnit = "px"
): DialogueWindowSurfaceStyle {
  return {
    backgroundColor: dialogueWindowBackgroundColor(
      backgroundColor,
      backgroundOpacity
    ),
    border: "none",
    borderRadius: canvasScaledLength(DIALOGUE_WINDOW_BORDER_RADIUS_PX, unit),
    boxShadow: "none"
  };
}

export function dialogueWindowTextShadow(
  glowColor: string,
  unit: DialogueWindowStyleUnit = "px"
): string {
  return `0 0 ${canvasScaledShadowLength(6, unit)} ${glowColor}, 0 0 ${canvasScaledShadowLength(14, unit)} ${glowColor}`;
}
