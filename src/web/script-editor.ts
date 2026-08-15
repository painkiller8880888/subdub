import {
  scriptLineSchema,
  type Character,
  type Script,
  type ScriptLine,
  type VideoProject
} from "../schema/index.js";

export type BulkPasteLine = {
  readonly speakerId: string;
  readonly spokenText: string;
  readonly subtitleText: string;
};

export type BulkPasteError = {
  readonly lineNumber: number;
  readonly message: string;
};

export type BulkPasteResult =
  | { readonly ok: true; readonly lines: BulkPasteLine[] }
  | { readonly ok: false; readonly errors: BulkPasteError[] };

export function parseBulkScript(
  text: string,
  characters: readonly Character[]
): BulkPasteResult {
  const lines: BulkPasteLine[] = [];
  const errors: BulkPasteError[] = [];

  text.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line.length === 0) {
      return;
    }

    const separatorIndexes = [line.indexOf(":"), line.indexOf("：")].filter(
      (separatorIndex) => separatorIndex >= 0
    );
    const separatorIndex = Math.min(...separatorIndexes);
    if (!Number.isFinite(separatorIndex)) {
      errors.push({
        lineNumber,
        message: "話者と本文を分けるコロンがありません。"
      });
      return;
    }

    const speakerText = line.slice(0, separatorIndex).trim();
    const body = line.slice(separatorIndex + 1).trim();
    const matches = characters.filter(
      (character) =>
        character.name === speakerText || character.id === speakerText
    );
    if (matches.length !== 1) {
      errors.push({
        lineNumber,
        message:
          matches.length === 0
            ? `話者「${speakerText}」が現在のプロジェクトにありません。`
            : `話者「${speakerText}」が一意に決まりません。`
      });
      return;
    }
    if (body.length === 0) {
      errors.push({ lineNumber, message: "本文が空です。" });
      return;
    }

    lines.push({
      speakerId: matches[0].id,
      spokenText: body,
      subtitleText: body
    });
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, lines };
}

export function createDefaultScriptLine(
  speakerId: string,
  id: string,
  text = ""
): ScriptLine {
  return {
    id,
    speakerId,
    spokenText: text,
    subtitleText: text,
    expression: "neutral",
    characterVariantId: null,
    pauseBeforeMs: 0,
    pauseAfterMs: 250,
    voiceOverrides: {},
    pronunciation: {
      mode: "dictionary",
      excludedTermIds: []
    }
  };
}

export function cloneScript(script: Script): Script {
  return {
    ...script,
    sections: script.sections.map((section) => ({
      ...section,
      lines: section.lines.map((line) => ({
        ...line,
        voiceOverrides: { ...line.voiceOverrides },
        pronunciation: {
          ...line.pronunciation,
          excludedTermIds: [...line.pronunciation.excludedTermIds]
        }
      }))
    }))
  };
}

export type ScriptLineLocator = {
  readonly sectionId: string;
  readonly lineIndex: number;
  readonly lineId: string;
};

export type ScriptLineRangeLocator = {
  readonly sectionId: string;
  readonly start: ScriptLineLocator;
  readonly end: ScriptLineLocator;
};

export type ResolvedScriptLineRange = {
  readonly startLineId: string;
  readonly endLineId: string;
};

export type ScriptLineIdReconciliation = {
  readonly script: Script;
  readonly lineIdMap: ReadonlyMap<string, string>;
};

export type VisualLineSelection = {
  readonly suggestionSectionId: string;
  readonly suggestionStartLineId: string;
  readonly suggestionEndLineId: string;
  readonly selectedVisualLineId: string;
};

export function reconcileVisualLineSelection(
  selection: VisualLineSelection,
  lineIdMap: ReadonlyMap<string, string>
): VisualLineSelection {
  const reconcile = (lineId: string): string => lineIdMap.get(lineId) ?? lineId;
  return {
    ...selection,
    suggestionStartLineId: reconcile(selection.suggestionStartLineId),
    suggestionEndLineId: reconcile(selection.suggestionEndLineId),
    selectedVisualLineId: reconcile(selection.selectedVisualLineId)
  };
}

export function createScriptLineLocator(
  script: Script,
  sectionId: string,
  lineId: string
): ScriptLineLocator | undefined {
  const section = script.sections.find(
    (candidate) => candidate.id === sectionId
  );
  const lineIndex =
    section?.lines.findIndex((line) => line.id === lineId) ?? -1;
  if (section === undefined || lineIndex < 0) {
    return undefined;
  }
  return { sectionId, lineIndex, lineId };
}

