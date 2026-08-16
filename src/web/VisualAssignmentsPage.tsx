import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import type { ProjectSummary } from "../schema/api.js";
import type {
  AssetDetail,
  VideoProject,
  VisualAssignment
} from "../schema/index.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  deleteProjectVisualAssignment,
  fetchAsset,
  fetchProject,
  updateProjectVisualAssignment
} from "./lib/api-client";
import { VisualAssignmentPanel } from "./VisualAssignmentPanel";
import { assignmentInput } from "./visual-assignment-editor";
import { WorkflowIndicator } from "./WorkflowIndicator";

type SaveVisualAssignmentInput = {
  readonly assignment: VisualAssignment;
  readonly assignmentId: string;
  readonly expectedRevision: number;
};

type RemoveVisualAssignmentInput = {
  readonly assignmentId: string;
  readonly expectedRevision: number;
};

export function visualAssignmentsPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/visual-assignments`;
}

function projectScriptPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/script`;
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

export function VisualAssignmentsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const assetIds = [
    ...new Set(
      (projectQuery.data?.visuals.assignments ?? []).map(
        (assignment) => assignment.assetId
      )
    )
  ];
  const assetQueries = useQueries({
    queries: assetIds.map((assetId) => ({
      queryKey: ["assets", assetId],
      queryFn: () => fetchAsset(assetId),
      retry: false
    }))
  });
  const revisionRef = useRef(0);
  const [mutationError, setMutationError] = useState<unknown>(null);

  useEffect(() => {
    revisionRef.current = projectQuery.data?.revision ?? 0;
  }, [projectId, projectQuery.data]);

  function adoptSavedProject(project: VideoProject): void {
    queryClient.setQueryData(["projects", project.metadata.id], project);
    queryClient.setQueryData<ProjectSummary[]>(["projects"], (projects) =>
      projects?.map((summary) =>
        summary.id === project.metadata.id
          ? projectSummaryFromProject(project)
          : summary
      )
    );
    revisionRef.current = project.revision;
  }

  const updateMutation = useMutation({
    mutationFn: ({
      assignment,
      assignmentId,
      expectedRevision
    }: SaveVisualAssignmentInput) =>
      updateProjectVisualAssignment(projectId ?? "", assignmentId, {
        assignment: assignmentInput(assignment),
        expectedRevision
      }),
    retry: false
  });
  const removeMutation = useMutation({
    mutationFn: ({
      assignmentId,
      expectedRevision
    }: RemoveVisualAssignmentInput) =>
      deleteProjectVisualAssignment(projectId ?? "", assignmentId, {
        expectedRevision
      }),
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (projectQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <p className="status-message" role="status" aria-live="polite">
          プロジェクトと現場素材の表示設定を読み込んでいます…
        </p>
      </main>
    );
  }

  if (projectQuery.isError || projectQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>現場素材の表示設定を読み込めません</h1>
          <p>
            {getErrorMessage(
              projectQuery.error,
              "プロジェクトを取得できませんでした。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void projectQuery.refetch()}
          >
            再試行
          </button>
        </section>
      </main>
    );
  }

  const project = projectQuery.data;
  const assets = new Map<string, AssetDetail | undefined>();
  assetIds.forEach((assetId, index) => {
    assets.set(assetId, assetQueries[index]?.data);
  });
  const assetQueryError = assetQueries.find((query) => query.isError)?.error;

  async function saveAssignment(
    assignment: VisualAssignment
  ): Promise<boolean> {
    setMutationError(null);
    try {
      const saved = await updateMutation.mutateAsync({
        assignment,
        assignmentId: assignment.id,
        expectedRevision: revisionRef.current
      });
      adoptSavedProject(saved);
      return true;
    } catch (error) {
      setMutationError(error);
      return false;
    }
  }

  async function removeAssignment(assignmentId: string): Promise<void> {
    setMutationError(null);
    try {
      const saved = await removeMutation.mutateAsync({
        assignmentId,
        expectedRevision: revisionRef.current
      });
      adoptSavedProject(saved);
    } catch (error) {
      setMutationError(error);
    }
  }

  const isMutating = updateMutation.isPending || removeMutation.isPending;
  const scriptPath = projectScriptPath(projectId);

  return (
    <main className="page-shell visual-assignments-page">
      <p className="back-link">
        <Link to={scriptPath}>台本へ戻る</Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="production" />
      <header className="page-header page-header-stacked">
        <p className="eyebrow">補助画面</p>
        <h1>現場素材の表示設定</h1>
        <p>
          {project.metadata.title}
          に割り当て済みの動画・画像・帳票素材について、表示範囲や動画の音量を編集します。台本の標準編集画面とは分離した画面です。
        </p>
        <div className="page-header-actions">
          <Link className="button" to={scriptPath}>
            台本を開く
          </Link>
        </div>
      </header>

      <div className="autosave-status" role="status" aria-live="polite">
        <strong>設定は各カードの保存ボタンで保存します</strong>
        <span>更新番号 {project.revision}</span>
        <span>割り当て {project.visuals.assignments.length}件</span>
      </div>

      {mutationError !== null ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>表示設定を保存できませんでした</h2>
          <p>
            {getErrorMessage(
              mutationError,
              "現在の変更内容はカードに保持されています。"
            )}
          </p>
        </section>
      ) : null}
      {assetQueryError !== undefined ? (
        <section className="message-panel message-panel-warning" role="status">
          <h2>一部の素材情報を確認できません</h2>
          <p>
            {getErrorMessage(
              assetQueryError,
              "素材の詳細を取得できませんでした。表示設定の編集は続けられます。"
            )}
          </p>
        </section>
      ) : null}

      <VisualAssignmentPanel
        project={project}
        assets={assets}
        onSave={saveAssignment}
        onRemove={removeAssignment}
        isMutating={isMutating}
      />
    </main>
  );
}
