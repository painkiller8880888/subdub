import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ZodError } from "zod";

import {
  outlineSchema,
  type OpenQuestion,
  type Outline,
  type OutlineSection,
  type VideoProject
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  approveProjectOutline,
  fetchModels,
  fetchProject,
  generateProjectOutline,
  reviewProjectOutline,
  saveProjectOutline
} from "./api/client";
import { AutosaveCoordinator, type AutosaveState } from "./brief-autosave";
import {
  cloneOutline,
  countOpenQuestions,
  hasStaleSource,
  itemsToText,
  makeQuestion,
  makeSection,
  mergeSavedOutlineIds,
  normalizeOutlineOrders,
  outlineOrderErrors,
  sourceRefsToText,
  textToItems,
  textToSourceRefs
} from "./outline-draft";

type OutlineSaveDraft = {
  readonly outline: Outline;
  readonly expectedRevision: number;
};

function temporaryId(prefix: string): string {
  return `tmp-${prefix}-${crypto.randomUUID()}`;
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
    (detail) => `${detail.path.join(".") || "outline"}: ${detail.message}`
  );
}

function outlineStatusLabel(status: Outline["status"]): string {
  switch (status) {
    case "approved":
      return "approved（承認済み）";
    case "needs_review":
      return "needs_review（要確認）";
    default:
      return "draft（下書き）";
  }
}

function updateQuestion(
  questions: OpenQuestion[],
  index: number,
  patch: Partial<OpenQuestion>
): OpenQuestion[] {
  return questions.map((question, questionIndex) =>
    questionIndex === index ? { ...question, ...patch } : question
  );
}

function QuestionList({
  label,
  questions,
  onChange,
  idPrefix
}: {
  readonly label: string;
  readonly questions: OpenQuestion[];
  readonly onChange: (questions: OpenQuestion[]) => void;
  readonly idPrefix: string;
}) {
  return (
    <fieldset className="outline-question-list">
      <legend>{label}</legend>
      {questions.length === 0 ? (
        <p className="field-hint">要確認事項はありません。</p>
      ) : null}
      {questions.map((question, index) => (
        <div className="outline-question" key={question.id}>
          <label htmlFor={`${idPrefix}-${question.id}-question`}>質問</label>
          <textarea
            id={`${idPrefix}-${question.id}-question`}
            rows={2}
            value={question.question}
            onChange={(event) => {
              onChange(
                updateQuestion(questions, index, {
                  question: event.target.value
                })
              );
            }}
          />
          <label htmlFor={`${idPrefix}-${question.id}-status`}>状態</label>
          <select
            id={`${idPrefix}-${question.id}-status`}
            value={question.status}
            onChange={(event) => {
              const status = event.target.value as OpenQuestion["status"];
              onChange(
                updateQuestion(questions, index, {
                  status,
                  resolution: status === "open" ? null : question.resolution
                })
              );
            }}
          >
            <option value="open">未解決</option>
            <option value="resolved">解決済み</option>
          </select>
          <label htmlFor={`${idPrefix}-${question.id}-resolution`}>
            解決内容
          </label>
          <textarea
            id={`${idPrefix}-${question.id}-resolution`}
            rows={2}
            value={question.resolution ?? ""}
            onChange={(event) => {
              onChange(
                updateQuestion(questions, index, {
                  resolution: event.target.value
                })
              );
            }}
          />
          <button
            className="button button-small"
            type="button"
            onClick={() => {
              onChange(
                questions.filter((_, questionIndex) => questionIndex !== index)
              );
            }}
          >
            質問を削除
          </button>
        </div>
      ))}
      <button
        className="button button-small"
        type="button"
        onClick={() => {
          onChange([
            ...questions,
            makeQuestion(temporaryId(`${idPrefix}-question`))
          ]);
        }}
      >
        質問を追加
      </button>
    </fieldset>
  );
}

