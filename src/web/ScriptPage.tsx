import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  type ChangeEvent,
  type FormEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ZodError } from "zod";

import type {
  ProjectSummary,
  VisualAssignmentRequest,
  VisualAssignmentUpdateRequest,
  VisualAssignmentDeleteRequest,
  VisualSuggestionResponse,
  VoiceLineGenerationStatus
} from "../schema/api.js";
import type {
  AssetDetail,
  AssetListItem,
  AssetListResult
} from "../schema/asset.js";
import {
  type Script,
  type ScriptLine,
  type VideoProject,
  type VisualAssignment
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  assignProjectVisual,
  rejectProjectVisualSuggestionCandidate,
  deleteProjectVisualAssignment,
  fetchAsset,
  fetchProject,
  fetchProjectVoiceStatus,
  generateAllProjectVoice,
  generateProjectVoice,
  initializeProjectScript,
  saveProjectScript,
  searchAssets,
  suggestProjectVisuals,
  updateProjectVisualAssignment
} from "./lib/api-client";
import {
  AutosaveCoordinator,
  navigateAfterAutosave,
  type AutosaveState
} from "./brief-autosave";
import {
  appendScriptLines,
  captureVisualSuggestionRequestAfterFlush,
  cloneScript,
  createScriptLineLocator,
  createScriptLineRangeLocator,
  createDefaultScriptLine,
  deleteScriptLine,
  duplicateScriptLine,
  isScriptInitializationAllowed,
  isProjectContextCurrent,
  isVisualSuggestionContextCurrent,
  moveScriptLine,
  parseBulkScript,
  reconcileScriptLineIds,
  resolveScriptLineId,
  resolveScriptLineRange,
  scriptStatusAfterEdit,
  updateScriptLine,
  validateScriptDraft,
  type BulkPasteError,
  type ScriptDraftIssue,
  type VisualSuggestionCurrentContext,
  type VisualSuggestionRequestContext
} from "./script-editor";
import { VisualAssignmentPanel } from "./VisualAssignmentPanel";
import { VoiceAdjustmentEditor } from "./VoiceAdjustmentEditor";
import { WorkflowIndicator } from "./WorkflowIndicator";
import {
  assignmentInput,
  defaultDisplayForAsset,
  nextVisualAssignmentId
} from "./visual-assignment-editor";

function charactersPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/characters`;
}

function outlinePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "入力内容を確認してください。";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

function scriptStatusLabel(status: Script["status"]): string {
  switch (status) {
    case "approved":
      return "互換 status（approved）";
    case "needs_review":
      return "要確認";
    default:
      return "編集中";
  }
}

function assetKindLabel(kind: AssetDetail["kind"]): string {
  switch (kind) {
    case "video":
      return "動画";
    case "photo":
      return "画像";
    case "document_scan":
      return "文書画像";
    case "sound_effect":
      return "効果音";
  }
}

function visualTagGroupLabel(group: string): string {
  switch (group) {
    case "requiredTags":
      return "必須タグ";
    case "optionalTags":
      return "任意タグ";
    case "excludedTags":
      return "除外タグ";
    default:
      return group;
  }
}

function unresolvedTagReasonLabel(reason: string): string {
  switch (reason) {
    case "unknown":
      return "登録されていません";
    case "ambiguous":
      return "複数の候補があります";
    default:
      return reason;
  }
}

function visualMatchReasonLabel(reason: string): string {
  const prefixes: ReadonlyArray<readonly [string, string]> = [
    ["required tags: ", "必須タグ："],
    ["optional tags: ", "任意タグ："],
    ["free text: ", "キーワード："],
    ["media kind: ", "素材の種類："]
  ];
  const prefix = prefixes.find(([source]) => reason.startsWith(source));
  return prefix === undefined
    ? reason
    : `${prefix[1]}${reason.slice(prefix[0].length)}`;
}

function voiceStatusLabel(status: VoiceLineGenerationStatus["status"]): string {
  switch (status) {
    case "current":
      return "最新";
    case "stale":
      return "再生成が必要";
    case "needs_review":
      return "調整要確認";
    case "generating":
      return "生成中";
    case "failed":
      return "失敗";
  }
}

function errorDetails(error: unknown): string[] {
  if (!(error instanceof ApiClientError)) {
    return [];
  }
  return error.details.map(
    (detail) => `${detail.path.join(".") || "script"}: ${detail.message}`
  );
}

function projectSummaryFromProject(project: VideoProject): ProjectSummary {
  return {
    id: project.metadata.id,
    title: project.metadata.title,
    department: project.metadata.department,
    manualVersion: project.metadata.manualVersion,
    revision: project.revision,
    createdAt: project.metadata.createdAt,
    updatedAt: project.metadata.updatedAt
  };
}

type VisualMutationContext = {
  readonly projectId: string;
  readonly projectGeneration: number;
  readonly expectedRevision: number;
};

type VisualSaveState = "idle" | "saved";

function lineIssueText(
  issues: readonly ScriptDraftIssue[],
  sectionIndex: number,
  lineIndex: number
): string[] {
  const prefix = ["script", "sections", sectionIndex, "lines", lineIndex];
  return issues
    .filter((issue) =>
      prefix.every((segment, index) => issue.path[index] === segment)
    )
    .map((issue) => issue.message);
}

function visualAssignmentsForLine(
  project: VideoProject,
  lineId: string
): VisualAssignment[] {
  const section = project.script.sections.find((candidate) =>
    candidate.lines.some((line) => line.id === lineId)
  );
  if (section === undefined) {
    return [];
  }
  const lineIndex = section.lines.findIndex((line) => line.id === lineId);
  return project.visuals.assignments.filter((assignment) => {
    const startIndex = section.lines.findIndex(
      (line) => line.id === assignment.startLineId
    );
    const endIndex = section.lines.findIndex(
      (line) => line.id === assignment.endLineId
    );
    return (
      startIndex >= 0 &&
      endIndex >= startIndex &&
      lineIndex >= startIndex &&
      lineIndex <= endIndex
    );
  });
}

function visualAssignmentRangeLabel(
  project: VideoProject,
  assignment: VisualAssignment
): string {
  const section = project.script.sections.find((candidate) =>
    candidate.lines.some(
      (line) =>
        line.id === assignment.startLineId || line.id === assignment.endLineId
    )
  );
  return section === undefined
    ? `${assignment.startLineId} ～ ${assignment.endLineId}`
    : `${section.name}: ${assignment.startLineId} ～ ${assignment.endLineId}`;
}

function assetThumbnailUrl(assetId: string, index: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnails/${index}`;
}

function nextTemporaryLineId(script: Script): string {
  const ids = new Set(
    script.sections.flatMap((section) => section.lines.map((line) => line.id))
  );
  let index = 1;
  let id = `draft-line-${index}`;
  while (ids.has(id)) {
    index += 1;
    id = `draft-line-${index}`;
  }
  return id;
}

