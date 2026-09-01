import type {
  EditVideoElement,
  ScriptSection,
  SectionBgmAssignment,
  SoundEffect,
  VideoProject,
  VisualAssignment
} from "../../schema/index.js";

export type EffectiveRenderProject = Readonly<{
  /** Enabled sections in their persisted array order. */
  readonly sections: readonly ScriptSection[];
  /** IDs belonging to the current output section collection. */
  readonly sectionIds: ReadonlySet<string>;
  /** IDs belonging to lines in the current output section collection. */
  readonly lineIds: ReadonlySet<string>;
  /** Visual assignments whose range is entirely inside enabled sections. */
  readonly visualAssignments: readonly VisualAssignment[];
  /** Sound effects attached to lines in enabled sections. */
  readonly soundEffects: readonly SoundEffect[];
  /** Section BGM assignments attached to enabled sections. */
  readonly sectionBgms: readonly SectionBgmAssignment[];
  /** Edit inserts with a renderable placement in the enabled collection. */
  readonly videoElements: readonly EditVideoElement[];
}>;

/**
 * Resolve the project data used by current output consumers.
 *
 * This is a read model over the persisted project. It keeps the source
 * objects intact, preserves their array order, and never writes a filtered
 * project back to persistence.
 */
export function createEffectiveRenderProject(
  project: Pick<VideoProject, "script" | "visuals" | "audio" | "edit">
): EffectiveRenderProject {
  const sections = project.script.sections.filter((section) => section.enabled);
  const sectionIds = new Set(sections.map((section) => section.id));
  const lineIds = new Set(
    sections.flatMap((section) => section.lines.map((line) => line.id))
  );
  const visualAssignments = project.visuals.assignments.filter(
    (assignment) =>
      lineIds.has(assignment.startLineId) && lineIds.has(assignment.endLineId)
  );
  const soundEffects = project.audio.soundEffects.filter((effect) =>
    lineIds.has(effect.lineId)
  );
  const sectionBgms = project.edit.sectionBgms.filter((bgm) =>
    sectionIds.has(bgm.sectionId)
  );
  const videoElements =
    sections.length === 0
      ? []
      : project.edit.videoElements.filter(
          (element) =>
            element.placement.kind !== "before_section" ||
            sectionIds.has(element.placement.sectionId)
        );

  return {
    sections,
    sectionIds,
    lineIds,
    visualAssignments,
    soundEffects,
    sectionBgms,
    videoElements
  };
}