function OutlineSectionCard({
  section,
  index,
  sourceId,
  canDelete,
  onChange,
  onDelete,
  onDuplicate,
  onMove
}: {
  readonly section: OutlineSection;
  readonly index: number;
  readonly sourceId: string;
  readonly canDelete: boolean;
  readonly onChange: (section: OutlineSection) => void;
  readonly onDelete: () => void;
  readonly onDuplicate: () => void;
  readonly onMove: (direction: -1 | 1) => void;
}) {
  function changeText(
    field: "title" | "overview" | "targetDurationSec",
    value: string
  ): void {
    onChange({
      ...section,
      [field]:
        field === "targetDurationSec" ? Math.max(1, Number(value) || 1) : value
    } as OutlineSection);
  }

  function changeDirective(
    field: keyof OutlineSection["humanDirectives"],
    value: string
  ): void {
    onChange({
      ...section,
      humanDirectives: {
        ...section.humanDirectives,
        [field]: textToItems(value)
      }
    });
  }

  return (
    <details className="outline-section-card" open>
      <summary>
        <span>#{section.order}</span> {section.title || "無題のセクション"}（
        {section.role}）
      </summary>
      <div className="outline-section-body">
        <div className="outline-card-actions">
          <button
            className="button button-small"
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
          >
            上へ
          </button>
          <button
            className="button button-small"
            type="button"
            onClick={() => onMove(1)}
          >
            下へ
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
            disabled={!canDelete}
          >
            削除
          </button>
        </div>

        <div className="outline-field-grid">
          <div className="form-field">
            <label htmlFor={`${section.id}-role`}>role</label>
            <select
              id={`${section.id}-role`}
              value={section.role}
              onChange={(event) =>
                onChange({
                  ...section,
                  role: event.target.value as OutlineSection["role"]
                })
              }
            >
              <option value="intro">intro</option>
              <option value="main">main</option>
              <option value="outro">outro</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${section.id}-duration`}>targetDurationSec</label>
            <input
              id={`${section.id}-duration`}
              type="number"
              min={1}
              step={1}
              value={section.targetDurationSec}
              onChange={(event) =>
                changeText("targetDurationSec", event.target.value)
              }
            />
          </div>
        </div>

        <div className="form-field">
          <label htmlFor={`${section.id}-title`}>title</label>
          <input
            id={`${section.id}-title`}
            value={section.title}
            onChange={(event) => changeText("title", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-overview`}>overview</label>
          <textarea
            id={`${section.id}-overview`}
            rows={3}
            value={section.overview}
            onChange={(event) => changeText("overview", event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-key-points`}>
            keyPoints（1行1項目）
          </label>
          <textarea
            id={`${section.id}-key-points`}
            rows={4}
            value={itemsToText(section.keyPoints)}
            onChange={(event) =>
              onChange({
                ...section,
                keyPoints: textToItems(event.target.value)
              })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-source-refs`}>
            sourceRefs（見出し階層を ` / ` で区切る）
          </label>
          <textarea
            id={`${section.id}-source-refs`}
            rows={3}
            value={sourceRefsToText(section.sourceRefs)}
            onChange={(event) =>
              onChange({
                ...section,
                sourceRefs: textToSourceRefs(event.target.value, sourceId)
              })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-required`}>
            humanDirectives.requiredItems
          </label>
          <textarea
            id={`${section.id}-required`}
            rows={3}
            value={itemsToText(section.humanDirectives.requiredItems)}
            onChange={(event) =>
              changeDirective("requiredItems", event.target.value)
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-prohibited`}>
            humanDirectives.prohibitedItems
          </label>
          <textarea
            id={`${section.id}-prohibited`}
            rows={3}
            value={itemsToText(section.humanDirectives.prohibitedItems)}
            onChange={(event) =>
              changeDirective("prohibitedItems", event.target.value)
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-constraints`}>
            humanDirectives.scriptConstraints
          </label>
          <textarea
            id={`${section.id}-constraints`}
            rows={3}
            value={itemsToText(section.humanDirectives.scriptConstraints)}
            onChange={(event) =>
              changeDirective("scriptConstraints", event.target.value)
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${section.id}-locked`}>
            lockedFields（1行1項目）
          </label>
          <textarea
            id={`${section.id}-locked`}
            rows={3}
            value={itemsToText(section.lockedFields)}
            onChange={(event) =>
              onChange({
                ...section,
                lockedFields: textToItems(event.target.value)
              })
            }
          />
        </div>
        <QuestionList
          idPrefix={section.id}
          label="セクション内の要確認事項"
          questions={section.openQuestions}
          onChange={(openQuestions) => onChange({ ...section, openQuestions })}
        />
      </div>
    </details>
  );
}

