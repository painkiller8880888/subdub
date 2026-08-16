import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import type {
  EditVideoElement,
  SectionBgmAssignment,
  VideoProject
} from "../schema/video-project.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchProject,
  fetchProjectEdit
} from "./lib/api-client";
import {
  createEditPlanReadModel,
  createEditSectionReadModels,
  type EditPlanReadModel,
  type EditSectionReadModel
} from "./edit-page";
import { WorkflowIndicator } from "./WorkflowIndicator";

function projectPath(projectId: string, path: string): string {
  return `/projects/${encodeURIComponent(projectId)}/${path}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "編集情報の応答形式を確認できませんでした。";
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
    (detail) => `${detail.path.join(".") || "project"}: ${detail.message}`
  );
}

function editRoleLabel(role: EditVideoElement["role"]): string {
  switch (role) {
    case "intro":
      return "イントロ";
    case "outro":
      return "アウトロ";
    case "cutin":
      return "カットイン";
  }
}

function assetReference(
  asset: Pick<EditVideoElement, "assetId" | "assetVersion">
): string {
  return `${asset.assetId}（v${asset.assetVersion}）`;
}

function placementLabel(
  element: EditVideoElement,
  sections: VideoProject["script"]["sections"]
): string {
  if (element.role === "intro") {
    return "最初のセクションより前";
  }
  if (element.role === "outro") {
    return "最後のセクションより後";
  }

  const placement = element.placement;
  if (placement.kind !== "before_section") {
    return "セクション境界";
  }

  const section = sections.find(
    (candidate) => candidate.id === placement.sectionId
  );
  const sectionName = section?.name ?? placement.sectionId;
  return `「${sectionName}」の前・順序 ${placement.order + 1}`;
}

function EditVideoElementCard({
  element,
  sections
}: {
  readonly element: EditVideoElement;
  readonly sections: VideoProject["script"]["sections"];
}) {
  return (
    <article className="edit-video-element-card">
      <div>
        <p className="eyebrow">編集要素</p>
        <h3>{editRoleLabel(element.role)}動画</h3>
      </div>
      <dl className="edit-detail-list">
        <div>
          <dt>配置</dt>
          <dd>{placementLabel(element, sections)}</dd>
        </div>
        <div>
          <dt>素材</dt>
          <dd>
            <code>{assetReference(element)}</code>
          </dd>
        </div>
        <div>
          <dt>音量</dt>
          <dd>{element.volume}</dd>
        </div>
      </dl>
    </article>
  );
}

function SectionBgmSlot({
  section,
  bgm
}: {
  readonly section: EditSectionReadModel["section"];
  readonly bgm: SectionBgmAssignment | undefined;
}) {
  return (
    <section
      aria-label={`${section.name}のBGM`}
      className="edit-section-bgm-slot"
    >
      <div>
        <p className="eyebrow">後続 ED-05 の編集領域</p>
        <h3>セクション BGM</h3>
      </div>
      {bgm === undefined ? (
        <p className="edit-empty-state">未設定</p>
      ) : (
        <div className="edit-assigned-state">
          <strong>設定済み</strong>
          <code>{assetReference(bgm)}</code>
          <span>音量 {bgm.volume}</span>
        </div>
      )}
    </section>
  );
}

function EditSectionCard({ model }: { readonly model: EditSectionReadModel }) {
  return (
    <section className="script-section-card edit-section-card">
      <header className="script-section-header">
        <div>
          <p className="eyebrow">セクション {model.order}</p>
          <h2>{model.section.name}</h2>
          <code>{model.section.id}</code>
        </div>
        <span className="edit-section-order">台本順 {model.order}</span>
      </header>
      <SectionBgmSlot section={model.section} bgm={model.bgm} />
    </section>
  );
}

function EditPlanSummary({
  readModel
}: {
  readonly readModel: EditPlanReadModel;
}) {
  if (!readModel.hasVideoElements && !readModel.hasSectionBgms) {
    return null;
  }

  return (
    <section className="edit-plan-summary" aria-label="編集状態">
      <strong>読み取り済みの編集状態</strong>
      <span>動画要素 {readModel.hasVideoElements ? "あり" : "なし"}</span>
      <span>セクション BGM {readModel.hasSectionBgms ? "あり" : "なし"}</span>
    </section>
  );
}

function EditLoadError({
  error,
  projectError,
  onRetry
}: {
  readonly error: unknown;
  readonly projectError: boolean;
  readonly onRetry: () => void;
}) {
  const details = errorDetails(error);
  return (
    <section className="message-panel message-panel-error" role="alert">
      <h1>
        {projectError
          ? "プロジェクトを読み込めませんでした"
          : "編集情報を読み込めませんでした"}
      </h1>
      <p>
        {getErrorMessage(
          error,
          projectError
            ? "プロジェクトの検証または取得に失敗しました。"
            : "編集データの取得に失敗しました。"
        )}
      </p>
      {details.length > 0 ? (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <button className="button" type="button" onClick={onRetry}>
        再試行
      </button>
    </section>
  );
}

export function EditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const editQuery = useQuery({
    queryKey: ["projects", projectId, "edit"],
    queryFn: () => fetchProjectEdit(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  const retry = (): void => {
    void Promise.all([projectQuery.refetch(), editQuery.refetch()]);
  };

  if (projectQuery.isPending || editQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <p className="status-message" role="status" aria-live="polite">
          プロジェクトと編集情報を読み込んでいます…
        </p>
      </main>
    );
  }

  if (projectQuery.isError || editQuery.isError) {
    const error = projectQuery.error ?? editQuery.error;
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <EditLoadError
          error={error}
          projectError={projectQuery.isError}
          onRetry={retry}
        />
      </main>
    );
  }

  const project = projectQuery.data;
  const editResponse = editQuery.data;
  if (project === undefined || editResponse === undefined) {
    return null;
  }

  if (project.revision !== editResponse.revision) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <section className="message-panel message-panel-error" role="alert">
          <h1>読み込み中にプロジェクト情報が更新されました</h1>
          <p>
            プロジェクト本体と編集情報の更新番号が一致しないため、異なる状態を混ぜないよう編集画面を開始していません。
          </p>
          <button className="button" type="button" onClick={retry}>
            最新データを再読み込み
          </button>
        </section>
      </main>
    );
  }

  const readModel = createEditPlanReadModel(editResponse.data);
  const sectionModels = createEditSectionReadModels(
    project.script.sections,
    readModel
  );

  return (
    <main className="page-shell edit-page">
      <p className="back-link">
        <Link to={projectPath(projectId, "script")}>台本へ戻る</Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="edit" />
      <header className="page-header page-header-stacked">
        <p className="eyebrow">編集</p>
        <h1>{project.metadata.title} の編集</h1>
        <p>
          台本のセクション順を正本として、編集要素とセクション BGM
          の現在状態を確認します。操作 UI は後続 Issue で追加します。
        </p>
        <div className="page-header-actions">
          <Link className="button" to={projectPath(projectId, "script")}>
            台本を開く
          </Link>
          <Link className="button" to={projectPath(projectId, "preview")}>
            プレビューを開く
          </Link>
        </div>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>読み込み済み</strong>
        <span>更新番号 {editResponse.revision}</span>
        <span>
          動画要素 {editResponse.data.videoElements.length} / BGM{" "}
          {editResponse.data.sectionBgms.length}
        </span>
      </div>

      <EditPlanSummary readModel={readModel} />

      {sectionModels.length === 0 ? (
        <section className="message-panel" aria-live="polite">
          <h2>台本セクションがありません</h2>
          <p>台本を初期化すると、編集画面にセクションカードが表示されます。</p>
          <Link className="button" to={projectPath(projectId, "script")}>
            台本を開く
          </Link>
        </section>
      ) : (
        <section className="edit-section-list" aria-label="編集セクション">
          {readModel.intro !== undefined ? (
            <EditVideoElementCard
              element={readModel.intro}
              sections={project.script.sections}
            />
          ) : null}
          {sectionModels.map((model) => (
            <div className="edit-section-flow" key={model.section.id}>
              {model.cutins.map((cutin) => (
                <EditVideoElementCard
                  element={cutin}
                  key={cutin.id}
                  sections={project.script.sections}
                />
              ))}
              <EditSectionCard model={model} />
            </div>
          ))}
          {readModel.outro !== undefined ? (
            <EditVideoElementCard
              element={readModel.outro}
              sections={project.script.sections}
            />
          ) : null}
        </section>
      )}
    </main>
  );
}
