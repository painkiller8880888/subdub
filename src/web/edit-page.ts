import type { ProjectEditPlanInput } from "../schema/api.js";
import type { AssetListItem } from "../schema/asset.js";
import type {
  EditPlan,
  EditVideoElement,
  ScriptSection,
  SectionBgmAssignment
} from "../schema/video-project.js";

export type EditPickerAssetKind = "video" | "bgm";

export type SelectableEditAsset = AssetListItem & {
  readonly version: number;
  readonly checksum: string;
  readonly durationMs: number;
  readonly mimeType: string;
};

export function editAssetReferenceKey(
  assetId: string,
  assetVersion: number
): string {
  return `${assetId}@v${assetVersion}`;
}

export function editAssetSearchInput(kind: EditPickerAssetKind, page = 1) {
  return kind === "video"
    ? {
        kind: "video" as const,
        format: "mp4" as const,
        status: "active" as const,
        page,
        pageSize: 100
      }
    : {
        kind: "bgm" as const,
        format: "mp3" as const,
        status: "active" as const,
        page,
        pageSize: 100
      };
}

export function isSelectableEditAsset(
  asset: AssetListItem,
  kind: EditPickerAssetKind
): asset is SelectableEditAsset {
  return (
    asset.status === "active" &&
    asset.kind === kind &&
    asset.version !== null &&
    asset.checksum !== null &&
    asset.durationMs !== null &&
    asset.durationMs > 0 &&
    asset.mimeType === (kind === "video" ? "video/mp4" : "audio/mpeg")
  );
}

