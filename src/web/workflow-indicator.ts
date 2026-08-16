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
    id: "production",
    label: "台本",
    description: "台本・ビジュアル・VOICEVOX音声"
  },
  {
    id: "edit",
    label: "編集",
    description: "編集要素とセクションBGM"
  },
  {
    id: "output",
    label: "出力",
    description: "プレビューと動画"
  }
] as const;

export type WorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];
export type WorkflowStepStatus = "past" | "current" | "future";

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
        : step === "edit"
          ? `${projectPath}/edit`
          : step === "output"
            ? `${projectPath}/preview`
            : `${projectPath}/script`;

  return path;
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