export function createScriptLineRangeLocator(
  script: Script,
  sectionId: string,
  startLineId: string,
  endLineId: string
): ScriptLineRangeLocator | undefined {
  const start = createScriptLineLocator(script, sectionId, startLineId);
  const end = createScriptLineLocator(script, sectionId, endLineId);
  if (start === undefined || end === undefined) {
    return undefined;
  }
  return { sectionId, start, end };
}

export function resolveScriptLineId(
  script: Script,
  locator: ScriptLineLocator
): string | undefined {
  const section = script.sections.find(
    (candidate) => candidate.id === locator.sectionId
  );
  if (section === undefined) {
    return undefined;
  }

  const lineWithOriginalId = section.lines.find(
    (line) => line.id === locator.lineId
  );
  return lineWithOriginalId?.id ?? section.lines[locator.lineIndex]?.id;
}

export function resolveScriptLineRange(
  script: Script,
  locator: ScriptLineRangeLocator
): ResolvedScriptLineRange | undefined {
  const startLineId = resolveScriptLineId(script, locator.start);
  const endLineId = resolveScriptLineId(script, locator.end);
  if (startLineId === undefined || endLineId === undefined) {
    return undefined;
  }
  return { startLineId, endLineId };
}

export function reconcileScriptLineIdsWithMap(
  submitted: Script,
  saved: Script,
  latest: Script
): ScriptLineIdReconciliation {
  const submittedToSaved = new Map<string, string>();

  for (const [sectionIndex, submittedSection] of submitted.sections.entries()) {
    const savedSection = saved.sections[sectionIndex];
    if (
      savedSection === undefined ||
      savedSection.outlineSectionId !== submittedSection.outlineSectionId
    ) {
      continue;
    }

    for (const [lineIndex, submittedLine] of submittedSection.lines.entries()) {
      const savedLine = savedSection.lines[lineIndex];
      if (savedLine !== undefined) {
        submittedToSaved.set(submittedLine.id, savedLine.id);
      }
    }
  }

  const reconciled = cloneScript(latest);
  for (const section of reconciled.sections) {
    for (const line of section.lines) {
      const savedId = submittedToSaved.get(line.id);
      if (savedId !== undefined) {
        line.id = savedId;
      }
    }
  }
  return { script: reconciled, lineIdMap: submittedToSaved };
}

export function reconcileScriptLineIds(
  submitted: Script,
  saved: Script,
  latest: Script
): Script {
  return reconcileScriptLineIdsWithMap(submitted, saved, latest).script;
}

export function isProjectContextCurrent(
  currentProjectId: string,
  currentGeneration: number,
  savingProjectId: string,
  savingGeneration: number
): boolean {
  return (
    currentProjectId === savingProjectId &&
    currentGeneration === savingGeneration
  );
}

export type VisualSuggestionRequestContext = {
  readonly projectId: string;
  readonly projectGeneration: number;
  readonly sectionId: string;
  readonly startLineId: string;
  readonly endLineId: string;
  readonly startLineIndex: number;
  readonly endLineIndex: number;
  readonly expectedRevision: number;
};

export type VisualSuggestionCurrentContext = {
  readonly projectId: string;
  readonly projectGeneration: number;
  readonly sectionId: string;
  readonly startLineId: string;
  readonly endLineId: string;
  readonly startLineIndex: number;
  readonly endLineIndex: number;
  readonly revision: number;
};

export async function captureVisualSuggestionRequestAfterFlush(
  flush: () => Promise<boolean | undefined>,
  getRequest: () =>
    Omit<VisualSuggestionRequestContext, "expectedRevision"> | undefined,
  getCurrentRevision: () => number
): Promise<VisualSuggestionRequestContext | undefined> {
  const flushed = await flush();
  if (flushed !== true) {
    return undefined;
  }
  const request = getRequest();
  if (request === undefined) {
    return undefined;
  }
  return {
    ...request,
    expectedRevision: getCurrentRevision()
  };
}

export function isVisualSuggestionContextCurrent(
  current: VisualSuggestionCurrentContext,
  requested: VisualSuggestionRequestContext
): boolean {
  return (
    isProjectContextCurrent(
      current.projectId,
      current.projectGeneration,
      requested.projectId,
      requested.projectGeneration
    ) &&
    current.sectionId === requested.sectionId &&
    current.startLineIndex === requested.startLineIndex &&
    current.endLineIndex === requested.endLineIndex &&
    current.revision === requested.expectedRevision
  );
}

