import type { EditVideoPlacement, EditVideoElement } from "../schema/index.js";
import { getEndExclusive } from "./frame-range.js";
import type { TimelineSectionRange } from "./section-ranges.js";

export type TimelineEditVideoElement = Readonly<
  Pick<
    EditVideoElement,
    "id" | "role" | "placement" | "volume" | "projectMediaPath"
  >
> & {
  readonly durationInFrames: number;
  readonly inputIndex: number;
};

export type TimelineEditVideoInsert = Readonly<{
  readonly id: string;
  readonly role: "intro" | "outro" | "cutin";
  readonly from: number;
  readonly durationInFrames: number;
  readonly src: string;
  readonly volume: number;
}>;

export type EditVideoTimelineResult = Readonly<{
  readonly inserts: readonly TimelineEditVideoInsert[];
  /** Shift applied to content in each section after its boundary inserts. */
  readonly sectionShiftById: ReadonlyMap<string, number>;
  readonly durationInFrames: number;
}>;

type IndexedElement = TimelineEditVideoElement & {
  readonly placement: EditVideoPlacement;
};

function placementSectionId(placement: EditVideoPlacement): string | undefined {
  return placement.kind === "before_section" ? placement.sectionId : undefined;
}

function sortCutins(left: IndexedElement, right: IndexedElement): number {
  if (
    left.placement.kind !== "before_section" ||
    right.placement.kind !== "before_section"
  ) {
    return left.inputIndex - right.inputIndex;
  }
  const orderDifference = left.placement.order - right.placement.order;
  return orderDifference === 0
    ? left.inputIndex - right.inputIndex
    : orderDifference;
}

/**
 * Resolve EditPlan video elements into a deterministic, non-overlapping
 * timeline. The input section ranges are the pre-insert ranges; the returned
 * section shifts are applied to lines, visuals, backgrounds, audio, and sound
 * effects derived from those ranges.
 */
export function calculateEditVideoTimeline(
  elements: readonly TimelineEditVideoElement[],
  sections: readonly TimelineSectionRange[]
): EditVideoTimelineResult {
  const indexedElements = elements as readonly IndexedElement[];
  const intro = indexedElements.find((element) => element.role === "intro");
  const outro = indexedElements.find((element) => element.role === "outro");
  const cutinsBySection = new Map<string, IndexedElement[]>();
  const sectionIds = new Set(sections.map((section) => section.sectionId));

  for (const element of indexedElements) {
    if (element.role !== "cutin") {
      continue;
    }
    const sectionId = placementSectionId(element.placement);
    if (sectionId === undefined) {
      throw new Error(`cutin ${element.id} must be placed before a section`);
    }
    if (!sectionIds.has(sectionId)) {
      throw new Error(`cutin ${element.id} references a missing section`);
    }
    const cutins = cutinsBySection.get(sectionId) ?? [];
    cutins.push(element);
    cutinsBySection.set(sectionId, cutins);
  }

  for (const cutins of cutinsBySection.values()) {
    cutins.sort(sortCutins);
  }

  const inserts: TimelineEditVideoInsert[] = [];
  const sectionShiftById = new Map<string, number>();
  let accumulatedShift = intro?.durationInFrames ?? 0;

  if (intro !== undefined) {
    inserts.push({
      id: intro.id,
      role: intro.role,
      from: 0,
      durationInFrames: intro.durationInFrames,
      src: intro.projectMediaPath,
      volume: intro.volume
    });
  }

  for (const section of sections) {
    const cutins = cutinsBySection.get(section.sectionId) ?? [];
    for (const cutin of cutins) {
      inserts.push({
        id: cutin.id,
        role: cutin.role,
        from: section.from + accumulatedShift,
        durationInFrames: cutin.durationInFrames,
        src: cutin.projectMediaPath,
        volume: cutin.volume
      });
      accumulatedShift += cutin.durationInFrames;
    }
    sectionShiftById.set(section.sectionId, accumulatedShift);
  }

  const baseEnd =
    sections.length === 0 ? 0 : getEndExclusive(sections[sections.length - 1]!);
  const contentEnd = baseEnd + accumulatedShift;
  const outroFrom = contentEnd;
  if (outro !== undefined) {
    inserts.push({
      id: outro.id,
      role: outro.role,
      from: outroFrom,
      durationInFrames: outro.durationInFrames,
      src: outro.projectMediaPath,
      volume: outro.volume
    });
  }

  return {
    inserts,
    sectionShiftById,
    durationInFrames: outroFrom + (outro?.durationInFrames ?? 0)
  };
}
