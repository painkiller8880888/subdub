import type {
  AssetDetail,
  CharacterVisualCatalogSnapshot,
  ScriptLine,
  ScriptSection,
  ScreenTemplate,
  VideoProject,
  VisualAssignment
} from "../schema/index.js";
import type {
  ScreenCharacterSlot,
  ScreenLayoutCharacterPreview,
  ScreenLayoutContentPreview,
  ScreenLayoutPreview
} from "../remotion/screen-template-layout";
import { sortByStartThenInputIndex } from "../timeline/visual-ranges.js";
import { resolveVisualPlaybackState } from "../timeline/visual-playback.js";
import { characterVisualFileUrl } from "./character-visual-picker";
import { createProjectManifestAssetUrlResolver } from "./preview-asset-url";

export type ResolvedScriptScreenTemplate = Readonly<{
  templateId: string;
  template: ScriptScreenTemplate | undefined;
  status: "ready" | "loading" | "missing" | "inactive";
}>;

/**
 * ScreenTemplate details returned by the API include contentHash, while
 * fixtures and other shared callers may only have the schema object. Keeping
 * the hash optional lets the preview resolver remain usable at both
 * boundaries; the persistent-state helper derives a deterministic fallback
 * identity when the API hash is unavailable.
 */
export type ScriptScreenTemplate = ScreenTemplate & {
  readonly contentHash?: string;
};

export function screenTemplateIdsForScript(
  script: Pick<VideoProject["script"], "sections">
): string[] {
  const ids = new Set<string>();
  for (const section of script.sections) {
    ids.add(section.screenTemplateId);
  }
  return [...ids];
}

export function resolveScriptScreenTemplate(
  section: Pick<ScriptSection, "screenTemplateId">,
  templates: ReadonlyMap<string, ScriptScreenTemplate>,
  loadingTemplateIds: ReadonlySet<string> = new Set()
): ResolvedScriptScreenTemplate {
  const templateId = section.screenTemplateId;
  const template = templates.get(templateId);
  if (template === undefined) {
    if (loadingTemplateIds.has(templateId)) {
      return { status: "loading", template: undefined, templateId };
    }
    return { status: "missing", template: undefined, templateId };
  }
  return {
    status: template.status === "active" ? "ready" : "inactive",
    template,
    templateId
  };
}

export function projectAssetVersion(
  projectMediaPath: string
): number | undefined {
  const fileName = projectMediaPath.split("/").at(-1) ?? "";
  const match = /^v([1-9][0-9]*)\.[^/]+$/u.exec(fileName);
  if (match === null) {
    return undefined;
  }
  const version = Number(match[1]);
  return Number.isSafeInteger(version) ? version : undefined;
}

export function screenPreviewAssetKey(
  assignment: Pick<VisualAssignment, "assetId" | "projectMediaPath">
): string {
  return `${assignment.assetId}:${assignment.projectMediaPath}`;
}

export function findVisualAssignmentsForLine(
  section: Pick<ScriptSection, "id" | "lines">,
  lineId: string,
  assignments: readonly VisualAssignment[]
): VisualAssignment[] {
  const lineIndex = section.lines.findIndex((line) => line.id === lineId);
  if (lineIndex < 0) {
    return [];
  }

  return sortByStartThenInputIndex(
    assignments.flatMap((assignment) => {
      const startIndex = section.lines.findIndex(
        (line) => line.id === assignment.startLineId
      );
      const endIndex = section.lines.findIndex(
        (line) => line.id === assignment.endLineId
      );
      return startIndex >= 0 &&
        endIndex >= startIndex &&
        startIndex <= lineIndex &&
        lineIndex <= endIndex
        ? [{ assignment, startIndex }]
        : [];
    }),
    ({ startIndex }) => startIndex
  ).map(({ assignment }) => assignment);
}

function characterSlot(index: number): ScreenCharacterSlot {
  return index === 0 ? "speaker-1" : "speaker-2";
}

function representativeFileKey(
  variant: NonNullable<
    CharacterVisualCatalogSnapshot[number]["variants"][number]
  >
): string {
  return variant.renderType === "mouth-pair" ? "closed" : "single";
}