export function scriptStatusAfterEdit(
  previousStatus: Script["status"],
  candidateStatus: Script["status"]
): Script["status"] {
  return previousStatus === "approved" ? "needs_review" : candidateStatus;
}

export function appendScriptLines(
  script: Script,
  sectionIndex: number,
  lines: readonly ScriptLine[]
): Script {
  const next = cloneScript(script);
  const section = next.sections[sectionIndex];
  if (section === undefined) {
    return next;
  }
  section.lines.push(
    ...lines.map((line) => ({
      ...line,
      voiceOverrides: { ...line.voiceOverrides },
      pronunciation: {
        ...line.pronunciation,
        excludedTermIds: [...line.pronunciation.excludedTermIds]
      }
    }))
  );
  return next;
}

export function updateScriptLine(
  script: Script,
  sectionIndex: number,
  lineIndex: number,
  update: Partial<ScriptLine>
): Script {
  const next = cloneScript(script);
  const line = next.sections[sectionIndex]?.lines[lineIndex];
  if (line !== undefined) {
    Object.assign(line, update);
  }
  return next;
}

export function moveScriptLine(
  script: Script,
  sectionIndex: number,
  lineIndex: number,
  direction: "up" | "down"
): Script {
  const next = cloneScript(script);
  const lines = next.sections[sectionIndex]?.lines;
  if (lines === undefined) {
    return next;
  }
  const targetIndex = direction === "up" ? lineIndex - 1 : lineIndex + 1;
  if (
    lineIndex < 0 ||
    lineIndex >= lines.length ||
    targetIndex < 0 ||
    targetIndex >= lines.length
  ) {
    return next;
  }
  const [line] = lines.splice(lineIndex, 1);
  if (line !== undefined) {
    lines.splice(targetIndex, 0, line);
  }
  return next;
}

export function duplicateScriptLine(
  script: Script,
  sectionIndex: number,
  lineIndex: number
): Script {
  const next = cloneScript(script);
  const lines = next.sections[sectionIndex]?.lines;
  const source = lines?.[lineIndex];
  if (lines === undefined || source === undefined) {
    return next;
  }
  const ids = new Set(
    next.sections.flatMap((section) => section.lines.map((line) => line.id))
  );
  let id = `${source.id}-copy`;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${source.id}-copy-${suffix}`;
    suffix += 1;
  }
  lines.splice(lineIndex + 1, 0, { ...source, id });
  return next;
}

export function deleteScriptLine(
  script: Script,
  sectionIndex: number,
  lineIndex: number
): Script {
  const next = cloneScript(script);
  next.sections[sectionIndex]?.lines.splice(lineIndex, 1);
  return next;
}

export type ScriptDraftIssue = {
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
};

export function validateScriptDraft(
  script: Script,
  characters: readonly Character[]
): ScriptDraftIssue[] {
  const issues: ScriptDraftIssue[] = [];
  const characterIds = new Set(characters.map((character) => character.id));
  const lineIds = new Set<string>();

  for (const [sectionIndex, section] of script.sections.entries()) {
    for (const [lineIndex, line] of section.lines.entries()) {
      const path = ["script", "sections", sectionIndex, "lines", lineIndex];
      const lineResult = scriptLineSchema.safeParse(line);
      if (!lineResult.success) {
        for (const issue of lineResult.error.issues) {
          const issuePath = issue.path.filter(
            (segment): segment is string | number =>
              typeof segment === "string" || typeof segment === "number"
          );
          issues.push({
            path: [...path, ...issuePath],
            message: issue.message
          });
        }
      }
      if (!characterIds.has(line.speakerId)) {
        issues.push({
          path: [...path, "speakerId"],
          message: "話者が現在のプロジェクトにありません。"
        });
      }
      if (lineIds.has(line.id)) {
        issues.push({
          path: [...path, "id"],
          message: "セリフIDが重複しています。"
        });
      }
      lineIds.add(line.id);
    }
  }

  return issues;
}

export function isScriptInitializationAllowed(project: VideoProject): boolean {
  return (
    project.script.sections.length === 0 &&
    project.outline.status === "approved" &&
    project.outline.sourceHash === project.source.sha256
  );
}
