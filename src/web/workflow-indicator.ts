export const WORKFLOW_STEPS = [
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

type CurrentWorkflowStepId = (typeof WORKFLOW_STEPS)[number]["id"];

/**
 * These IDs are kept only so the unreachable legacy planning components can
 * still be type-checked while their routes remain outside the current SPA.
 */
type LegacyWorkflowStepId = "brief" | "outline";
export type WorkflowStepId = CurrentWorkflowStepId | LegacyWorkflowStepId;
export type WorkflowStepStatus = "past" | "current" | "future";

function currentWorkflowStep(step: WorkflowStepId): CurrentWorkflowStepId {
  return step === "brief" || step === "outline" ? "production" : step;
}

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
  const normalizedCurrentStep = currentWorkflowStep(currentStep);
  const normalizedStep = currentWorkflowStep(step);
  const currentIndex = WORKFLOW_STEPS.findIndex(
    (candidate) => candidate.id === normalizedCurrentStep
  );
  const stepIndex = WORKFLOW_STEPS.findIndex(
    (candidate) => candidate.id === normalizedStep
  );

  if (stepIndex < currentIndex) {
    return "past";
  }
  if (stepIndex === currentIndex) {
    return "current";
  }
  return "future";
}
