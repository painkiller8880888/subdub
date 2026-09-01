import type { AssetTagDictionaryEntry } from "../assets/asset-repository.js";
import type { ScriptLine, ScriptSection, VideoProject } from "../../schema/index.js";
import {
  VISUAL_SUGGESTION_ERROR_CODE,
  VisualSuggestionError
} from "./visual-suggestion-errors.js";

export const VISUAL_MEDIA_KINDS = [
  "video",
  "photo",
  "document_scan"
] as const;

export type VisualSuggestionTarget = {
  readonly section: ScriptSection;
  readonly startLine: ScriptLine;
  readonly endLine: ScriptLine;
  readonly lineIds: readonly string[];
};

export type VisualSuggestionPromptContext = {
  readonly lines: readonly {
    readonly order: number;
    readonly spokenText: string;
    readonly subtitleText: string;
  }[];
  readonly section: {
    readonly title: string;
    readonly overview: string;
    readonly keyPoints: readonly string[];
  };
  readonly availableMediaKinds: readonly string[];
  readonly activeTagDictionary: readonly {
    readonly key: string;
    readonly axis: string;
    readonly canonicalName: string;
    readonly aliases: readonly string[];
  }[];
};

function rangeDetail(path: string, message: string) {
  return [{ path: [path], message }];
}

export function resolveVisualSuggestionTarget(
  project: VideoProject,
  startLineId: string,
  endLineId: string
): VisualSuggestionTarget {
  let startSectionIndex = -1;
  let startLineIndex = -1;
  let endSectionIndex = -1;
  let endLineIndex = -1;

  for (const [sectionIndex, section] of project.script.sections.entries()) {
    const startIndex = section.lines.findIndex((line) => line.id === startLineId);
    if (startIndex >= 0) {
      startSectionIndex = sectionIndex;
      startLineIndex = startIndex;
    }
    const endIndex = section.lines.findIndex((line) => line.id === endLineId);
    if (endIndex >= 0) {
      endSectionIndex = sectionIndex;
      endLineIndex = endIndex;
    }
  }

  if (startSectionIndex < 0) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.lineRangeInvalid,
      422,
      "The visual suggestion start line does not exist.",
      rangeDetail("startLineId", "startLineId must reference a script line")
    );
  }
  if (endSectionIndex < 0) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.lineRangeInvalid,
      422,
      "The visual suggestion end line does not exist.",
      rangeDetail("endLineId", "endLineId must reference a script line")
    );
  }
  if (startSectionIndex !== endSectionIndex) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.sectionMismatch,
      422,
      "A visual suggestion range must stay within one script section.",
      rangeDetail("endLineId", "startLineId and endLineId must be in the same section")
    );
  }
  if (startLineIndex > endLineIndex) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.lineRangeInvalid,
      422,
      "The visual suggestion start line must not follow the end line.",
      rangeDetail("startLineId", "startLineId must not follow endLineId")
    );
  }

  const section = project.script.sections[startSectionIndex];
  if (section === undefined) {
    throw new VisualSuggestionError(
      VISUAL_SUGGESTION_ERROR_CODE.lineRangeInvalid,
      422,
      "The visual suggestion script section does not exist."
    );
  }
  return {
    section,
    startLine: section.lines[startLineIndex]!,
    endLine: section.lines[endLineIndex]!,
    lineIds: section.lines
      .slice(startLineIndex, endLineIndex + 1)
      .map((line) => line.id)
  };
}

export function buildVisualSuggestionPromptContext(
  target: VisualSuggestionTarget,
  tagDictionary: readonly AssetTagDictionaryEntry[]
): VisualSuggestionPromptContext {
  const startIndex = target.section.lines.findIndex(
    (line) => line.id === target.startLine.id
  );
  const endIndex = target.section.lines.findIndex(
    (line) => line.id === target.endLine.id
  );

  return {
    lines: target.section.lines
      .slice(startIndex, endIndex + 1)
      .map((line, index) => ({
        order: index + 1,
        spokenText: line.spokenText,
        subtitleText: line.subtitleText
      })),
    section: {
      title: target.section.name,
      overview: "",
      keyPoints: []
    },
    availableMediaKinds: [...VISUAL_MEDIA_KINDS],
    activeTagDictionary: tagDictionary.map((tag) => ({
      key: `${tag.axis}:${tag.canonicalName}`,
      axis: tag.axis,
      canonicalName: tag.canonicalName,
      aliases: tag.aliases.map((alias) => alias.alias)
    }))
  };
}
