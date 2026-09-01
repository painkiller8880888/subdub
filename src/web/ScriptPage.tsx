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
  ScreenTemplateDetail,
  ScreenTemplateSummary,
  VoiceLineGenerationStatus
} from "../schema/api.js";
import type {
  AssetListItem,
  AssetDetail,
  CharacterVisualCatalogSnapshot,
  CharacterVisualSet,
  LineOverlay,
  Script,
  ScriptLine,
  ScriptSection,
  VideoProject,
  VisualAssignment,
  VisualPlaybackCue
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchCharacterVisualCatalog,
  fetchAsset,
  fetchProject,
  fetchProjectManifest,
  fetchProjectVoiceStatus,
  fetchScreenTemplate,
  fetchScreenTemplates,
  assignProjectVisual,
  generateAllProjectVoice,
  generateProjectVoice,
  searchAssets,
  saveProjectLineOverlays,
  saveProjectScript,
  splitProjectVisualAssignment,
  updateProjectVisualAssignment
} from "./lib/api-client";
import {
  AutosaveCoordinator,
  navigateAfterAutosave,
  type AutosaveState
} from "./brief-autosave";
import {
  appendScriptLines,
  cloneScript,
  createScriptLineLocator,
  createDefaultScriptLine,
  deleteScriptLine,
  duplicateScriptLine,
  isProjectContextCurrent,
  moveScriptLine,
  parseBulkScript,
  reconcileScriptLineIdsWithMap,
  resolveScriptLineId,
  updateScriptSection,
  updateScriptLine,
  validateScriptDraft,
  type BulkPasteError,
  type ScriptDraftIssue
} from "./script-editor";
import { CharacterVisualPickerModal } from "./CharacterVisualPicker";
import { LineOverlayEditor } from "./LineOverlayEditor";
import { VoiceAdjustmentEditor } from "./VoiceAdjustmentEditor";
import { visualAssignmentsPath } from "./VisualAssignmentsPage";
import {
  ScriptMediaAssetPicker,
  ScriptMediaDialog,
  ScriptMediaPane,
  type ScriptMediaPickerAction
} from "./ScriptMediaPane";
import { WorkflowIndicator } from "./WorkflowIndicator";
import { ScreenLayoutFrame } from "../remotion/screen-template-layout";
import { createProjectManifestAssetUrlResolver } from "./preview-asset-url";
import {
  addVisualPlaybackCue,
  assignmentInput,
  defaultDisplayForAsset,
  isSelectableGenericVisualAsset,
  nextVisualAssignmentId,
  playbackCuesOutsideRange,
  removePlaybackCuesOutsideRange,
  replacementDisplayForAsset,
  type SelectableGenericVisualAsset
} from "./visual-assignment-editor";
import { replaceLineOverlays } from "./line-overlay-editor";
import {
  previewLineKey,
  projectAssetVersion,
  resolveScriptLineScreenPreview,
  resolveScriptLinePreviewStates,
  resolveScriptScreenTemplate,
  screenPreviewAssetKey,
  screenTemplateIdsForScript,
  type ResolvedScriptScreenTemplate,
  type ScriptLinePreviewState
} from "./screen-template-preview";

function charactersPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/characters`;
}

function editPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/edit`;
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

function errorDetails(error: unknown): string[] {
  if (!(error instanceof ApiClientError)) {
    return [];
  }
  return error.details.map(
    (detail) => `${detail.path.join(".") || "script"}: ${detail.message}`
  );
}

