import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type FormEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams
} from "react-router";
import { ZodError } from "zod";

import {
  projectCreateRequestSchema,
  type ProjectCreateRequest,
  type ProjectSummary
} from "../schema/api.js";
import {
  projectBriefSchema,
  type ProjectBrief,
  type VideoProject,
  type VideoProjectV18
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  createProject,
  fetchProject,
  fetchProjectSource,
  fetchProjects,
  saveProjectBrief,
  saveProjectSource
} from "./lib/api-client";
import {
  AutosaveCoordinator,
  navigateAfterAutosave,
  type AutosaveState
} from "./brief-autosave";
import { sameBriefDraft, type BriefDraft } from "./brief-draft";
import { CharacterAssetsPage } from "./CharacterAssetsPage";
import { AssetsPage } from "./AssetsPage";
import { CharacterVisualsPage } from "./CharacterVisualsPage";
import { EditPage } from "./EditPage";
import { OutlinePage } from "./OutlinePage";
import { ScreenTemplateEditorPage } from "./ScreenTemplateEditorPage";
import { ScreenTemplatesPage } from "./ScreenTemplatesPage";
import { InsertTextTemplateEditorPage } from "./InsertTextTemplateEditorPage";
import { InsertTextTemplatesPage } from "./InsertTextTemplatesPage";
import { ScriptPage } from "./ScriptPage";
import { TerminologyPage } from "./TerminologyPage";
import { PreviewPage } from "./PreviewPage";
import { AiRunsPage } from "./AiRunsPage";
import { VisualAssignmentsPage } from "./VisualAssignmentsPage";
import { WorkflowIndicator } from "./WorkflowIndicator";
import { WorkspaceLayout } from "./WorkspaceLayout";

function projectOutlinePath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/outline`;
}

function projectScriptPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/script`;
}

function projectPreviewPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/preview`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
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

function ProjectSummaryCard({ project }: { project: ProjectSummary }) {
  return (
    <li className="project-card">
      <Link className="project-card-link" to={projectScriptPath(project.id)}>
        <span className="project-card-title">{project.title}</span>
        <span className="project-card-meta">
          {project.department || "部門未設定"}
          {project.manualVersion ? ` / 版数 ${project.manualVersion}` : ""}
        </span>
        <span className="project-card-meta">
          更新番号 {project.revision} ・ 最終更新 {formatDate(project.updatedAt)}
        </span>
      </Link>
    </li>
  );
}

function ProjectsPage() {
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: fetchProjects,
    retry: false
  });

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">subdub</p>
          <h1>プロジェクト一覧</h1>
          <p>動画制作プロジェクトを選択するか、新しく作成します。</p>
        </div>
        <Link className="button button-primary" to="/projects/new">
          新しいプロジェクトを作成
        </Link>
        <Link className="button" to="/terminology">
          用語辞書
        </Link>
        <Link className="button" to="/ai-runs">
          AI実行履歴
        </Link>
      </header>

      {projectsQuery.isPending ? (
        <p className="status-message" role="status">
          プロジェクトを読み込んでいます…
        </p>
      ) : projectsQuery.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>一覧を取得できませんでした</h2>
          <p>
            {getErrorMessage(
              projectsQuery.error,
              "プロジェクト一覧の取得に失敗しました。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void projectsQuery.refetch();
            }}
          >
            再試行
          </button>
        </section>
      ) : projectsQuery.data.length === 0 ? (
        <section className="message-panel" aria-labelledby="empty-projects-title">
          <h2 id="empty-projects-title">プロジェクトはまだありません</h2>
          <p>最初のプロジェクトを作成して、制作を始めましょう。</p>
          <Link className="button button-primary" to="/projects/new">
            最初のプロジェクトを作成
          </Link>
        </section>
      ) : (
        <ul className="project-list">
          {projectsQuery.data.map((project) => (
            <ProjectSummaryCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </main>
  );
}

function NewProjectPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("一般");
  const [manualVersion, setManualVersion] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );

  const createMutation = useMutation({
    mutationFn: (input: ProjectCreateRequest) => createProject(input),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(projectScriptPath(project.metadata.id));
    }
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const result = projectCreateRequestSchema.safeParse({
      title,
      department,
      manualVersion
    });
    if (!result.success) {
      setValidationMessage("タイトルを入力してください。");
      return;
    }

    setValidationMessage(null);
    createMutation.mutate(result.data);
  }

  const isSubmitting = createMutation.isPending;

  return (
    <main className="page-shell narrow-shell">
      <header className="page-header page-header-stacked">
        <p className="eyebrow">新規作成</p>
        <h1>プロジェクトを作成</h1>
        <p>
          プロジェクト名を入力して、企画内容と元資料を登録するところから始めます。
        </p>
      </header>

      <form className="project-form" noValidate onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="project-title">プロジェクト名（必須）</label>
          <input
            id="project-title"
            name="title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={isSubmitting}
            autoComplete="off"
            aria-required="true"
          />
        </div>

        <div className="form-field">
          <label htmlFor="project-department">担当部門（任意）</label>
          <input
            id="project-department"
            name="department"
            type="text"
            value={department}
            onChange={(event) => setDepartment(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        <div className="form-field">
          <label htmlFor="project-manual-version">対象マニュアルの版数（任意）</label>
          <input
            id="project-manual-version"
            name="manualVersion"
            type="text"
            value={manualVersion}
            onChange={(event) => setManualVersion(event.target.value)}
            disabled={isSubmitting}
          />
        </div>

        {validationMessage !== null ? (
          <p className="form-error" role="alert">
            {validationMessage}
          </p>
        ) : null}
        {createMutation.isError ? (
          <p className="form-error" role="alert">
            {getErrorMessage(
              createMutation.error,
              "プロジェクトを作成できませんでした。"
            )}
          </p>
        ) : null}
        {isSubmitting ? (
          <p className="status-message" role="status" aria-live="polite">
            作成しています…
          </p>
        ) : null}

        <div className="form-actions">
          <Link className="button" to="/projects">
            キャンセル
          </Link>
          <button
            className="button button-primary"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "作成中…" : "作成する"}
          </button>
        </div>
      </form>
    </main>
  );
}

type ProjectSaveRequest =
  | {
      kind: "source";
      projectId: string;
      markdown: string;
      expectedRevision: number;
    }
  | {
      kind: "brief";
      projectId: string;
      brief: ProjectBrief;
      expectedRevision: number;
    };

function legacyProjectFromCurrent(
  project: VideoProject | undefined
): VideoProjectV18 | undefined {
  if (
    project === undefined ||
    !("source" in project) ||
    !("brief" in project) ||
    !("outline" in project)
  ) {
    return undefined;
  }
  return project as unknown as VideoProjectV18;
}

function projectToBriefDraft(
  project: VideoProjectV18,
  markdown: string
): BriefDraft {
  return {
    markdown,
    audience: project.brief.audience,
    postViewingGoal: project.brief.postViewingGoal,
    prerequisites: [...project.brief.prerequisites],
    targetDurationSec: String(project.brief.targetDurationSec),
    requiredItems: [...project.brief.requiredItems],
    prohibitedItems: [...project.brief.prohibitedItems],
    globalDirectives: [...project.brief.globalDirectives]
  };
}

function splitItems(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function itemsToText(items: string[]): string {
  return items.join("\n");
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

function ProjectBriefPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const sourceQuery = useQuery({
    queryKey: ["projects", projectId, "source"],
    queryFn: () => fetchProjectSource(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const legacyProject = legacyProjectFromCurrent(projectQuery.data);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    status: "idle",
    error: undefined
  });
  const projectIdRef = useRef(projectId ?? "");
  const revisionRef = useRef(0);
  const draftRef = useRef<BriefDraft | null>(null);
  const lastSavedRef = useRef<BriefDraft | null>(null);
  const initializedForProjectRef = useRef<string | null>(null);
  const saveMutation = useMutation({
    mutationFn: async (request: ProjectSaveRequest): Promise<VideoProject> => {
      if (request.kind === "source") {
        return saveProjectSource(request.projectId, {
          markdown: request.markdown,
          expectedRevision: request.expectedRevision
        });
      }
      return saveProjectBrief(request.projectId, {
        brief: request.brief,
        expectedRevision: request.expectedRevision
      });
    },
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;
  projectIdRef.current = projectId ?? "";

  function updateMutationCaches(
    project: VideoProject,
    request: ProjectSaveRequest
  ): void {
    queryClient.setQueryData(["projects", request.projectId], project);
    queryClient.setQueryData<ProjectSummary[]>(
      ["projects"],
      (summaries) =>
        summaries?.map((summary) =>
          summary.id === project.metadata.id
            ? projectSummaryFromProject(project)
            : summary
        )
    );
    queryClient.setQueryData<
      Awaited<ReturnType<typeof fetchProjectSource>> | undefined
    >(["projects", request.projectId, "source"], (source) => {
      if (source === undefined) {
        return source;
      }
      return {
        ...source,
        revision: project.revision,
        sha256: source.sha256,
        ...(request.kind === "source"
          ? { markdown: request.markdown }
          : {})
      };
    });
  }

  async function saveDraft(nextDraft: BriefDraft): Promise<void> {
    const lastSaved = lastSavedRef.current;
    if (lastSaved === null) {
      return;
    }

    const sourceChanged = nextDraft.markdown !== lastSaved.markdown;
    const briefChanged = !sameBriefDraft(nextDraft, lastSaved);
    if (!sourceChanged && !briefChanged) {
      return;
    }

    const saveProjectId = projectIdRef.current;

    if (sourceChanged) {
      const request = {
        kind: "source" as const,
        projectId: saveProjectId,
        markdown: nextDraft.markdown,
        expectedRevision: revisionRef.current
      };
      const project = await saveMutationRef.current.mutateAsync(request);
      revisionRef.current = project.revision;
      updateMutationCaches(project, request);
      const savedAfterSource = lastSavedRef.current;
      if (savedAfterSource === null) {
        return;
      }
      lastSavedRef.current = {
        ...savedAfterSource,
        markdown: nextDraft.markdown
      };
    }

    const currentDraft = draftRef.current;
    if (
      briefChanged &&
      currentDraft !== null &&
      sameBriefDraft(currentDraft, nextDraft)
    ) {
      const brief = projectBriefSchema.parse({
        audience: nextDraft.audience,
        postViewingGoal: nextDraft.postViewingGoal,
        prerequisites: nextDraft.prerequisites,
        targetDurationSec: Number(nextDraft.targetDurationSec),
        requiredItems: nextDraft.requiredItems,
        prohibitedItems: nextDraft.prohibitedItems,
        globalDirectives: nextDraft.globalDirectives
      });
      const request = {
        kind: "brief" as const,
        projectId: saveProjectId,
        brief,
        expectedRevision: revisionRef.current
      };
      const project = await saveMutationRef.current.mutateAsync(request);
      revisionRef.current = project.revision;
      updateMutationCaches(project, request);
      const savedAfterBrief = lastSavedRef.current;
      if (savedAfterBrief === null) {
        return;
      }
      lastSavedRef.current = {
        ...savedAfterBrief,
        ...nextDraft
      };
    }
  }

  const saveDraftRef = useRef<(nextDraft: BriefDraft) => Promise<void>>(
    async () => undefined
  );
  saveDraftRef.current = saveDraft;
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<BriefDraft> | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [snapshotMismatch, setSnapshotMismatch] = useState(false);
  const snapshotRefetchingRef = useRef(false);
  const snapshotRefetchSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    const nextCoordinator = new AutosaveCoordinator<BriefDraft>({
      debounceMs: 350,
      save: (nextDraft) => saveDraftRef.current(nextDraft),
      isConflict: (error) =>
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "PROJECT_REVISION_CONFLICT",
      onStateChange: setAutosaveState
    });
    setCoordinator(nextCoordinator);
    return () => {
      nextCoordinator.dispose();
    };
  }, []);

  useEffect(() => {
    if (coordinator === null) {
      return;
    }
    initializedForProjectRef.current = null;
    revisionRef.current = 0;
    draftRef.current = null;
    lastSavedRef.current = null;
    snapshotRefetchSignatureRef.current = null;
    snapshotRefetchingRef.current = false;
    setSnapshotMismatch(false);
    setPendingNavigation(false);
    setDraft(null);
    coordinator.reset();
  }, [coordinator, projectId]);

  useEffect(() => {
    if (
      projectId === undefined ||
      coordinator === null ||
      initializedForProjectRef.current === projectId ||
      projectQuery.data === undefined ||
      legacyProject === undefined ||
      sourceQuery.data === undefined ||
      projectQuery.isError ||
      sourceQuery.isError
    ) {
      return;
    }

    if (projectQuery.data.revision !== sourceQuery.data.revision) {
      setSnapshotMismatch(true);
      const signature = `${projectQuery.data.revision}:${sourceQuery.data.revision}`;
      if (
        !snapshotRefetchingRef.current &&
        snapshotRefetchSignatureRef.current !== signature
      ) {
        snapshotRefetchSignatureRef.current = signature;
        snapshotRefetchingRef.current = true;
        void Promise.all([projectQuery.refetch(), sourceQuery.refetch()]).finally(
          () => {
            snapshotRefetchingRef.current = false;
          }
        );
      }
      return;
    }

    setSnapshotMismatch(false);
    snapshotRefetchSignatureRef.current = null;
    const nextDraft = projectToBriefDraft(
      legacyProject,
      sourceQuery.data.markdown
    );
    initializedForProjectRef.current = projectIdRef.current;
    revisionRef.current = projectQuery.data.revision;
    draftRef.current = nextDraft;
    lastSavedRef.current = nextDraft;
    setDraft(nextDraft);
    coordinator.reset();
  }, [
    coordinator,
    legacyProject,
    projectId,
    projectQuery.data,
    projectQuery.isError,
    sourceQuery.data,
    sourceQuery.isError
  ]);

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (projectQuery.data !== undefined && legacyProject === undefined) {
    return <Navigate replace to={projectScriptPath(projectId)} />;
  }

  function updateDraft(nextDraft: BriefDraft): void {
    if (coordinator === null) {
      return;
    }
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    coordinator.update(nextDraft);
  }

  function updateTextField(
    field:
      | "markdown"
      | "audience"
      | "postViewingGoal"
      | "targetDurationSec",
    value: string
  ): void {
    if (draft === null) {
      return;
    }
    updateDraft({ ...draft, [field]: value } as BriefDraft);
  }

  function updateItemsField(
    field:
      | "prerequisites"
      | "requiredItems"
      | "prohibitedItems"
      | "globalDirectives",
    value: string
  ): void {
    if (draft === null) {
      return;
    }
    updateDraft({ ...draft, [field]: splitItems(value) });
  }

  async function reloadLatest(): Promise<void> {
    if (coordinator === null) {
      return;
    }

    setSnapshotMismatch(false);
    snapshotRefetchSignatureRef.current = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [projectResult, sourceResult] = await Promise.all([
        projectQuery.refetch(),
        sourceQuery.refetch()
      ]);
      if (
        projectResult.isSuccess &&
        sourceResult.isSuccess &&
        projectResult.data !== undefined &&
        sourceResult.data !== undefined &&
        legacyProjectFromCurrent(projectResult.data) !== undefined &&
        projectResult.data.revision === sourceResult.data.revision
      ) {
        const nextLegacyProject = legacyProjectFromCurrent(projectResult.data);
        if (nextLegacyProject === undefined) {
          return;
        }
        const nextDraft = projectToBriefDraft(
          nextLegacyProject,
          sourceResult.data.markdown
        );
        initializedForProjectRef.current = projectIdRef.current;
        revisionRef.current = projectResult.data.revision;
        draftRef.current = nextDraft;
        lastSavedRef.current = nextDraft;
        setDraft(nextDraft);
        coordinator.reset();
        return;
      }
    }
    setSnapshotMismatch(true);
  }

  async function navigateAway(
    event: MouseEvent<HTMLAnchorElement>,
    destination = "/projects"
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
      coordinator,
      destination,
      navigate
    );
    if (flushed) {
      return;
    }
    setPendingNavigation(false);
  }

  if (projectQuery.isError || sourceQuery.isError) {
    const error = projectQuery.error ?? sourceQuery.error;
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects" onClick={navigateAway}>
            プロジェクト一覧へ戻る
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>プロジェクトを読み込めませんでした</h1>
          <p>{getErrorMessage(error, "プロジェクトを読み込めませんでした。")}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void reloadLatest();
            }}
          >
            再試行
          </button>
        </section>
      </main>
    );
  }

  if (snapshotMismatch) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects" onClick={navigateAway}>
            プロジェクト一覧へ戻る
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>読み込み中にプロジェクト情報が更新されました</h1>
          <p>
            プロジェクト情報と元資料の更新番号が一致しないため、異なる状態を混ぜないよう編集画面を開始していません。
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void reloadLatest();
            }}
          >
            最新データを再読み込み
          </button>
        </section>
      </main>
    );
  }

  if (
    coordinator === null ||
    projectQuery.isPending ||
    sourceQuery.isPending ||
    draft === null
  ) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects" onClick={navigateAway}>
            プロジェクト一覧へ戻る
          </Link>
        </p>
        <p className="status-message" role="status" aria-live="polite">
          企画入力を読み込んでいます…
        </p>
      </main>
    );
  }

  const autosaveMessage = pendingNavigation
    ? "移動前に保存しています…"
    : autosaveState.status === "saving"
      ? "保存中…"
      : autosaveState.status === "saved"
        ? "保存済み"
        : autosaveState.status === "error"
          ? "保存に失敗しました"
          : autosaveState.status === "conflict"
            ? "保存競合"
            : autosaveState.status === "pending"
              ? "保存待ち"
              : "変更はありません";

  return (
    <main className="page-shell narrow-shell">
      <p className="back-link">
        <Link to="/projects" onClick={navigateAway}>
          プロジェクト一覧へ戻る
        </Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="brief" />
      <header className="page-header page-header-stacked">
        <p className="eyebrow">企画入力</p>
        <h1>{projectQuery.data.metadata.title}</h1>
        <p>
          元資料と動画の企画内容を入力します。編集内容は少し待つと自動保存され、構成案の作成に使われます。
        </p>
        <div className="page-header-actions">
          <Link
            className="button"
            to={projectOutlinePath(projectId)}
            onClick={(event) => {
              void navigateAway(event, projectOutlinePath(projectId));
            }}
          >
            構成案を開く
          </Link>
          <Link
            className="button button-primary"
            to={projectScriptPath(projectId)}
            onClick={(event) => {
              void navigateAway(event, projectScriptPath(projectId));
            }}
          >
            台本を編集
          </Link>
          <Link className="button" to={projectPreviewPath(projectId)}>
            プレビューを開く
          </Link>
        </div>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>{autosaveMessage}</strong>
        <span>更新番号 {projectQuery.data.revision}</span>
      </div>

      {autosaveState.status === "error" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存に失敗しました</h2>
          <p>
            {getErrorMessage(
              autosaveState.error,
              "入力内容は画面に保持されています。準備ができたら再試行してください。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              coordinator.retry();
            }}
          >
            再試行
          </button>
        </section>
      ) : null}

      {autosaveState.status === "conflict" ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存競合</h2>
          <p>
            別の画面またはタブでこのプロジェクトが更新されました。自動保存を停止し、現在の入力内容を保持しています。最新データを再読み込みして続けてください。
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void reloadLatest();
            }}
          >
            最新データを再読み込み
          </button>
        </section>
      ) : null}

      <form
        className="project-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="form-field">
          <label htmlFor="project-source-markdown">元資料（Markdown形式）</label>
          <textarea
            id="project-source-markdown"
            name="markdown"
            rows={14}
            value={draft.markdown}
            placeholder="動画化するマニュアルや手順書の本文を貼り付けてください。"
            onChange={(event) => {
              updateTextField("markdown", event.target.value);
            }}
          />
          <small>見出しや箇条書きを含む元資料を、そのまま入力してください。</small>
        </div>

        <div className="form-field">
          <label htmlFor="project-audience">想定視聴者（誰に向けた動画か）</label>
          <textarea
            id="project-audience"
            name="audience"
            rows={3}
            value={draft.audience}
            placeholder="例：入社直後の社員。業務システムを初めて使う人。"
            onChange={(event) => {
              updateTextField("audience", event.target.value);
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="project-post-viewing-goal">視聴後にできるようになってほしいこと</label>
          <textarea
            id="project-post-viewing-goal"
            name="postViewingGoal"
            rows={3}
            value={draft.postViewingGoal}
            placeholder="例：申請画面を開き、必要項目を入力して送信できる。"
            onChange={(event) => {
              updateTextField("postViewingGoal", event.target.value);
            }}
          />
        </div>

        <div className="form-field">
          <label htmlFor="project-prerequisites">事前に知っておいてほしいこと</label>
          <textarea
            id="project-prerequisites"
            name="prerequisites"
            rows={4}
            value={itemsToText(draft.prerequisites)}
            placeholder="例：社内ポータルにログインできる"
            onChange={(event) => {
              updateItemsField("prerequisites", event.target.value);
            }}
          />
          <small>1項目を1行に入力してください。なければ空欄のままで構いません。</small>
        </div>

        <div className="form-field">
          <label htmlFor="project-target-duration">目標動画時間（秒）</label>
          <input
            id="project-target-duration"
            name="targetDurationSec"
            type="number"
            min={1}
            step={1}
            value={draft.targetDurationSec}
            onChange={(event) => {
              updateTextField("targetDurationSec", event.target.value);
            }}
          />
          <small>完成した動画のおおよその長さを、秒数で入力してください。</small>
        </div>

        <div className="form-field">
          <label htmlFor="project-required-items">動画に必ず含める内容</label>
          <textarea
            id="project-required-items"
            name="requiredItems"
            rows={4}
            value={itemsToText(draft.requiredItems)}
            placeholder="例：申請前に確認する項目を説明する"
            onChange={(event) => {
              updateItemsField("requiredItems", event.target.value);
            }}
          />
          <small>1項目を1行に入力してください。構成案と台本に反映されます。</small>
        </div>

        <div className="form-field">
          <label htmlFor="project-prohibited-items">動画に含めない内容</label>
          <textarea
            id="project-prohibited-items"
            name="prohibitedItems"
            rows={4}
            value={itemsToText(draft.prohibitedItems)}
            placeholder="例：社外秘の具体的な顧客情報"
            onChange={(event) => {
              updateItemsField("prohibitedItems", event.target.value);
            }}
          />
          <small>1項目を1行に入力してください。</small>
        </div>

        <div className="form-field">
          <label htmlFor="project-global-directives">動画全体の注意点</label>
          <textarea
            id="project-global-directives"
            name="globalDirectives"
            rows={4}
            value={itemsToText(draft.globalDirectives)}
            placeholder="例：専門用語には必ず補足説明を付ける"
            onChange={(event) => {
              updateItemsField("globalDirectives", event.target.value);
            }}
          />
          <small>動画全体に適用するルールを、1項目1行で入力してください。</small>
        </div>
      </form>
    </main>
  );
}


function NotFoundPage() {
  return (
    <main className="page-shell narrow-shell">
      <h1>ページが見つかりません</h1>
      <p>指定されたページは存在しません。</p>
      <Link className="button button-primary" to="/projects">
        プロジェクト一覧へ
      </Link>
    </main>
  );
}

export function App() {
  return (
    <WorkspaceLayout>
      <Routes>
        <Route element={<Navigate replace to="/projects" />} path="/" />
        <Route element={<ProjectsPage />} path="/projects" />
        <Route element={<NewProjectPage />} path="/projects/new" />
        <Route element={<ProjectBriefPage />} path="/projects/:projectId/brief" />
        <Route element={<OutlinePage />} path="/projects/:projectId/outline" />
        <Route
          element={<ScriptPage />}
          path="/projects/:projectId/script"
        />
        <Route element={<EditPage />} path="/projects/:projectId/edit" />
        <Route
          element={<VisualAssignmentsPage />}
          path="/projects/:projectId/visual-assignments"
        />
        <Route
          element={<PreviewPage />}
          path="/projects/:projectId/preview"
        />
        <Route
          element={<CharacterAssetsPage />}
          path="/projects/:projectId/characters"
        />
        <Route element={<CharacterVisualsPage />} path="/character-visuals" />
        <Route element={<ScreenTemplatesPage />} path="/screen-templates" />
        <Route
          element={<ScreenTemplateEditorPage />}
          path="/screen-templates/:templateId"
        />
        <Route
          element={<InsertTextTemplatesPage />}
          path="/insert-text-templates"
        />
        <Route
          element={<InsertTextTemplateEditorPage />}
          path="/insert-text-templates/:templateId"
        />
        <Route element={<AssetsPage />} path="/assets" />
        <Route element={<TerminologyPage />} path="/terminology" />
        <Route element={<AiRunsPage />} path="/ai-runs" />
        <Route element={<NotFoundPage />} path="*" />
      </Routes>
    </WorkspaceLayout>
  );
}