function ScriptLineCard({
  line,
  sectionIndex,
  lineIndex,
  project,
  assignmentAssets,
  isVisualSelected,
  issues,
  voiceStatus,
  voiceGenerationDisabled,
  voiceAvailable,
  projectId,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onGenerateVoice,
  onSelectVisualRange
}: {
  readonly line: ScriptLine;
  readonly sectionIndex: number;
  readonly lineIndex: number;
  readonly project: VideoProject;
  readonly assignmentAssets: ReadonlyMap<string, AssetDetail | undefined>;
  readonly isVisualSelected: boolean;
  readonly issues: readonly ScriptDraftIssue[];
  readonly voiceStatus: VoiceLineGenerationStatus | undefined;
  readonly voiceGenerationDisabled: boolean;
  readonly voiceAvailable: boolean;
  readonly projectId: string;
  readonly onChange: (update: Partial<ScriptLine>) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onGenerateVoice: () => void;
  readonly onSelectVisualRange: () => void;
}) {
  const lineIssues = lineIssueText(issues, sectionIndex, lineIndex);
  const lineVisualAssignments = visualAssignmentsForLine(project, line.id);
  const numberValue = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";

  return (
    <article
      className={`script-line-card${
        isVisualSelected ? " script-line-card-visual-selected" : ""
      }`}
      aria-label={`セリフ ${line.id}`}
      aria-current={isVisualSelected ? "true" : undefined}
    >
      <header className="script-line-card-header">
        <div>
          <p className="eyebrow">セリフ識別子</p>
          <code>{line.id}</code>
        </div>
        <div className="script-line-actions">
          <button
            className="button"
            type="button"
            onClick={() => onMove("up")}
            disabled={lineIndex === 0}
          >
            上へ移動
          </button>
          <button
            className="button"
            type="button"
            onClick={() => onMove("down")}
            disabled={
              lineIndex ===
              project.script.sections[sectionIndex]?.lines.length - 1
            }
          >
            下へ移動
          </button>
          <button className="button" type="button" onClick={onDuplicate}>
            複製
          </button>
          <button className="button" type="button" onClick={onDelete}>
            削除
          </button>
        </div>
      </header>

      <div className="script-line-fields">
        <div className="form-field">
          <label htmlFor={`${line.id}-speaker`}>話者</label>
          <select
            id={`${line.id}-speaker`}
            value={line.speakerId}
            onChange={(event) => onChange({ speakerId: event.target.value })}
          >
            {project.characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name}（{character.role}）
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${line.id}-expression`}>表情（動画内の表示）</label>
          <select
            id={`${line.id}-expression`}
            value={line.expression}
            onChange={(event) =>
              onChange({
                expression: event.target.value as ScriptLine["expression"]
              })
            }
          >
            <option value="neutral">通常</option>
            <option value="smile">喜び</option>
            <option value="explain">説明</option>
            <option value="caution">注意</option>
          </select>
        </div>
        <div className="form-field script-line-wide-field">
          <label htmlFor={`${line.id}-spoken`}>
            読み上げる文章（VOICEVOX）
          </label>
          <textarea
            id={`${line.id}-spoken`}
            rows={3}
            value={line.spokenText}
            onChange={(event) => onChange({ spokenText: event.target.value })}
          />
        </div>
        <div className="form-field script-line-wide-field">
          <label htmlFor={`${line.id}-subtitle`}>字幕に表示する文章</label>
          <textarea
            id={`${line.id}-subtitle`}
            rows={3}
            value={line.subtitleText}
            onChange={(event) => onChange({ subtitleText: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${line.id}-pause-before`}>
            発話前の間（ミリ秒）
          </label>
          <input
            id={`${line.id}-pause-before`}
            type="number"
            min={0}
            step={1}
            value={numberValue(line.pauseBeforeMs)}
            onChange={(event) =>
              onChange({
                pauseBeforeMs:
                  event.target.value.length === 0
                    ? Number.NaN
                    : Number(event.target.value)
              })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${line.id}-pause-after`}>発話後の間（ミリ秒）</label>
          <input
            id={`${line.id}-pause-after`}
            type="number"
            min={0}
            step={1}
            value={numberValue(line.pauseAfterMs)}
            onChange={(event) =>
              onChange({
                pauseAfterMs:
                  event.target.value.length === 0
                    ? Number.NaN
                    : Number(event.target.value)
              })
            }
          />
        </div>
      </div>
      <section
        className="script-line-visual-summary"
        aria-label={`${line.id}のビジュアル設定`}
      >
        <div className="script-line-visual-summary-content">
          <span className="eyebrow">ビジュアル</span>
          {lineVisualAssignments.length === 0 ? (
            <span className="status-message">未割り当て</span>
          ) : (
            <div className="script-line-visual-assignments">
              {lineVisualAssignments.map((assignment) => {
                const asset = assignmentAssets.get(assignment.assetId);
                const thumbnailPath = asset?.thumbnailPaths[0];
                return (
                  <div
                    className="script-line-visual-assignment"
                    key={assignment.id}
                  >
                    {thumbnailPath !== undefined ? (
                      <img
                        className="script-line-visual-thumbnail"
                        src={assetThumbnailUrl(assignment.assetId, 0)}
                        alt={`${asset?.title ?? assignment.assetId}のサムネイル`}
                      />
                    ) : (
                      <div
                        className="script-line-visual-thumbnail script-line-visual-thumbnail-empty"
                        aria-hidden="true"
                      >
                        素材
                      </div>
                    )}
                    <span className="script-line-visual-assignment-details">
                      <strong>{asset?.title ?? assignment.assetId}</strong>
                      <span>
                        適用範囲：
                        {visualAssignmentRangeLabel(project, assignment)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button
          className="button button-small"
          type="button"
          aria-pressed={isVisualSelected}
          onClick={onSelectVisualRange}
        >
          {isVisualSelected ? "このセリフを選択中" : "このセリフの素材を編集"}
        </button>
      </section>
      <div className="script-line-voice-status" aria-label="音声状態">
        <span className="eyebrow">音声状態</span>
        {voiceStatus === undefined ? (
          <span className="status-message">確認中…</span>
        ) : (
          <span className={`voice-status voice-status-${voiceStatus.status}`}>
            {voiceStatusLabel(voiceStatus.status)}
          </span>
        )}
        {voiceStatus?.status === "failed" &&
        voiceStatus.errorCode !== undefined ? (
          <code>{voiceStatus.errorCode}</code>
        ) : null}
        <button
          className="button button-small"
          type="button"
          disabled={
            voiceGenerationDisabled ||
            lineIssues.length > 0 ||
            voiceStatus?.status === "current" ||
            voiceStatus?.status === "generating" ||
            voiceStatus?.status === "needs_review"
          }
          onClick={onGenerateVoice}
        >
          {voiceStatus?.status === "generating"
            ? "生成中…"
            : "このセリフを生成"}
        </button>
      </div>
      <VoiceAdjustmentEditor
        projectId={projectId}
        line={line}
        voiceAvailable={voiceAvailable}
      />
      {lineIssues.length > 0 ? (
        <ul className="form-error script-line-errors" role="alert">
          {lineIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
    </article>
  );
}

export function ScriptPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const voiceStatusQuery = useQuery({
    queryKey: ["voice-status", projectId],
    queryFn: () => fetchProjectVoiceStatus(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.jobs.some(
        (job) => job.status === "queued" || job.status === "running"
      )
        ? 1_000
        : false
  });
  const assignmentAssetQueries = useQueries({
    queries: (projectQuery.data?.visuals.assignments ?? []).map(
      (assignment) => ({
        queryKey: ["assets", assignment.assetId],
        queryFn: () => fetchAsset(assignment.assetId),
        retry: false
      })
    )
  });
  const [draft, setDraft] = useState<Script | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    status: "idle",
    error: undefined
  });
  const [bulkSectionIndex, setBulkSectionIndex] = useState(0);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<BulkPasteError[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [initializationError, setInitializationError] = useState<unknown>(null);
  const [suggestionSectionId, setSuggestionSectionId] = useState("");
  const [suggestionStartLineId, setSuggestionStartLineId] = useState("");
  const [suggestionEndLineId, setSuggestionEndLineId] = useState("");
  const [selectedVisualLineId, setSelectedVisualLineId] = useState("");
  const [suggestionResponse, setSuggestionResponse] =
    useState<VisualSuggestionResponse | null>(null);
  const [visualSuggestionStale, setVisualSuggestionStale] = useState(false);
  const [suggestionError, setSuggestionError] = useState<unknown>(null);
  const [visualDecisionReason, setVisualDecisionReason] = useState("");
  const [candidateDecisionByAssetId, setCandidateDecisionByAssetId] = useState<
    Record<string, "accepted" | "rejected" | "stale">
  >({});
  const [assetSearchQuery, setAssetSearchQuery] = useState("");
  const [assetSearchTagIds, setAssetSearchTagIds] = useState("");
  const [assetSearchResult, setAssetSearchResult] =
    useState<AssetListResult | null>(null);
  const [assetSearchError, setAssetSearchError] = useState<unknown>(null);
  const [visualError, setVisualError] = useState<unknown>(null);
  const [voiceError, setVoiceError] = useState<unknown>(null);
  const [visualSaveState, setVisualSaveState] =
    useState<VisualSaveState>("idle");
  const projectIdRef = useRef(projectId ?? "");
  const projectGenerationRef = useRef(0);
  const revisionRef = useRef(0);
  const currentSuggestionSection = draft?.sections.find(
    (section) => section.id === suggestionSectionId
  );
  const currentSuggestionStartLineIndex =
    currentSuggestionSection?.lines.findIndex(
      (line) => line.id === suggestionStartLineId
    ) ?? -1;
  const currentSuggestionEndLineIndex =
    currentSuggestionSection?.lines.findIndex(
      (line) => line.id === suggestionEndLineId
    ) ?? -1;
  const visualSuggestionContextRef = useRef<VisualSuggestionCurrentContext>({
    projectId: projectId ?? "",
    projectGeneration: 0,
    sectionId: "",
    startLineId: "",
    endLineId: "",
    startLineIndex: -1,
    endLineIndex: -1,
    revision: 0
  });
  visualSuggestionContextRef.current = {
    projectId: projectId ?? "",
    projectGeneration: projectGenerationRef.current,
    sectionId: suggestionSectionId,
    startLineId: suggestionStartLineId,
    endLineId: suggestionEndLineId,
    startLineIndex: currentSuggestionStartLineIndex,
    endLineIndex: currentSuggestionEndLineIndex,
    revision: revisionRef.current
  };
  const draftRef = useRef<Script | null>(null);
  const lastSavedRef = useRef<Script | null>(null);
  const initializedForProjectRef = useRef<string | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<Script> | null>(null);
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<Script> | null>(null);

  const saveMutation = useMutation({
    mutationFn: ({
      projectId,
      script,
      expectedRevision
    }: {
      projectId: string;
      script: Script;
      expectedRevision: number;
    }) => saveProjectScript(projectId, { script, expectedRevision }),
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  const generateVoiceMutation = useMutation({
    mutationFn: ({
      projectId,
      lineId
    }: {
      projectId: string;
      lineId: string;
    }) => generateProjectVoice(projectId, { lineIds: [lineId] }),
    onSuccess: () => {
      setVoiceError(null);
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    onError: setVoiceError,
    retry: false
  });

  const generateAllVoiceMutation = useMutation({
    mutationFn: (requestProjectId: string) =>
      generateAllProjectVoice(requestProjectId),
    onSuccess: () => {
      setVoiceError(null);
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    onError: setVoiceError,
    retry: false
  });

  const suggestionMutation = useMutation({
    mutationFn: ({
      projectId,
      startLineId,
      endLineId,
      expectedRevision
    }: VisualSuggestionRequestContext) =>
      suggestProjectVisuals(projectId, {
        startLineId,
        endLineId,
        expectedRevision
      }),
    onMutate: () => {
      setSuggestionError(null);
    },
    onSuccess: (response, variables) => {
      if (
        !isVisualSuggestionContextCurrent(
          visualSuggestionContextRef.current,
          variables
        )
      ) {
        return;
      }
      setSuggestionError(null);
      setSuggestionResponse(response);
      revisionRef.current = response.revision;
      void projectQuery.refetch();
    },
    onError: (error, variables) => {
      if (
        isVisualSuggestionContextCurrent(
          visualSuggestionContextRef.current,
          variables
        )
      ) {
        setSuggestionError(error);
      }
    }
  });

  const assetSearchMutation = useMutation({
    mutationFn: ({ query, tagIds }: { query: string; tagIds: string[] }) =>
      searchAssets({ q: query, tagIds, pageSize: 12 }),
    onSuccess: (result) => {
      setAssetSearchError(null);
      setAssetSearchResult(result);
    },
    onError: setAssetSearchError
  });

  const visualAssignMutation = useMutation({
    mutationFn: ({
      projectId,
      expectedRevision,
      assignment,
      suggestionRunId,
      reason
    }: VisualAssignmentRequest & { projectId: string }) =>
      assignProjectVisual(projectId, {
        expectedRevision,
        assignment,
        ...(suggestionRunId === undefined ? {} : { suggestionRunId, reason })
      }),
    retry: false
  });

  const visualRejectMutation = useMutation({
    mutationFn: ({
      projectId,
      runId,
      assetId,
      expectedRevision,
      reason
    }: {
      projectId: string;
      runId: string;
      assetId: string;
      expectedRevision: number;
      reason: string;
    }) =>
      rejectProjectVisualSuggestionCandidate(projectId, runId, assetId, {
        expectedRevision,
        reason
      }),
    retry: false
  });

  const visualUpdateMutation = useMutation({
    mutationFn: ({
      projectId,
      assignmentId,
      expectedRevision,
      assignment
    }: VisualAssignmentUpdateRequest & {
      projectId: string;
      assignmentId: string;
    }) =>
      updateProjectVisualAssignment(projectId, assignmentId, {
        expectedRevision,
        assignment
      }),
    retry: false
  });

  const visualDeleteMutation = useMutation({
    mutationFn: ({
      projectId,
      assignmentId,
      expectedRevision
    }: VisualAssignmentDeleteRequest & {
      projectId: string;
      assignmentId: string;
    }) =>
      deleteProjectVisualAssignment(projectId, assignmentId, {
        expectedRevision
      }),
    retry: false
  });

  function updateMutationCaches(project: VideoProject): void {
    queryClient.setQueryData(["projects", project.metadata.id], project);
    void queryClient.invalidateQueries({
      queryKey: ["voice-status", project.metadata.id]
    });
    queryClient.setQueryData<ProjectSummary[]>(["projects"], (summaries) =>
      summaries?.map((summary) =>
        summary.id === project.metadata.id
          ? projectSummaryFromProject(project)
          : summary
      )
    );
  }

  function adoptProject(project: VideoProject): void {
    const nextDraft = cloneScript(project.script);
    revisionRef.current = project.revision;
    draftRef.current = nextDraft;
    lastSavedRef.current = nextDraft;
    initializedForProjectRef.current = project.metadata.id;
    setDraft(nextDraft);
    setBulkSectionIndex(0);
    coordinatorRef.current?.reset();
  }

  async function saveDraft(nextDraft: Script): Promise<void> {
    const lastSaved = lastSavedRef.current;
    if (
      lastSaved === null ||
      JSON.stringify(lastSaved) === JSON.stringify(nextDraft)
    ) {
      return;
    }
    const savingProjectId = projectIdRef.current;
    const savingGeneration = projectGenerationRef.current;
    const project = await saveMutationRef.current.mutateAsync({
      projectId: savingProjectId,
      script: nextDraft,
      expectedRevision: revisionRef.current
    });
    updateMutationCaches(project);
    if (
      !isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        savingProjectId,
        savingGeneration
      )
    ) {
      return;
    }
    revisionRef.current = project.revision;
    const latestDraft = draftRef.current ?? nextDraft;
    const reconciledDraft = {
      ...reconcileScriptLineIds(nextDraft, project.script, latestDraft),
      status: project.script.status
    };
    lastSavedRef.current = cloneScript(project.script);
    draftRef.current = reconciledDraft;
    coordinatorRef.current?.replaceDraft(reconciledDraft);
    setDraft(reconciledDraft);
  }

  useEffect(() => {
    const nextCoordinator = new AutosaveCoordinator<Script>({
      debounceMs: 350,
      save: (nextDraft) => saveDraft(nextDraft),
      isConflict: (error) =>
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "PROJECT_REVISION_CONFLICT",
      onStateChange: setAutosaveState
    });
    coordinatorRef.current = nextCoordinator;
    setCoordinator(nextCoordinator);
    return () => {
      nextCoordinator.dispose();
      if (coordinatorRef.current === nextCoordinator) {
        coordinatorRef.current = null;
      }
    };
  }, []);

  projectIdRef.current = projectId ?? "";

  useEffect(() => {
    if (coordinator === null || projectId === undefined) {
      return;
    }
    projectGenerationRef.current += 1;
    initializedForProjectRef.current = null;
    draftRef.current = null;
    lastSavedRef.current = null;
    revisionRef.current = 0;
    setDraft(null);
    setBulkText("");
    setBulkErrors([]);
    setInitializationError(null);
    setSuggestionSectionId("");
    setSuggestionStartLineId("");
    setSuggestionEndLineId("");
    setSelectedVisualLineId("");
    setSuggestionResponse(null);
    setVisualSuggestionStale(false);
    setSuggestionError(null);
    setVisualDecisionReason("");
    setCandidateDecisionByAssetId({});
    visualSuggestionContextRef.current = {
      projectId: projectId ?? "",
      projectGeneration: projectGenerationRef.current,
      sectionId: "",
      startLineId: "",
      endLineId: "",
      startLineIndex: -1,
      endLineIndex: -1,
      revision: 0
    };
    setAssetSearchResult(null);
    setAssetSearchError(null);
    setVisualError(null);
    setVisualSaveState("idle");
    coordinator.reset();
  }, [coordinator, projectId]);

  useEffect(() => {
    if (
      projectId === undefined ||
      coordinator === null ||
      projectQuery.data === undefined ||
      projectQuery.isError ||
      initializedForProjectRef.current === projectId
    ) {
      return;
    }
    revisionRef.current = projectQuery.data.revision;
    if (projectQuery.data.script.sections.length > 0) {
      adoptProject(projectQuery.data);
    } else {
      setDraft(null);
      coordinator.reset();
    }
  }, [coordinator, projectId, projectQuery.data, projectQuery.isError]);

  useEffect(() => {
    if (draft === null) {
      return;
    }
    const selectedSection =
      draft.sections.find((section) => section.id === suggestionSectionId) ??
      draft.sections.find((section) => section.lines.length > 0) ??
      draft.sections[0];
    if (selectedSection === undefined) {
      return;
    }
    if (selectedSection.id !== suggestionSectionId) {
      setSuggestionSectionId(selectedSection.id);
    }
    const firstLineId = selectedSection.lines[0]?.id ?? "";
    const lastLineId = selectedSection.lines.at(-1)?.id ?? "";
    if (
      !selectedSection.lines.some((line) => line.id === suggestionStartLineId)
    ) {
      setSuggestionStartLineId(firstLineId);
    }
    if (
      !selectedSection.lines.some((line) => line.id === suggestionEndLineId)
    ) {
      setSuggestionEndLineId(lastLineId);
    }
    if (
      !selectedSection.lines.some((line) => line.id === selectedVisualLineId)
    ) {
      setSelectedVisualLineId(firstLineId);
    }
  }, [
    draft,
    selectedVisualLineId,
    suggestionEndLineId,
    suggestionSectionId,
    suggestionStartLineId
  ]);

  const initializeMutation = useMutation({
    mutationFn: ({
      projectId,
      expectedRevision
    }: {
      projectId: string;
      projectGeneration: number;
      expectedRevision: number;
    }) => initializeProjectScript(projectId, { expectedRevision }),
    onSuccess: (project, variables) => {
      updateMutationCaches(project);
      if (
        !isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          variables.projectId,
          variables.projectGeneration
        )
      ) {
        return;
      }
      setInitializationError(null);
      adoptProject(project);
    },
    onError: (error, variables) => {
      if (
        isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          variables.projectId,
          variables.projectGeneration
        )
      ) {
        setInitializationError(error);
      }
    },
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  async function reloadLatest(): Promise<void> {
    const reloadingProjectId = projectIdRef.current;
    const reloadingGeneration = projectGenerationRef.current;
    const result = await projectQuery.refetch();
    if (
      !result.isSuccess ||
      result.data === undefined ||
      !isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        reloadingProjectId,
        reloadingGeneration
      )
    ) {
      return;
    }
    initializedForProjectRef.current = null;
    if (result.data.script.sections.length > 0) {
      adoptProject(result.data);
    } else {
      revisionRef.current = result.data.revision;
      setDraft(null);
      coordinatorRef.current?.reset();
    }
  }

  async function navigateAway(
    event: MouseEvent<HTMLAnchorElement>,
    destination: string
  ): Promise<void> {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    if (pendingNavigation) {
      return;
    }
    setPendingNavigation(true);
    const flushed = await navigateAfterAutosave(
      coordinatorRef.current,
      destination,
      navigate
    );
    if (!flushed) {
      setPendingNavigation(false);
    }
  }

  function selectVisualRange(sectionId: string, lineId: string): void {
    setSelectedVisualLineId(lineId);
    setSuggestionSectionId(sectionId);
    setSuggestionStartLineId(lineId);
    setSuggestionEndLineId(lineId);
    setSuggestionResponse(null);
    setSuggestionError(null);
  }

  function updateDraft(nextDraft: Script): void {
    const status = scriptStatusAfterEdit(
      draftRef.current?.status ?? nextDraft.status,
      nextDraft.status
    );
    const statusDraft = { ...nextDraft, status };
    draftRef.current = statusDraft;
    setDraft(statusDraft);
    coordinatorRef.current?.update(statusDraft);
  }

  function updateLine(
    sectionIndex: number,
    lineIndex: number,
    update: Partial<ScriptLine>
  ): void {
    if (draft !== null) {
      updateDraft(updateScriptLine(draft, sectionIndex, lineIndex, update));
    }
  }

  function addLine(sectionIndex: number): void {
    if (draft === null) {
      return;
    }
    const speakerId = projectQuery.data?.characters[0]?.id;
    if (speakerId === undefined) {
      return;
    }
    updateDraft(
      appendScriptLines(draft, sectionIndex, [
        createDefaultScriptLine(speakerId, nextTemporaryLineId(draft))
      ])
    );
  }

  function pasteLines(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft === null || projectQuery.data === undefined) {
      return;
    }
    const result = parseBulkScript(bulkText, projectQuery.data.characters);
    if (!result.ok) {
      setBulkErrors(result.errors);
      return;
    }
    const usedIds = new Set(
      draft.sections.flatMap((section) => section.lines.map((line) => line.id))
    );
    const lines = result.lines.map((line, index) => {
      let id = `draft-line-${index + 1}`;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `draft-line-${index + 1}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);
      return createDefaultScriptLine(line.speakerId, id, line.spokenText);
    });
    const nextDraft = appendScriptLines(draft, bulkSectionIndex, lines);
    updateDraft(nextDraft);
    setBulkText("");
    setBulkErrors([]);
  }

  const isInitializing = initializeMutation.isPending;
  const project = projectQuery.data;
  const assignmentAssets = new Map<string, AssetDetail | undefined>();
  (project?.visuals.assignments ?? []).forEach((assignment, index) => {
    assignmentAssets.set(
      assignment.assetId,
      assignmentAssetQueries[index]?.data
    );
  });
  const isReadyToInitialize =
    project !== undefined && isScriptInitializationAllowed(project);
  const issues =
    draft !== null && project !== undefined
      ? validateScriptDraft(draft, project.characters)
      : [];
  const autosaveMessage = pendingNavigation
    ? "遷移前に保存しています…"
    : autosaveState.status === "saving"
      ? "保存中…"
      : autosaveState.status === "saved"
        ? "保存済み"
        : autosaveState.status === "error"
          ? "保存に失敗しました"
          : autosaveState.status === "conflict"
            ? "保存競合です"
            : autosaveState.status === "pending"
              ? "変更を保存する準備中…"
              : "変更はありません";
  if (projectQuery.isError) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>台本を読み込めません</h1>
          <p>
            {getErrorMessage(
              projectQuery.error,
              "プロジェクトを取得できませんでした。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void reloadLatest()}
          >
            再試行
          </button>
        </section>
      </main>
    );
  }

  if (projectQuery.isPending || project === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <p className="status-message" role="status" aria-live="polite">
          台本を読み込んでいます…
        </p>
      </main>
    );
  }

  if (draft === null) {
    const reason =
      project.outline.status !== "approved"
        ? "構成案が未承認です。構成案画面で確認・承認してください。"
        : project.outline.sourceHash !== project.source.sha256
          ? "元資料が更新されているため、構成案を再確認してください。"
          : "台本を初期化できます。";
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={outlinePath(projectId)}>構成案へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="production" />
        <header className="page-header page-header-stacked">
          <p className="eyebrow">制作 台本・ビジュアル・音声</p>
          <h1>{project.metadata.title}</h1>
          <p>
            構成案のセクション構造を引き継いで、台本中心の制作を開始します。
          </p>
          <div className="page-header-actions">
            <Link className="button" to={outlinePath(projectId)}>
              構成案を確認
            </Link>
            <Link className="button" to={charactersPath(projectId)}>
              キャラクター素材を確認
            </Link>
          </div>
        </header>
        <section className="message-panel" aria-live="polite">
          <h2>台本編集を開始</h2>
          <p>{reason}</p>
          {!isReadyToInitialize ? (
            <p>
              構成案を承認し、元資料との不一致を解消すると開始できます。既存の台本データは削除しません。
            </p>
          ) : null}
          {initializationError !== null ? (
            <div className="message-panel message-panel-error" role="alert">
              <p>
                {getErrorMessage(
                  initializationError,
                  "台本の初期化に失敗しました。"
                )}
              </p>
              {errorDetails(initializationError).length > 0 ? (
                <ul>
                  {errorDetails(initializationError).map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <button
            className="button button-primary"
            type="button"
            disabled={!isReadyToInitialize || isInitializing}
            onClick={() =>
              initializeMutation.mutate({
                projectId: projectIdRef.current,
                projectGeneration: projectGenerationRef.current,
                expectedRevision: project.revision
              })
            }
          >
            {isInitializing ? "初期化中…" : "台本編集を開始"}
          </button>
        </section>
      </main>
    );
  }

  const suggestionSection =
    draft.sections.find((section) => section.id === suggestionSectionId) ??
    draft.sections.find((section) => section.lines.length > 0) ??
    draft.sections[0];
  const selectedVisualSection =
    draft.sections.find((section) =>
      section.lines.some((line) => line.id === selectedVisualLineId)
    ) ?? suggestionSection;
  const selectedVisualLine =
    selectedVisualSection?.lines.find(
      (line) => line.id === selectedVisualLineId
    ) ??
    suggestionSection?.lines.find(
      (line) => line.id === suggestionStartLineId
    ) ??
    suggestionSection?.lines[0];
  const canSuggest = issues.length === 0;
  const visualMutationPending =
    visualAssignMutation.isPending ||
    visualRejectMutation.isPending ||
    visualUpdateMutation.isPending ||
    visualDeleteMutation.isPending;

  function isVisualMutationCurrent(context: VisualMutationContext): boolean {
    return (
      isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        context.projectId,
        context.projectGeneration
      ) && revisionRef.current === context.expectedRevision
    );
  }

  function acceptVisualMutationResult(
    saved: VideoProject,
    context: VisualMutationContext
  ): boolean {
    if (!isVisualMutationCurrent(context)) {
      return false;
    }
    updateMutationCaches(saved);
    revisionRef.current = saved.revision;
    setVisualError(null);
    setVisualSaveState("saved");
    return true;
  }

  async function saveVisualAssignment(
    assignment: VisualAssignment
  ): Promise<boolean> {
    const context: VisualMutationContext = {
      projectId: projectIdRef.current,
      projectGeneration: projectGenerationRef.current,
      expectedRevision: revisionRef.current
    };
    setVisualError(null);
    setVisualSaveState("idle");
    try {
      const saved = await visualUpdateMutation.mutateAsync({
        ...context,
        assignmentId: assignment.id,
        assignment: assignmentInput(assignment)
      });
      return acceptVisualMutationResult(saved, context);
    } catch (error) {
      if (isVisualMutationCurrent(context)) {
        setVisualError(error);
        setVisualSaveState("idle");
      }
      return false;
    }
  }

  async function removeVisualAssignment(assignmentId: string): Promise<void> {
    const context: VisualMutationContext = {
      projectId: projectIdRef.current,
      projectGeneration: projectGenerationRef.current,
      expectedRevision: revisionRef.current
    };
    setVisualError(null);
    setVisualSaveState("idle");
    try {
      const saved = await visualDeleteMutation.mutateAsync({
        ...context,
        assignmentId
      });
      acceptVisualMutationResult(saved, context);
    } catch (error) {
      if (isVisualMutationCurrent(context)) {
        setVisualError(error);
        setVisualSaveState("idle");
      }
    }
  }

  async function assignVisualCandidate(
    asset: AssetDetail | AssetListItem,
    suggestionRunId?: string
  ): Promise<void> {
    if (
      suggestionSection === undefined ||
      suggestionStartLineId.length === 0 ||
      suggestionEndLineId.length === 0
    ) {
      setVisualError(
        new Error("同じセクション内の表示範囲を選択してください。")
      );
      setVisualSaveState("idle");
      return;
    }
    const currentDraft = draftRef.current;
    if (currentDraft === null) {
      setVisualError(new Error("台本を読み込んでから操作してください。"));
      setVisualSaveState("idle");
      return;
    }
    const requestRange = createScriptLineRangeLocator(
      currentDraft,
      suggestionSection.id,
      suggestionStartLineId,
      suggestionEndLineId
    );
    if (requestRange === undefined) {
      setVisualError(new Error("対象セリフを保存後の台本から解決できません。"));
      setVisualSaveState("idle");
      return;
    }
    const displayResult = defaultDisplayForAsset(asset);
    if (displayResult.display === undefined) {
      setVisualError(new Error(displayResult.reason));
      setVisualSaveState("idle");
      return;
    }

    const requestProjectId = projectIdRef.current;
    const requestGeneration = projectGenerationRef.current;
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      return;
    }
    if (
      !isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        requestProjectId,
        requestGeneration
      )
    ) {
      return;
    }
    const latestProject =
      queryClient.getQueryData<VideoProject>(["projects", requestProjectId]) ??
      project;
    const latestDraft = draftRef.current;
    const resolvedRange =
      latestDraft === null
        ? undefined
        : resolveScriptLineRange(latestDraft, requestRange);
    if (resolvedRange === undefined) {
      setVisualError(new Error("対象セリフを保存後の台本から解決できません。"));
      setVisualSaveState("idle");
      return;
    }
    setSuggestionStartLineId(resolvedRange.startLineId);
    setSuggestionEndLineId(resolvedRange.endLineId);
    if (latestProject === undefined) {
      setVisualError(new Error("プロジェクトを再読み込みしてください。"));
      setVisualSaveState("idle");
      return;
    }
    const context: VisualMutationContext = {
      projectId: requestProjectId,
      projectGeneration: requestGeneration,
      expectedRevision: revisionRef.current
    };
    setVisualError(null);
    setVisualSaveState("idle");
    try {
      const saved = await visualAssignMutation.mutateAsync({
        ...context,
        ...(suggestionRunId === undefined
          ? {}
          : {
              suggestionRunId,
              reason: visualDecisionReason
            }),
        assignment: {
          id: nextVisualAssignmentId(latestProject.visuals.assignments),
          startLineId: resolvedRange.startLineId,
          endLineId: resolvedRange.endLineId,
          assetId: asset.assetId,
          display: displayResult.display
        }
      });
      if (
        acceptVisualMutationResult(saved, context) &&
        suggestionRunId !== undefined
      ) {
        setCandidateDecisionByAssetId((current) => {
          const next = { ...current, [asset.assetId]: "accepted" as const };
          for (const candidate of suggestionResponse?.data.candidates ?? []) {
            if (
              candidate.asset.assetId !== asset.assetId &&
              current[candidate.asset.assetId] === undefined
            ) {
              next[candidate.asset.assetId] = "stale";
            }
          }
          return next;
        });
        setVisualSuggestionStale(true);
      }
    } catch (error) {
      if (isVisualMutationCurrent(context)) {
        setVisualError(error);
        setVisualSaveState("idle");
      }
    }
  }

  async function rejectVisualCandidate(assetId: string): Promise<void> {
    const runId = suggestionResponse?.data.runId;
    if (
      runId === undefined ||
      candidateDecisionByAssetId[assetId] !== undefined
    ) {
      return;
    }
    const requestProjectId = projectIdRef.current;
    const requestGeneration = projectGenerationRef.current;
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      return;
    }
    const context: VisualMutationContext = {
      projectId: requestProjectId,
      projectGeneration: requestGeneration,
      expectedRevision: revisionRef.current
    };
    if (!isVisualMutationCurrent(context)) {
      return;
    }
    setVisualError(null);
    setVisualSaveState("idle");
    try {
      await visualRejectMutation.mutateAsync({
        projectId: requestProjectId,
        runId,
        assetId,
        expectedRevision: context.expectedRevision,
        reason: visualDecisionReason
      });
      if (isVisualMutationCurrent(context)) {
        setCandidateDecisionByAssetId((current) => ({
          ...current,
          [assetId]: "rejected"
        }));
      }
    } catch (error) {
      if (isVisualMutationCurrent(context)) {
        setVisualError(error);
      }
    }
  }

  async function runVisualSuggestion(): Promise<void> {
    if (
      suggestionSection === undefined ||
      suggestionStartLineId.length === 0 ||
      suggestionEndLineId.length === 0 ||
      !canSuggest ||
      suggestionMutation.isPending
    ) {
      return;
    }
    const requestProjectId = projectIdRef.current;
    const requestGeneration = projectGenerationRef.current;
    const currentDraft = draftRef.current;
    if (currentDraft === null) {
      setSuggestionError(new Error("台本を読み込んでから操作してください。"));
      return;
    }
    const requestRange = createScriptLineRangeLocator(
      currentDraft,
      suggestionSection.id,
      suggestionStartLineId,
      suggestionEndLineId
    );
    if (requestRange === undefined) {
      setSuggestionError(
        new Error("対象セリフを保存後の台本から解決できません。")
      );
      return;
    }
    const requestContext = await captureVisualSuggestionRequestAfterFlush(
      () => coordinatorRef.current?.flush() ?? Promise.resolve(false),
      () => {
        const latestDraft = draftRef.current;
        const resolvedRange =
          latestDraft === null
            ? undefined
            : resolveScriptLineRange(latestDraft, requestRange);
        if (resolvedRange === undefined) {
          setSuggestionError(
            new Error("対象セリフを保存後の台本から解決できません。")
          );
          return undefined;
        }
        setSuggestionStartLineId(resolvedRange.startLineId);
        setSuggestionEndLineId(resolvedRange.endLineId);
        return {
          projectId: requestProjectId,
          projectGeneration: requestGeneration,
          sectionId: requestRange.sectionId,
          startLineId: resolvedRange.startLineId,
          endLineId: resolvedRange.endLineId,
          startLineIndex: requestRange.start.lineIndex,
          endLineIndex: requestRange.end.lineIndex
        };
      },
      () => revisionRef.current
    );
    if (requestContext === undefined) {
      return;
    }
    const currentContext: VisualSuggestionCurrentContext = {
      ...visualSuggestionContextRef.current,
      projectId: projectIdRef.current,
      projectGeneration: projectGenerationRef.current,
      revision: revisionRef.current
    };
    if (!isVisualSuggestionContextCurrent(currentContext, requestContext)) {
      return;
    }
    setSuggestionResponse(null);
    setVisualSuggestionStale(false);
    setCandidateDecisionByAssetId({});
    suggestionMutation.mutate(requestContext);
  }

  function runAssetSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAssetSearchError(null);
    const tagIds = [
      ...new Set(
        assetSearchTagIds
          .split(/[\s,]+/u)
          .map((tagId) => tagId.normalize("NFC").trim())
          .filter((tagId) => tagId.length > 0)
      )
    ];
    assetSearchMutation.mutate({ query: assetSearchQuery, tagIds });
  }

  async function generateVoiceLine(
    sectionId: string,
    lineId: string
  ): Promise<void> {
    if (generateVoiceMutation.isPending || generateAllVoiceMutation.isPending) {
      return;
    }
    const currentDraft = draftRef.current;
    if (currentDraft === null) {
      setVoiceError(new Error("台本を読み込んでから操作してください。"));
      return;
    }
    const lineLocator = createScriptLineLocator(
      currentDraft,
      sectionId,
      lineId
    );
    if (lineLocator === undefined) {
      setVoiceError(new Error("対象セリフを台本から解決できません。"));
      return;
    }
    const requestProjectId = projectIdRef.current;
    const requestGeneration = projectGenerationRef.current;
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      return;
    }
    if (
      !isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        requestProjectId,
        requestGeneration
      )
    ) {
      return;
    }
    const latestDraft = draftRef.current;
    const resolvedLineId =
      latestDraft === null
        ? undefined
        : resolveScriptLineId(latestDraft, lineLocator);
    if (resolvedLineId === undefined) {
      setVoiceError(new Error("対象セリフを保存後の台本から解決できません。"));
      return;
    }
    setVoiceError(null);
    generateVoiceMutation.mutate({
      projectId: requestProjectId,
      lineId: resolvedLineId
    });
  }

  async function generateAllVoice(): Promise<void> {
    if (generateVoiceMutation.isPending || generateAllVoiceMutation.isPending) {
      return;
    }
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      return;
    }
    setVoiceError(null);
    generateAllVoiceMutation.mutate(projectIdRef.current);
  }

  const voiceStatusByLine = new Map(
    (voiceStatusQuery.data?.lines ?? []).map((lineStatus) => [
      lineStatus.lineId,
      lineStatus
    ])
  );
  const voiceGenerationDisabled =
    voiceStatusQuery.isPending ||
    voiceStatusQuery.isError ||
    voiceStatusQuery.data?.available !== true ||
    generateVoiceMutation.isPending ||
    generateAllVoiceMutation.isPending;

  return (
    <main className="page-shell script-editor-page">
      <p className="back-link">
        <Link
          to="/projects"
          onClick={(event) => void navigateAway(event, "/projects")}
        >
          プロジェクト一覧へ戻る
        </Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="production" />
      <header className="page-header page-header-stacked">
        <div className="page-header-actions">
          <p className="eyebrow">制作 台本・ビジュアル・音声</p>
          <Link
            className="button"
            to={charactersPath(projectId)}
            onClick={(event) =>
              void navigateAway(event, charactersPath(projectId))
            }
          >
            キャラクター素材を確認
          </Link>
        </div>
        <h1>{project.metadata.title}</h1>
        <p>
          台本を書きながら、セリフごとのビジュアルとVOICEVOX音声を設定・確認します。保存と検証の状態はこの画面で確認できます。
        </p>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>{autosaveMessage}</strong>
        <span>更新番号 {revisionRef.current}</span>
        <span>{scriptStatusLabel(draft.status)}</span>
      </div>

      {autosaveState.status === "error" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存できませんでした</h2>
          <p>
            {getErrorMessage(
              autosaveState.error,
              "入力中の台本は保持されています。"
            )}
          </p>
          {errorDetails(autosaveState.error).length > 0 ? (
            <ul>
              {errorDetails(autosaveState.error).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
          <button
            className="button"
            type="button"
            onClick={() => coordinator?.retry()}
          >
            再試行
          </button>
        </section>
      ) : null}
      {autosaveState.status === "conflict" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存競合</h2>
          <p>
            別の画面で更新されたため、自動上書きを停止しました。現在の台本入力は保持しています。
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void reloadLatest()}
          >
            最新データを再読込
          </button>
        </section>
      ) : null}
      {issues.length > 0 ? (
        <section className="message-panel message-panel-warning" role="alert">
          <h2>入力を確認してください</h2>
          <p>
            入力中の台本は保持しています。該当項目を修正して再保存してください。
          </p>
        </section>
      ) : null}

      <section
        id="workflow-voice"
        className="voice-generation-panel"
        aria-labelledby="voice-generation-title"
      >
        <div>
          <p className="eyebrow">制作 音声</p>
          <h2 id="voice-generation-title">差分のあるセリフだけを生成</h2>
          <p>
            台本、話者、音声設定、用語、音声エンジンの版を比較し、更新が必要なセリフだけを対象にします。
          </p>
        </div>
        {voiceStatusQuery.isPending ? (
          <p className="status-message">音声状態を確認しています…</p>
        ) : null}
        {voiceStatusQuery.isError ? (
          <p className="message-panel message-panel-warning" role="status">
            VOICEVOX
            が利用できないため、音声操作を無効にしています。台本編集は続けられます。
          </p>
        ) : null}
        {voiceStatusQuery.data?.available === false ? (
          <p className="message-panel message-panel-warning" role="status">
            VOICEVOX
            が停止中です。台本編集は続けられますが、音声生成は利用できません。
          </p>
        ) : null}
        {voiceError !== null ? (
          <p className="form-error" role="alert">
            {getErrorMessage(voiceError, "音声生成に失敗しました。")}
          </p>
        ) : null}
        <button
          className="button button-primary"
          type="button"
          disabled={voiceGenerationDisabled || issues.length > 0}
          onClick={() => void generateAllVoice()}
        >
          {generateAllVoiceMutation.isPending
            ? "差分音声を生成中…"
            : "差分音声を一括生成"}
        </button>
      </section>

      <div className="script-production-layout">
        <aside
          className="script-visual-sidebar"
          aria-label="セリフのビジュアル編集"
        >
          <section
            className="selected-script-line-panel"
            aria-labelledby="selected-script-line-title"
          >
            <div className="visual-subsection-header">
              <div>
                <p className="eyebrow">現在の編集対象</p>
                <h2 id="selected-script-line-title">
                  {selectedVisualLine?.id ?? "セリフを選択してください"}
                </h2>
              </div>
              <span className="status-message">台本と同じ画面で編集</span>
            </div>
            {selectedVisualLine !== undefined ? (
              <dl className="selected-script-line-details">
                <div>
                  <dt>読み上げ文</dt>
                  <dd>{selectedVisualLine.spokenText || "未入力"}</dd>
                </div>
                <div>
                  <dt>字幕</dt>
                  <dd>{selectedVisualLine.subtitleText || "未入力"}</dd>
                </div>
                <div>
                  <dt>対象範囲</dt>
                  <dd>
                    {suggestionSection?.name ?? "不明"}：
                    {suggestionStartLineId || "—"} ～{" "}
                    {suggestionEndLineId || "—"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="status-message">
                左のセリフカードを選ぶと、対象範囲と割り当て済み素材をここで編集できます。
              </p>
            )}
          </section>

          <section
            id="workflow-visual"
            className="visual-suggestion-panel"
            aria-labelledby="visual-suggestion-title"
          >
            <div>
              <p className="eyebrow">制作 ビジュアル候補</p>
              <h2 id="visual-suggestion-title">AIでビジュアル候補を探す</h2>
              <p>
                AIが検索条件を作成し、登録済みで利用可能な素材から候補を検索します。素材の割り当ては最後に手動で確定します。
              </p>
            </div>
            {!canSuggest ? (
              <p className="message-panel message-panel-warning">
                台本の入力エラーを解消するとAIでビジュアル候補を検索できます。通常の素材検索と素材の割り当ては編集中も利用できます。
              </p>
            ) : null}
            <div className="form-field">
              <label htmlFor="visual-suggestion-section">
                候補を探すセクション
              </label>
              <select
                id="visual-suggestion-section"
                value={suggestionSection?.id ?? ""}
                onChange={(event) => {
                  const nextSection = draft.sections.find(
                    (section) => section.id === event.target.value
                  );
                  setSuggestionSectionId(event.target.value);
                  setSuggestionStartLineId(nextSection?.lines[0]?.id ?? "");
                  setSuggestionEndLineId(nextSection?.lines.at(-1)?.id ?? "");
                  setSelectedVisualLineId(nextSection?.lines[0]?.id ?? "");
                  setSuggestionResponse(null);
                  setSuggestionError(null);
                }}
                disabled={suggestionMutation.isPending}
              >
                {draft.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}（{section.lines.length}セリフ）
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field-group">
              <div className="form-field">
                <label htmlFor="visual-suggestion-start">開始セリフ</label>
                <select
                  id="visual-suggestion-start"
                  value={suggestionStartLineId}
                  onChange={(event) => {
                    setSuggestionStartLineId(event.target.value);
                    setSelectedVisualLineId(event.target.value);
                    setSuggestionResponse(null);
                    setSuggestionError(null);
                  }}
                  disabled={
                    suggestionSection === undefined ||
                    suggestionMutation.isPending
                  }
                >
                  {suggestionSection?.lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="visual-suggestion-end">終了セリフ</label>
                <select
                  id="visual-suggestion-end"
                  value={suggestionEndLineId}
                  onChange={(event) => {
                    setSuggestionEndLineId(event.target.value);
                    setSuggestionResponse(null);
                    setSuggestionError(null);
                  }}
                  disabled={
                    suggestionSection === undefined ||
                    suggestionMutation.isPending
                  }
                >
                  {suggestionSection?.lines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              className="button button-primary"
              type="button"
              onClick={() => void runVisualSuggestion()}
              disabled={
                !canSuggest ||
                suggestionSection === undefined ||
                suggestionStartLineId.length === 0 ||
                suggestionEndLineId.length === 0 ||
                suggestionMutation.isPending
              }
            >
              {suggestionMutation.isPending
                ? "ビジュアル候補を検索中…"
                : "AIでビジュアル候補を検索"}
            </button>
            {suggestionError !== null ? (
              <section
                className="message-panel message-panel-error"
                role="alert"
              >
                <p>
                  {getErrorMessage(
                    suggestionError,
                    "AIによるビジュアル候補の検索に失敗しました。"
                  )}
                </p>
                {errorDetails(suggestionError).length > 0 ? (
                  <ul>
                    {errorDetails(suggestionError).map((detail) => (
                      <li key={detail}>{detail}</li>
                    ))}
                  </ul>
                ) : null}
                <p>通常の素材検索は引き続き利用できます。</p>
              </section>
            ) : null}
            {suggestionResponse !== null ? (
              <div className="visual-suggestion-result">
                <p className="eyebrow">AIが作成した検索条件</p>
                <dl className="definition-list">
                  <dt>必須タグ</dt>
                  <dd>
                    {suggestionResponse.data.aiIntent.requiredTags.join("、") ||
                      "なし"}
                  </dd>
                  <dt>任意タグ</dt>
                  <dd>
                    {suggestionResponse.data.aiIntent.optionalTags.join("、") ||
                      "なし"}
                  </dd>
                  <dt>除外タグ</dt>
                  <dd>
                    {suggestionResponse.data.aiIntent.excludedTags.join("、") ||
                      "なし"}
                  </dd>
                  <dt>素材の種類</dt>
                  <dd>
                    {suggestionResponse.data.aiIntent.mediaKinds
                      .map(assetKindLabel)
                      .join("、")}
                  </dd>
                  <dt>キーワード検索</dt>
                  <dd>
                    {suggestionResponse.data.aiIntent.freeTextQuery || "なし"}
                  </dd>
                  <dt>提案理由</dt>
                  <dd>{suggestionResponse.data.aiIntent.reason}</dd>
                </dl>
                <p className="eyebrow">登録情報に照合した検索条件</p>
                <dl className="definition-list">
                  <dt>必須タグ</dt>
                  <dd>
                    {suggestionResponse.data.resolvedSearch.requiredTags
                      .map((tag) => `${tag.canonicalName}（${tag.tagId}）`)
                      .join("、") || "なし"}
                  </dd>
                  <dt>任意タグ</dt>
                  <dd>
                    {suggestionResponse.data.resolvedSearch.optionalTags
                      .map((tag) => `${tag.canonicalName}（${tag.tagId}）`)
                      .join("、") || "なし"}
                  </dd>
                  <dt>除外タグ</dt>
                  <dd>
                    {suggestionResponse.data.resolvedSearch.excludedTags
                      .map((tag) => `${tag.canonicalName}（${tag.tagId}）`)
                      .join("、") || "なし"}
                  </dd>
                  <dt>キーワード検索</dt>
                  <dd>
                    {suggestionResponse.data.resolvedSearch.freeTextQuery ||
                      "なし"}
                  </dd>
                </dl>
                {suggestionResponse.data.diagnostics.unresolvedTags.length >
                0 ? (
                  <div className="message-panel message-panel-warning">
                    <h3>未解決条件</h3>
                    <ul>
                      {suggestionResponse.data.diagnostics.unresolvedTags.map(
                        (tag) => (
                          <li key={`${tag.group}-${tag.value}`}>
                            {visualTagGroupLabel(tag.group)}：{tag.value}（
                            {unresolvedTagReasonLabel(tag.reason)}）
                          </li>
                        )
                      )}
                    </ul>
                    {suggestionResponse.data.diagnostics
                      .requiredTagResolutionFailed ? (
                      <p>必須タグを解決できないため候補は返していません。</p>
                    ) : null}
                  </div>
                ) : null}
                <div className="form-field">
                  <label htmlFor="visual-decision-reason">
                    候補の採否理由（任意）
                  </label>
                  <textarea
                    id="visual-decision-reason"
                    rows={3}
                    value={visualDecisionReason}
                    onChange={(event) =>
                      setVisualDecisionReason(event.target.value)
                    }
                    placeholder="理由を入力しなくても採用・却下の事実は記録されます。"
                    maxLength={2000}
                  />
                  <small>理由未入力でも採用・却下の事実は記録されます。</small>
                </div>
                <p className="eyebrow">
                  利用可能な素材候補（
                  {suggestionResponse.data.diagnostics.candidateCount}件）
                </p>
                {visualSuggestionStale ? (
                  <p className="status-message">
                    候補を採用したためプロジェクト版が更新されました。残りの候補は無効です。再生成してください。
                  </p>
                ) : null}
                {suggestionResponse.data.candidates.length === 0 ? (
                  <p className="status-message">候補なし</p>
                ) : (
                  <ul className="asset-candidate-list">
                    {suggestionResponse.data.candidates.map((candidate) => {
                      const decision =
                        candidateDecisionByAssetId[candidate.asset.assetId];
                      return (
                        <li key={candidate.asset.assetId}>
                          <strong>{candidate.asset.title}</strong>（
                          {assetKindLabel(candidate.asset.kind)}）
                          <span>
                            タグ：{" "}
                            {candidate.asset.tags
                              .map((tag) => tag.canonicalName)
                              .join("、") || "なし"}
                          </span>
                          <span>
                            {candidate.matchReasons
                              .map(visualMatchReasonLabel)
                              .join(" / ")}
                          </span>
                          {decision === "accepted" ? (
                            <span className="status-message">採用済み</span>
                          ) : null}
                          {decision === "rejected" ? (
                            <span className="status-message">却下済み</span>
                          ) : null}
                          {decision === "stale" ? (
                            <span className="status-message">古い候補</span>
                          ) : null}
                          <button
                            className="button button-small"
                            type="button"
                            disabled={
                              visualMutationPending || decision !== undefined
                            }
                            onClick={() =>
                              void assignVisualCandidate(
                                candidate.asset,
                                suggestionResponse.data.runId
                              )
                            }
                          >
                            この素材を採用して割り当て
                          </button>
                          <button
                            className="button button-small"
                            type="button"
                            disabled={
                              visualMutationPending || decision !== undefined
                            }
                            onClick={() =>
                              void rejectVisualCandidate(
                                candidate.asset.assetId
                              )
                            }
                          >
                            この候補を却下
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}
          </section>

          <section
            className="asset-search-panel"
            aria-labelledby="asset-search-title"
          >
            <p className="eyebrow">手順3-3 素材検索</p>
            <h2 id="asset-search-title">素材をキーワードやタグで探す</h2>
            <form onSubmit={runAssetSearch}>
              <div className="form-field-group">
                <div className="form-field">
                  <label htmlFor="asset-search-query">キーワード</label>
                  <input
                    id="asset-search-query"
                    value={assetSearchQuery}
                    onChange={(event) =>
                      setAssetSearchQuery(event.target.value)
                    }
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="asset-search-tag-ids">
                    タグ識別子（カンマまたは空白で区切る）
                  </label>
                  <input
                    id="asset-search-tag-ids"
                    value={assetSearchTagIds}
                    onChange={(event) =>
                      setAssetSearchTagIds(event.target.value)
                    }
                    placeholder="例：tag-daily tag-inspection"
                  />
                </div>
                <button
                  className="button"
                  type="submit"
                  disabled={assetSearchMutation.isPending}
                >
                  {assetSearchMutation.isPending ? "検索中…" : "通常検索"}
                </button>
              </div>
            </form>
            {assetSearchError !== null ? (
              <p className="form-error" role="alert">
                {getErrorMessage(assetSearchError, "素材検索に失敗しました。")}
              </p>
            ) : null}
            {assetSearchResult !== null ? (
              assetSearchResult.items.length === 0 ? (
                <p className="status-message">候補なし</p>
              ) : (
                <ul className="asset-candidate-list">
                  {assetSearchResult.items.map((asset) => (
                    <li key={asset.assetId}>
                      <strong>{asset.title}</strong>（
                      {assetKindLabel(asset.kind)}）
                      <span>
                        {asset.tags
                          .map((tag) => tag.canonicalName)
                          .join("、") || "タグなし"}
                      </span>
                      <button
                        className="button button-small"
                        type="button"
                        disabled={visualMutationPending}
                        onClick={() => void assignVisualCandidate(asset)}
                      >
                        この素材を割り当て
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </section>

          {visualError !== null ? (
            <section className="message-panel message-panel-error" role="alert">
              <h2>ビジュアル設定を保存できません</h2>
              <p>
                {getErrorMessage(
                  visualError,
                  "入力内容または素材の状態を確認してください。"
                )}
              </p>
              {errorDetails(visualError).length > 0 ? (
                <ul>
                  {errorDetails(visualError).map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
              {visualError instanceof ApiClientError &&
              visualError.status === 409 ? (
                <p>
                  競合のため、入力中の表示設定は保持しています。最新データで上書きしません。
                </p>
              ) : null}
            </section>
          ) : null}

          {visualSaveState === "saved" ? (
            <p className="status-message" role="status">
              ビジュアル設定を保存済みです（更新番号 {revisionRef.current}）。
            </p>
          ) : null}

          <VisualAssignmentPanel
            project={project}
            assets={assignmentAssets}
            focusLineId={selectedVisualLine?.id}
            onSave={saveVisualAssignment}
            onRemove={removeVisualAssignment}
            isMutating={visualMutationPending}
          />
        </aside>
        <div className="script-production-main">
          <form className="bulk-paste-panel" onSubmit={pasteLines}>
            <div>
              <h2>話者付きテキストの一括貼り付け</h2>
              <p>
                1行に1セリフを入力し、話者名と本文を半角または全角のコロンで区切ります。
              </p>
            </div>
            <div className="form-field">
              <label htmlFor="bulk-script-section">追加先セクション</label>
              <select
                id="bulk-script-section"
                value={bulkSectionIndex}
                onChange={(event) =>
                  setBulkSectionIndex(Number(event.target.value))
                }
              >
                {draft.sections.map((section, index) => (
                  <option key={section.id} value={index}>
                    {section.name}（{section.id}）
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="bulk-script-text">貼り付ける台本本文</label>
              <textarea
                id="bulk-script-text"
                rows={5}
                value={bulkText}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setBulkText(event.target.value)
                }
                placeholder="四国めたん：最初に申請画面を開きます。\nずんだもん: 右上の新規作成を押すのだ。"
              />
            </div>
            {bulkErrors.length > 0 ? (
              <ul className="form-error" role="alert">
                {bulkErrors.map((error) => (
                  <li key={`${error.lineNumber}-${error.message}`}>
                    {error.lineNumber}行目: {error.message}
                  </li>
                ))}
              </ul>
            ) : null}
            <button className="button" type="submit">
              セリフカードへ追加
            </button>
          </form>

          <section className="script-section-list" aria-label="台本セクション">
            {draft.sections.map((section, sectionIndex) => (
              <section className="script-section-card" key={section.id}>
                <header className="script-section-header">
                  <div>
                    <p className="eyebrow">セクション</p>
                    <h2>{section.name}</h2>
                    <code>
                      {section.id} / 構成案ID: {section.outlineSectionId}
                    </code>
                  </div>
                  <button
                    className="button"
                    type="button"
                    onClick={() => addLine(sectionIndex)}
                  >
                    セリフを追加
                  </button>
                </header>
                {section.lines.length === 0 ? (
                  <p className="status-message">セリフはまだありません。</p>
                ) : (
                  <div className="script-line-list">
                    {section.lines.map((line, lineIndex) => (
                      <ScriptLineCard
                        key={line.id}
                        line={line}
                        sectionIndex={sectionIndex}
                        lineIndex={lineIndex}
                        project={project}
                        assignmentAssets={assignmentAssets}
                        isVisualSelected={selectedVisualLineId === line.id}
                        issues={issues}
                        voiceStatus={voiceStatusByLine.get(line.id)}
                        voiceGenerationDisabled={
                          voiceGenerationDisabled || issues.length > 0
                        }
                        voiceAvailable={
                          voiceStatusQuery.data?.available === true
                        }
                        projectId={project.metadata.id}
                        onChange={(update) =>
                          updateLine(sectionIndex, lineIndex, update)
                        }
                        onMove={(direction) =>
                          updateDraft(
                            moveScriptLine(
                              draft,
                              sectionIndex,
                              lineIndex,
                              direction
                            )
                          )
                        }
                        onDuplicate={() =>
                          updateDraft(
                            duplicateScriptLine(draft, sectionIndex, lineIndex)
                          )
                        }
                        onDelete={() =>
                          updateDraft(
                            deleteScriptLine(draft, sectionIndex, lineIndex)
                          )
                        }
                        onGenerateVoice={() =>
                          void generateVoiceLine(section.id, line.id)
                        }
                        onSelectVisualRange={() =>
                          selectVisualRange(section.id, line.id)
                        }
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </section>
        </div>
      </div>
    </main>
  );
}
