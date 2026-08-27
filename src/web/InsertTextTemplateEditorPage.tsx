import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";

import type {
  InsertTextTemplateDetail,
  InsertTextTemplateUpdateRequest
} from "../schema/api.js";
import {
  INSERT_TEXT_TEMPLATE_CANVAS_WIDTH,
  type InsertTextTemplate
} from "../schema/insert-text-template.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchInsertTextTemplate,
  updateInsertTextTemplate
} from "./lib/api-client";

type TemplateDraft = {
  name: string;
  description: string;
  status: InsertTextTemplate["status"];
  textRect: InsertTextTemplate["textRect"];
  rotationDeg: number;
  fontSize: number;
  fontWeight: number;
  textColor: string;
  textAlign: InsertTextTemplate["textAlign"];
  verticalAlign: InsertTextTemplate["verticalAlign"];
};

function draftFromDetail(detail: InsertTextTemplateDetail): TemplateDraft {
  return {
    name: detail.name,
    description: detail.description,
    status: detail.status,
    textRect: { ...detail.textRect },
    rotationDeg: detail.rotationDeg,
    fontSize: detail.fontSize,
    fontWeight: detail.fontWeight,
    textColor: detail.textColor,
    textAlign: detail.textAlign,
    verticalAlign: detail.verticalAlign
  };
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

function alignItems(
  value: TemplateDraft["verticalAlign"]
): CSSProperties["alignItems"] {
  return value === "top"
    ? "flex-start"
    : value === "bottom"
      ? "flex-end"
      : "center";
}

function justifyContent(
  value: TemplateDraft["textAlign"]
): CSSProperties["justifyContent"] {
  return value === "left"
    ? "flex-start"
    : value === "right"
      ? "flex-end"
      : "center";
}

export function InsertTextTemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [saveState, setSaveState] = useState<
    "saved" | "dirty" | "saving" | "error"
  >("saved");
  const templateQuery = useQuery({
    queryKey: ["insert-text-templates", templateId],
    queryFn: () => fetchInsertTextTemplate(templateId ?? ""),
    enabled: templateId !== undefined,
    retry: false
  });

  useEffect(() => {
    if (templateQuery.data !== undefined) {
      setDraft(draftFromDetail(templateQuery.data));
      setSaveState("saved");
    }
  }, [templateQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (input: InsertTextTemplateUpdateRequest) =>
      updateInsertTextTemplate(templateId ?? "", input),
    onMutate: () => setSaveState("saving"),
    onSuccess: async (template) => {
      setDraft(draftFromDetail(template));
      setSaveState("saved");
      queryClient.setQueryData(["insert-text-templates", templateId], template);
      await queryClient.invalidateQueries({
        queryKey: ["insert-text-templates"]
      });
    },
    onError: () => setSaveState("error")
  });

  if (templateId === undefined) {
    return <Navigate replace to="/insert-text-templates" />;
  }
  if (templateQuery.isError) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/insert-text-templates">一覧へ戻る</Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>テンプレートを取得できません</h1>
          <p>
            {errorMessage(
              templateQuery.error,
              "テンプレートの取得に失敗しました。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void templateQuery.refetch()}
          >
            再読み込み
          </button>
        </section>
      </main>
    );
  }
  if (templateQuery.isPending || draft === null) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/insert-text-templates">一覧へ戻る</Link>
        </p>
        <p className="status-message" role="status">
          挿入文字テンプレートを読み込んでいます…
        </p>
      </main>
    );
  }

  const loadedTemplate = templateQuery.data;

  function updateDraft<K extends keyof TemplateDraft>(
    field: K,
    value: TemplateDraft[K]
  ): void {
    setDraft((current) =>
      current === null ? current : { ...current, [field]: value }
    );
    setSaveState("dirty");
  }

  function updateRect(
    field: keyof TemplateDraft["textRect"],
    value: number
  ): void {
    setDraft((current) =>
      current === null
        ? current
        : {
            ...current,
            textRect: { ...current.textRect, [field]: value }
          }
    );
    setSaveState("dirty");
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (draft === null) {
      return;
    }
    saveMutation.mutate({
      name: draft.name,
      description: draft.description,
      status: draft.status,
      textRect: draft.textRect,
      rotationDeg: draft.rotationDeg,
      fontSize: draft.fontSize,
      fontWeight: draft.fontWeight,
      textColor: draft.textColor,
      textAlign: draft.textAlign,
      verticalAlign: draft.verticalAlign,
      expectedRevision: loadedTemplate.revision
    });
  }

  const previewStyle: CSSProperties = {
    left: `${draft.textRect.x * 100}%`,
    top: `${draft.textRect.y * 100}%`,
    width: `${draft.textRect.width * 100}%`,
    height: `${draft.textRect.height * 100}%`,
    alignItems: alignItems(draft.verticalAlign),
    justifyContent: justifyContent(draft.textAlign),
    transform: `rotate(${draft.rotationDeg}deg)`,
    color: draft.textColor,
    fontSize: `${(draft.fontSize / INSERT_TEXT_TEMPLATE_CANVAS_WIDTH) * 100}cqw`,
    fontWeight: draft.fontWeight,
    textAlign: draft.textAlign,
    whiteSpace: "pre-wrap"
  };

  return (
    <main className="page-shell insert-text-template-editor-page">
      <p className="back-link">
        <Link to="/insert-text-templates">挿入文字テンプレート一覧へ戻る</Link>
      </p>
      <header className="page-header page-header-stacked">
        <p className="eyebrow">挿入文字テンプレート管理</p>
        <h1>{draft.name}</h1>
        <p>revision {loadedTemplate.revision} / canvas 1920 × 1080</p>
      </header>
      {saveMutation.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>保存できませんでした</h2>
          <p>
            {errorMessage(
              saveMutation.error,
              "入力内容を保存できませんでした。"
            )}
          </p>
        </section>
      ) : null}
      <form
        className="insert-text-template-editor-grid"
        noValidate
        onSubmit={submit}
      >
        <section className="insert-text-template-properties">
          <div className="form-field">
            <label htmlFor="insert-text-template-name">名前</label>
            <input
              id="insert-text-template-name"
              type="text"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="insert-text-template-description">説明</label>
            <textarea
              id="insert-text-template-description"
              rows={3}
              value={draft.description}
              onChange={(event) =>
                updateDraft("description", event.target.value)
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="insert-text-template-status">状態</label>
            <select
              id="insert-text-template-status"
              value={draft.status}
              onChange={(event) =>
                updateDraft(
                  "status",
                  event.target.value as TemplateDraft["status"]
                )
              }
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </div>
          <fieldset className="insert-text-template-fieldset">
            <legend>文字矩形（正規化 0〜1）</legend>
            {(["x", "y", "width", "height"] as const).map((field) => (
              <div className="form-field" key={field}>
                <label htmlFor={`insert-text-template-${field}`}>{field}</label>
                <input
                  id={`insert-text-template-${field}`}
                  min={0}
                  max={1}
                  step={0.001}
                  type="number"
                  value={draft.textRect[field]}
                  onChange={(event) =>
                    updateRect(field, Number(event.target.value))
                  }
                />
              </div>
            ))}
          </fieldset>
          <div className="form-field">
            <label htmlFor="insert-text-template-rotation">rotationDeg</label>
            <input
              id="insert-text-template-rotation"
              step={0.1}
              type="number"
              value={draft.rotationDeg}
              onChange={(event) =>
                updateDraft("rotationDeg", Number(event.target.value))
              }
            />
          </div>
          <div className="insert-text-template-two-column">
            <div className="form-field">
              <label htmlFor="insert-text-template-font-size">fontSize</label>
              <input
                id="insert-text-template-font-size"
                min={1}
                step={1}
                type="number"
                value={draft.fontSize}
                onChange={(event) =>
                  updateDraft("fontSize", Number(event.target.value))
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor="insert-text-template-font-weight">
                fontWeight
              </label>
              <input
                id="insert-text-template-font-weight"
                min={1}
                step={1}
                type="number"
                value={draft.fontWeight}
                onChange={(event) =>
                  updateDraft("fontWeight", Number(event.target.value))
                }
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="insert-text-template-color">textColor</label>
            <input
              id="insert-text-template-color"
              pattern="^#[0-9a-fA-F]{6}$"
              type="text"
              value={draft.textColor}
              onChange={(event) => updateDraft("textColor", event.target.value)}
            />
          </div>
          <div className="insert-text-template-two-column">
            <div className="form-field">
              <label htmlFor="insert-text-template-align">textAlign</label>
              <select
                id="insert-text-template-align"
                value={draft.textAlign}
                onChange={(event) =>
                  updateDraft(
                    "textAlign",
                    event.target.value as TemplateDraft["textAlign"]
                  )
                }
              >
                <option value="left">left</option>
                <option value="center">center</option>
                <option value="right">right</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="insert-text-template-vertical-align">
                verticalAlign
              </label>
              <select
                id="insert-text-template-vertical-align"
                value={draft.verticalAlign}
                onChange={(event) =>
                  updateDraft(
                    "verticalAlign",
                    event.target.value as TemplateDraft["verticalAlign"]
                  )
                }
              >
                <option value="top">top</option>
                <option value="center">center</option>
                <option value="bottom">bottom</option>
              </select>
            </div>
          </div>
          <div className="insert-text-template-save-row">
            <span
              className={`screen-template-save-state screen-template-save-state-${saveState}`}
            >
              {saveState === "saved"
                ? "保存済み"
                : saveState === "dirty"
                  ? "未保存の変更があります"
                  : saveState === "saving"
                    ? "保存中…"
                    : "保存に失敗しました"}
            </span>
            <button
              className="button button-primary"
              disabled={saveMutation.isPending}
              type="submit"
            >
              {saveMutation.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </section>
        <section
          className="insert-text-template-preview-panel"
          aria-labelledby="insert-text-template-preview-title"
        >
          <div className="insert-text-template-preview-heading">
            <div>
              <p className="eyebrow">1920 × 1080</p>
              <h2 id="insert-text-template-preview-title">プレビュー</h2>
            </div>
            <span>複数行サンプル</span>
          </div>
          <div className="insert-text-template-preview-canvas">
            <div
              className="insert-text-template-preview-text"
              style={previewStyle}
            >
              {"サンプル文字\n複数行プレビュー"}
            </div>
          </div>
          <p className="insert-text-template-preview-note">
            編集ページではここで設定したレイアウトだけを使い、個別カードからは文字とテンプレートだけを選択します。
          </p>
        </section>
      </form>
    </main>
  );
}
