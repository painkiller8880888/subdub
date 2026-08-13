import type {
  OpenQuestion,
  Outline,
  OutlineSection,
  SourceRef
} from "../schema/video-project.js";

export function cloneOutline(outline: Outline): Outline {
  return {
    ...outline,
    openQuestions: outline.openQuestions.map((question) => ({ ...question })),
    sections: outline.sections.map((section) => ({
      ...section,
      keyPoints: [...section.keyPoints],
      sourceRefs: section.sourceRefs.map((sourceRef) => ({
        ...sourceRef,
        headingPath: [...sourceRef.headingPath]
      })),
      openQuestions: section.openQuestions.map((question) => ({ ...question })),
      humanDirectives: {
        requiredItems: [...section.humanDirectives.requiredItems],
        prohibitedItems: [...section.humanDirectives.prohibitedItems],
        scriptConstraints: [...section.humanDirectives.scriptConstraints]
      },
      lockedFields: [...section.lockedFields]
    }))
  };
}

function addOutlineIdMappings(
  draftItems: ReadonlyArray<{ readonly id: string }>,
  savedItems: ReadonlyArray<{ readonly id: string }>,
  mappings: Map<string, string>
): void {
  for (const [index, draftItem] of draftItems.entries()) {
    const savedItem = savedItems[index];
    if (savedItem !== undefined && !mappings.has(draftItem.id)) {
      mappings.set(draftItem.id, savedItem.id);
    }
  }
}

export function mergeSavedOutlineIds(
  savedDraftInput: Outline,
  savedOutline: Outline,
  currentDraft: Outline
): Outline {
  const mappings = new Map<string, string>();
  addOutlineIdMappings(
    savedDraftInput.openQuestions,
    savedOutline.openQuestions,
    mappings
  );
  addOutlineIdMappings(
    savedDraftInput.sections,
    savedOutline.sections,
    mappings
  );
  for (const [index, draftSection] of savedDraftInput.sections.entries()) {
    const savedSection = savedOutline.sections[index];
    if (savedSection !== undefined) {
      addOutlineIdMappings(
        draftSection.openQuestions,
        savedSection.openQuestions,
        mappings
      );
    }
  }

  return {
    ...currentDraft,
    openQuestions: currentDraft.openQuestions.map((question) => ({
      ...question,
      id: mappings.get(question.id) ?? question.id
    })),
    sections: currentDraft.sections.map((section) => ({
      ...section,
      id: mappings.get(section.id) ?? section.id,
      openQuestions: section.openQuestions.map((question) => ({
        ...question,
        id: mappings.get(question.id) ?? question.id
      }))
    }))
  };
}

export function normalizeOutlineOrders(outline: Outline): Outline {
  return {
    ...outline,
    sections: outline.sections.map((section, index) => ({
      ...section,
      order: index + 1
    }))
  };
}

export function outlineOrderErrors(outline: Outline): string[] {
  const errors: string[] = [];
  if (outline.sections.length < 3) {
    errors.push("導入・本編・まとめの3セクション以上が必要です。");
  }
  if (outline.sections[0]?.role !== "intro") {
    errors.push("先頭セクションの役割を「導入」にしてください。");
  }
  if (outline.sections.at(-1)?.role !== "outro") {
    errors.push("末尾セクションの役割を「まとめ・締め」にしてください。");
  }
  const middle = outline.sections.slice(1, -1);
  if (
    middle.length === 0 ||
    !middle.some((section) => section.role === "main")
  ) {
    errors.push("「本編」のセクションを1件以上追加してください。");
  }
  if (middle.some((section) => section.role !== "main")) {
    errors.push(
      "「導入」と「まとめ・締め」の間には「本編」だけを配置してください。"
    );
  }
  const orders = outline.sections.map((section) => section.order);
  if (
    new Set(orders).size !== orders.length ||
    orders.some((order, index) => order !== index + 1)
  ) {
    errors.push("セクション番号は表示順と一致する連番にしてください。");
  }
  return errors;
}

export function countOpenQuestions(outline: Outline): number {
  return [
    ...outline.openQuestions,
    ...outline.sections.flatMap((section) => section.openQuestions)
  ].filter((question) => question.status === "open").length;
}

export function hasStaleSource(outline: Outline, sourceHash: string): boolean {
  return outline.sourceHash !== sourceHash;
}

export function textToItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function itemsToText(items: string[]): string {
  return items.join("\n");
}

export function sourceRefsToText(sourceRefs: SourceRef[]): string {
  return sourceRefs
    .map((sourceRef) => sourceRef.headingPath.join(" / "))
    .join("\n");
}

export function textToSourceRefs(value: string, sourceId: string): SourceRef[] {
  return textToItems(value).map((headingPath) => ({
    sourceId,
    headingPath: headingPath
      .split("/")
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
  }));
}

export function makeQuestion(id: string): OpenQuestion {
  return {
    id,
    question: "確認事項を入力してください。",
    resolution: null,
    status: "open"
  };
}

export function makeSection(id: string): OutlineSection {
  return {
    id,
    order: 1,
    role: "main",
    title: "新しいセクション",
    overview: "",
    keyPoints: [],
    targetDurationSec: 1,
    sourceRefs: [],
    openQuestions: [],
    humanDirectives: {
      requiredItems: [],
      prohibitedItems: [],
      scriptConstraints: []
    },
    lockedFields: []
  };
}
