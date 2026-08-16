import { type MouseEvent } from "react";
import { Link, useLocation } from "react-router";
import {
  WORKFLOW_STEPS,
  workflowStepPath,
  workflowStepStatus,
  type WorkflowStepId
} from "./workflow-indicator";

type WorkflowIndicatorProps = {
  readonly projectId: string;
  readonly currentStep: WorkflowStepId;
  readonly onNavigate?: (
    event: MouseEvent<HTMLAnchorElement>,
    destination: string
  ) => void;
};

export function WorkflowIndicator({
  projectId,
  currentStep,
  onNavigate
}: WorkflowIndicatorProps) {
  const location = useLocation();
  const hashStep =
    location.pathname.endsWith("/script") &&
    (location.hash === "#workflow-visual" ||
      location.hash === "#workflow-voice")
      ? "production"
      : null;
  const activeStep = hashStep ?? currentStep;
  const activeIndex = WORKFLOW_STEPS.findIndex(
    (step) => step.id === activeStep
  );
  const activeStepLabel =
    WORKFLOW_STEPS[activeIndex]?.label ?? WORKFLOW_STEPS[0].label;

  return (
    <nav
      aria-label="動画制作の工程"
      className="workflow-indicator"
      data-current-step={activeStep}
    >
      <div className="workflow-indicator-header">
        <div>
          <p className="workflow-indicator-kicker">制作工程</p>
          <p className="workflow-indicator-current">
            現在: <strong>{activeStepLabel}</strong>
          </p>
        </div>
        <span className="workflow-indicator-count">
          {activeIndex + 1} / {WORKFLOW_STEPS.length}
        </span>
      </div>
      <ol className="workflow-steps">
        {WORKFLOW_STEPS.map((step, index) => {
          const status = workflowStepStatus(activeStep, step.id);
          const destination = workflowStepPath(projectId, step.id);
          return (
            <li
              className={`workflow-step-item workflow-step-item-${status}`}
              key={step.id}
            >
              <Link
                aria-current={status === "current" ? "step" : undefined}
                className={`workflow-step workflow-step-${status}`}
                title={step.description}
                to={destination}
                onClick={(event) => onNavigate?.(event, destination)}
              >
                <span aria-hidden="true" className="workflow-step-marker">
                  {status === "past" ? "✓" : index + 1}
                </span>
                <span className="workflow-step-label">{step.label}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
