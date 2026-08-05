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

import type { ProjectSummary } from "../schema/api.js";
import {
  type Script,
  type ScriptLine,
  type VideoProject
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchProject,
  initializeProjectScript,
  saveProjectScript
} from "./api/client";
import {
  AutosaveCoordinator,
  navigateAfterAutosave,
  type AutosaveState
} from "./brief-autosave";
import {
  appendScriptLines,
  cloneScript,
  createDefaultScriptLine,
  deleteScriptLine,
  duplicateScriptLine,
  isScriptInitializationAllowed,
  moveScriptLine,
  parseBulkScript,
  updateScriptLine,
  validateScriptDraft,
  type BulkPasteError,
  type ScriptDraftIssue
} from "./script-editor";

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
  issues,
  onChange,
  onMove,
  onDuplicate,
  onDelete
}: {
  readonly line: ScriptLine;
  readonly sectionIndex: number;
  readonly lineIndex: number;
  readonly project: VideoProject;
  readonly issues: readonly ScriptDraftIssue[];
  readonly onChange: (update: Partial<ScriptLine>) => void;
  readonly onMove: (direction: "up" | "down") => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
}) {
  const lineIssues = lineIssueText(issues, sectionIndex, lineIndex);
  const numberValue = (value: number): string =>
    Number.isFinite(value) ? String(value) : "";

  return (
    <article className="script-line-card" aria-label={`セリフ ${line.id}`}>
      <header className="script-line-card-header">
        <div>
          <p className="eyebrow">セリフID</p>
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
          <label htmlFor={`${line.id}-expression`}>論理表情</label>
          <select
            id={`${line.id}-expression`}
            value={line.expression}
            onChange={(event) =>
              onChange({
                expression: event.target.value as ScriptLine["expression"]
              })
            }
          >
            <option value="neutral">neutral（通常）</option>
            <option value="smile">smile（喜び）</option>
            <option value="explain">explain（説明）</option>
            <option value="caution">caution（注意）</option>
          </select>
        </div>
        <div className="form-field script-line-wide-field">
          <label htmlFor={`${line.id}-spoken`}>VOICEVOX 読み上げ</label>
          <textarea
            id={`${line.id}-spoken`}
            rows={3}
            value={line.spokenText}
            onChange={(event) => onChange({ spokenText: event.target.value })}
          />
        </div>
        <div className="form-field script-line-wide-field">
          <label htmlFor={`${line.id}-subtitle`}>字幕</label>
          <textarea
            id={`${line.id}-subtitle`}
            rows={3}
            value={line.subtitleText}
            onChange={(event) => onChange({ subtitleText: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${line.id}-pause-before`}>発話前の無音（ms）</label>
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
          <label htmlFor={`${line.id}-pause-after`}>発話後の無音（ms）</label>
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
  const projectIdRef = useRef(projectId ?? "");
  const revisionRef = useRef(0);
  const draftRef = useRef<Script | null>(null);
  const lastSavedRef = useRef<Script | null>(null);
  const initializedForProjectRef = useRef<string | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<Script> | null>(null);
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<Script> | null>(null);

  const saveMutation = useMutation({
    mutationFn: ({
      script,
      expectedRevision
    }: {
      script: Script;
      expectedRevision: number;
    }) => saveProjectScript(projectIdRef.current, { script, expectedRevision }),
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  function updateMutationCaches(project: VideoProject): void {
    queryClient.setQueryData(["projects", project.metadata.id], project);
    queryClient.setQueryData<ProjectSummary[]>(["projects"], (summaries) =>
      summaries?.map((summary) =>
        summary.id === project.metadata.id
          ? projectSummaryFromProject(project)
          : summary
      )
    );
  }

  function adoptProject(project: VideoProject): void {
    const nextDraft = cloneScript({
      ...project.script,
      status:
        project.script.status === "approved"
          ? "needs_review"
          : project.script.status
    });
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
    const project = await saveMutationRef.current.mutateAsync({
      script: nextDraft,
      expectedRevision: revisionRef.current
    });
    revisionRef.current = project.revision;
    updateMutationCaches(project);
    if (JSON.stringify(draftRef.current) === JSON.stringify(nextDraft)) {
      const savedDraft = cloneScript(nextDraft);
      lastSavedRef.current = savedDraft;
      draftRef.current = savedDraft;
    }
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
    initializedForProjectRef.current = null;
    draftRef.current = null;
    lastSavedRef.current = null;
    revisionRef.current = 0;
    setDraft(null);
    setBulkText("");
    setBulkErrors([]);
    setInitializationError(null);
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

  const initializeMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      initializeProjectScript(projectId ?? "", { expectedRevision }),
    onSuccess: (project) => {
      setInitializationError(null);
      updateMutationCaches(project);
      adoptProject(project);
    },
    onError: setInitializationError,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  async function reloadLatest(): Promise<void> {
    const result = await projectQuery.refetch();
    if (!result.isSuccess || result.data === undefined) {
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
          ? "構成案が stale です。構成案画面で再確認してください。"
          : "台本を初期化できます。";
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={outlinePath(projectId)}>構成案へ戻る</Link>
        </p>
        <header className="page-header page-header-stacked">
          <p className="eyebrow">P2-02 台本</p>
          <h1>{project.metadata.title}</h1>
          <p>承認済み構成案のセクション構造を引き継いで台本を開始します。</p>
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
              構成案を承認し、stale
              を解消すると開始できます。既存の台本データは削除しません。
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
            onClick={() => initializeMutation.mutate(project.revision)}
          >
            {isInitializing ? "初期化中…" : "台本編集を開始"}
          </button>
        </section>
      </main>
    );
  }

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
      <header className="page-header page-header-stacked">
        <div className="page-header-actions">
          <p className="eyebrow">P2-02 台本編集</p>
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
        <p>論理表情・読み上げ文・字幕・前後の無音時間を編集します。</p>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>{autosaveMessage}</strong>
        <span>revision {revisionRef.current}</span>
      </div>

      {autosaveState.status === "error" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存できませんでした</h2>
          <p>
            {getErrorMessage(
              autosaveState.error,
              "入力中の draft は保持されています。"
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
            別の画面で更新されたため、自動上書きを停止しました。現在の draft
            は保持しています。
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
            入力中の draft
            は保持しています。該当フィールドを修正して再保存してください。
          </p>
        </section>
      ) : null}

      <form className="bulk-paste-panel" onSubmit={pasteLines}>
        <div>
          <h2>話者付きテキストの一括貼り付け</h2>
          <p>1 行 1 セリフ。半角または全角コロンで話者と本文を分けます。</p>
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
          <label htmlFor="bulk-script-text">貼り付け本文</label>
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
                  {section.id} / outline: {section.outlineSectionId}
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
                    issues={issues}
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
                  />
                ))}
              </div>
            )}
          </section>
        ))}
      </section>
    </main>
  );
}