export function resolveCharacterPreviewForSlot(
  project: Pick<VideoProject, "characters">,
  line: Pick<ScriptLine, "speakerId" | "characterVariantId">,
  catalog: CharacterVisualCatalogSnapshot | undefined,
  index: number
): ScreenLayoutCharacterPreview {
  const character = project.characters[index];
  const slot = characterSlot(index);
  if (character === undefined) {
    return { alt: slot === "speaker-1" ? "話者1" : "話者2", src: null };
  }

  const visualId = character.characterVisual.visualId;
  const visual = catalog?.find(
    (candidate) =>
      candidate.visualId === visualId && candidate.status === "active"
  );
  const variantId =
    character.id === line.speakerId
      ? line.characterVariantId
      : character.characterVisual.idleVariantId;
  const variant = visual?.variants.find(
    (candidate) =>
      candidate.variantId === variantId && candidate.status === "active"
  );
  const fileKey =
    variant === undefined ? undefined : representativeFileKey(variant);
  const file =
    fileKey === undefined
      ? undefined
      : variant?.files.find((candidate) => candidate.key === fileKey);

  return {
    alt:
      variant === undefined
        ? `${character.name}のビジュアル未解決`
        : `${character.name}の${variant.label}`,
    src:
      visual === undefined || variant === undefined || file === undefined
        ? null
        : characterVisualFileUrl(visual.visualId, variant.variantId, file.key)
  };
}

export function resolveCharacterPreviews(
  project: Pick<VideoProject, "characters">,
  line: Pick<ScriptLine, "speakerId" | "characterVariantId">,
  catalog: CharacterVisualCatalogSnapshot | undefined
): Readonly<
  Partial<Record<ScreenCharacterSlot, ScreenLayoutCharacterPreview>>
> {
  return {
    "speaker-1": resolveCharacterPreviewForSlot(project, line, catalog, 0),
    "speaker-2": resolveCharacterPreviewForSlot(project, line, catalog, 1)
  };
}

