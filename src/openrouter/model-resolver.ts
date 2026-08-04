import type { AiSettings, AiTaskKind } from "../schema/video-project.js";
import type { OpenRouterModelCapabilities } from "./model-service.js";

export type ModelSelectionSource = "run_override" | "task_override" | "default";

export type ModelResolutionFailureReason =
  | "MODEL_NOT_SELECTED"
  | "MODEL_NOT_FOUND"
  | "MODEL_TEXT_OUTPUT_UNSUPPORTED"
  | "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED"
  | "MODEL_EXPIRED"
  | "MODEL_ZDR_ENDPOINT_UNAVAILABLE";

export type ModelResolution =
  | {
      readonly ok: true;
      readonly modelId: string;
      readonly source: ModelSelectionSource;
      readonly capabilities: OpenRouterModelCapabilities;
    }
  | {
      readonly ok: false;
      readonly reason: ModelResolutionFailureReason;
    };

export type ResolveModelInput = {
  readonly settings: AiSettings;
  readonly taskKind: AiTaskKind;
  readonly runOverride?: string | null;
  readonly models: readonly OpenRouterModelCapabilities[];
  readonly now?: () => Date;
};

function isExpired(expirationDate: string | null, nowMs: number): boolean {
  return expirationDate !== null && Date.parse(expirationDate) <= nowMs;
}

export function resolveModel(input: ResolveModelInput): ModelResolution {
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  let modelId: string | null | undefined;
  let source: ModelSelectionSource | undefined;

  if (input.runOverride !== undefined && input.runOverride !== null) {
    modelId = input.runOverride;
    source = "run_override";
  } else {
    const taskOverride = input.settings.taskModelOverrides[input.taskKind];
    if (taskOverride !== undefined) {
      modelId = taskOverride;
      source = "task_override";
    } else {
      modelId = input.settings.defaultModelId;
      source = "default";
    }
  }

  if (modelId === undefined || modelId === null) {
    return { ok: false, reason: "MODEL_NOT_SELECTED" };
  }

  const capabilities = input.models.find((model) => model.id === modelId);
  if (capabilities === undefined) {
    return { ok: false, reason: "MODEL_NOT_FOUND" };
  }
  if (!capabilities.outputModalities.includes("text")) {
    return { ok: false, reason: "MODEL_TEXT_OUTPUT_UNSUPPORTED" };
  }
  if (!capabilities.structuredOutputs) {
    return { ok: false, reason: "MODEL_STRUCTURED_OUTPUT_UNSUPPORTED" };
  }
  if (isExpired(capabilities.expirationDate, nowMs)) {
    return { ok: false, reason: "MODEL_EXPIRED" };
  }
  if (input.settings.zdr && !capabilities.zdrAvailable) {
    return { ok: false, reason: "MODEL_ZDR_ENDPOINT_UNAVAILABLE" };
  }

  return {
    ok: true,
    modelId,
    source: source as ModelSelectionSource,
    capabilities
  };
}