export function formatDurationMs(durationMs: number | null): string {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return "長さ未取得";
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}（${durationMs} ms）`;
}

export function cloneEditPlan(editPlan: EditPlan): EditPlan {
  return {
    videoElements: editPlan.videoElements.map((element) => ({
      ...element,
      placement: { ...element.placement }
    })),
    sectionBgms: editPlan.sectionBgms.map((bgm) => ({ ...bgm }))
  };
}

export function createProjectEditInput(
  editPlan: EditPlan
): ProjectEditPlanInput {
  return {
    videoElements: editPlan.videoElements.map((element) => ({
      id: element.id,
      role: element.role,
      assetId: element.assetId,
      assetVersion: element.assetVersion,
      placement: { ...element.placement },
      volume: element.volume
    })),
    sectionBgms: editPlan.sectionBgms.map((bgm) => ({
      id: bgm.id,
      sectionId: bgm.sectionId,
      assetId: bgm.assetId,
      assetVersion: bgm.assetVersion,
      volume: bgm.volume
    }))
  };
}

function temporaryEditId(prefix: string): string {
  return `edit-${prefix}-${globalThis.crypto.randomUUID()}`;
}

function nextCutinOrder(editPlan: EditPlan, sectionId: string): number {
  const orders = editPlan.videoElements.flatMap((element) => {
    if (
      element.role !== "cutin" ||
      element.placement.kind !== "before_section" ||
      element.placement.sectionId !== sectionId
    ) {
      return [];
    }
    return [element.placement.order];
  });
  return orders.length === 0 ? 0 : Math.max(...orders) + 1;
}

export function addEditVideoElement(
  editPlan: EditPlan,
  role: EditVideoElement["role"],
  sectionId: string | undefined,
  asset: SelectableEditAsset,
  firstSectionId?: string
): EditPlan {
  if (
    (role === "intro" || role === "outro") &&
    editPlan.videoElements.some((element) => element.role === role)
  ) {
    return editPlan;
  }
  if (
    role === "cutin" &&
    (sectionId === undefined || sectionId === firstSectionId)
  ) {
    return editPlan;
  }

  const placement: EditVideoElement["placement"] =
    role === "intro"
      ? { kind: "before_first_section" }
      : role === "outro"
        ? { kind: "after_last_section" }
        : {
            kind: "before_section",
            sectionId: sectionId!,
            order: nextCutinOrder(editPlan, sectionId!)
          };

  const element: EditVideoElement = {
    id: temporaryEditId(role),
    role,
    assetId: asset.assetId,
    assetVersion: asset.version,
    assetChecksum: asset.checksum,
    projectMediaPath: "media/pending-edit-asset",
    placement,
    volume: 1
  };
  return {
    ...editPlan,
    videoElements: [...editPlan.videoElements, element]
  };
}

export function replaceEditVideoElement(
  editPlan: EditPlan,
  elementId: string,
  asset: SelectableEditAsset
): EditPlan {
  return {
    ...editPlan,
    videoElements: editPlan.videoElements.map((element) =>
      element.id === elementId
        ? {
            ...element,
            assetId: asset.assetId,
            assetVersion: asset.version,
            assetChecksum: asset.checksum,
            projectMediaPath: "media/pending-edit-asset"
          }
        : element
    )
  };
}

export function removeEditVideoElement(
  editPlan: EditPlan,
  elementId: string
): EditPlan {
  return {
    ...editPlan,
    videoElements: editPlan.videoElements.filter(
      (element) => element.id !== elementId
    )
  };
}

export type EditCutinDropTarget = {
  readonly sectionId: string;
  /** Insertion index in the cutins displayed before sectionId. */
  readonly index: number;
};

/**
 * Return the valid insertion slots for keyboard and pointer DnD.
 * The first script section deliberately has no slot because a cutin cannot be
 * placed before it.
 */
export function createEditCutinDropTargets(
  sectionModels: readonly EditSectionReadModel[]
): EditCutinDropTarget[] {
  return sectionModels.flatMap((model) => {
    if (model.order === 1) {
      return [];
    }
    return Array.from({ length: model.cutins.length + 1 }, (_, index) => ({
      sectionId: model.section.id,
      index
    }));
  });
}

/**
 * Move a cutin to a valid section boundary and normalize the order in both
 * affected boundaries. A rejected target is a no-op so the UI cannot create a
 * client-side state that the server would reject.
 */
export function moveEditVideoElement(
  editPlan: EditPlan,
  elementId: string,
  target: EditCutinDropTarget,
  sectionIds: readonly string[]
): EditPlan {
  const validSectionIds = new Set(sectionIds);
  const firstSectionId = sectionIds[0];
  if (
    firstSectionId === undefined ||
    target.sectionId === firstSectionId ||
    !validSectionIds.has(target.sectionId) ||
    !Number.isInteger(target.index) ||
    target.index < 0
  ) {
    return cloneEditPlan(editPlan);
  }

  const source = editPlan.videoElements.find(
    (element) => element.id === elementId
  );
  if (
    source === undefined ||
    source.role !== "cutin" ||
    source.placement.kind !== "before_section"
  ) {
    return cloneEditPlan(editPlan);
  }

  const cutinsBySectionId = new Map<string, EditVideoElement[]>();
  for (const element of editPlan.videoElements) {
    if (
      element.role !== "cutin" ||
      element.placement.kind !== "before_section"
    ) {
      continue;
    }
    const cutins = cutinsBySectionId.get(element.placement.sectionId) ?? [];
    cutins.push(element);
    cutinsBySectionId.set(element.placement.sectionId, cutins);
  }
  for (const cutins of cutinsBySectionId.values()) {
    cutins.sort((left, right) => {
      if (
        left.placement.kind !== "before_section" ||
        right.placement.kind !== "before_section"
      ) {
        return 0;
      }
      return left.placement.order - right.placement.order;
    });
  }

  const sourceCutins = cutinsBySectionId.get(source.placement.sectionId);
  if (sourceCutins === undefined) {
    return cloneEditPlan(editPlan);
  }
  const targetCutins =
    cutinsBySectionId.get(target.sectionId) ?? ([] as EditVideoElement[]);
  cutinsBySectionId.set(target.sectionId, targetCutins);
  const sourceIndex = sourceCutins.findIndex(
    (element) => element.id === source.id
  );
  if (sourceIndex < 0) {
    return cloneEditPlan(editPlan);
  }

  // The target index is measured while the source card is still rendered.
  // Adjust it after removing the source when both sides are the same boundary.
  const boundedTargetIndex = Math.min(target.index, targetCutins.length);
  let insertionIndex = boundedTargetIndex;
  if (sourceCutins === targetCutins && sourceIndex < insertionIndex) {
    insertionIndex -= 1;
  }
  sourceCutins.splice(sourceIndex, 1);
  insertionIndex = Math.max(0, Math.min(insertionIndex, targetCutins.length));
  targetCutins.splice(insertionIndex, 0, source);

  const placementByElementId = new Map<string, EditVideoElement["placement"]>();
  for (const [sectionId, cutins] of cutinsBySectionId.entries()) {
    for (const [order, cutin] of cutins.entries()) {
      if (cutin.placement.kind !== "before_section") {
        continue;
      }
      placementByElementId.set(cutin.id, {
        kind: "before_section",
        sectionId,
        order
      });
    }
  }

  return {
    ...editPlan,
    videoElements: editPlan.videoElements.map((element) => {
      const placement = placementByElementId.get(element.id);
      return placement === undefined
        ? { ...element, placement: { ...element.placement } }
        : { ...element, placement };
    })
  };
}

export function addSectionBgm(
  editPlan: EditPlan,
  sectionId: string,
  asset: SelectableEditAsset
): EditPlan {
  if (editPlan.sectionBgms.some((bgm) => bgm.sectionId === sectionId)) {
    return editPlan;
  }
  return {
    ...editPlan,
    sectionBgms: [
      ...editPlan.sectionBgms,
      {
        id: temporaryEditId("bgm"),
        sectionId,
        assetId: asset.assetId,
        assetVersion: asset.version,
        assetChecksum: asset.checksum,
        projectMediaPath: "media/pending-edit-asset",
        volume: 1
      }
    ]
  };
}

export function replaceSectionBgm(
  editPlan: EditPlan,
  bgmId: string,
  asset: SelectableEditAsset
): EditPlan {
  return {
    ...editPlan,
    sectionBgms: editPlan.sectionBgms.map((bgm) =>
      bgm.id === bgmId
        ? {
            ...bgm,
            assetId: asset.assetId,
            assetVersion: asset.version,
            assetChecksum: asset.checksum,
            projectMediaPath: "media/pending-edit-asset"
          }
        : bgm
    )
  };
}

export function removeSectionBgm(editPlan: EditPlan, bgmId: string): EditPlan {
  return {
    ...editPlan,
    sectionBgms: editPlan.sectionBgms.filter((bgm) => bgm.id !== bgmId)
  };
}

export function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function reconcileSavedEditPlan(
  submitted: EditPlan,
  saved: EditPlan,
  current: EditPlan
): EditPlan {
  const submittedVideos = new Map(
    submitted.videoElements.map((element) => [element.id, element])
  );
  const savedVideos = new Map(
    saved.videoElements.map((element) => [element.id, element])
  );
  const submittedBgms = new Map(
    submitted.sectionBgms.map((bgm) => [bgm.id, bgm])
  );
  const savedBgms = new Map(saved.sectionBgms.map((bgm) => [bgm.id, bgm]));

  return {
    videoElements: current.videoElements.map((element) => {
      const submittedElement = submittedVideos.get(element.id);
      const savedElement = savedVideos.get(element.id);
      if (
        submittedElement !== undefined &&
        savedElement !== undefined &&
        element.assetId === submittedElement.assetId &&
        element.assetVersion === submittedElement.assetVersion
      ) {
        return {
          ...savedElement,
          id: element.id,
          role: element.role,
          placement: { ...element.placement },
          volume: element.volume
        };
      }
      return { ...element, placement: { ...element.placement } };
    }),
    sectionBgms: current.sectionBgms.map((bgm) => {
      const submittedBgm = submittedBgms.get(bgm.id);
      const savedBgm = savedBgms.get(bgm.id);
      if (
        submittedBgm !== undefined &&
        savedBgm !== undefined &&
        bgm.assetId === submittedBgm.assetId &&
        bgm.assetVersion === submittedBgm.assetVersion
      ) {
        return {
          ...savedBgm,
          id: bgm.id,
          sectionId: bgm.sectionId,
          volume: bgm.volume
        };
      }
      return { ...bgm };
    })
  };
}

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
