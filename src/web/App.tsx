import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
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
  ApiClientError,
  ApiClientProtocolError,
  createProject,
  fetchProject,
  fetchProjects
} from "./api/client";

function projectBriefPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/brief`;
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
      <Link className="project-card-link" to={projectBriefPath(project.id)}>
        <span className="project-card-title">{project.title}</span>
        <span className="project-card-meta">
          {project.department || "部門未設定"}
          {project.manualVersion ? ` / 版数 ${project.manualVersion}` : ""}
        </span>
        <span className="project-card-meta">
          revision {project.revision} ・ 更新 {formatDate(project.updatedAt)}
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
          新規プロジェクト
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
            プロジェクトを作成
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
  const [department, setDepartment] = useState("General");
  const [manualVersion, setManualVersion] = useState("");
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );

  const createMutation = useMutation({
    mutationFn: (input: ProjectCreateRequest) => createProject(input),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      navigate(projectBriefPath(project.metadata.id));
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
        <p>タイトルを入力すると、空の制作プロジェクトを作成できます。</p>
      </header>

      <form className="project-form" noValidate onSubmit={handleSubmit}>
        <div className="form-field">
          <label htmlFor="project-title">タイトル（必須）</label>
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
          <label htmlFor="project-department">部門（任意）</label>
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
          <label htmlFor="project-manual-version">版数（任意）</label>
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

function ProjectBriefPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  return (
    <main className="page-shell narrow-shell">
      <p className="back-link">
        <Link to="/projects">← プロジェクト一覧へ戻る</Link>
      </p>
      {projectQuery.isPending ? (
        <p className="status-message" role="status">
          プロジェクトを読み込んでいます…
        </p>
      ) : projectQuery.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h1>プロジェクトを読み込めませんでした</h1>
          <p>
            {getErrorMessage(
              projectQuery.error,
              "プロジェクト詳細の取得に失敗しました。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void projectQuery.refetch();
            }}
          >
            再試行
          </button>
        </section>
      ) : (
        <>
          <header className="page-header page-header-stacked">
            <p className="eyebrow">プロジェクト詳細</p>
            <h1>{projectQuery.data.metadata.title}</h1>
            <p>現在のプロジェクト情報を確認できます。</p>
          </header>
          <dl className="detail-list">
            <div>
              <dt>ID</dt>
              <dd>{projectQuery.data.metadata.id}</dd>
            </div>
            <div>
              <dt>revision</dt>
              <dd>{projectQuery.data.revision}</dd>
            </div>
            <div>
              <dt>部門</dt>
              <dd>{projectQuery.data.metadata.department || "未設定"}</dd>
            </div>
            <div>
              <dt>版数</dt>
              <dd>{projectQuery.data.metadata.manualVersion || "未設定"}</dd>
            </div>
            <div>
              <dt>更新日時</dt>
              <dd>{formatDate(projectQuery.data.metadata.updatedAt)}</dd>
            </div>
          </dl>
          <p className="scope-note">
            この画面では読み込み確認のみを行います。企画編集や自動保存は次の工程で追加します。
          </p>
        </>
      )}
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
    <Routes>
      <Route element={<Navigate replace to="/projects" />} path="/" />
      <Route element={<ProjectsPage />} path="/projects" />
      <Route element={<NewProjectPage />} path="/projects/new" />
      <Route element={<ProjectBriefPage />} path="/projects/:projectId/brief" />
      <Route element={<NotFoundPage />} path="*" />
    </Routes>
  );
}
