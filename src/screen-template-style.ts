export const DEFAULT_DIALOGUE_WINDOW_GLOW_COLOR = "#ffffff" as const;

export const DIALOGUE_WINDOW_BORDER_RADIUS_PX = 16 as const;

export type DialogueWindowSurfaceStyle = Readonly<{
  backgroundColor: string;
  border: "none";
  borderRadius: typeof DIALOGUE_WINDOW_BORDER_RADIUS_PX;
  boxShadow: "none";
}>;

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
  backgroundOpacity: number
): DialogueWindowSurfaceStyle {
  return {
    backgroundColor: dialogueWindowBackgroundColor(
      backgroundColor,
      backgroundOpacity
    ),
    border: "none",
    borderRadius: DIALOGUE_WINDOW_BORDER_RADIUS_PX,
    boxShadow: "none"
  };
}

export function dialogueWindowTextShadow(glowColor: string): string {
  return `0 0 6px ${glowColor}, 0 0 14px ${glowColor}`;
}
