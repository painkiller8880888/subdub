import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Player } from "@remotion/player";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import { RenderManifestComposition } from "../remotion/composition";
import {
  previewPresetDefinitions,
  previewPresetSchema,
  type PreviewPreset
} from "../schema/render-profile";
import {
  ApiClientError,
  ApiClientProtocolError,
  compileProjectManifest,
  enqueueProjectPreviewRender,
  fetchProjectManifest,
  fetchProjectRenderStatus,
  projectPreviewDownloadUrl
} from "./lib/api-client";
import {
  createPreviewCompileDiagnosticViewModel,
  createPreviewPlayerProps,
  createPreviewViewModel
} from "./preview-state";
import { WorkflowIndicator } from "./WorkflowIndicator";

type PreviewRun = {
  readonly runId: string;
  readonly previewPreset: PreviewPreset;
};

function getErrorMessage(
  error: unknown,
  fallback = "プレビュー情報を取得できませんでした。"
): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "プレビュー応答の形式を確認できませんでした。";
  }
  return fallback;
}

function errorDetails(error: unknown): readonly string[] {
  if (!(error instanceof ApiClientError)) {
    return [];
  }
  return error.details.map(
    (detail) => `${detail.path.join(".") || "project"}: ${detail.message}`
  );
}

export function PreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [previewPreset, setPreviewPreset] = useState<PreviewPreset>("hd");
  const [previewRun, setPreviewRun] = useState<PreviewRun | null>(null);
  const manifestQuery = useQuery({
    queryKey: ["projects", projectId, "manifest"],
    queryFn: () => fetchProjectManifest(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const compileMutation = useMutation({
    mutationFn: () => compileProjectManifest(projectId ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "manifest"]
      });
    }
  });
  const previewRenderMutation = useMutation({
    mutationFn: () =>
      enqueueProjectPreviewRender(projectId ?? "", previewPreset),
    onMutate: () => {
      setPreviewRun(null);
    },
    onSuccess: (accepted) => {
      setPreviewRun({
        runId: accepted.runId,
        previewPreset: accepted.previewPreset
      });
    }
  });
  const previewStatusQuery = useQuery({
    queryKey: ["projects", projectId, "preview-render", previewRun?.runId],
    queryFn: () =>
      fetchProjectRenderStatus(projectId ?? "", previewRun?.runId ?? ""),
    enabled: projectId !== undefined && previewRun !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "running" ? 1000 : false;
    }
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (manifestQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/script`}>
            台本へ戻る
          </Link>
        </p>
        <p className="status-message" role="status">
          プレビュー情報を読み込んでいます…
        </p>
      </main>
    );
  }

  if (manifestQuery.isError) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/script`}>
            台本へ戻る
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>プレビューを読み込めませんでした</h1>
          <p>{getErrorMessage(manifestQuery.error)}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void manifestQuery.refetch();
            }}
          >
            再試行
          </button>
        </section>
      </main>
    );
  }

  const data = manifestQuery.data;
  const viewModel = createPreviewViewModel(data, projectId);
  const playerProps = createPreviewPlayerProps(data, projectId);
  const noEnabledSection = data.blockers.some(
    (blocker) => blocker.code === "NO_ENABLED_SECTION"
  );
  const compileDiagnostics =
    compileMutation.data?.status === "failed"
      ? createPreviewCompileDiagnosticViewModel(
          compileMutation.data.diagnostics
        )
      : [];
  const previewStatus = previewStatusQuery.data;
  const previewRenderInProgress =
    previewRenderMutation.isPending ||
    previewStatus?.status === "queued" ||
    previewStatus?.status === "running";
  let previewDownloadUrl: string | null = null;
  if (previewStatus?.status === "succeeded") {
    try {
      previewDownloadUrl = projectPreviewDownloadUrl(
        projectId,
        previewStatus.outputPath
      );
    } catch {
      previewDownloadUrl = null;
    }
  }

  return (
    <main className="page-shell preview-page">
      <p className="back-link">
        <Link to={`/projects/${encodeURIComponent(projectId)}/script`}>
          台本へ戻る
        </Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="output" />
      <header className="page-header page-header-stacked">
        <p className="eyebrow">動画プレビュー</p>
        <h1>{data.project.title}</h1>
        <p>保存済みの動画構成情報を、MP4出力と同じ条件で画面上に表示します。</p>
      </header>

      <section
        className="preview-status-panel"
        aria-labelledby="preview-status-title"
      >
        <div>
          <p className="eyebrow">プレビュー状態</p>
          <h2 id="preview-status-title">{viewModel.stateLabel}</h2>
          <p>{viewModel.stateDescription}</p>
        </div>
        <div className="preview-play-status">
          <button
            className="button button-primary"
            type="button"
            disabled={compileMutation.isPending || noEnabledSection}
            onClick={() => compileMutation.mutate()}
          >
            {noEnabledSection
              ? "有効なセクションがありません"
              : compileMutation.isPending
                ? "プレビューを作成中…"
                : data.manifest === null
                  ? "プレビューを作成"
                  : "プレビューを更新"}
          </button>
          <button
            className="button"
            type="button"
            disabled={!viewModel.canPlay}
            aria-describedby="preview-play-disabled-reason"
          >
            {viewModel.canPlay ? "再生できます" : "再生できません"}
          </button>
          <p id="preview-play-disabled-reason">
            {viewModel.canPlay
              ? "下の再生画面で動画を確認できます。"
              : "前工程または素材に未解決の問題があるため、実行操作を無効にしています。"}
          </p>
        </div>
      </section>

      {compileMutation.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>プレビューを作成できませんでした</h2>
          <p>
            {getErrorMessage(
              compileMutation.error,
              "プレビュー作成に必要な情報を確認できませんでした。"
            )}
          </p>
          {errorDetails(compileMutation.error).length > 0 ? (
            <ul>
              {errorDetails(compileMutation.error).map((detail) => (
                <li key={detail}>{detail}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {noEnabledSection ? (
        <section className="message-panel message-panel-warning" role="alert">
          <h2>レンダリング対象の有効なセクションがありません</h2>
          <p>
            セクションのデータは保持されています。台本画面で再有効化するか、新しいセクションを追加すると、プレビューとMP4出力を再開できます。
          </p>
          <Link
            className="button"
            to={`/projects/${encodeURIComponent(projectId)}/script`}
          >
            台本でセクションを確認
          </Link>
        </section>
      ) : null}

      {compileDiagnostics.length > 0 ? (
        <section
          aria-labelledby="preview-compile-diagnostics-title"
          className="preview-blockers preview-compile-diagnostics"
          role="alert"
        >
          <h2 id="preview-compile-diagnostics-title">
            プレビュー作成に不足している項目
          </h2>
          <p>次の項目を解消してから、もう一度プレビューを作成してください。</p>
          <ul>
            {compileDiagnostics.map(({ diagnostic, target, title }) => (
              <li
                key={`${diagnostic.code}-${diagnostic.path.join(".")}-${target}`}
              >
                <div>
                  <strong>{title}</strong>
                  <span className="preview-diagnostic-target">{target}</span>
                  <span className="preview-blocker-code">
                    {diagnostic.code}
                  </span>
                  <small>{diagnostic.message}</small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {viewModel.previousSuccess ? (
        <section className="message-panel preview-previous-panel">
          <h2>以前の成功プレビュー</h2>
          <p>
            現在の入力では再生できませんが、保存済みの以前の成果物は削除せず状態を表示しています。
          </p>
        </section>
      ) : null}

      {viewModel.blockers.length > 0 ? (
        <section
          className="preview-blockers"
          aria-labelledby="preview-blockers-title"
        >
          <h2 id="preview-blockers-title">対応が必要な項目</h2>
          <ul>
            {viewModel.blockers.map((blocker) => (
              <li
                key={`${blocker.blocker.code}-${JSON.stringify(blocker.blocker.target)}`}
              >
                <div>
                  <strong>{blocker.message}</strong>
                  <span className="preview-blocker-code">
                    {blocker.blocker.code}
                  </span>
                </div>
                <Link className="button" to={blocker.href}>
                  {blocker.targetLabel}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="preview-player-panel" aria-label="動画プレビュー">
        <div className="preview-export-controls">
          <div>
            <p className="eyebrow">プレビューを保存</p>
            <label htmlFor="preview-export-preset">保存解像度</label>
            <select
              id="preview-export-preset"
              value={previewPreset}
              disabled={previewRenderInProgress || compileMutation.isPending}
              onChange={(event) => {
                const parsedPreset = previewPresetSchema.safeParse(
                  event.target.value
                );
                if (parsedPreset.success) {
                  setPreviewPreset(parsedPreset.data);
                }
              }}
            >
              {previewPresetDefinitions.map(({ preset, width, height }) => (
                <option key={preset} value={preset}>
                  {preset.toUpperCase()}（{width}×{height}）
                </option>
              ))}
            </select>
          </div>
          <button
            className="button button-primary"
            type="button"
            disabled={
              !viewModel.canPlay ||
              noEnabledSection ||
              manifestQuery.isFetching ||
              compileMutation.isPending ||
              compileMutation.isError ||
              compileMutation.data?.status === "failed" ||
              compileDiagnostics.length > 0 ||
              previewRenderInProgress
            }
            onClick={() => previewRenderMutation.mutate()}
          >
            {previewRenderInProgress
              ? "プレビューを保存中…"
              : "プレビューを保存"}
          </button>
        </div>
        {previewRenderMutation.isError ? (
          <p className="status-message status-message-error" role="alert">
            {getErrorMessage(
              previewRenderMutation.error,
              "プレビューを保存できませんでした。"
            )}
          </p>
        ) : null}
        {previewStatusQuery.isError ? (
          <p className="status-message status-message-error" role="alert">
            {getErrorMessage(
              previewStatusQuery.error,
              "プレビュー保存の状態を取得できませんでした。"
            )}
          </p>
        ) : null}
        {previewRun !== null && !previewStatusQuery.isError ? (
          <div
            className="preview-export-status"
            role={previewStatus?.status === "failed" ? "alert" : "status"}
          >
            <p>
              {previewStatus === undefined
                ? `${previewRun.previewPreset.toUpperCase()}の保存を受け付けました。`
                : previewStatus.status === "queued"
                  ? `${previewRun.previewPreset.toUpperCase()}を保存する準備をしています…`
                  : previewStatus.status === "running"
                    ? `${previewRun.previewPreset.toUpperCase()}を保存しています…`
                    : previewStatus.status === "succeeded"
                      ? `${previewRun.previewPreset.toUpperCase()}のプレビューを保存しました。`
                      : `${previewRun.previewPreset.toUpperCase()}の保存に失敗しました。（エラーコード: ${previewStatus.errorCode}）`}
            </p>
            {previewDownloadUrl !== null ? (
              <a className="button" href={previewDownloadUrl} download>
                保存したプレビューを取得
              </a>
            ) : null}
          </div>
        ) : null}
        {playerProps !== null ? (
          <Player
            component={RenderManifestComposition}
            inputProps={playerProps.inputProps}
            durationInFrames={playerProps.durationInFrames}
            fps={playerProps.fps}
            compositionWidth={playerProps.compositionWidth}
            compositionHeight={playerProps.compositionHeight}
            controls
            acknowledgeRemotionLicense
            style={{ width: "100%", aspectRatio: "16 / 9" }}
            errorFallback={({ error }) => (
              <div className="message-panel message-panel-error" role="alert">
                <h2>動画プレビューを表示できませんでした</h2>
                <p>{error.message || "動画プレビューの描画に失敗しました。"}</p>
              </div>
            )}
          />
        ) : null}
      </section>
      {data.manifest === null ? (
        <section
          className="message-panel"
          aria-labelledby="preview-empty-title"
        >
          <h2 id="preview-empty-title">プレビューはまだ生成されていません</h2>
          <p>台本、ビジュアル、音声を確認してからプレビューを生成できます。</p>
          <Link
            className="button button-primary"
            to={`/projects/${encodeURIComponent(projectId)}/script`}
          >
            台本と音声を確認
          </Link>
        </section>
      ) : null}
    </main>
  );
}
