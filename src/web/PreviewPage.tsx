import { useQuery } from "@tanstack/react-query";
import { Player } from "@remotion/player";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import { RenderManifestComposition } from "../remotion/composition";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchProjectManifest
} from "./lib/api-client";
import {
  createPreviewPlayerProps,
  createPreviewViewModel
} from "./preview-state";

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "プレビュー応答の形式を確認できませんでした。";
  }
  return "プレビュー情報を取得できませんでした。";
}

export function PreviewPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const manifestQuery = useQuery({
    queryKey: ["projects", projectId, "manifest"],
    queryFn: () => fetchProjectManifest(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (manifestQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
            プロジェクト概要へ戻る
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
          <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
            プロジェクト概要へ戻る
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

  return (
    <main className="page-shell preview-page">
      <p className="back-link">
        <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
          プロジェクト概要へ戻る
        </Link>
      </p>
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

      {playerProps !== null ? (
        <section className="preview-player-panel" aria-label="動画プレビュー">
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
        </section>
      ) : data.manifest === null ? (
        <section
          className="message-panel"
          aria-labelledby="preview-empty-title"
        >
          <h2 id="preview-empty-title">プレビューはまだ生成されていません</h2>
          <p>
            構成案、台本、ビジュアル、音声を確認してからプレビューを生成できます。
          </p>
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
