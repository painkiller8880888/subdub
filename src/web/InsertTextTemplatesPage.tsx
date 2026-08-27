import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";

import type { InsertTextTemplateSummary } from "../schema/api.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  activateInsertTextTemplate,
  createInsertTextTemplate,
  deactivateInsertTextTemplate,
  fetchInsertTextTemplates
} from "./lib/api-client";

const DEFAULT_TEMPLATE_VALUES = {
  textRect: { x: 0.1, y: 0.75, width: 0.8, height: 0.16 },
  rotationDeg: 0,
  fontSize: 64,
  fontWeight: 700,
  textColor: "#ffffff",
  textAlign: "center" as const,
  verticalAlign: "center" as const
};

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

function statusLabel(status: InsertTextTemplateSummary["status"]): string {
  return status === "active" ? "active" : "inactive";
}

export function InsertTextTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const templatesQuery = useQuery({
    queryKey: ["insert-text-templates"],
    queryFn: () => fetchInsertTextTemplates(),
    retry: false
  });
  const createMutation = useMutation({
    mutationFn: createInsertTextTemplate,
    onSuccess: async (template) => {
      await queryClient.invalidateQueries({
        queryKey: ["insert-text-templates"]
      });
      setShowCreateForm(false);
      setName("");
      setDescription("");
      setCreateError(null);
      navigate(
        `/insert-text-templates/${encodeURIComponent(template.templateId)}`
      );
    },
    onError: (error) => {
      setCreateError(
        errorMessage(error, "InsertTextTemplateを作成できませんでした。")
      );
    }
  });
  const statusMutation = useMutation({
    mutationFn: ({
      action,
      template
    }: {
      readonly action: "activate" | "deactivate";
      readonly template: InsertTextTemplateSummary;
    }) =>
      action === "activate"
        ? activateInsertTextTemplate(template.templateId, template.revision)
        : deactivateInsertTextTemplate(template.templateId, template.revision),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["insert-text-templates"]
      });
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
      status: "active",
      ...DEFAULT_TEMPLATE_VALUES
    });
  }

  if (templatesQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          挿入文字テンプレートを読み込んでいます…
        </p>
      </main>
    );
  }

  if (templatesQuery.isError || templatesQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>挿入文字テンプレートを取得できません</h1>
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
    <main className="page-shell insert-text-templates-page">
      <header className="page-header page-header-stacked">
        <p className="eyebrow">ワークスペース共通ライブラリ</p>
        <h1>挿入文字テンプレート</h1>
        <p>
          イントロ・アウトロ・アイキャッチの動画上に重ねる文字レイアウトを管理します。canvas
          は 1920 × 1080 固定です。
        </p>
        <div className="page-header-actions">
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
        </div>
      </header>

      {showCreateForm ? (
        <form
          className="insert-text-template-create-panel"
          noValidate
          onSubmit={submitCreate}
        >
          <div>
            <p className="eyebrow">新規作成</p>
            <h2>基本レイアウトから作成</h2>
            <p>作成後に位置・文字サイズ・揃え方を編集できます。</p>
          </div>
          <div className="insert-text-template-create-fields">
            <div className="form-field">
              <label htmlFor="insert-text-template-create-name">名前</label>
              <input
                id="insert-text-template-create-name"
                required
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="insert-text-template-create-description">
                説明（任意）
              </label>
              <textarea
                id="insert-text-template-create-description"
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
            {createMutation.isPending ? "作成中…" : "作成して編集"}
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

      <section
        className="insert-text-template-list-panel"
        aria-labelledby="insert-text-template-list-title"
      >
        <div className="insert-text-template-list-header">
          <div>
            <h2 id="insert-text-template-list-title">登録済みテンプレート</h2>
            <p>active / inactive {templatesQuery.data.length}件</p>
          </div>
          <span>canvas 1920 × 1080</span>
        </div>
        {templatesQuery.data.length === 0 ? (
          <p className="edit-empty-state">
            登録済みのテンプレートはありません。
          </p>
        ) : (
          <ul className="insert-text-template-list">
            {templatesQuery.data.map((template) => {
              const isTarget =
                statusMutation.variables?.template.templateId ===
                template.templateId;
              return (
                <li
                  className="insert-text-template-card"
                  key={template.templateId}
                >
                  <div>
                    <div className="insert-text-template-title-row">
                      <h3>{template.name}</h3>
                      <span
                        className={`screen-template-status screen-template-status-${template.status}`}
                      >
                        {statusLabel(template.status)}
                      </span>
                    </div>
                    <p>{template.description || "説明なし"}</p>
                    <dl className="insert-text-template-details">
                      <div>
                        <dt>更新日時</dt>
                        <dd>{formatDate(template.updatedAt)}</dd>
                      </div>
                      <div>
                        <dt>revision</dt>
                        <dd>{template.revision}</dd>
                      </div>
                      <div>
                        <dt>文字</dt>
                        <dd>
                          {template.fontSize}px / {template.fontWeight} /{" "}
                          {template.textColor}
                        </dd>
                      </div>
                    </dl>
                  </div>
                  <div className="screen-template-card-actions">
                    <Link
                      className="button button-primary"
                      to={`/insert-text-templates/${encodeURIComponent(template.templateId)}`}
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
                      {isTarget && statusMutation.isPending
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
        )}
      </section>
    </main>
  );
}
