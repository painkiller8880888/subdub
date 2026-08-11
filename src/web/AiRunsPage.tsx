import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";

import {
  ApiClientError,
  ApiClientProtocolError,
  exportAiRuns,
  searchAiRuns
} from "./lib/api-client";
import {
  aiRunTaskKinds,
  buildAiRunExportQuery,
  buildAiRunSearchQuery,
  emptyAiRunFilterDraft,
  type AiRunFilterDraft
} from "./ai-runs-query";
import type { AiRunSearchItem } from "../schema/api.js";

function formatLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function formatDuration(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number, label: string): string {
  return `${label} ${value}`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  return "AI実行ログの取得に失敗しました。";
}

function getExportErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  return "AI実行ログのエクスポートに失敗しました。";
}

function modifiedLabel(value: AiRunSearchItem["modified"]): string {
  if (value === true) {
    return "あり";
  }
  if (value === false) {
    return "なし";
  }
  return "判定不能";
}

function statusLabel(value: AiRunSearchItem["status"]): string {
  switch (value) {
    case "succeeded":
      return "成功";
    case "failed":
      return "失敗";
    case "queued":
      return "待機中";
    case "running":
      return "実行中";
  }
}

function validationLabel(value: AiRunSearchItem["schemaValidation"]): string {
  switch (value) {
    case "passed":
      return "通過";
    case "failed":
      return "失敗";
    case "not_run":
      return "未実施";
  }
}

function updateDraft(
  setDraft: (draft: AiRunFilterDraft) => void,
  draft: AiRunFilterDraft,
  key: keyof AiRunFilterDraft,
  value: string
): void {
  setDraft({ ...draft, [key]: value });
}

function SummaryCard({
  label,
  value,
  detail
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <section className="ai-runs-summary-card">
      <p className="ai-runs-summary-label">{label}</p>
      <p className="ai-runs-summary-value">{value}</p>
      <p className="ai-runs-summary-detail">{detail}</p>
    </section>
  );
}

function RunRow({ item }: { readonly item: AiRunSearchItem }) {
  return (
    <tr>
      <td>
        <strong>{item.projectId}</strong>
        <span className="ai-runs-cell-subtext">{item.runId}</span>
      </td>
      <td>{item.taskKind}</td>
      <td>
        <span>{item.modelId ?? "未解決"}</span>
        <span className="ai-runs-cell-subtext">
          応答: {item.responseModel ?? "—"}
        </span>
      </td>
      <td>
        <span className={`ai-runs-status ai-runs-status-${item.status}`}>
          {statusLabel(item.status)}
        </span>
        <span className="ai-runs-cell-subtext">
          {validationLabel(item.schemaValidation)}
        </span>
        <span className="ai-runs-cell-subtext">
          error: {item.errorCode ?? "—"}
        </span>
      </td>
      <td>
        <span>{formatLocalDateTime(item.queuedAt)}</span>
        <span className="ai-runs-cell-subtext">
          {item.finishedAt === null
            ? "終了時刻なし"
            : formatLocalDateTime(item.finishedAt)}
        </span>
      </td>
      <td>{formatDuration(item.responseTimeMs)}</td>
      <td>
        <span className="ai-runs-decision-counts">
          {formatCount(item.acceptedCount, "採用")}
          {formatCount(item.rejectedCount, "却下")}
          {formatCount(item.undecidedCount, "未判断")}
        </span>
        <span className="ai-runs-cell-subtext">
          候補合計 {item.candidateCount}
        </span>
      </td>
      <td>
        <span
          className={`ai-runs-modified ai-runs-modified-${
            item.modified === null ? "unknown" : item.modified ? "yes" : "no"
          }`}
        >
          {modifiedLabel(item.modified)}
        </span>
      </td>
    </tr>
  );
}

