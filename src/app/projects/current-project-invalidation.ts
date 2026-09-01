import type { VideoProject } from "../../schema/video-project.js";

export function hasMeaningfulVisuals(
  project: Pick<VideoProject, "visuals">
): boolean {
  return (
    project.visuals.assignments.length > 0 ||
    project.visuals.suggestionRunIds.length > 0 ||
    project.visuals.status !== "draft"
  );
}
