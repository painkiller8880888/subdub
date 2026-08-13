export const WORKFLOW_STEPS = [
  {
    id: "brief",
    label: "企画",
    description: "元資料と企画条件"
  },
  {
    id: "outline",
    label: "構成案",
    description: "章立てと要点"
  },
  {
    id: "script",
    label: "台本",
    description: "セリフと話者"
  },
  {
    id: "visual",
    label: "ビジュアル",
    description: "素材の検索と割り当て"
  },
  {
    id: "voice",
    label: "音声",
    description: "VOICEVOX音声"
  },
  {
    id: "output",
    label: "出力",
    description: "プレビューと動画"
  }
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];
export type WorkflowStepStatus = "past" | "current" | "future";

const SCRIPT_SECTION_HASHES: Partial<Record<WorkflowStepId, string>> = {
  visual: "#workflow-visual",
  voice: "#workflow-voice"
};

export function workflowStepPath(
  projectId: string,
  step: WorkflowStepId
): string {
  const projectPath = `/projects/${encodeURIComponent(projectId)}`;
  const path =
    step === "brief"
      ? `${projectPath}/brief`
      : step === "outline"
        ? `${projectPath}/outline`
        : step === "output"
          ? `${projectPath}/preview`
          : `${projectPath}/script`;

  return `${path}${SCRIPT_SECTION_HASHES[step] ?? ""}`;
}

export function workflowStepStatus(
  currentStep: WorkflowStepId,
  step: WorkflowStepId
): WorkflowStepStatus {
  const currentIndex = WORKFLOW_STEPS.findIndex(
    (candidate) => candidate.id === currentStep
  );
  const stepIndex = WORKFLOW_STEPS.findIndex(
    (candidate) => candidate.id === step
  );

  if (stepIndex < currentIndex) {
    return "past";
  }
  if (stepIndex === currentIndex) {
    return "current";
  }
  return "future";
}