export function AiRunsPage() {
  const [draft, setDraft] = useState<AiRunFilterDraft>({
    ...emptyAiRunFilterDraft
  });
  const [searchQuery, setSearchQuery] = useState(() =>
    buildAiRunSearchQuery(emptyAiRunFilterDraft)
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const aiRunsQuery = useQuery({
    queryKey: ["ai-runs", searchQuery],
    queryFn: () => searchAiRuns(searchQuery),
    retry: false
  });

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try {
      setSearchQuery(buildAiRunSearchQuery(draft, 0));
      setValidationMessage(null);
      setExportError(null);
    } catch {
      setValidationMessage("日付または検索条件を確認してください。");
    }
  }

  function clearSearch(): void {
    const cleared = { ...emptyAiRunFilterDraft };
    setDraft(cleared);
    setSearchQuery(buildAiRunSearchQuery(cleared, 0));
    setValidationMessage(null);
    setExportError(null);
  }

  async function exportAppliedSearch(): Promise<void> {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      const { blob, filename } = await exportAiRuns(
        buildAiRunExportQuery(searchQuery)
      );
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = filename;
        link.click();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch (error) {
      setExportError(getExportErrorMessage(error));
    } finally {
      setIsExporting(false);
    }
  }

  const data = aiRunsQuery.data;
  const summary = data?.summary;

  return (
    <main className="page-shell ai-runs-page">
      <header className="page-header ai-runs-header">
        <div>
          <p className="eyebrow">P6-03</p>
          <h1>AI実行ログ</h1>
          <p>
            複数プロジェクトの AI 実行と候補判断を検索します。モデル ID
            は実行時に解決された値です。
          </p>
        </div>
        <Link className="button" to="/projects">
          プロジェクト一覧
        </Link>
      </header>

      <form className="ai-runs-filter-panel" onSubmit={submitSearch}>
        <div className="ai-runs-filter-grid">
          <div className="form-field">
            <label htmlFor="ai-runs-from">開始日（ローカル）</label>
            <input
              id="ai-runs-from"
              type="date"
              value={draft.from}
              onChange={(event) =>
                updateDraft(setDraft, draft, "from", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-to">終了日（ローカル）</label>
            <input
              id="ai-runs-to"
              type="date"
              value={draft.to}
              onChange={(event) =>
                updateDraft(setDraft, draft, "to", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-task-kind">task kind</label>
            <select
              id="ai-runs-task-kind"
              value={draft.taskKind}
              onChange={(event) =>
                updateDraft(setDraft, draft, "taskKind", event.target.value)
              }
            >
              <option value="">すべて</option>
              {aiRunTaskKinds.map((taskKind) => (
                <option key={taskKind} value={taskKind}>
                  {taskKind}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-model-id">model ID</label>
            <input
              id="ai-runs-model-id"
              type="text"
              value={draft.modelId}
              placeholder="google/gemma-4-31b-it"
              onChange={(event) =>
                updateDraft(setDraft, draft, "modelId", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-status">実行結果</label>
            <select
              id="ai-runs-status"
              value={draft.status}
              onChange={(event) =>
                updateDraft(setDraft, draft, "status", event.target.value)
              }
            >
              <option value="">すべて</option>
              <option value="succeeded">成功</option>
              <option value="failed">失敗</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-decision">候補判断</label>
            <select
              id="ai-runs-decision"
              value={draft.decision}
              onChange={(event) =>
                updateDraft(setDraft, draft, "decision", event.target.value)
              }
            >
              <option value="">すべて</option>
              <option value="accepted">採用あり</option>
              <option value="rejected">却下あり</option>
              <option value="undecided">未判断あり</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="ai-runs-error-code">error code</label>
            <input
              id="ai-runs-error-code"
              type="text"
              value={draft.errorCode}
              placeholder="OPENROUTER_TIMEOUT"
              onChange={(event) =>
                updateDraft(setDraft, draft, "errorCode", event.target.value)
              }
            />
          </div>
        </div>
        {validationMessage !== null ? (
          <p className="form-error" role="alert">
            {validationMessage}
          </p>
        ) : null}
        <div className="ai-runs-filter-actions">
          <button className="button button-primary" type="submit">
            検索
          </button>
          <button className="button" type="button" onClick={clearSearch}>
            条件クリア
          </button>
          <button
            className="button"
            type="button"
            disabled={isExporting}
            onClick={() => void exportAppliedSearch()}
          >
            {isExporting ? "エクスポート中…" : "JSON Linesをエクスポート"}
          </button>
        </div>
        {exportError !== null ? (
          <p className="form-error" role="alert">
            {exportError}
          </p>
        ) : null}
      </form>

      {aiRunsQuery.isPending ? (
        <p className="status-message" role="status">
          AI実行ログを読み込んでいます…
        </p>
      ) : aiRunsQuery.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>AI実行ログを取得できませんでした</h2>
          <p>{getErrorMessage(aiRunsQuery.error)}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void aiRunsQuery.refetch();
            }}
          >
            再試行
          </button>
        </section>
      ) : data === undefined || summary === undefined ? null : (
        <>
          <div className="ai-runs-summary-grid">
            <SummaryCard
              label="実行件数"
              value={String(summary.totalCount)}
              detail="現在の検索条件に一致"
            />
            <SummaryCard
              label="検証通過率"
              value={formatRate(summary.validationPassRate)}
              detail={`${summary.validationPassedCount} / ${summary.validationEvaluatedCount} 件を評価`}
            />
            <SummaryCard
              label="平均応答時間"
              value={formatDuration(summary.averageResponseTimeMs)}
              detail={`${summary.responseTimeMeasuredCount} 件を計測`}
            />
            <SummaryCard
              label="修正あり"
              value={String(summary.modifiedRunCount)}
              detail={`${summary.modifiedRunCount} / ${summary.modificationEvaluatedCount} 件を判定`}
            />
          </div>

          <p className="ai-runs-modified-note">
            「修正あり」は、候補生成後に project revision
            が進んだかを人間による修正の代理指標として表示しています。
          </p>

          {data.items.length === 0 ? (
            <section
              className="message-panel"
              aria-labelledby="empty-ai-runs-title"
            >
              <h2 id="empty-ai-runs-title">該当する AI 実行ログはありません</h2>
              <p>検索条件を変更して、もう一度検索してください。</p>
            </section>
          ) : (
            <>
              <div className="ai-runs-table-wrap">
                <table className="ai-runs-table">
                  <thead>
                    <tr>
                      <th scope="col">プロジェクト / run</th>
                      <th scope="col">task kind</th>
                      <th scope="col">model ID / 応答モデル</th>
                      <th scope="col">結果 / 検証 / error</th>
                      <th scope="col">キュー日時</th>
                      <th scope="col">応答時間</th>
                      <th scope="col">候補判断</th>
                      <th scope="col">修正代理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <RunRow
                        key={`${item.projectId}:${item.runId}`}
                        item={item}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="ai-runs-pagination" aria-label="AI実行ログページ">
                <button
                  className="button"
                  type="button"
                  disabled={searchQuery.offset === 0 || aiRunsQuery.isFetching}
                  onClick={() =>
                    setSearchQuery({
                      ...searchQuery,
                      offset: Math.max(
                        0,
                        searchQuery.offset - searchQuery.limit
                      )
                    })
                  }
                >
                  前のページ
                </button>
                <span>
                  {searchQuery.offset + 1}–
                  {searchQuery.offset + data.items.length} /{" "}
                  {summary.totalCount}
                </span>
                <button
                  className="button"
                  type="button"
                  disabled={!data.hasNextPage || aiRunsQuery.isFetching}
                  onClick={() =>
                    setSearchQuery({
                      ...searchQuery,
                      offset: searchQuery.offset + searchQuery.limit
                    })
                  }
                >
                  次のページ
                </button>
              </nav>
            </>
          )}
        </>
      )}
      {aiRunsQuery.isFetching && !aiRunsQuery.isPending ? (
        <p className="status-message" role="status">
          更新しています…
        </p>
      ) : null}
    </main>
  );
}
