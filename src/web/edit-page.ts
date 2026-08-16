import type {
  EditPlan,
  EditVideoElement,
  ScriptSection,
  SectionBgmAssignment
} from "../schema/video-project.js";

export type EditPlanReadModel = {
  readonly intro: EditVideoElement | undefined;
  readonly outro: EditVideoElement | undefined;
  readonly cutins: readonly EditVideoElement[];
  readonly sectionBgms: readonly SectionBgmAssignment[];
  readonly hasVideoElements: boolean;
  readonly hasSectionBgms: boolean;
};

export type EditSectionReadModel = {
  readonly section: ScriptSection;
  readonly order: number;
  readonly bgm: SectionBgmAssignment | undefined;
  readonly cutins: readonly EditVideoElement[];
};

export function createEditPlanReadModel(editPlan: EditPlan): EditPlanReadModel {
  const intro = editPlan.videoElements.find(
    (element) => element.role === "intro"
  );
  const outro = editPlan.videoElements.find(
    (element) => element.role === "outro"
  );
  const cutins = editPlan.videoElements.filter(
    (element) => element.role === "cutin"
  );

  return {
    intro,
    outro,
    cutins,
    sectionBgms: editPlan.sectionBgms,
    hasVideoElements: editPlan.videoElements.length > 0,
    hasSectionBgms: editPlan.sectionBgms.length > 0
  };
}

export function createEditSectionReadModels(
  sections: readonly ScriptSection[],
  editPlan: EditPlanReadModel
): EditSectionReadModel[] {
  const bgmBySectionId = new Map(
    editPlan.sectionBgms.map((bgm) => [bgm.sectionId, bgm])
  );
  const cutinsBySectionId = new Map<string, EditVideoElement[]>();

  for (const cutin of editPlan.cutins) {
    if (cutin.placement.kind !== "before_section") {
      continue;
    }
    const sectionCutins =
      cutinsBySectionId.get(cutin.placement.sectionId) ?? [];
    sectionCutins.push(cutin);
    cutinsBySectionId.set(cutin.placement.sectionId, sectionCutins);
  }

  for (const sectionCutins of cutinsBySectionId.values()) {
    sectionCutins.sort((left, right) => {
      if (
        left.placement.kind !== "before_section" ||
        right.placement.kind !== "before_section"
      ) {
        return 0;
      }
      return left.placement.order - right.placement.order;
    });
  }

  return sections.map((section, index) => ({
    section,
    order: index + 1,
    bgm: bgmBySectionId.get(section.id),
    cutins: cutinsBySectionId.get(section.id) ?? []
  }));
}
