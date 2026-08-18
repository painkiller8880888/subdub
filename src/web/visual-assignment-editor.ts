import type {
  AssetDetail,
  AssetListItem,
  DisplayV13,
  StaticAnnotation,
  VisualAssignment
} from "../schema/index.js";

export type VisualAsset = Pick<
  AssetDetail | AssetListItem,
  "assetId" | "kind" | "durationMs" | "pageCount"
>;

export type DefaultDisplayResult =
  | { readonly display: DisplayV13; readonly reason?: undefined }
  | { readonly display: undefined; readonly reason: string };

export function clampUnitInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

export function defaultDisplayForAsset(
  asset: VisualAsset | undefined
): DefaultDisplayResult {
  if (asset === undefined) {
    return { display: undefined, reason: "素材のメタデータを取得できません。" };
  }

  const common = {
    fit: "contain" as const,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    scale: 1,
    position: { x: 0.5, y: 0.5 },
    prioritizeVisual: false,
    annotations: [],
    displayCoordinateSpace: "content-slot-relative" as const
  };

  if (asset.kind === "video") {
    if (asset.durationMs === null || asset.durationMs <= 0) {
      return {
        display: undefined,
        reason: "動画の尺が未取得のため割り当てできません。"
      };
    }
    return {
      display: {
        ...common,
        kind: "video",
        startMs: 0,
        endMs: asset.durationMs,
        playbackRate: 1,
        volume: 0
      }
    };
  }

  if (asset.kind === "document_scan") {
    if (asset.pageCount === null || asset.pageCount <= 0) {
      return {
        display: undefined,
        reason: "帳票のページ数が未取得のため割り当てできません。"
      };
    }
    return { display: { ...common, kind: "document_scan", page: 1 } };
  }

  if (asset.kind === "photo") {
    return { display: { ...common, kind: "photo" } };
  }

  return {
    display: undefined,
    reason: "効果音はビジュアルへ割り当てできません。"
  };
}

function nextAnnotationId(): string {
  return `annotation-${globalThis.crypto.randomUUID()}`;
}

export function addVisualAnnotation(
  assignment: VisualAssignment
): VisualAssignment {
  const annotation: StaticAnnotation = {
    id: nextAnnotationId(),
    kind: "label",
    text: "",
    x: 0.1,
    y: 0.1,
    width: 0.25,
    height: 0.08,
    colorToken: "accent"
  };
  return {
    ...assignment,
    display: {
      ...assignment.display,
      annotations: [...assignment.display.annotations, annotation]
    }
  };
}

export function updateVisualAnnotation(
  assignment: VisualAssignment,
  annotationId: string,
  update: Partial<StaticAnnotation>
): VisualAssignment {
  return {
    ...assignment,
    display: {
      ...assignment.display,
      annotations: assignment.display.annotations.map((annotation) =>
        annotation.id === annotationId
          ? { ...annotation, ...update }
          : annotation
      )
    }
  };
}

export function removeVisualAnnotation(
  assignment: VisualAssignment,
  annotationId: string
): VisualAssignment {
  return {
    ...assignment,
    display: {
      ...assignment.display,
      annotations: assignment.display.annotations.filter(
        (annotation) => annotation.id !== annotationId
      )
    }
  };
}

export function updateVisualAssignmentVideoVolume(
  assignment: VisualAssignment,
  volume: number
): VisualAssignment {
  if (assignment.display.kind !== "video") {
    return assignment;
  }

  return {
    ...assignment,
    display: {
      ...assignment.display,
      volume: clampUnitInterval(volume)
    }
  };
}

export function nextVisualAssignmentId(
  assignments: readonly VisualAssignment[]
): string {
  const ids = new Set(assignments.map((assignment) => assignment.id));
  let suffix = assignments.length + 1;
  let id = `visual-assignment-${suffix}`;
  while (ids.has(id)) {
    suffix += 1;
    id = `visual-assignment-${suffix}`;
  }
  return id;
}

export function assignmentInput(
  assignment: VisualAssignment
): Pick<
  VisualAssignment,
  "id" | "startLineId" | "endLineId" | "assetId" | "display"
> {
  return {
    id: assignment.id,
    startLineId: assignment.startLineId,
    endLineId: assignment.endLineId,
    assetId: assignment.assetId,
    display: assignment.display
  };
}