export function OutlinePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: () => fetchModels(),
    enabled:
      projectQuery.data !== undefined &&
      projectQuery.data.outline.sections.length === 0,
    retry: false
  });
  const [draft, setDraft] = useState<Outline | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    status: "idle",
    error: undefined
  });
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [approvalError, setApprovalError] = useState<unknown>(null);
  const revisionRef = useRef(0);
  const draftRef = useRef<Outline | null>(null);
  const lastSavedRef = useRef<Outline | null>(null);
  const initializedForProjectRef = useRef<string | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<Outline> | null>(null);
  const saveMutation = useMutation({
    mutationFn: ({ outline, expectedRevision }: OutlineSaveDraft) =>
      saveProjectOutline(projectId ?? "", { outline, expectedRevision }),
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  const approveMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      approveProjectOutline(projectId ?? "", { expectedRevision }),
    retry: false
  });
  const reviewMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      reviewProjectOutline(projectId ?? "", { expectedRevision }),
    retry: false
  });
  const generateMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      generateProjectOutline(projectId ?? "", {
        expectedRevision,
        ...(selectedModelId === null ? {} : { modelId: selectedModelId })
      }),
    retry: false
  });

  useEffect(() => {
    const coordinator = new AutosaveCoordinator<Outline>({
      debounceMs: 350,
      save: async (nextDraft) => {
        const saved = await saveMutationRef.current.mutateAsync({
          outline: nextDraft,
          expectedRevision: revisionRef.current
        });
        revisionRef.current = saved.revision;
        queryClient.setQueryData(["projects", projectId], saved);
        const serverDraft = cloneOutline(saved.outline);
        lastSavedRef.current = serverDraft;
        const currentDraft = draftRef.current;
        if (currentDraft === null) {
          return;
        }
        const reconciledDraft = mergeSavedOutlineIds(
          nextDraft,
          serverDraft,
          currentDraft
        );
        draftRef.current = reconciledDraft;
        setDraft(reconciledDraft);
        coordinator.replaceDraft(reconciledDraft);
      },
      isConflict: (error) =>
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "PROJECT_REVISION_CONFLICT",
      onStateChange: setAutosaveState
    });
    coordinatorRef.current = coordinator;
    return () => {
      coordinator.dispose();
      coordinatorRef.current = null;
    };
  }, [projectId, queryClient]);

  useEffect(() => {
    if (
      projectId === undefined ||
      projectQuery.data === undefined ||
      initializedForProjectRef.current === projectId ||
      coordinatorRef.current === null
    ) {
      return;
    }
    const nextDraft = cloneOutline(projectQuery.data.outline);
    revisionRef.current = projectQuery.data.revision;
    draftRef.current = nextDraft;
    lastSavedRef.current = cloneOutline(nextDraft);
    initializedForProjectRef.current = projectId;
    setDraft(nextDraft);
    coordinatorRef.current.reset();
  }, [projectId, projectQuery.data]);

  useEffect(() => {
    if (selectedModelId !== null || modelsQuery.data === undefined) {
      return;
    }
    const defaultModelId = projectQuery.data?.aiSettings.defaultModelId;
    setSelectedModelId(
      defaultModelId ?? modelsQuery.data.models[0]?.id ?? null
    );
  }, [modelsQuery.data, projectQuery.data, selectedModelId]);

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  function updateDraft(nextDraft: Outline): void {
    const validatedDraft = outlineSchema.parse(nextDraft);
    draftRef.current = validatedDraft;
    setDraft(validatedDraft);
    coordinatorRef.current?.update(validatedDraft);
  }

  function updateSections(sections: OutlineSection[]): void {
    if (draft === null) {
      return;
    }
    updateDraft(normalizeOutlineOrders({ ...draft, sections }));
  }

  function updateSection(index: number, section: OutlineSection): void {
    if (draft === null) {
      return;
    }
    updateSections(
      draft.sections.map((current, sectionIndex) =>
        sectionIndex === index ? section : current
      )
    );
  }

  function duplicateSection(index: number): void {
    if (draft === null) {
      return;
    }
    const original = draft.sections[index];
    if (original === undefined) {
      return;
    }
    const duplicated: OutlineSection = {
      ...original,
      id: temporaryId("outline-section"),
      openQuestions: original.openQuestions.map((question) => ({
        ...question,
        id: temporaryId("outline-question")
      }))
    };
    updateSections([
      ...draft.sections.slice(0, index + 1),
      duplicated,
      ...draft.sections.slice(index + 1)
    ]);
  }

  function moveSection(index: number, direction: -1 | 1): void {
    if (draft === null) {
      return;
    }
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draft.sections.length) {
      return;
    }
    const sections = [...draft.sections];
    const current = sections[index];
    const target = sections[targetIndex];
    if (current === undefined || target === undefined) {
      return;
    }
    sections[index] = target;
    sections[targetIndex] = current;
    updateSections(sections);
  }

  function addSection(): void {
    if (draft === null) {
      return;
    }
    updateSections([
      ...draft.sections,
      makeSection(temporaryId("outline-section"))
    ]);
  }

  function removeSection(index: number): void {
    if (draft === null) {
      return;
    }
    updateSections(
      draft.sections.filter((_, sectionIndex) => sectionIndex !== index)
    );
  }

  function reloadLatest(): void {
    void projectQuery.refetch().then((result) => {
      if (!result.isSuccess || result.data === undefined) {
        return;
      }
      const nextDraft = cloneOutline(result.data.outline);
      revisionRef.current = result.data.revision;
      draftRef.current = nextDraft;
      lastSavedRef.current = cloneOutline(nextDraft);
      setDraft(nextDraft);
      coordinatorRef.current?.reset();
      setApprovalError(null);
    });
  }

  async function navigateToBrief(
    event: MouseEvent<HTMLAnchorElement>
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
    const flushed =
      coordinatorRef.current === null
        ? true
        : await coordinatorRef.current.flush();
    if (flushed) {
      navigate(`/projects/${encodeURIComponent(projectId ?? "")}/brief`);
    } else {
      setPendingNavigation(false);
    }
  }

  async function approve(): Promise<void> {
    if (coordinatorRef.current === null) {
      return;
    }
    setApprovalError(null);
    const flushed = await coordinatorRef.current.flush();
    if (!flushed) {
      return;
    }
    try {
      const saved = await approveMutation.mutateAsync(revisionRef.current);
      revisionRef.current = saved.revision;
      queryClient.setQueryData(["projects", projectId], saved);
      const nextDraft = cloneOutline(saved.outline);
      draftRef.current = nextDraft;
      lastSavedRef.current = cloneOutline(nextDraft);
      setDraft(nextDraft);
      coordinatorRef.current.reset();
    } catch (error) {
      setApprovalError(error);
    }
  }

  function applyProjectResult(saved: VideoProject): void {
    revisionRef.current = saved.revision;
    queryClient.setQueryData(["projects", projectId], saved);
    const nextDraft = cloneOutline(saved.outline);
    draftRef.current = nextDraft;
    lastSavedRef.current = cloneOutline(nextDraft);
    setDraft(nextDraft);
    coordinatorRef.current?.reset();
  }

  async function markReviewComplete(): Promise<void> {
    if (coordinatorRef.current === null) {
      return;
    }
    setApprovalError(null);
    const flushed = await coordinatorRef.current.flush();
    if (!flushed) {
      return;
    }
    try {
      applyProjectResult(await reviewMutation.mutateAsync(revisionRef.current));
    } catch (error) {
      setApprovalError(error);
    }
  }

  function generate(): void {
    if (selectedModelId === null) {
      return;
    }
    generateMutation.mutate(revisionRef.current, {
      onSuccess: applyProjectResult
    });
  }

  if (projectQuery.isError) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
            企画画面へ
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>構成案を読み込めませんでした</h1>
          <p>
            {getErrorMessage(
              projectQuery.error,
              "プロジェクトを読み込めませんでした。"
            )}
          </p>
          <button className="button" type="button" onClick={reloadLatest}>
            再試行
          </button>
        </section>
      </main>
    );
  }

  if (
    projectQuery.isPending ||
    draft === null ||
    coordinatorRef.current === null
  ) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link
            to={`/projects/${encodeURIComponent(projectId)}/brief`}
            onClick={navigateToBrief}
          >
            企画画面へ
          </Link>
        </p>
        <p className="status-message" role="status">
          構成案を読み込んでいます…
        </p>
      </main>
    );
  }

  const project = projectQuery.data as VideoProject;
  const stale = hasStaleSource(draft, project.source.sha256);
  const orderErrors = outlineOrderErrors(draft);
  const unresolvedQuestions = countOpenQuestions(draft);
  const isEmpty =
    draft.sections.length === 0 &&
    draft.openQuestions.length === 0 &&
    draft.generationRunId === null;
  const autosaveMessage = pendingNavigation
    ? "移動前に保存しています…"
    : autosaveState.status === "saving"
      ? "保存中…"
      : autosaveState.status === "saved"
        ? "保存済み"
        : autosaveState.status === "error"
          ? "保存失敗"
          : autosaveState.status === "conflict"
            ? "競合"
            : autosaveState.status === "pending"
              ? "保存待ち"
              : "変更なし";

  return (
    <main className="page-shell">
      <p className="back-link">
        <Link
          to={`/projects/${encodeURIComponent(projectId)}/brief`}
          onClick={navigateToBrief}
        >
          企画画面へ
        </Link>
      </p>
      <header className="page-header page-header-stacked">
        <p className="eyebrow">Outline editor</p>
        <h1>{project.metadata.title} の構成案</h1>
        <p>編集内容は短い待ち時間の後に自動保存されます。承認は別操作です。</p>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>{autosaveMessage}</strong>
        <span>
          revision {revisionRef.current} / {outlineStatusLabel(draft.status)}
        </span>
      </div>

      {stale ? (
        <section className="message-panel message-panel-warning" role="alert">
          <h2>元資料が変更されているため stale です</h2>
          <p>
            現在の構成案は古い Markdown
            に基づいています。承認前に企画画面で資料を確認し、必要なら構成案を見直してください。
          </p>
          <Link
            className="button"
            to={`/projects/${encodeURIComponent(projectId)}/brief`}
            onClick={navigateToBrief}
          >
            企画画面で資料を確認
          </Link>
          <button
            className="button"
            type="button"
            onClick={() => void markReviewComplete()}
            disabled={
              isEmpty ||
              reviewMutation.isPending ||
              autosaveState.status === "conflict"
            }
          >
            最新資料への見直し完了
          </button>
        </section>
      ) : null}

      {autosaveState.status === "error" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存に失敗しました</h2>
          <p>
            {getErrorMessage(
              autosaveState.error,
              "入力は保持されています。再試行してください。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => coordinatorRef.current?.retry()}
          >
            再試行
          </button>
        </section>
      ) : null}
      {autosaveState.status === "conflict" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存競合</h2>
          <p>
            別の画面でプロジェクトが更新されました。現在の入力は保持しています。最新データを再読込するまで自動保存しません。
          </p>
          <button className="button" type="button" onClick={reloadLatest}>
            最新データを再読込
          </button>
        </section>
      ) : null}
      {isEmpty ? (
        <section
          className="message-panel"
          aria-labelledby="outline-generate-title"
        >
          <h2 id="outline-generate-title">構成案を生成</h2>
          <p>
            既定モデルを初期選択しています。生成に失敗した場合は同じ入力で再試行できます。
          </p>
          {modelsQuery.isPending ? (
            <p className="status-message">モデル一覧を読み込んでいます…</p>
          ) : null}
          {modelsQuery.isError ? (
            <div className="message-panel message-panel-error">
              <p>
                {getErrorMessage(
                  modelsQuery.error,
                  "モデル一覧を取得できませんでした。"
                )}
              </p>
              <button
                className="button"
                type="button"
                onClick={() => void modelsQuery.refetch()}
              >
                モデル一覧を再試行
              </button>
            </div>
          ) : null}
          {modelsQuery.data !== undefined ? (
            <div className="form-field">
              <label htmlFor="outline-model">生成モデル</label>
              <select
                id="outline-model"
                value={selectedModelId ?? ""}
                onChange={(event) =>
                  setSelectedModelId(event.target.value || null)
                }
              >
                {modelsQuery.data.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}（{model.id}）
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {generateMutation.isError ? (
            <p className="form-error" role="alert">
              {getErrorMessage(
                generateMutation.error,
                "構成案の生成に失敗しました。"
              )}
            </p>
          ) : null}
          <button
            className="button button-primary"
            type="button"
            onClick={generate}
            disabled={
              generateMutation.isPending ||
              selectedModelId === null ||
              modelsQuery.isPending
            }
          >
            {generateMutation.isPending ? "生成中…" : "構成案を生成"}
          </button>
        </section>
      ) : (
        <>
          <section
            className="outline-summary-panel"
            aria-label="承認条件の概要"
          >
            <div>
              <strong>未解決質問</strong>
              <span>{unresolvedQuestions}件</span>
            </div>
            <div>
              <strong>順序検証</strong>
              <span>
                {orderErrors.length === 0
                  ? "問題なし"
                  : `${orderErrors.length}件の問題`}
              </span>
            </div>
            <div>
              <strong>sourceHash</strong>
              <span>{stale ? "stale" : "最新"}</span>
            </div>
          </section>
          {orderErrors.length > 0 ? (
            <section
              className="message-panel message-panel-warning"
              role="alert"
            >
              <h2>順序エラー</h2>
              <ul>
                {orderErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="project-form outline-form">
            <QuestionList
              idPrefix="outline"
              label="構成案全体の要確認事項"
              questions={draft.openQuestions}
              onChange={(openQuestions) =>
                updateDraft({ ...draft, openQuestions })
              }
            />
            {draft.sections.map((section, index) => (
              <OutlineSectionCard
                key={section.id}
                section={section}
                index={index}
                sourceId={project.source.id}
                canDelete={
                  !project.script.sections.some(
                    (scriptSection) =>
                      scriptSection.outlineSectionId === section.id
                  )
                }
                onChange={(nextSection) => updateSection(index, nextSection)}
                onDelete={() => removeSection(index)}
                onDuplicate={() => duplicateSection(index)}
                onMove={(direction) => moveSection(index, direction)}
              />
            ))}
            <div className="form-actions">
              <button className="button" type="button" onClick={addSection}>
                セクションを追加
              </button>
            </div>
          </section>
          {approvalError !== null ? (
            <section className="message-panel message-panel-error" role="alert">
              <h2>承認できません</h2>
              <p>
                {getErrorMessage(approvalError, "承認条件を満たしていません。")}
              </p>
              {errorDetails(approvalError).length > 0 ? (
                <ul>
                  {errorDetails(approvalError).map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          <div className="form-actions outline-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => void approve()}
              disabled={
                stale ||
                approveMutation.isPending ||
                autosaveState.status === "conflict"
              }
            >
              {approveMutation.isPending ? "承認中…" : "構成案を承認"}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
