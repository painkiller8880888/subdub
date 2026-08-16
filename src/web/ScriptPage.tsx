import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  VoiceLineGenerationStatus
} from "../schema/api.js";
import type {
  CharacterVariant,
  CharacterVisualCatalogSnapshot,
  CharacterVisualSet,
  Script,
  ScriptLine,
  VideoProject
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchCharacterVisualCatalog,
  fetchProject,
  fetchProjectVoiceStatus,
  generateAllProjectVoice,
  generateProjectVoice,
  initializeProjectScript,
  saveProjectScript
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
  isScriptInitializationAllowed,
  moveScriptLine,
  parseBulkScript,
  reconcileScriptLineIdsWithMap,
  resolveScriptLineId,
  scriptStatusAfterEdit,
  updateScriptLine,
  validateScriptDraft,
  type BulkPasteError,
  type ScriptDraftIssue
} from "./script-editor";
import { CharacterVisualPickerModal } from "./CharacterVisualPicker";
import { characterVisualFileUrl } from "./character-visual-picker";
import { VoiceAdjustmentEditor } from "./VoiceAdjustmentEditor";
import { WorkflowIndicator } from "./WorkflowIndicator";

function charactersPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/characters`;
}

function outlinePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
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

function variantFileSlots(variant: CharacterVariant): readonly {
  key: "single" | "closed" | "open";
  label: string;
}[] {
  return variant.renderType === "single-image"
    ? [{ key: "single", label: "素材" }]
    : [
        { key: "closed", label: "口閉じ" },
        { key: "open", label: "口開き" }
      ];
}

function CharacterVariantPreview({
  visual,
  variant,
  characterName
}: {
  readonly visual: CharacterVisualSet;
  readonly variant: CharacterVariant;
  readonly characterName: string;
}) {
  return (
    <div
      className={
        variant.renderType === "mouth-pair"
          ? "script-line-variant-preview script-line-variant-preview-pair"
          : "script-line-variant-preview"
      }
    >
      {variantFileSlots(variant).map((slot) => {
        const file = variant.files.find(
          (candidate) => candidate.key === slot.key
        );
        return file === undefined ? (
          <div
            className="script-line-variant-preview-missing"
            key={slot.key}
            role="img"
            aria-label={`${characterName}の${variant.label}・${slot.label}が未登録`}
          >
            未登録
          </div>
        ) : (
          <img
            alt={`${characterName}の${variant.label}・${slot.label}`}
            className="script-line-variant-preview-image"
            key={slot.key}
            loading="lazy"
            src={characterVisualFileUrl(
              visual.visualId,
              variant.variantId,
              file.key
            )}
          />
        );
      })}
    </div>
  );
}

function visualForLine(
  project: VideoProject,
  catalog: CharacterVisualCatalogSnapshot | undefined,
  line: ScriptLine
): {
  character: VideoProject["characters"][number] | undefined;
  visual: CharacterVisualSet | undefined;
  variant: CharacterVariant | undefined;
} {
  const character = project.characters.find(
    (candidate) => candidate.id === line.speakerId
  );
  const visualId = character?.characterVisual.visualId;
  const visual =
    visualId === null || visualId === undefined
      ? undefined
      : catalog?.find((candidate) => candidate.visualId === visualId);
  const variant = visual?.variants.find(
    (candidate) => candidate.variantId === line.characterVariantId
  );
  return { character, visual, variant };
}

function ScriptLineCard({
  line,
  sectionIndex,
  lineIndex,
  project,
  catalog,
  catalogUnavailable,
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
  onOpenPicker
}: {
  readonly line: ScriptLine;
  readonly sectionIndex: number;
  readonly lineIndex: number;
  readonly project: VideoProject;
  readonly catalog: CharacterVisualCatalogSnapshot | undefined;
  readonly catalogUnavailable: boolean;
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
  readonly onOpenPicker: () => void;
}) {
  const lineIssues = lineIssueText(issues, sectionIndex, lineIndex);
  const { character, visual, variant } = visualForLine(project, catalog, line);
  const numberValue = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";
  const visualButtonDisabled =
    catalogUnavailable || visual === undefined || visual.status !== "active";
  const visualSummary =
    character === undefined
      ? "話者が未解決です"
      : character.characterVisual.visualId === null
        ? "話者のビジュアルセットが未設定です"
        : visual === undefined
          ? "カタログにないビジュアルセットです"
          : line.characterVariantId === null ||
              line.characterVariantId === undefined
            ? "未選択"
            : variant === undefined
              ? "カタログにない variant です"
              : variant.status === "active" && visual.status === "active"
                ? "選択中"
                : "非アクティブな参照です";

  return (
    <article className="script-line-card" aria-label={`セリフ ${line.id}`}>
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
              (project.script.sections[sectionIndex]?.lines.length ?? 1) - 1
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
            onChange={(event) =>
              onChange({
                speakerId: event.target.value,
                characterVariantId: null
              })
            }
          >
            {project.characters.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}（{candidate.role}）
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${line.id}-expression`}>
            表情（表示選択には影響しません）
          </label>
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
        aria-label={`${line.id}のキャラクタービジュアル設定`}
        className="script-line-character-visual"
      >
        <div className="script-line-character-visual-content">
          <div>
            <p className="eyebrow">キャラクタービジュアル</p>
            <strong>{visual?.name ?? "プロジェクト binding 未設定"}</strong>
            <span className="status-message">{visualSummary}</span>
          </div>
          {visual !== undefined && variant !== undefined ? (
            <CharacterVariantPreview
              visual={visual}
              variant={variant}
              characterName={character?.name ?? line.speakerId}
            />
          ) : (
            <div className="script-line-character-visual-empty">未選択</div>
          )}
          {variant !== undefined ? (
            <dl className="script-line-variant-details">
              <div>
                <dt>ラベル</dt>
                <dd>{variant.label}</dd>
              </div>
              <div>
                <dt>renderType</dt>
                <dd>{variant.renderType}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        <button
          className="button button-small"
          type="button"
          disabled={visualButtonDisabled}
          onClick={onOpenPicker}
        >
          {variant === undefined ? "ビジュアルを選択" : "ビジュアルを変更"}
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
  const [initializationError, setInitializationError] = useState<unknown>(null);
  const [voiceError, setVoiceError] = useState<unknown>(null);
  const [pickerLineId, setPickerLineId] = useState<string | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const projectIdRef = useRef(projectId ?? "");
  const projectGenerationRef = useRef(0);
  const revisionRef = useRef(0);
  const draftRef = useRef<Script | null>(null);
  const lastSavedRef = useRef<Script | null>(null);
  const initializedForProjectRef = useRef<string | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<Script> | null>(null);
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<Script> | null>(null);

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
    initializedForProjectRef.current = project.metadata.id;
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
      ...reconciliation.script,
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
    setVoiceError(null);
    setPickerLineId(null);
    setPickerError(null);
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
      initializedForProjectRef.current = projectIdRef.current;
      setDraft(null);
      coordinator.reset();
    }
  }, [coordinator, projectId, projectQuery.data, projectQuery.isError]);

  const initializeMutation = useMutation({
    mutationFn: ({
      projectId: initializationProjectId,
      expectedRevision
    }: {
      projectId: string;
      projectGeneration: number;
      expectedRevision: number;
    }) =>
      initializeProjectScript(initializationProjectId, { expectedRevision }),
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
      initializedForProjectRef.current = projectIdRef.current;
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
    const currentDraft = draftRef.current;
    if (currentDraft !== null) {
      updateDraft(
        updateScriptLine(currentDraft, sectionIndex, lineIndex, update)
      );
    }
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

  const project = projectQuery.data;
  const catalog = catalogQuery.data;
  const isInitializing = initializeMutation.isPending;
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
        <WorkflowIndicator
          projectId={projectId}
          currentStep="production"
          onNavigate={(event, destination) =>
            void navigateAway(event, destination)
          }
        />
        <div className="production-character-assets-action">
          <Link className="button" to={charactersPath(projectId)}>
            キャラクター素材を設定
          </Link>
        </div>
        <header className="page-header page-header-stacked">
          <p className="eyebrow">台本</p>
          <h1>{project.metadata.title}</h1>
          <p>
            構成案のセクション構造を引き継いで、台本中心の制作を開始します。
          </p>
          <div className="page-header-actions">
            <Link className="button" to={outlinePath(projectId)}>
              構成案を確認
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
        <span>{scriptStatusLabel(draft.status)}</span>
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
      {pickerError !== null ? (
        <section className="message-panel message-panel-warning" role="alert">
          <p>{pickerError}</p>
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
                      catalog={catalog}
                      catalogUnavailable={
                        catalogQuery.isPending || catalogQuery.isError
                      }
                      issues={issues}
                      voiceStatus={voiceStatusByLine.get(line.id)}
                      voiceGenerationDisabled={
                        voiceGenerationDisabled || issues.length > 0
                      }
                      voiceAvailable={voiceStatusQuery.data?.available === true}
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
                      onOpenPicker={() => openVisualPicker(line.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </section>
      </section>

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
