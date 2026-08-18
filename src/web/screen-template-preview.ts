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
import { resolveScreenTemplateId } from "../app/projects/screen-template-selection.js";
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
    for (const line of section.lines) {
      if (line.screenTemplateId !== null) {
        ids.add(line.screenTemplateId);
      }
    }
  }
  return [...ids];
}

export function resolveScriptScreenTemplate(
  section: Pick<ScriptSection, "screenTemplateId">,
  line: Pick<ScriptLine, "screenTemplateId">,
  templates: ReadonlyMap<string, ScreenTemplate>,
  loadingTemplateIds: ReadonlySet<string> = new Set()
): ResolvedScriptScreenTemplate {
  const templateId = resolveScreenTemplateId(section, line);
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

export function findVisualAssignmentForLine(
  section: Pick<ScriptSection, "id" | "lines">,
  lineId: string,
  assignments: readonly VisualAssignment[]
): VisualAssignment | undefined {
  const lineIndex = section.lines.findIndex((line) => line.id === lineId);
  if (lineIndex < 0) {
    return undefined;
  }

  return assignments.find((assignment) => {
    const startIndex = section.lines.findIndex(
      (line) => line.id === assignment.startLineId
    );
    const endIndex = section.lines.findIndex(
      (line) => line.id === assignment.endLineId
    );
    return (
      startIndex >= 0 &&
      endIndex >= startIndex &&
      startIndex <= lineIndex &&
      lineIndex <= endIndex
    );
  });
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
  if (
    asset.status !== "active" ||
    asset.version === null ||
    asset.thumbnailPaths[thumbnailIndex] === undefined
  ) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(asset.assetId)}/thumbnails/${thumbnailIndex}?version=${asset.version}`;
}

export function resolveContentPreview(
  assignment: VisualAssignment | undefined,
  asset: AssetDetail | undefined
): ScreenLayoutContentPreview {
  if (assignment === undefined || asset === undefined) {
    return { alt: "primary content preview 未解決", src: null };
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
  assignment,
  asset
}: {
  readonly projectId: string;
  readonly project: Pick<VideoProject, "characters">;
  readonly section: Pick<ScriptSection, "name" | "background">;
  readonly line: Pick<
    ScriptLine,
    "speakerId" | "characterVariantId" | "subtitleText"
  >;
  readonly catalog: CharacterVisualCatalogSnapshot | undefined;
  readonly assignment: VisualAssignment | undefined;
  readonly asset: AssetDetail | undefined;
}): ScreenLayoutPreview {
  return {
    background: resolveBackgroundPreview(projectId, section),
    characters: resolveCharacterPreviews(project, line, catalog),
    content: resolveContentPreview(assignment, asset),
    dialogueText: line.subtitleText,
    sectionTitleText: section.name
  };
}
