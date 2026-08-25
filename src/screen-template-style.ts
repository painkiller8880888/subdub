export const DEFAULT_DIALOGUE_WINDOW_GLOW_COLOR = "#ffffff" as const;

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

export function dialogueWindowTextShadow(glowColor: string): string {
  return `0 0 6px ${glowColor}, 0 0 14px ${glowColor}`;
}
