import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import type { ScreenTemplateSummary } from "../schema/api.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  activateScreenTemplate,
  createScreenTemplate,
  deactivateScreenTemplate,
  fetchScreenTemplates
} from "./lib/api-client";

const STANDARD_SCREEN_TEMPLATE_ID = "screen-template-standard";

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

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  return fallback;
}

function statusLabel(status: ScreenTemplateSummary["status"]): string {
  return status === "active" ? "active" : "inactive";
}

function elementSummaryLabel(
  summary: ScreenTemplateSummary["elementSummary"]
): string {
  return [
    `要素 ${summary.total}件`,
    `セリフ ${summary.byType["dialogue-window"]}`,
    `セクション名 ${summary.byType["section-title"]}`,
    `話者 ${summary.byType["character-visual"]}`,
    `content ${summary.byType["content-slot"]}`
  ].join(" / ");
}

export function ScreenTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const templatesQuery = useQuery({
    queryKey: ["screen-templates"],
    queryFn: () => fetchScreenTemplates(),
    retry: false
  });

  const createMutation = useMutation({
    mutationFn: createScreenTemplate,
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({ queryKey: ["screen-templates"] });
      setShowCreateForm(false);
      setName("");
      setDescription("");
      setCreateError(null);
      navigate(`/screen-templates/${encodeURIComponent(template.templateId)}`);
    },
    onError: (error) => {
      setCreateError(
        errorMessage(error, "ScreenTemplateを作成できませんでした。")
      );
    }
  });

  const statusMutation = useMutation({
    mutationFn: ({
      action,
      template
    }: {
      readonly action: "activate" | "deactivate";
      readonly template: ScreenTemplateSummary;
    }) =>
      action === "activate"
        ? activateScreenTemplate(template.templateId, template.revision)
        : deactivateScreenTemplate(template.templateId, template.revision),
    onSuccess: async (template) => {
      queryClient.setQueryData<ScreenTemplateSummary[]>(
        ["screen-templates"],
        (current) =>
          current?.map((candidate) =>
            candidate.templateId === template.templateId
              ? {
                  ...candidate,
                  revision: template.revision,
                  status: template.status,
                  updatedAt: template.updatedAt
                }
              : candidate
          )
      );
      await queryClient.invalidateQueries({ queryKey: ["screen-templates"] });
    }
  });

  function submitCreate(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (name.trim().length === 0) {
      setCreateError("テンプレート名を入力してください。");
      return;
    }
    setCreateError(null);
    createMutation.mutate({
      name,
      description,
      baseTemplateId: STANDARD_SCREEN_TEMPLATE_ID
    });
  }

  if (templatesQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          画面テンプレートを読み込んでいます…
        </p>
      </main>
    );
  }

  if (templatesQuery.isError || templatesQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>画面テンプレートを取得できません</h1>
          <p>
            {errorMessage(templatesQuery.error, "一覧の取得に失敗しました。")}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void templatesQuery.refetch();
            }}
          >
            再読み込み
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell screen-templates-page">
      <header className="page-header screen-templates-header">
        <div>
          <p className="eyebrow">ワークスペース共通ライブラリ</p>
          <h1>画面テンプレート</h1>
          <p>
            16:9の画面構成をテンプレートとして管理します。inactiveも含めて確認できます。
          </p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            setShowCreateForm((current) => !current);
            setCreateError(null);
          }}
        >
          {showCreateForm ? "新規作成を閉じる" : "+ 新規作成"}
        </button>
      </header>

      {showCreateForm ? (
        <form
          className="screen-template-create-panel"
          noValidate
          onSubmit={submitCreate}
        >
          <div>
            <p className="eyebrow">新規作成</p>
            <h2>Standardをベースに作成</h2>
            <p>
              完全な要素セットから開始するため、空の壊れたテンプレートは作成しません。
            </p>
          </div>
          <div className="screen-template-create-fields">
            <div className="form-field">
              <label htmlFor="screen-template-create-name">名前</label>
              <input
                id="screen-template-create-name"
                required
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="screen-template-create-description">
                説明（任意）
              </label>
              <textarea
                id="screen-template-create-description"
                rows={2}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
          </div>
          {createError !== null ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
          <button
            className="button button-primary"
            disabled={createMutation.isPending}
            type="submit"
          >
            {createMutation.isPending ? "作成中…" : "Standardから作成"}
          </button>
        </form>
      ) : null}

      {statusMutation.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>状態を変更できません</h2>
          <p>
            {errorMessage(
              statusMutation.error,
              "最新状態を取得して再試行してください。"
            )}
          </p>
        </section>
      ) : null}

      {templatesQuery.data.length === 0 ? (
        <section className="message-panel">
          <h2>登録済みのテンプレートはありません</h2>
          <p>Standardをベースに最初のテンプレートを作成できます。</p>
        </section>
      ) : (
        <section
          aria-labelledby="screen-template-list-title"
          className="screen-template-list-panel"
        >
          <div className="screen-template-list-header">
            <div>
              <h2 id="screen-template-list-title">登録済みテンプレート</h2>
              <p>active / inactive {templatesQuery.data.length}件</p>
            </div>
            <span>canvas 1920 × 1080</span>
          </div>
          <ul className="screen-template-list">
            {templatesQuery.data.map((template) => {
              const isStatusMutationTarget =
                statusMutation.variables?.template.templateId ===
                template.templateId;
              return (
                <li className="screen-template-card" key={template.templateId}>
                  <div className="screen-template-card-main">
                    <div className="screen-template-card-title-row">
                      <h3>{template.name}</h3>
                      <span
                        className={`screen-template-status screen-template-status-${template.status}`}
                      >
                        {statusLabel(template.status)}
                      </span>
                    </div>
                    <p>{template.description || "説明なし"}</p>
                    <dl className="screen-template-card-details">
                      <div>
                        <dt>更新日時</dt>
                        <dd>{formatDate(template.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>revision</dt>
                        <dd>{template.revision}</dd>
                      </div>
                      <div>
                        <dt>要素</dt>
                        <dd>{elementSummaryLabel(template.elementSummary)}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="screen-template-card-actions">
                    <Link
                      className="button button-primary"
                      to={`/screen-templates/${encodeURIComponent(template.templateId)}`}
                    >
                      編集
                    </Link>
                    <button
                      className="button"
                      disabled={statusMutation.isPending}
                      type="button"
                      onClick={() => {
                        statusMutation.mutate({
                          action:
                            template.status === "active"
                              ? "deactivate"
                              : "activate",
                          template
                        });
                      }}
                    >
                      {isStatusMutationTarget && statusMutation.isPending
                        ? "更新中…"
                        : template.status === "active"
                          ? "利用停止"
                          : "再有効化"}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
