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
import { characterVisualFileUrl } from "./character-visual-picker";
import { createProjectManifestAssetUrlResolver } from "./preview-asset-url";

export type ResolvedScriptScreenTemplate = Readonly<{
  templateId: string;
  template: ScreenTemplate | undefined;
  status: "ready" | "loading" | "missing" | "inactive";
}>;

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
  templates: ReadonlyMap<string, ScreenTemplate>,
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
  return {
    background: resolveBackgroundPreview(projectId, section),
    characters: resolveCharacterPreviews(project, line, catalog),
    content: contents[0] ?? unresolvedContentPreview(undefined),
    contents,
    dialogueText: line.subtitleText,
    speakerNameText:
      project.characters.find((character) => character.id === line.speakerId)
        ?.name ?? "",
    sectionTitleText: section.name
  };
}
