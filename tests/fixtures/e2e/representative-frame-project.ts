import {
  type Outline,
  type Script,
  type ScriptLine,
  type ScriptSection
} from "../../../src/schema/index.js";
import type { OutlineGenerationCandidate } from "../../../src/schema/outline-generation.js";

export const representativeFrameMarkdown = [
  "# SubDub fixture guide",
  "",
  "## Introduction",
  "Welcome to the SubDub fixture guide.",
  "",
  "## Request",
  "Create a request and verify the attached material.",
  "",
  "## Completion",
  "Confirm the result and finish the request."
].join("\n");

export const representativeFrameBrief = {
  audience: "New internal operators",
  postViewingGoal: "Create and confirm a short SubDub request.",
  prerequisites: ["An internal account"],
  targetDurationSec: 12,
  requiredItems: ["A request", "A confirmation"],
  prohibitedItems: ["Private customer data"],
  globalDirectives: ["Use the displayed labels exactly."]
} as const;

export function createRepresentativeFrameOutline(sourceHash: string): Outline {
  return {
    status: "draft",
    sourceHash,
    generationRunId: null,
    openQuestions: [],
    sections: [
      {
        id: "outline-intro",
        order: 1,
        role: "intro",
        title: "Introduction",
        overview: "Explain the purpose of the fixture.",
        keyPoints: ["Introduce the SubDub request"],
        targetDurationSec: 2,
        sourceRefs: [
          { sourceId: "source-main", headingPath: ["Introduction"] }
        ],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["Purpose"],
          prohibitedItems: [],
          scriptConstraints: ["Keep the introduction short."]
        },
        lockedFields: []
      },
      {
        id: "outline-main",
        order: 2,
        role: "main",
        title: "Request",
        overview: "Create the request and verify its material.",
        keyPoints: ["Create a request", "Verify the material"],
        targetDurationSec: 4,
        sourceRefs: [{ sourceId: "source-main", headingPath: ["Request"] }],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["Request fields"],
          prohibitedItems: ["Private customer data"],
          scriptConstraints: ["Show the confirmation step."]
        },
        lockedFields: []
      },
      {
        id: "outline-outro",
        order: 3,
        role: "outro",
        title: "Completion",
        overview: "Confirm the result and finish.",
        keyPoints: ["Confirm the result"],
        targetDurationSec: 2,
        sourceRefs: [{ sourceId: "source-main", headingPath: ["Completion"] }],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["Completion result"],
          prohibitedItems: [],
          scriptConstraints: []
        },
        lockedFields: []
      }
    ]
  };
}

export function createRepresentativeFrameOutlineCandidate(): OutlineGenerationCandidate {
  const outline = createRepresentativeFrameOutline("0".repeat(64));
  return {
    openQuestions: [],
    sections: outline.sections.map((section) => ({
      role: section.role,
      title: section.title,
      overview: section.overview,
      keyPoints: [...section.keyPoints],
      targetDurationSec: section.targetDurationSec,
      sourceRefs: section.sourceRefs.map((sourceRef) => ({
        headingPath: ["SubDub fixture guide", ...sourceRef.headingPath]
      })),
      openQuestions: section.openQuestions.map((question) => ({
        question: question.question
      }))
    }))
  };
}

function line(
  id: string,
  speakerId: "character-mentor" | "character-learner",
  spokenText: string,
  subtitleText: string,
  expression: ScriptLine["expression"]
): ScriptLine {
  const variantIdByExpression = {
    neutral:
      speakerId === "character-mentor"
        ? "character-mentor-speak-normal-v1"
        : "character-learner-speak-normal-v1",
    smile:
      speakerId === "character-mentor"
        ? "character-mentor-speak-normal-v1"
        : "character-learner-speak-normal-v1",
    explain:
      speakerId === "character-mentor"
        ? "character-mentor-speak-pointing-v1"
        : "character-learner-speak-pointing-v1",
    caution:
      speakerId === "character-mentor"
        ? "character-mentor-speak-pointing-v1"
        : "character-learner-speak-pointing-v1"
  } as const;
  return {
    id,
    speakerId,
    spokenText,
    subtitleText,
    expression,
    characterVariantId: variantIdByExpression[expression],
    pauseBeforeMs: 0,
    pauseAfterMs: 100,
    voiceOverrides: {},
    pronunciation: { mode: "dictionary", excludedTermIds: [] }
  };
}

function section(
  id: string,
  outlineSectionId: string,
  name: string,
  lines: ScriptLine[]
): ScriptSection {
  return {
    id,
    outlineSectionId,
    name,
    screenTemplateId: "screen-template-standard",
    background: { kind: "solid", colorToken: "background" },
    lines
  };
}

export function createRepresentativeFrameScript(
  outlineHash: string,
  outlineSectionIds: readonly string[] = [
    "outline-intro",
    "outline-main",
    "outline-outro"
  ]
): Script {
  return {
    status: "draft",
    origin: "manual",
    outlineHash,
    sections: [
      section(
        "section-intro",
        outlineSectionIds[0] ?? "outline-intro",
        "Introduction",
        [
          line(
            "fixture-intro-mentor",
            "character-mentor",
            "Welcome to the SubDub request guide.",
            "Welcome to the SubDub request guide.",
            "explain"
          ),
          line(
            "fixture-intro-learner",
            "character-learner",
            "We will create a request together.",
            "We will create a request together.",
            "neutral"
          )
        ]
      ),
      section(
        "section-main",
        outlineSectionIds[1] ?? "outline-main",
        "Request",
        [
          line(
            "fixture-main-mentor",
            "character-mentor",
            "Create a new SubDub request.",
            "Create a new SubDub request.",
            "explain"
          ),
          line(
            "fixture-main-learner",
            "character-learner",
            "Verify the SubDub material before saving.",
            "Verify the SubDub material before saving.",
            "caution"
          )
        ]
      ),
      section(
        "section-outro",
        outlineSectionIds[2] ?? "outline-outro",
        "Completion",
        [
          line(
            "fixture-outro-mentor",
            "character-mentor",
            "Confirm the result and finish the request.",
            "Confirm the result and finish the request.",
            "smile"
          )
        ]
      )
    ]
  };
}