function assetThumbnailUrl(
  asset: AssetDetail,
  thumbnailIndex: number
): string | null {
  if (asset.thumbnailPaths[thumbnailIndex] === undefined) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(asset.assetId)}/thumbnails/${thumbnailIndex}?version=${asset.version}`;
}

function matchesProjectAssetSnapshot(
  assignment: VisualAssignment,
  asset: AssetDetail
): boolean {
  const snapshotVersion = projectAssetVersion(assignment.projectMediaPath);
  return (
    asset.assetId === assignment.assetId &&
    (snapshotVersion === undefined || asset.version === snapshotVersion) &&
    asset.checksum !== null &&
    asset.checksum.toLowerCase() === assignment.assetChecksum.toLowerCase()
  );
}

function unresolvedContentPreview(
  assignment: VisualAssignment | undefined
): ScreenLayoutContentPreview {
  return {
    alt:
      assignment === undefined
        ? "primary content preview 未解決"
        : "snapshot preview を解決できません",
    ...(assignment === undefined ? {} : { display: assignment.display }),
    src: null
  };
}

export function resolveContentPreview(
  assignment: VisualAssignment | undefined,
  asset: AssetDetail | undefined
): ScreenLayoutContentPreview {
  if (assignment === undefined || asset === undefined) {
    return unresolvedContentPreview(assignment);
  }
  if (!matchesProjectAssetSnapshot(assignment, asset)) {
    return unresolvedContentPreview(assignment);
  }

  const thumbnailIndex =
    assignment.display.kind === "document_scan"
      ? assignment.display.page - 1
      : 0;
  return {
    alt: asset.title,
    display: assignment.display,
    src: assetThumbnailUrl(asset, thumbnailIndex)
  };
}

export function resolveContentPreviews(
  assignments: readonly VisualAssignment[],
  assets: ReadonlyMap<string, AssetDetail | undefined>
): ScreenLayoutContentPreview[] {
  if (assignments.length === 0) {
    return [unresolvedContentPreview(undefined)];
  }
  return assignments.map((assignment) =>
    resolveContentPreview(
      assignment,
      assets.get(screenPreviewAssetKey(assignment))
    )
  );
}

export function resolveBackgroundPreview(
  projectId: string,
  section: Pick<ScriptSection, "background">
): NonNullable<ScreenLayoutPreview["background"]> {
  if (section.background.kind === "solid") {
    return { fit: "cover", src: null };
  }
  return {
    fit: section.background.fit,
    src: createProjectManifestAssetUrlResolver(projectId)(
      section.background.src
    )
  };
}

export function resolveScriptLineScreenPreview({
  projectId,
  project,
  section,
  line,
  catalog,
  assignments,
  assets
}: {
  readonly projectId: string;
  readonly project: Pick<VideoProject, "characters">;
  readonly section: Pick<ScriptSection, "name" | "background">;
  readonly line: Pick<
    ScriptLine,
    "speakerId" | "characterVariantId" | "subtitleText"
  >;
  readonly catalog: CharacterVisualCatalogSnapshot | undefined;
  readonly assignments: readonly VisualAssignment[];
  readonly assets: ReadonlyMap<string, AssetDetail | undefined>;
}): ScreenLayoutPreview {
  const contents = resolveContentPreviews(assignments, assets);
  const speaker = project.characters.find(
    (character) => character.id === line.speakerId
  );
  const speakerVisual = catalog?.find(
    (visual) => visual.visualId === speaker?.characterVisual.visualId
  );
  return {
    background: resolveBackgroundPreview(projectId, section),
    characters: resolveCharacterPreviews(project, line, catalog),
    content: contents[0] ?? unresolvedContentPreview(undefined),
    contents,
    dialogueGlowColor: speakerVisual?.glowColor,
    dialogueText: line.subtitleText,
    speakerNameText:
      project.characters.find((character) => character.id === line.speakerId)
        ?.name ?? "",
    sectionTitleText: section.name
  };
}

export type PreviewMode = "full-screen" | "dialogue-only";

/**
 * This is the line-boundary lifecycle read model used by ScriptPage and the
 * shared preview comparison. It intentionally describes the resolved state,
 * rather than exposing raw cue actions as UI state.
 */
export type PersistentVisualLifecycle =
  "hidden" | "static-visible" | "playing" | "paused" | "ended";

export type PersistentVisualPlaybackIssue = Readonly<{
  code: string;
  message: string;
}>;

export type PersistentVisualPresentationState = Readonly<{
  assignmentId: string;
  assetId: string;
  assetChecksum: string;
  projectMediaPath: string;
  lifecycle: PersistentVisualLifecycle;
  display: VisualAssignment["display"];
  assetResolution: "loading" | "resolved" | "unresolved";
  playbackIssues: readonly PersistentVisualPlaybackIssue[];
}>;

export type PersistentVisualBoundaryTransition = Readonly<{
  assignmentId: string;
  action: "end";
}>;

export type PersistentScreenState = Readonly<{
  sectionId: string;
  screenTemplateIdentity: Readonly<{
    templateId: string;
    revision: number;
    contentHash: string;
  }>;
  templateStatus: ResolvedScriptScreenTemplate["status"];
  backgroundIdentity: string;
  visualBoundaryTransitions: readonly PersistentVisualBoundaryTransition[];
  visualPresentationState: readonly PersistentVisualPresentationState[];
}>;

export type ScriptLinePreviewState = Readonly<{
  mode: PreviewMode;
  resolvedTemplate: ResolvedScriptScreenTemplate;
  assignments: readonly VisualAssignment[];
  persistentScreenState: PersistentScreenState;
}>;

function stableSerialize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }
  return String(value);
}

function templateRenderIdentity(template: ScriptScreenTemplate): unknown {
  return {
    templateId: template.templateId,
    canvasWidth: template.canvasWidth,
    canvasHeight: template.canvasHeight,
    elements: template.elements.map((element) => {
      if (element.type === "dialogue-window") {
        return {
          type: element.type,
          transform: element.transform,
          fontSize: element.fontSize,
          backgroundColor: element.backgroundColor,
          backgroundOpacity: element.backgroundOpacity
        };
      }
      if (element.type === "section-title") {
        return {
          type: element.type,
          transform: element.transform,
          fontSize: element.fontSize
        };
      }
      if (element.type === "character-visual") {
        return {
          type: element.type,
          transform: element.transform,
          slot: element.slot,
          flipX: element.flipX
        };
      }
      return {
        type: element.type,
        transform: element.transform,
        slot: element.slot
      };
    })
  };
}

function templateContentIdentity(
  template: ScriptScreenTemplate | undefined
): string {
  if (template === undefined) {
    return "unresolved";
  }
  return (
    template.contentHash ?? stableSerialize(templateRenderIdentity(template))
  );
}

export function persistentScreenStateKey(state: PersistentScreenState): string {
  return stableSerialize(state);
}

export function previewLineKey(sectionId: string, lineId: string): string {
  return stableSerialize([sectionId, lineId]);
}

export function resolvePersistentScreenState({
  section,
  lineId,
  resolvedTemplate,
  assignments,
  assets,
  assetLoadingKeys = new Set()
}: {
  readonly section: Pick<ScriptSection, "id" | "background"> & {
    readonly lines?: readonly Pick<ScriptLine, "id">[];
  };
  readonly lineId?: string;
  readonly resolvedTemplate: ResolvedScriptScreenTemplate;
  readonly assignments: readonly VisualAssignment[];
  readonly assets: ReadonlyMap<string, AssetDetail | undefined>;
  readonly assetLoadingKeys?: ReadonlySet<string>;
}): PersistentScreenState {
  const template = resolvedTemplate.template;
  const sectionLines = section.lines ?? [];
  const resolvedLineId = lineId ?? sectionLines[0]?.id;
  const playbackScript = {
    sections: [
      {
        id: section.id,
        lines: sectionLines.map((line) => ({ id: line.id }))
      }
    ]
  };
  return {
    sectionId: section.id,
    screenTemplateIdentity: {
      templateId: resolvedTemplate.templateId,
      revision: template?.revision ?? 0,
      contentHash: templateContentIdentity(template)
    },
    templateStatus: resolvedTemplate.status,
    backgroundIdentity: stableSerialize(section.background),
    visualBoundaryTransitions:
      resolvedLineId === undefined
        ? []
        : assignments
            .filter((assignment) => assignment.endLineId === resolvedLineId)
            .map((assignment) => ({
              assignmentId: assignment.id,
              action: "end" as const
            })),
    visualPresentationState: assignments.map((assignment) => {
      const assetKey = screenPreviewAssetKey(assignment);
      const contentPreview = resolveContentPreview(
        assignment,
        assets.get(assetKey)
      );
      const playbackResolution =
        assignment.display.kind === "video" && resolvedLineId !== undefined
          ? resolveVisualPlaybackState({
              assignment,
              script: playbackScript,
              boundary: { lineId: resolvedLineId, edge: "before" }
            })
          : undefined;
      const lifecycle: PersistentVisualLifecycle =
        assignment.display.kind === "video"
          ? (playbackResolution?.playbackState ?? "hidden")
          : "static-visible";
      return {
        assignmentId: assignment.id,
        assetId: assignment.assetId,
        assetChecksum: assignment.assetChecksum,
        projectMediaPath: assignment.projectMediaPath,
        lifecycle,
        display: assignment.display,
        assetResolution: assetLoadingKeys.has(assetKey)
          ? "loading"
          : contentPreview.src === null
            ? "unresolved"
            : "resolved",
        playbackIssues:
          playbackResolution?.issues?.map(({ code, message }) => ({
            code,
            message
          })) ?? []
      };
    })
  };
}

export function previewModeForLine(
  previous: PersistentScreenState | null,
  current: PersistentScreenState,
  isSectionFirstLine: boolean
): PreviewMode {
  if (isSectionFirstLine || previous === null) {
    return "full-screen";
  }
  return persistentScreenStateKey(previous) ===
    persistentScreenStateKey(current)
    ? "dialogue-only"
    : "full-screen";
}

export function resolveScriptLinePreviewStates({
  script,
  templates,
  loadingTemplateIds,
  assignments,
  assets,
  assetLoadingKeys = new Set()
}: {
  readonly script: Pick<VideoProject["script"], "sections">;
  readonly templates: ReadonlyMap<string, ScriptScreenTemplate>;
  readonly loadingTemplateIds?: ReadonlySet<string>;
  readonly assignments: readonly VisualAssignment[];
  readonly assets: ReadonlyMap<string, AssetDetail | undefined>;
  readonly assetLoadingKeys?: ReadonlySet<string>;
}): ReadonlyMap<string, ScriptLinePreviewState> {
  const states = new Map<string, ScriptLinePreviewState>();
  let previous: PersistentScreenState | null = null;

  for (const section of script.sections) {
    const resolvedTemplate = resolveScriptScreenTemplate(
      section,
      templates,
      loadingTemplateIds
    );
    for (const [lineIndex, line] of section.lines.entries()) {
      const lineAssignments = findVisualAssignmentsForLine(
        section,
        line.id,
        assignments
      );
      const persistentScreenState = resolvePersistentScreenState({
        section,
        lineId: line.id,
        resolvedTemplate,
        assignments: lineAssignments,
        assets,
        assetLoadingKeys
      });
      states.set(previewLineKey(section.id, line.id), {
        mode: previewModeForLine(
          previous,
          persistentScreenState,
          lineIndex === 0
        ),
        resolvedTemplate,
        assignments: lineAssignments,
        persistentScreenState
      });
      previous = persistentScreenState;
    }
  }

  return states;
}