function scriptStatusLabel(): string {
  return "編集中";
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

function screenTemplateReferenceMessage(
  resolved: ResolvedScriptScreenTemplate
): string | null {
  switch (resolved.status) {
    case "missing":
      return `未解決: ${resolved.templateId}`;
    case "inactive":
      return `非アクティブ: ${resolved.templateId}`;
    case "loading":
      return "テンプレートを読み込み中…";
    default:
      return null;
  }
}

function screenTemplateName(
  resolved: ResolvedScriptScreenTemplate,
  activeTemplates: readonly ScreenTemplateSummary[]
): string {
  return (
    resolved.template?.name ??
    activeTemplates.find(
      (template) => template.templateId === resolved.templateId
    )?.name ??
    resolved.templateId
  );
}

function screenTemplateStatusIsSelectable(
  resolved: ResolvedScriptScreenTemplate
): boolean {
  return resolved.status === "ready";
}

function sectionBackgroundSummary(
  background: ScriptSection["background"]
): string {
  return background.kind === "solid"
    ? "単色（background）"
    : `${background.src}（${background.fit}）`;
}

function projectAudioUrl(
  projectId: string,
  audioPath: string | undefined
): string | undefined {
  return audioPath === undefined
    ? undefined
    : createProjectManifestAssetUrlResolver(projectId)(audioPath);
}

type VoiceIndicator = Readonly<{
  readonly state:
    | "current"
    | "stale"
    | "needs_review"
    | "generating"
    | "failed"
    | "missing"
    | "unavailable"
    | "loading";
  readonly label: string;
  readonly accessibleLabel: string;
}>;

function voiceIndicatorForLine(
  status: VoiceLineGenerationStatus | undefined,
  available: boolean,
  loading: boolean
): VoiceIndicator {
  if (loading) {
    return {
      state: "loading",
      label: "確認中",
      accessibleLabel: "音声状態を確認中"
    };
  }
  if (status !== undefined) {
    return {
      state: status.status,
      label: voiceStatusLabel(status.status),
      accessibleLabel: `音声状態: ${voiceStatusLabel(status.status)}`
    };
  }
  if (!available) {
    return {
      state: "unavailable",
      label: "利用不可",
      accessibleLabel: "音声サービスを利用できません"
    };
  }
  return {
    state: "missing",
    label: "未生成",
    accessibleLabel: "音声がありません"
  };
}

function visualForLine(
  project: VideoProject,
  catalog: CharacterVisualCatalogSnapshot | undefined,
  line: ScriptLine
): {
  character: VideoProject["characters"][number] | undefined;
  visual: CharacterVisualSet | undefined;
} {
  const character = project.characters.find(
    (candidate) => candidate.id === line.speakerId
  );
  const visualId = character?.characterVisual.visualId;
  const visual =
    visualId === null || visualId === undefined
      ? undefined
      : catalog?.find((candidate) => candidate.visualId === visualId);
  return { character, visual };
}

function ScriptLineCard({
  line,
  sectionIndex,
  lineIndex,
  project,
  catalog,
  catalogUnavailable,
  previewState,
  linePreview,
  issues,
  voiceStatus,
  voiceStatusLoading,
  voiceGenerationDisabled,
  voiceAvailable,
  projectId,
  assets,
  onChange,
  onMove,
  onDuplicate,
  onDelete,
  onGenerateVoice,
  onOpenOverlayEditor,
  onOpenPicker,
  onStartMedia,
  onPauseMedia,
  onResumeMedia,
  onEndMedia,
  onReplaceMedia,
  onSplitMedia,
  mediaMutationPending
}: {
  readonly line: ScriptLine;
  readonly sectionIndex: number;
  readonly lineIndex: number;
  readonly project: VideoProject;
  readonly catalog: CharacterVisualCatalogSnapshot | undefined;
  readonly catalogUnavailable: boolean;
  readonly previewState: ScriptLinePreviewState;
  readonly linePreview: ReturnType<typeof resolveScriptLineScreenPreview>;
  readonly issues: readonly ScriptDraftIssue[];
  readonly voiceStatus: VoiceLineGenerationStatus | undefined;
  readonly voiceStatusLoading: boolean;
  readonly voiceGenerationDisabled: boolean;
  readonly voiceAvailable: boolean;
  readonly projectId: string;
  readonly assets: ReadonlyMap<string, AssetDetail | undefined>;
  readonly onChange: (update: Partial<ScriptLine>) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onGenerateVoice: () => void;
  readonly onOpenOverlayEditor: () => void;
  readonly onOpenPicker: () => void;
  readonly onStartMedia: () => void;
  readonly onPauseMedia: (assignmentId: string) => void;
  readonly onResumeMedia: (assignmentId: string) => void;
  readonly onEndMedia: (assignmentId: string) => void;
  readonly onReplaceMedia: (assignmentId: string) => void;
  readonly onSplitMedia: (assignmentId: string) => void;
  readonly mediaMutationPending: boolean;
}) {
  const lineIssues = lineIssueText(issues, sectionIndex, lineIndex);
  const { visual } = visualForLine(project, catalog, line);
  const { mode, resolvedTemplate } = previewState;
  const [expandedTextField, setExpandedTextField] = useState<
    "subtitle" | "spoken" | null
  >(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const numberValue = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";
  const visualButtonDisabled =
    catalogUnavailable || visual === undefined || visual.status !== "active";
  const templateReferenceError =
    screenTemplateReferenceMessage(resolvedTemplate);
  const audioUrl =
    voiceStatus?.status === "current"
      ? projectAudioUrl(projectId, voiceStatus.audioPath)
      : undefined;
  const voiceIndicator = voiceIndicatorForLine(
    voiceStatus,
    voiceAvailable,
    voiceStatusLoading
  );

  useEffect(() => {
    audioRef.current?.pause();
    setAudioPlaying(false);
  }, [audioUrl]);

  function playCurrentVoice(): void {
    const audio = audioRef.current;
    if (audio === null) {
      return;
    }
    if (audio.paused) {
      void audio.play().catch(() => setAudioPlaying(false));
    } else {
      audio.pause();
    }
  }

  function textRow(
    field: "subtitle" | "spoken",
    label: string,
    value: string,
    onChange: (value: string) => void
  ) {
    const expanded = expandedTextField === field;
    return (
      <div
        className={`script-line-text-row${
          expanded ? " script-line-text-row-expanded" : ""
        }`}
      >
        <label htmlFor={`${line.id}-${field}`}>{label}</label>
        <textarea
          aria-label={`${line.id}の${label}`}
          className="script-line-text-input"
          id={`${line.id}-${field}`}
          rows={expanded ? 4 : 1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setExpandedTextField(field)}
          onBlur={() => setExpandedTextField(null)}
        />
      </div>
    );
  }

  return (
    <article className="script-line-card" aria-label={`セリフ ${line.id}`}>
      <div className="script-line-card-layout">
        <aside
          aria-label={`${line.id}の画面プレビュー`}
          className="script-line-card-preview"
        >
          <button
            aria-label={`${line.id}のオーバーレイを編集`}
            className="script-line-card-preview-trigger"
            type="button"
            onClick={onOpenOverlayEditor}
          >
            {resolvedTemplate.status === "ready" &&
            resolvedTemplate.template !== undefined ? (
              <ScreenLayoutFrame
                ariaLabel={
                  mode === "full-screen"
                    ? `${line.id}の16対9画面プレビュー`
                    : `${line.id}の字幕コンパクトプレビュー`
                }
                className={`script-line-card-screen-preview${
                  mode === "full-screen"
                    ? " script-line-card-full-preview"
                    : " script-line-card-dialogue-preview"
                }`}
                mode={mode === "full-screen" ? "full" : "dialogue-only"}
                preview={linePreview}
                template={resolvedTemplate.template}
              />
            ) : (
              <div
                aria-label={
                  templateReferenceError ?? "画面テンプレートを読み込み中"
                }
                className="script-line-card-preview-state"
                role="img"
              >
                <strong>
                  {templateReferenceError ?? "テンプレートを読み込み中…"}
                </strong>
                {templateReferenceError !== null ? (
                  <span>activeなテンプレートを選び直してください。</span>
                ) : null}
              </div>
            )}
          </button>
        </aside>

        <div className="script-line-card-editor">
          <div className="script-line-primary-row">
            <div className="script-line-identity">
              <span className="eyebrow">セリフID</span>
              <code>{line.id}</code>
            </div>

            <div className="script-line-primary-controls">
              <div className="form-field script-line-speaker-field">
                <select
                  aria-label={`${line.id}の話者`}
                  id={`${line.id}-speaker`}
                  value={line.speakerId}
                  onChange={(event) =>
                    onChange({
                      speakerId: event.target.value,
                      characterVariantId: null
                    })
                  }
                >
                  {project.characters.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>

              <div
                aria-label={`${line.id}のキャラクタービジュアル設定`}
                className="script-line-visual-control"
              >
                <button
                  aria-label={`${line.id}のビジュアルを変更`}
                  className="button button-small"
                  type="button"
                  disabled={visualButtonDisabled}
                  onClick={onOpenPicker}
                >
                  ビジュアルを変更
                </button>
              </div>

              <div className="script-line-audio-control" aria-label="音声操作">
                <span
                  aria-label={voiceIndicator.accessibleLabel}
                  className={`voice-status voice-status-${voiceIndicator.state}`}
                  title={voiceIndicator.accessibleLabel}
                >
                  {voiceIndicator.label}
                </span>
                {audioUrl !== undefined ? (
                  <audio
                    aria-hidden="true"
                    preload="none"
                    ref={audioRef}
                    src={audioUrl}
                    tabIndex={-1}
                    onEnded={() => setAudioPlaying(false)}
                    onPause={() => setAudioPlaying(false)}
                    onPlay={() => setAudioPlaying(true)}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="script-line-audio-missing"
                  />
                )}
                <button
                  aria-label={`${line.id}の音声を再生`}
                  aria-pressed={audioPlaying}
                  className="button button-small"
                  disabled={audioUrl === undefined}
                  type="button"
                  onClick={playCurrentVoice}
                >
                  再生
                </button>
                <button
                  aria-label={`${line.id}の音声を再生成`}
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
                  {voiceStatus?.status === "generating" ? "生成中…" : "再生成"}
                </button>
              </div>

              <VoiceAdjustmentEditor
                projectId={projectId}
                line={line}
                voiceAvailable={voiceAvailable}
              />

              {lineIssues.length > 0 ? (
                <span className="script-line-validation-error" role="alert">
                  入力エラー {lineIssues.length}件
                </span>
              ) : null}
            </div>
          </div>

          {textRow("subtitle", "字幕", line.subtitleText, (value) =>
            onChange({ subtitleText: value })
          )}
          {textRow("spoken", "読み上げ", line.spokenText, (value) =>
            onChange({ spokenText: value })
          )}

          <div className="script-line-action-row">
            <button
              aria-controls={`${line.id}-details-dialog`}
              aria-expanded={detailsOpen}
              aria-haspopup="dialog"
              className="button button-small"
              type="button"
              onClick={() => setDetailsOpen(true)}
            >
              詳細設定
            </button>
            <div className="script-line-actions">
              <button
                className="button button-small"
                type="button"
                onClick={() => onMove("up")}
                disabled={lineIndex === 0}
              >
                上へ移動
              </button>
              <button
                className="button button-small"
                type="button"
                onClick={() => onMove("down")}
                disabled={
                  lineIndex ===
                  (project.script.sections[sectionIndex]?.lines.length ?? 1) - 1
                }
              >
                下へ移動
              </button>
              <button
                className="button button-small"
                type="button"
                onClick={onDuplicate}
              >
                複製
              </button>
              <button
                className="button button-small"
                type="button"
                onClick={onDelete}
              >
                削除
              </button>
            </div>
          </div>

          {detailsOpen ? (
            <ScriptMediaDialog
              className="script-line-details-dialog"
              dialogId={`${line.id}-details-dialog`}
              describedById={`${line.id}-details-description`}
              onClose={() => setDetailsOpen(false)}
              titleId={`${line.id}-details-title`}
            >
              <header className="script-line-details-dialog-header">
                <div>
                  <p className="eyebrow">詳細設定</p>
                  <h2 id={`${line.id}-details-title`}>
                    セリフ {line.id}の詳細設定
                  </h2>
                  <p id={`${line.id}-details-description`}>
                    表情と発話前後の間を設定します。
                  </p>
                </div>
                <button
                  className="button button-small"
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                >
                  閉じる
                </button>
              </header>
              <div className="script-line-secondary-fields">
                <div className="form-field">
                  <label htmlFor={`${line.id}-expression`}>
                    表情（表示選択には影響しません）
                  </label>
                  <select
                    id={`${line.id}-expression`}
                    value={line.expression}
                    onChange={(event) =>
                      onChange({
                        expression: event.target
                          .value as ScriptLine["expression"]
                      })
                    }
                  >
                    <option value="neutral">通常</option>
                    <option value="smile">喜び</option>
                    <option value="explain">説明</option>
                    <option value="caution">注意</option>
                  </select>
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
                  <label htmlFor={`${line.id}-pause-after`}>
                    発話後の間（ミリ秒）
                  </label>
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
              {lineIssues.length > 0 ? (
                <ul className="form-error script-line-errors" role="alert">
                  {lineIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : null}
            </ScriptMediaDialog>
          ) : null}
        </div>

        <ScriptMediaPane
          assignments={previewState.assignments}
          assets={assets}
          isPending={mediaMutationPending}
          line={line}
          onEnd={onEndMedia}
          onPause={onPauseMedia}
          onReplace={onReplaceMedia}
          onSplit={onSplitMedia}
          onResume={onResumeMedia}
          onStart={onStartMedia}
          presentationStates={
            previewState.persistentScreenState.visualPresentationState
          }
        />
      </div>
    </article>
  );
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

function findLineLocation(
  script: Script,
  lineId: string
): { sectionIndex: number; lineIndex: number } | undefined {
  for (const [sectionIndex, section] of script.sections.entries()) {
    const lineIndex = section.lines.findIndex((line) => line.id === lineId);
    if (lineIndex >= 0) {
      return { sectionIndex, lineIndex };
    }
  }
  return undefined;
}

type MediaLineReference = Readonly<{
  sectionId: string;
  lineId: string;
}>;

type MediaPickerState = Readonly<{
  action: ScriptMediaPickerAction;
  line: MediaLineReference;
  assignmentId?: string;
}>;

type MediaRangeConfirmation = Readonly<{
  assignmentId: string;
  line: MediaLineReference;
  outsideCues: readonly VisualPlaybackCue[];
}>;

type MediaSplitConfirmation = Readonly<{
  assignmentId: string;
  line: MediaLineReference;
  asset: SelectableGenericVisualAsset;
  replacementAssignmentId: string;
  outsideCues: readonly VisualPlaybackCue[];
}>;

type MediaKindChangeConfirmation = Readonly<{
  assignmentId: string;
  asset: SelectableGenericVisualAsset;
  fromKind: VisualAssignment["display"]["kind"];
  toKind: VisualAssignment["display"]["kind"];
}>;

type MediaMutationInput =
  | {
      kind: "create";
      projectId: string;
      projectGeneration: number;
      input: Parameters<typeof assignProjectVisual>[1];
    }
  | {
      kind: "update";
      projectId: string;
      assignmentId: string;
      projectGeneration: number;
      input: Parameters<typeof updateProjectVisualAssignment>[2];
    }
  | {
      kind: "split";
      projectId: string;
      assignmentId: string;
      projectGeneration: number;
      input: Parameters<typeof splitProjectVisualAssignment>[2];
    };

const scriptMediaAssetKinds = ["video", "photo", "document_scan"] as const;

function visualDisplayKindLabel(
  kind: VisualAssignment["display"]["kind"]
): string {
  switch (kind) {
    case "video":
      return "動画";
    case "photo":
      return "写真";
    case "document_scan":
      return "帳票スキャン";
  }
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
  const manifestQuery = useQuery({
    queryKey: ["projects", projectId, "manifest"],
    queryFn: () => fetchProjectManifest(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const catalogQuery = useQuery({
    queryKey: ["character-visuals"],
    queryFn: fetchCharacterVisualCatalog,
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
  const [draft, setDraft] = useState<Script | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    status: "idle",
    error: undefined
  });
  const [bulkSectionIndex, setBulkSectionIndex] = useState(0);
  const [bulkText, setBulkText] = useState("");
  const [bulkErrors, setBulkErrors] = useState<BulkPasteError[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [voiceError, setVoiceError] = useState<unknown>(null);
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [mediaPicker, setMediaPicker] = useState<MediaPickerState | null>(null);
  const [mediaPickerSearch, setMediaPickerSearch] = useState("");
  const [mediaError, setMediaError] = useState<unknown>(null);
  const [mediaRangeConfirmation, setMediaRangeConfirmation] =
    useState<MediaRangeConfirmation | null>(null);
  const [mediaSplitConfirmation, setMediaSplitConfirmation] =
    useState<MediaSplitConfirmation | null>(null);
  const [mediaKindChangeConfirmation, setMediaKindChangeConfirmation] =
    useState<MediaKindChangeConfirmation | null>(null);
  const [mediaActionPending, setMediaActionPending] = useState(false);
  const [overlayEditorLineId, setOverlayEditorLineId] = useState<string | null>(
    null
  );
  const [overlayError, setOverlayError] = useState<unknown>(null);
  const projectIdRef = useRef(projectId ?? "");
  const projectGenerationRef = useRef(0);
  const revisionRef = useRef(0);
  const draftRef = useRef<Script | null>(null);
  const lastSavedRef = useRef<Script | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<Script> | null>(null);
  const mediaActionPendingRef = useRef(false);
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<Script> | null>(null);

  const screenTemplateSource = draft ?? projectQuery.data?.script;
  const selectedTemplateIds =
    screenTemplateSource === undefined
      ? []
      : screenTemplateIdsForScript(screenTemplateSource);
  const screenTemplatesQuery = useQuery({
    queryKey: ["screen-templates", { status: "active" }],
    queryFn: () => fetchScreenTemplates({ status: "active" }),
    enabled: projectId !== undefined,
    retry: false
  });
  const templateDetailQueries = useQueries({
    queries: selectedTemplateIds.map((templateId) => ({
      queryKey: ["screen-template", templateId],
      queryFn: () => fetchScreenTemplate(templateId),
      retry: false
    }))
  });
  const assetReferences = [
    ...new Map(
      (projectQuery.data?.visuals.assignments ?? []).map((assignment) => {
        const key = screenPreviewAssetKey(assignment);
        return [
          key,
          {
            assetId: assignment.assetId,
            key,
            version: projectAssetVersion(assignment.projectMediaPath)
          }
        ];
      })
    ).values()
  ];
  const assetQueries = useQueries({
    queries: assetReferences.map((reference) => ({
      queryKey: ["assets", reference.key],
      queryFn: () => fetchAsset(reference.assetId, reference.version),
      retry: false
    }))
  });
  const mediaPickerQueries = useQueries({
    queries: scriptMediaAssetKinds.map((kind) => ({
      queryKey: ["assets", "script-media-picker", kind, mediaPickerSearch],
      queryFn: () =>
        searchAssets({
          q: mediaPickerSearch,
          kind,
          status: "active",
          page: 1,
          pageSize: 100
        }),
      enabled: projectId !== undefined && mediaPicker !== null,
      retry: false
    }))
  });

  const saveMutation = useMutation({
    mutationFn: ({
      projectId: savingProjectId,
      script,
      expectedRevision
    }: {
      projectId: string;
      script: Script;
      expectedRevision: number;
    }) => saveProjectScript(savingProjectId, { script, expectedRevision }),
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  const mediaMutation = useMutation({
    mutationFn: (input: MediaMutationInput) =>
      input.kind === "create"
        ? assignProjectVisual(input.projectId, input.input)
        : input.kind === "split"
          ? splitProjectVisualAssignment(
              input.projectId,
              input.assignmentId,
              input.input
            )
          : updateProjectVisualAssignment(
              input.projectId,
              input.assignmentId,
              input.input
            ),
    onSuccess: (project, variables) => {
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
      updateMutationCaches(project);
      revisionRef.current = project.revision;
      setMediaError(null);
    },
    retry: false
  });

  const lineOverlayMutation = useMutation({
    mutationFn: ({
      projectId: savingProjectId,
      overlays,
      expectedRevision
    }: {
      projectId: string;
      projectGeneration: number;
      overlays: readonly LineOverlay[];
      expectedRevision: number;
    }) =>
      saveProjectLineOverlays(savingProjectId, {
        overlays: { lineOverlays: [...overlays] },
        expectedRevision
      }),
    onSuccess: (savedProject, variables) => {
      if (
        isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          variables.projectId,
          variables.projectGeneration
        )
      ) {
        updateMutationCaches(savedProject);
        revisionRef.current = savedProject.revision;
        setOverlayEditorLineId(null);
        setOverlayError(null);
      }
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
        setOverlayError(error);
      }
    },
    retry: false
  });

  const generateVoiceMutation = useMutation({
    mutationFn: ({
      projectId: savingProjectId,
      lineId
    }: {
      projectId: string;
      lineId: string;
    }) => generateProjectVoice(savingProjectId, { lineIds: [lineId] }),
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
    mutationFn: (savingProjectId: string) =>
      generateAllProjectVoice(savingProjectId),
    onSuccess: () => {
      setVoiceError(null);
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    onError: setVoiceError,
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
    lastSavedRef.current = cloneScript(project.script);
    setDraft(nextDraft);
    setBulkSectionIndex(0);
    setPickerLineId(null);
    setPickerError(null);
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
    const reconciliation = reconcileScriptLineIdsWithMap(
      nextDraft,
      project.script,
      latestDraft
    );
    const reconciledDraft = {
      ...reconciliation.script
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
    draftRef.current = null;
    lastSavedRef.current = null;
    revisionRef.current = 0;
    setDraft(null);
    setBulkText("");
    setBulkErrors([]);
    setVoiceError(null);
    setPickerLineId(null);
    setPickerError(null);
    setMediaPicker(null);
    setMediaPickerSearch("");
    setMediaError(null);
    setMediaRangeConfirmation(null);
    setMediaSplitConfirmation(null);
    setMediaKindChangeConfirmation(null);
    setOverlayEditorLineId(null);
    setOverlayError(null);
    coordinator.reset();
  }, [coordinator, projectId]);

  useEffect(() => {
    if (
      projectId === undefined ||
      coordinator === null ||
      projectQuery.data === undefined ||
      projectQuery.isError
    ) {
      return;
    }
    revisionRef.current = projectQuery.data.revision;
    adoptProject(projectQuery.data);
  }, [coordinator, projectId, projectQuery.data, projectQuery.isError]);

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
    adoptProject(result.data);
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

  function updateDraft(nextDraft: Script): void {
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    coordinatorRef.current?.update(nextDraft);
  }

  function updateLine(
    sectionIndex: number,
    lineIndex: number,
    update: Partial<ScriptLine>
  ): void {
    const currentDraft = draftRef.current;
    if (currentDraft !== null) {
      updateDraft(
        updateScriptLine(currentDraft, sectionIndex, lineIndex, update)
      );
    }
  }

  function updateSectionTemplate(
    sectionIndex: number,
    templateId: string
  ): void {
    const currentDraft = draftRef.current;
    if (currentDraft === null) {
      return;
    }
    updateDraft(
      updateScriptSection(currentDraft, sectionIndex, {
        screenTemplateId: templateId
      })
    );
  }

  function addLine(sectionIndex: number): void {
    const currentDraft = draftRef.current;
    const speakerId = projectQuery.data?.characters[0]?.id;
    if (currentDraft === null || speakerId === undefined) {
      return;
    }
    updateDraft(
      appendScriptLines(currentDraft, sectionIndex, [
        createDefaultScriptLine(speakerId, nextTemporaryLineId(currentDraft))
      ])
    );
  }

  function pasteLines(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const currentDraft = draftRef.current;
    const project = projectQuery.data;
    if (currentDraft === null || project === undefined) {
      return;
    }
    const result = parseBulkScript(bulkText, project.characters);
    if (!result.ok) {
      setBulkErrors(result.errors);
      return;
    }
    const usedIds = new Set(
      currentDraft.sections.flatMap((section) =>
        section.lines.map((line) => line.id)
      )
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
    updateDraft(appendScriptLines(currentDraft, bulkSectionIndex, lines));
    setBulkText("");
    setBulkErrors([]);
  }

  function openVisualPicker(lineId: string): void {
    if (catalogQuery.isPending || catalogQuery.isError) {
      setPickerError("キャラクタービジュアルのカタログを確認できません。");
      return;
    }
    const currentDraft = draftRef.current;
    const project = projectQuery.data;
    const location =
      currentDraft === null
        ? undefined
        : findLineLocation(currentDraft, lineId);
    const line =
      currentDraft === null || location === undefined
        ? undefined
        : currentDraft.sections[location.sectionIndex]?.lines[
            location.lineIndex
          ];
    const visual =
      project === undefined || line === undefined
        ? undefined
        : visualForLine(project, catalogQuery.data, line).visual;
    if (visual === undefined || visual.status !== "active") {
      setPickerError(
        "話者のプロジェクト binding に有効なビジュアルセットがありません。キャラクター素材画面で設定してください。"
      );
      return;
    }
    setPickerError(null);
    setPickerLineId(lineId);
  }

  function selectVariant(variantId: string): void {
    const currentDraft = draftRef.current;
    if (currentDraft === null || pickerLineId === null) {
      return;
    }
    const location = findLineLocation(currentDraft, pickerLineId);
    if (location === undefined) {
      setPickerError("対象セリフが現在の台本から見つかりません。");
      return;
    }
    updateLine(location.sectionIndex, location.lineIndex, {
      characterVariantId: variantId
    });
    setPickerError(null);
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

  function latestProject(): VideoProject | undefined {
    return (
      queryClient.getQueryData<VideoProject>([
        "projects",
        projectIdRef.current
      ]) ?? projectQuery.data
    );
  }

  async function openLineOverlayEditor(
    sectionId: string,
    lineId: string
  ): Promise<void> {
    const draftScript = draftRef.current;
    const locator =
      draftScript === null
        ? undefined
        : createScriptLineLocator(draftScript, sectionId, lineId);
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      setOverlayError(
        new Error("台本を保存できないため注釈を編集できません。")
      );
      return;
    }
    const currentProject = latestProject();
    if (currentProject === undefined) {
      setOverlayError(
        new Error("プロジェクトを読み込んでから操作してください。")
      );
      return;
    }
    const resolvedLineId =
      locator === undefined
        ? currentProject.script.sections
            .find((section) => section.id === sectionId)
            ?.lines.find((line) => line.id === lineId)?.id
        : resolveScriptLineId(currentProject.script, locator);
    if (resolvedLineId === undefined) {
      setOverlayError(
        new Error("対象セリフを保存後の台本から解決できません。")
      );
      return;
    }
    setOverlayError(null);
    setOverlayEditorLineId(resolvedLineId);
  }

  function saveLineOverlayDraft(
    lineId: string,
    lineOverlays: readonly LineOverlay[]
  ): void {
    if (lineOverlayMutation.isPending) {
      return;
    }
    const currentProject = latestProject();
    if (currentProject === undefined) {
      setOverlayError(
        new Error("プロジェクトを読み込んでから保存してください。")
      );
      return;
    }
    setOverlayError(null);
    lineOverlayMutation.mutate({
      projectId: currentProject.metadata.id,
      projectGeneration: projectGenerationRef.current,
      overlays: replaceLineOverlays(
        currentProject.overlays.lineOverlays,
        lineId,
        lineOverlays
      ),
      expectedRevision: currentProject.revision
    });
  }

  function beginMediaAction(): boolean {
    if (mediaActionPendingRef.current || mediaMutation.isPending) {
      return false;
    }
    mediaActionPendingRef.current = true;
    setMediaActionPending(true);
    return true;
  }

  function endMediaAction(): void {
    mediaActionPendingRef.current = false;
    setMediaActionPending(false);
  }

  function closeMediaPicker(): void {
    if (mediaActionPendingRef.current || mediaMutation.isPending) {
      return;
    }
    setMediaPicker(null);
    setMediaPickerSearch("");
  }

  function openMediaPicker(
    line: MediaLineReference,
    action: ScriptMediaPickerAction,
    assignmentId?: string
  ): void {
    if (mediaActionPendingRef.current || mediaMutation.isPending) {
      return;
    }
    setMediaError(null);
    setMediaPickerSearch("");
    setMediaPicker({ action, line, assignmentId });
  }

  async function flushBeforeMediaMutation(
    errorMessage: string
  ): Promise<VideoProject | undefined> {
    const flushed = await coordinatorRef.current?.flush();
    if (flushed !== true) {
      setMediaError(new Error(errorMessage));
      return undefined;
    }
    const currentProject = latestProject();
    if (currentProject === undefined) {
      setMediaError(
        new Error("プロジェクトを読み込んでから操作してください。")
      );
      return undefined;
    }
    return currentProject;
  }

  function resolveMediaLineId(
    currentProject: VideoProject,
    line: MediaLineReference,
    locator: ReturnType<typeof createScriptLineLocator>
  ): string | undefined {
    return locator === undefined
      ? currentProject.script.sections
          .find((section) => section.id === line.sectionId)
          ?.lines.find((candidate) => candidate.id === line.lineId)?.id
      : resolveScriptLineId(currentProject.script, locator);
  }

  async function saveMediaAssignment(
    currentProject: VideoProject,
    assignment: VisualAssignment,
    assetVersion?: number
  ): Promise<boolean> {
    const requestProjectId = currentProject.metadata.id;
    const requestGeneration = projectGenerationRef.current;
    try {
      await mediaMutation.mutateAsync({
        kind: "update",
        projectId: requestProjectId,
        assignmentId: assignment.id,
        projectGeneration: requestGeneration,
        input: {
          expectedRevision: currentProject.revision,
          ...(assetVersion === undefined ? {} : { assetVersion }),
          assignment: assignmentInput(assignment)
        }
      });
      const isCurrent = isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        requestProjectId,
        requestGeneration
      );
      if (isCurrent) {
        setMediaRangeConfirmation(null);
        setMediaSplitConfirmation(null);
        setMediaKindChangeConfirmation(null);
      }
      return isCurrent;
    } catch (error) {
      if (
        isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          requestProjectId,
          requestGeneration
        )
      ) {
        setMediaError(error);
      }
      return false;
    }
  }

  async function submitSplitMediaAssignment(
    currentProject: VideoProject,
    line: MediaLineReference,
    selectedLineId: string,
    assignmentId: string,
    asset: SelectableGenericVisualAsset,
    replacementAssignmentId: string,
    removeOutsidePlaybackCues: boolean
  ): Promise<boolean> {
    const currentAssignment = currentProject.visuals.assignments.find(
      (candidate) => candidate.id === assignmentId
    );
    const section = currentProject.script.sections.find(
      (candidate) => candidate.id === line.sectionId
    );
    if (currentAssignment === undefined || section === undefined) {
      setMediaError(new Error("対象セリフまたは表示素材を解決できません。"));
      return false;
    }

    const displayResult =
      currentAssignment.startLineId === selectedLineId
        ? replacementDisplayForAsset(currentAssignment, asset)
        : defaultDisplayForAsset(asset);
    if (displayResult.display === undefined) {
      setMediaError(
        new Error(displayResult.reason ?? "切替用の表示設定を作成できません。")
      );
      return false;
    }

    const selectedIndex = section.lines.findIndex(
      (candidate) => candidate.id === selectedLineId
    );
    const previousLine = section.lines[selectedIndex - 1];
    const outsideCues =
      previousLine === undefined
        ? []
        : playbackCuesOutsideRange(currentAssignment, section, previousLine.id);
    const requestProjectId = currentProject.metadata.id;
    const requestGeneration = projectGenerationRef.current;
    try {
      await mediaMutation.mutateAsync({
        kind: "split",
        projectId: requestProjectId,
        assignmentId,
        projectGeneration: requestGeneration,
        input: {
          expectedRevision: currentProject.revision,
          selectedLineId,
          assetVersion: asset.version,
          removeOutsidePlaybackCues,
          assignment: {
            id: replacementAssignmentId,
            assetId: asset.assetId,
            display: displayResult.display
          }
        }
      });
      const isCurrent = isProjectContextCurrent(
        projectIdRef.current,
        projectGenerationRef.current,
        requestProjectId,
        requestGeneration
      );
      if (isCurrent) {
        setMediaPicker(null);
        setMediaPickerSearch("");
        setMediaSplitConfirmation(null);
        setMediaError(null);
      }
      return isCurrent;
    } catch (error) {
      if (
        isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          requestProjectId,
          requestGeneration
        ) &&
        error instanceof ApiClientError &&
        error.code ===
          "VISUAL_ASSIGNMENT_RANGE_SHORTENING_CONFIRMATION_REQUIRED" &&
        !removeOutsidePlaybackCues
      ) {
        setMediaSplitConfirmation({
          assignmentId,
          line: { sectionId: section.id, lineId: selectedLineId },
          asset,
          replacementAssignmentId,
          outsideCues
        });
        setMediaPicker(null);
        setMediaPickerSearch("");
        setMediaError(null);
        return false;
      }
      if (
        isProjectContextCurrent(
          projectIdRef.current,
          projectGenerationRef.current,
          requestProjectId,
          requestGeneration
        )
      ) {
        setMediaError(error);
      }
      return false;
    }
  }

  async function updateMediaAssignment(
    line: MediaLineReference,
    assignmentId: string,
    update: (
      assignment: VisualAssignment,
      resolvedLineId: string,
      currentProject: VideoProject
    ) => VisualAssignment
  ): Promise<void> {
    if (!beginMediaAction()) {
      return;
    }
    try {
      const draftScript = draftRef.current;
      const locator =
        draftScript === null
          ? undefined
          : createScriptLineLocator(draftScript, line.sectionId, line.lineId);
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、表示素材を変更できません。"
      );
      if (currentProject === undefined) {
        return;
      }
      const resolvedLineId = resolveMediaLineId(currentProject, line, locator);
      const currentAssignment = currentProject.visuals.assignments.find(
        (assignment) => assignment.id === assignmentId
      );
      if (resolvedLineId === undefined || currentAssignment === undefined) {
        setMediaError(new Error("対象セリフまたは表示素材を解決できません。"));
        return;
      }
      const nextAssignment = update(
        currentAssignment,
        resolvedLineId,
        currentProject
      );
      await saveMediaAssignment(currentProject, nextAssignment);
    } finally {
      endMediaAction();
    }
  }

  function pauseMedia(line: MediaLineReference, assignmentId: string): void {
    void updateMediaAssignment(line, assignmentId, (assignment, lineId) =>
      addVisualPlaybackCue(assignment, lineId, "pause")
    );
  }

  function resumeMedia(line: MediaLineReference, assignmentId: string): void {
    void updateMediaAssignment(line, assignmentId, (assignment, lineId) =>
      addVisualPlaybackCue(assignment, lineId, "resume")
    );
  }

  async function requestEndMedia(
    line: MediaLineReference,
    assignmentId: string
  ): Promise<void> {
    if (!beginMediaAction()) {
      return;
    }
    try {
      const draftScript = draftRef.current;
      const locator =
        draftScript === null
          ? undefined
          : createScriptLineLocator(draftScript, line.sectionId, line.lineId);
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、素材の終了位置を変更できません。"
      );
      if (currentProject === undefined) {
        return;
      }
      const resolvedLineId = resolveMediaLineId(currentProject, line, locator);
      const currentAssignment = currentProject.visuals.assignments.find(
        (assignment) => assignment.id === assignmentId
      );
      const section = currentProject.script.sections.find(
        (candidate) => candidate.id === line.sectionId
      );
      if (
        resolvedLineId === undefined ||
        currentAssignment === undefined ||
        section === undefined
      ) {
        setMediaError(new Error("対象セリフまたは表示素材を解決できません。"));
        return;
      }
      const outsideCues = playbackCuesOutsideRange(
        currentAssignment,
        section,
        resolvedLineId
      );
      if (outsideCues.length > 0) {
        setMediaRangeConfirmation({
          assignmentId,
          line: { sectionId: section.id, lineId: resolvedLineId },
          outsideCues
        });
        return;
      }
      await saveMediaAssignment(currentProject, {
        ...currentAssignment,
        endLineId: resolvedLineId
      });
    } finally {
      endMediaAction();
    }
  }

  async function confirmEndMedia(): Promise<void> {
    const confirmation = mediaRangeConfirmation;
    if (confirmation === null || !beginMediaAction()) {
      return;
    }
    try {
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、素材の終了位置を変更できません。"
      );
      if (currentProject === undefined) {
        return;
      }
      const assignment = currentProject.visuals.assignments.find(
        (candidate) => candidate.id === confirmation.assignmentId
      );
      const section = currentProject.script.sections.find(
        (candidate) => candidate.id === confirmation.line.sectionId
      );
      if (assignment === undefined || section === undefined) {
        setMediaError(new Error("終了対象の表示素材を解決できません。"));
        return;
      }
      const next = removePlaybackCuesOutsideRange(
        assignment,
        section,
        confirmation.line.lineId
      );
      await saveMediaAssignment(currentProject, next);
    } finally {
      endMediaAction();
    }
  }

  async function confirmSplitMedia(): Promise<void> {
    const confirmation = mediaSplitConfirmation;
    if (confirmation === null || !beginMediaAction()) {
      return;
    }
    try {
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、セリフ境界で素材を切り替えできません。"
      );
      if (currentProject === undefined) {
        return;
      }
      await submitSplitMediaAssignment(
        currentProject,
        confirmation.line,
        confirmation.line.lineId,
        confirmation.assignmentId,
        confirmation.asset,
        confirmation.replacementAssignmentId,
        true
      );
    } finally {
      endMediaAction();
    }
  }

  async function confirmMediaKindChange(): Promise<void> {
    const confirmation = mediaKindChangeConfirmation;
    if (confirmation === null || !beginMediaAction()) {
      return;
    }
    try {
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、表示素材を差し替えできません。"
      );
      if (currentProject === undefined) {
        return;
      }
      const currentAssignment = currentProject.visuals.assignments.find(
        (assignment) => assignment.id === confirmation.assignmentId
      );
      if (currentAssignment === undefined) {
        setMediaError(new Error("差し替え対象の表示素材を解決できません。"));
        return;
      }
      if (currentAssignment.display.kind !== confirmation.fromKind) {
        setMediaError(
          new Error(
            "差し替え対象の素材が更新されています。画面を再読み込みしてください。"
          )
        );
        return;
      }
      const displayResult = replacementDisplayForAsset(
        currentAssignment,
        confirmation.asset
      );
      if (
        displayResult.display === undefined ||
        displayResult.display.kind !== confirmation.toKind
      ) {
        setMediaError(
          new Error(
            "差し替え用の表示設定を再作成できません。素材を選び直してください。"
          )
        );
        return;
      }
      await saveMediaAssignment(
        currentProject,
        {
          ...currentAssignment,
          assetId: confirmation.asset.assetId,
          display: displayResult.display
        },
        confirmation.asset.version
      );
    } finally {
      endMediaAction();
    }
  }

  async function selectMediaAsset(asset: AssetListItem): Promise<void> {
    const picker = mediaPicker;
    if (picker === null || !isSelectableGenericVisualAsset(asset)) {
      return;
    }
    if (!beginMediaAction()) {
      return;
    }
    try {
      const draftScript = draftRef.current;
      const locator =
        draftScript === null
          ? undefined
          : createScriptLineLocator(
              draftScript,
              picker.line.sectionId,
              picker.line.lineId
            );
      const currentProject = await flushBeforeMediaMutation(
        "台本を保存できないため、素材を割り当てできません。"
      );
      if (currentProject === undefined) {
        return;
      }
      const resolvedLineId = resolveMediaLineId(
        currentProject,
        picker.line,
        locator
      );
      const section = currentProject.script.sections.find(
        (candidate) => candidate.id === picker.line.sectionId
      );
      if (resolvedLineId === undefined || section === undefined) {
        setMediaError(
          new Error("対象セリフまたはセクションを解決できません。")
        );
        return;
      }

      if (picker.action === "split") {
        const currentAssignment = currentProject.visuals.assignments.find(
          (candidate) => candidate.id === picker.assignmentId
        );
        if (
          currentAssignment === undefined ||
          picker.assignmentId === undefined
        ) {
          setMediaError(new Error("切替対象の表示素材を解決できません。"));
          return;
        }
        await submitSplitMediaAssignment(
          currentProject,
          picker.line,
          resolvedLineId,
          picker.assignmentId,
          asset,
          nextVisualAssignmentId(currentProject.visuals.assignments),
          false
        );
        return;
      }

      let assignment: VisualAssignment;
      if (picker.action === "start") {
        const requestGeneration = projectGenerationRef.current;
        const displayResult = defaultDisplayForAsset(asset);
        const endLineId = section.lines.at(-1)?.id;
        if (displayResult.display === undefined || endLineId === undefined) {
          setMediaError(
            new Error(
              displayResult.reason ?? "素材の表示設定を作成できません。"
            )
          );
          return;
        }
        assignment = {
          id: nextVisualAssignmentId(currentProject.visuals.assignments),
          startLineId: resolvedLineId,
          endLineId,
          assetId: asset.assetId,
          assetChecksum: asset.checksum,
          projectMediaPath: "media/pending-script-media",
          display: displayResult.display
        };
        try {
          await mediaMutation.mutateAsync({
            kind: "create",
            projectId: currentProject.metadata.id,
            projectGeneration: requestGeneration,
            input: {
              expectedRevision: currentProject.revision,
              assetVersion: asset.version,
              assignment: assignmentInput(assignment)
            }
          });
          if (
            !isProjectContextCurrent(
              projectIdRef.current,
              projectGenerationRef.current,
              currentProject.metadata.id,
              requestGeneration
            )
          ) {
            return;
          }
          setMediaPicker(null);
          setMediaPickerSearch("");
          setMediaError(null);
        } catch (error) {
          if (
            isProjectContextCurrent(
              projectIdRef.current,
              projectGenerationRef.current,
              currentProject.metadata.id,
              requestGeneration
            )
          ) {
            setMediaError(error);
          }
        }
        return;
      }

      const currentAssignment = currentProject.visuals.assignments.find(
        (candidate) => candidate.id === picker.assignmentId
      );
      if (currentAssignment === undefined) {
        setMediaError(new Error("差し替え対象の表示素材を解決できません。"));
        return;
      }
      const displayResult = replacementDisplayForAsset(
        currentAssignment,
        asset
      );
      if (displayResult.display === undefined) {
        setMediaError(
          new Error(
            displayResult.reason ?? "差し替え用の表示設定を作成できません。"
          )
        );
        return;
      }
      assignment = {
        ...currentAssignment,
        startLineId: currentAssignment.startLineId,
        endLineId: currentAssignment.endLineId,
        assetId: asset.assetId,
        display: displayResult.display
      };
      if (currentAssignment.display.kind !== displayResult.display.kind) {
        setMediaKindChangeConfirmation({
          assignmentId: currentAssignment.id,
          asset,
          fromKind: currentAssignment.display.kind,
          toKind: displayResult.display.kind
        });
        setMediaPicker(null);
        setMediaPickerSearch("");
        setMediaError(null);
        return;
      }
      const saved = await saveMediaAssignment(
        currentProject,
        assignment,
        asset.version
      );
      if (saved) {
        setMediaPicker(null);
        setMediaPickerSearch("");
      }
    } finally {
      endMediaAction();
    }
  }

  const project = projectQuery.data;
  const catalog = catalogQuery.data;
  const manifest = manifestQuery.data?.manifest;
  const activeTemplates = screenTemplatesQuery.data ?? [];
  const templateDetails = new Map<string, ScreenTemplateDetail>();
  const templateLoadingIds = new Set<string>();
  selectedTemplateIds.forEach((templateId, index) => {
    const query = templateDetailQueries[index];
    if (query?.data !== undefined) {
      templateDetails.set(templateId, query.data);
    }
    if (query?.isPending === true) {
      templateLoadingIds.add(templateId);
    }
  });
  const assets = new Map<string, AssetDetail | undefined>();
  const assetLoadingKeys = new Set<string>();
  assetReferences.forEach((reference, index) => {
    assets.set(reference.key, assetQueries[index]?.data);
    if (assetQueries[index]?.isPending === true) {
      assetLoadingKeys.add(reference.key);
    }
  });
  const mediaPickerItems = mediaPickerQueries.flatMap(
    (query) => query.data?.items ?? []
  );
  const mediaPickerIsPending =
    mediaPicker !== null && mediaPickerQueries.some((query) => query.isPending);
  const mediaPickerError =
    mediaPickerQueries.find((query) => query.isError)?.error ?? null;
  const mediaMutationPending = mediaActionPending || mediaMutation.isPending;
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
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <p className="status-message" role="status">
          台本を準備しています…
        </p>
      </main>
    );
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

  const pickerLine =
    pickerLineId === null
      ? undefined
      : draft.sections
          .flatMap((section) => section.lines)
          .find((line) => line.id === pickerLineId);
  const pickerSelection =
    pickerLine === undefined
      ? undefined
      : visualForLine(project, catalog, pickerLine);
  const previewStates = resolveScriptLinePreviewStates({
    script: draft,
    templates: templateDetails,
    loadingTemplateIds: templateLoadingIds,
    assignments: project.visuals.assignments,
    assets,
    assetLoadingKeys
  });
  const overlayEditorSection =
    overlayEditorLineId === null
      ? undefined
      : draft.sections.find((section) =>
          section.lines.some((line) => line.id === overlayEditorLineId)
        );
  const overlayEditorLine = overlayEditorSection?.lines.find(
    (line) => line.id === overlayEditorLineId
  );
  const overlayEditorPreviewState =
    overlayEditorSection === undefined || overlayEditorLine === undefined
      ? undefined
      : previewStates.get(
          previewLineKey(overlayEditorSection.id, overlayEditorLine.id)
        );
  const overlayEditorTemplate =
    overlayEditorSection === undefined
      ? undefined
      : templateDetails.get(overlayEditorSection.screenTemplateId);
  const overlayEditorPreview =
    overlayEditorSection === undefined ||
    overlayEditorLine === undefined ||
    overlayEditorPreviewState === undefined
      ? undefined
      : resolveScriptLineScreenPreview({
          projectId: project.metadata.id,
          project,
          section: overlayEditorSection,
          line: overlayEditorLine,
          catalog,
          manifest,
          assignments: overlayEditorPreviewState.assignments,
          assets
        });

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
      <WorkflowIndicator
        projectId={projectId}
        currentStep="production"
        onNavigate={(event, destination) =>
          void navigateAway(event, destination)
        }
      />
      <div className="production-character-assets-action">
        <Link
          className="button"
          to={charactersPath(projectId)}
          onClick={(event) =>
            void navigateAway(event, charactersPath(projectId))
          }
        >
          キャラクター素材を設定
        </Link>
      </div>
      <header className="page-header page-header-stacked">
        <p className="eyebrow">台本</p>
        <h1>{project.metadata.title}</h1>
        <p>
          台本を編集し、話者ごとのビジュアルセットからセリフ単位で表示 variant
          を明示的に選択します。
        </p>
        <div className="page-header-actions">
          <Link
            className="button"
            to={visualAssignmentsPath(projectId)}
            onClick={(event) =>
              void navigateAway(event, visualAssignmentsPath(projectId))
            }
          >
            現場素材の表示設定
          </Link>
          <Link
            className="button button-primary"
            to={editPath(projectId)}
            onClick={(event) => void navigateAway(event, editPath(projectId))}
          >
            編集へ進む
          </Link>
        </div>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>{autosaveMessage}</strong>
        <span>更新番号 {revisionRef.current}</span>
        <span>{scriptStatusLabel()}</span>
      </div>

      {catalogQuery.isError ? (
        <section className="message-panel message-panel-warning" role="status">
          <h2>ビジュアルカタログを確認できません</h2>
          <p>
            台本編集は続けられますが、variant
            の選択にはカタログの復旧が必要です。
          </p>
        </section>
      ) : null}
      {screenTemplatesQuery.isError ? (
        <section className="message-panel message-panel-warning" role="status">
          <h2>画面テンプレート候補を確認できません</h2>
          <p>
            既存の参照は保持したまま表示します。activeなテンプレートの選択には復旧が必要です。
          </p>
        </section>
      ) : null}
      {pickerError !== null ? (
        <section className="message-panel message-panel-warning" role="alert">
          <p>{pickerError}</p>
        </section>
      ) : null}
      {mediaError !== null ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>表示素材を変更できません</h2>
          <p>
            {getErrorMessage(
              mediaError,
              "入力中の台本と既存の表示素材は保持されています。"
            )}
          </p>
          {errorDetails(mediaError).length > 0 ? (
            <ul>
              {errorDetails(mediaError).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
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
        aria-labelledby="voice-generation-title"
        className="voice-generation-panel"
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

      <section aria-label="台本編集" className="script-production-main">
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
          {draft.sections.map((section, sectionIndex) => {
            const sectionTemplate = resolveScriptScreenTemplate(
              section,
              templateDetails,
              templateLoadingIds
            );
            const sectionTemplateError =
              screenTemplateReferenceMessage(sectionTemplate);
            const sectionTemplateIsCandidate = activeTemplates.some(
              (template) => template.templateId === section.screenTemplateId
            );

            return (
              <section className="script-section-card" key={section.id}>
                <header className="script-section-header">
                  <div>
                    <p className="eyebrow">セクション</p>
                    <h2>{section.name}</h2>
                    <code>{section.id}</code>
                    <div className="script-section-template-control">
                      <label htmlFor={`${section.id}-screen-template`}>
                        画面テンプレート
                      </label>
                      <select
                        aria-invalid={
                          !screenTemplateStatusIsSelectable(sectionTemplate)
                        }
                        disabled={
                          screenTemplatesQuery.isError ||
                          activeTemplates.length === 0
                        }
                        id={`${section.id}-screen-template`}
                        value={section.screenTemplateId}
                        onChange={(event) =>
                          updateSectionTemplate(
                            sectionIndex,
                            event.target.value
                          )
                        }
                      >
                        {!sectionTemplateIsCandidate ? (
                          <option value={section.screenTemplateId}>
                            {sectionTemplateError ??
                              `現在: ${screenTemplateName(sectionTemplate, activeTemplates)}`}
                          </option>
                        ) : null}
                        {activeTemplates.map((template) => (
                          <option
                            key={template.templateId}
                            value={template.templateId}
                          >
                            {template.name}
                          </option>
                        ))}
                      </select>
                      {sectionTemplateError !== null ? (
                        <span
                          className="script-template-reference-error"
                          role="alert"
                        >
                          {sectionTemplateError}
                        </span>
                      ) : null}
                    </div>
                    <div className="script-section-background-summary">
                      <span>背景</span>
                      <code>
                        {sectionBackgroundSummary(section.background)}
                      </code>
                    </div>
                  </div>
                </header>
                {section.lines.length === 0 ? (
                  <p className="status-message">セリフはまだありません。</p>
                ) : (
                  <div className="script-line-list">
                    {section.lines.map((line, lineIndex) => {
                      const previewState = previewStates.get(
                        previewLineKey(section.id, line.id)
                      );
                      if (previewState === undefined) {
                        return null;
                      }
                      return (
                        <ScriptLineCard
                          key={line.id}
                          line={line}
                          sectionIndex={sectionIndex}
                          lineIndex={lineIndex}
                          project={project}
                          catalog={catalog}
                          catalogUnavailable={
                            catalogQuery.isPending || catalogQuery.isError
                          }
                          previewState={previewState}
                          linePreview={resolveScriptLineScreenPreview({
                            projectId: project.metadata.id,
                            project,
                            section,
                            line,
                            catalog,
                            manifest,
                            assignments: previewState.assignments,
                            assets
                          })}
                          issues={issues}
                          voiceStatus={voiceStatusByLine.get(line.id)}
                          voiceStatusLoading={voiceStatusQuery.isPending}
                          voiceGenerationDisabled={
                            voiceGenerationDisabled || issues.length > 0
                          }
                          voiceAvailable={
                            voiceStatusQuery.data?.available === true
                          }
                          projectId={project.metadata.id}
                          assets={assets}
                          mediaMutationPending={mediaMutationPending}
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
                              duplicateScriptLine(
                                draft,
                                sectionIndex,
                                lineIndex
                              )
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
                          onOpenOverlayEditor={() =>
                            void openLineOverlayEditor(section.id, line.id)
                          }
                          onOpenPicker={() => openVisualPicker(line.id)}
                          onStartMedia={() =>
                            openMediaPicker(
                              {
                                sectionId: section.id,
                                lineId: line.id
                              },
                              "start"
                            )
                          }
                          onPauseMedia={(assignmentId) =>
                            pauseMedia(
                              { sectionId: section.id, lineId: line.id },
                              assignmentId
                            )
                          }
                          onResumeMedia={(assignmentId) =>
                            resumeMedia(
                              { sectionId: section.id, lineId: line.id },
                              assignmentId
                            )
                          }
                          onEndMedia={(assignmentId) =>
                            void requestEndMedia(
                              { sectionId: section.id, lineId: line.id },
                              assignmentId
                            )
                          }
                          onReplaceMedia={(assignmentId) =>
                            openMediaPicker(
                              {
                                sectionId: section.id,
                                lineId: line.id
                              },
                              "replace",
                              assignmentId
                            )
                          }
                          onSplitMedia={(assignmentId) =>
                            openMediaPicker(
                              {
                                sectionId: section.id,
                                lineId: line.id
                              },
                              "split",
                              assignmentId
                            )
                          }
                        />
                      );
                    })}
                  </div>
                )}
                <button
                  className="button script-section-add-line"
                  type="button"
                  onClick={() => addLine(sectionIndex)}
                >
                  セリフを追加
                </button>
              </section>
            );
          })}
        </section>
      </section>

      {mediaSplitConfirmation !== null ? (
        <ScriptMediaDialog
          className="script-media-confirm-dialog"
          describedById="script-media-split-confirm-description"
          onClose={() => {
            if (!mediaMutationPending) {
              setMediaSplitConfirmation(null);
            }
          }}
          titleId="script-media-split-confirm-title"
        >
          <h2 id="script-media-split-confirm-title">
            この行から変更するためcueを削除しますか？
          </h2>
          <p id="script-media-split-confirm-description">
            旧素材の表示範囲をこのセリフの直前まで短縮すると、範囲外になるcueが削除されます。旧素材の設定は保持し、新素材をこの行からセクション末尾まで表示します。
          </p>
          <ul>
            {mediaSplitConfirmation.outsideCues.map((cue) => (
              <li key={`${cue.lineId}-${cue.edge}-${cue.action}`}>
                {cue.lineId} / {cue.edge} / {cue.action}
              </li>
            ))}
          </ul>
          <div className="script-media-confirm-actions">
            <button
              className="button"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => setMediaSplitConfirmation(null)}
            >
              キャンセル
            </button>
            <button
              className="button button-primary"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => void confirmSplitMedia()}
            >
              {mediaMutationPending ? "保存中…" : "cueを削除して切り替え"}
            </button>
          </div>
        </ScriptMediaDialog>
      ) : null}

      {mediaRangeConfirmation !== null ? (
        <ScriptMediaDialog
          className="script-media-confirm-dialog"
          describedById="script-media-range-confirm-description"
          onClose={() => {
            if (!mediaMutationPending) {
              setMediaRangeConfirmation(null);
            }
          }}
          titleId="script-media-range-confirm-title"
        >
          <h2 id="script-media-range-confirm-title">
            終了位置を短縮してcueを削除しますか？
          </h2>
          <p id="script-media-range-confirm-description">
            終了位置を現在のセリフへ変更すると、次のcueが新しい範囲の外になります。削除と終了位置の変更を同じ保存操作で行います。
          </p>
          <ul>
            {mediaRangeConfirmation.outsideCues.map((cue) => (
              <li key={`${cue.lineId}-${cue.edge}-${cue.action}`}>
                {cue.lineId} / {cue.edge} / {cue.action}
              </li>
            ))}
          </ul>
          <div className="script-media-confirm-actions">
            <button
              className="button"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => setMediaRangeConfirmation(null)}
            >
              キャンセル
            </button>
            <button
              className="button button-primary"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => void confirmEndMedia()}
            >
              {mediaMutationPending ? "保存中…" : "cueを削除して終了"}
            </button>
          </div>
        </ScriptMediaDialog>
      ) : null}

      {mediaKindChangeConfirmation !== null ? (
        <ScriptMediaDialog
          className="script-media-confirm-dialog"
          describedById="script-media-kind-change-confirm-description"
          onClose={() => {
            if (!mediaMutationPending) {
              setMediaKindChangeConfirmation(null);
            }
          }}
          titleId="script-media-kind-change-confirm-title"
        >
          <h2 id="script-media-kind-change-confirm-title">
            素材の種類を変更して差し替えますか？
          </h2>
          <p id="script-media-kind-change-confirm-description">
            {visualDisplayKindLabel(mediaKindChangeConfirmation.fromKind)}から
            {visualDisplayKindLabel(mediaKindChangeConfirmation.toKind)}
            へ変更します。
          </p>
          {mediaKindChangeConfirmation.fromKind === "video" ? (
            <p>
              動画固有の再生範囲・再生速度・音量とpause/resume
              cueが削除されます。この変更は承認後に一度の保存操作で実行されます。
            </p>
          ) : (
            <p>
              差し替え後の素材は新しい種類の初期表示設定で作成されます。この変更は承認後に一度の保存操作で実行されます。
            </p>
          )}
          <div className="script-media-confirm-actions">
            <button
              className="button"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => setMediaKindChangeConfirmation(null)}
            >
              キャンセル
            </button>
            <button
              className="button button-primary"
              disabled={mediaMutationPending}
              type="button"
              onClick={() => void confirmMediaKindChange()}
            >
              {mediaMutationPending ? "保存中…" : "確認して差し替え"}
            </button>
          </div>
        </ScriptMediaDialog>
      ) : null}

      {mediaPicker !== null ? (
        <ScriptMediaAssetPicker
          action={mediaPicker.action}
          disabled={mediaMutationPending}
          error={mediaPickerError}
          isPending={mediaPickerIsPending}
          items={mediaPickerItems}
          lineId={mediaPicker.line.lineId}
          onClose={closeMediaPicker}
          onSearch={setMediaPickerSearch}
          onSelect={(asset) => void selectMediaAsset(asset)}
          search={mediaPickerSearch}
        />
      ) : null}

      {overlayEditorLineId !== null &&
      overlayEditorLine !== undefined &&
      overlayEditorSection !== undefined ? (
        <ScriptMediaDialog
          className="line-overlay-editor-dialog"
          describedById="line-overlay-editor-description"
          onClose={() => {
            if (!lineOverlayMutation.isPending) {
              setOverlayEditorLineId(null);
              setOverlayError(null);
            }
          }}
          titleId="line-overlay-editor-title"
        >
          {overlayEditorTemplate !== undefined &&
          overlayEditorPreview !== undefined ? (
            <LineOverlayEditor
              key={overlayEditorLine.id}
              existingOverlayIds={
                new Set(
                  project.overlays.lineOverlays.map((overlay) => overlay.id)
                )
              }
              initialOverlays={project.overlays.lineOverlays.filter(
                (overlay) => overlay.lineId === overlayEditorLine.id
              )}
              line={overlayEditorLine}
              onCancel={() => {
                setOverlayEditorLineId(null);
                setOverlayError(null);
              }}
              onSave={(lineOverlays) =>
                saveLineOverlayDraft(overlayEditorLine.id, lineOverlays)
              }
              pending={lineOverlayMutation.isPending}
              preview={overlayEditorPreview}
              template={overlayEditorTemplate}
              error={overlayError}
            />
          ) : (
            <div className="message-panel message-panel-warning">
              <h2 id="line-overlay-editor-title">画面注釈を編集できません</h2>
              <p id="line-overlay-editor-description">
                セリフの画面テンプレートを読み込めないため、注釈エディターを開けません。
              </p>
              <button
                className="button"
                type="button"
                onClick={() => {
                  setOverlayEditorLineId(null);
                  setOverlayError(null);
                }}
              >
                閉じる
              </button>
            </div>
          )}
        </ScriptMediaDialog>
      ) : null}

      <CharacterVisualPickerModal
        visual={pickerSelection?.visual}
        characterName={pickerSelection?.character?.name ?? "キャラクター"}
        selectedVariantId={pickerLine?.characterVariantId}
        onSelect={selectVariant}
        onClose={() => setPickerLineId(null)}
      />
    </main>
  );
}
