import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useState } from "react";
import { Link } from "react-router";
import { ZodError } from "zod";

import {
  terminologyListQuerySchema,
  type TerminologyListQuery
} from "../schema/api.js";
import {
  terminologyCategorySuggestions,
  terminologyReadingInputSchema
} from "../schema/terminology.js";
import {
  ApiClientError,
  activateTerminology,
  createTerminology,
  deactivateTerminology,
  fetchTerminology,
  updateTerminology
} from "./lib/api-client";
import { TerminologyPreview } from "./TerminologyPreview";
import {
  emptyTerminologyForm,
  terminologyFormToCreateInput,
  terminologyFormToUpdateInput,
  terminologyToForm,
  type TerminologyFormState
} from "./terminology-form";
import { hasTerminologyListFilters } from "./terminology-page-state";
import { TerminologyStatusError } from "./terminology-status-error";

type FilterFormState = {
  surface: string;
  reading: string;
  category: string;
  status: "" | "active" | "inactive";
};

const emptyFilterForm: FilterFormState = {
  surface: "",
  reading: "",
  category: "",
  status: ""
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    if (error.code === "TERMINOLOGY_DUPLICATE") {
      return "同じ表記の用語が既に登録されています。";
    }
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  return fallback;
}

function getValidationMessage(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "入力内容を確認してください。";
  }
  return "入力内容を確認してください。";
}

function terminologyStatusLabel(status: "active" | "inactive"): string {
  return status === "active" ? "有効" : "無効";
}

function formField(
  form: TerminologyFormState,
  setForm: (next: TerminologyFormState) => void,
  field: keyof TerminologyFormState
) {
  return {
    value: form[field],
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setForm({ ...form, [field]: event.target.value });
    }
  };
}

function TerminologyFields({
  form,
  setForm,
  idPrefix,
  disabled
}: {
  form: TerminologyFormState;
  setForm: (next: TerminologyFormState) => void;
  idPrefix: string;
  disabled: boolean;
}) {
  const readingInvalid =
    form.readingKatakana.length > 0 &&
    !terminologyReadingInputSchema.safeParse(form.readingKatakana).success;

  return (
    <>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-surface`}>
          表記（画面や台本に表示する文字）
        </label>
        <input
          id={`${idPrefix}-surface`}
          type="text"
          {...formField(form, setForm, "surface")}
          disabled={disabled}
          required
        />
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-reading`}>読み（全角カタカナ）</label>
        <input
          id={`${idPrefix}-reading`}
          type="text"
          {...formField(form, setForm, "readingKatakana")}
          aria-invalid={readingInvalid}
          disabled={disabled}
          required
        />
        {readingInvalid ? (
          <p className="form-error" role="alert">
            読みは全角カタカナ、小書き文字、長音符などで入力してください。
          </p>
        ) : null}
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-category`}>
          カテゴリ（例：製品名、部署名）
        </label>
        <input
          id={`${idPrefix}-category`}
          type="text"
          list={`${idPrefix}-category-options`}
          {...formField(form, setForm, "category")}
          disabled={disabled}
          required
        />
        <datalist id={`${idPrefix}-category-options`}>
          {terminologyCategorySuggestions.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-priority`}>読み替えの優先度</label>
        <input
          id={`${idPrefix}-priority`}
          type="number"
          step={1}
          {...formField(form, setForm, "priority")}
          disabled={disabled}
          required
        />
        <small>
          数字が大きい用語を優先して読み替えます。通常は0で構いません。
        </small>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-notes`}>補足メモ（任意）</label>
        <textarea
          id={`${idPrefix}-notes`}
          rows={3}
          {...formField(form, setForm, "notes")}
          disabled={disabled}
        />
      </div>
    </>
  );
}

export function TerminologyPage() {
  const queryClient = useQueryClient();
  const [filterForm, setFilterForm] = useState(emptyFilterForm);
  const [filters, setFilters] = useState<TerminologyListQuery>({});
  const [createForm, setCreateForm] =
    useState<TerminologyFormState>(emptyTerminologyForm);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [editingForm, setEditingForm] =
    useState<TerminologyFormState>(emptyTerminologyForm);
  const [editingError, setEditingError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const termsQuery = useQuery({
    queryKey: ["terminology", filters],
    queryFn: () => fetchTerminology(filters),
    retry: false
  });
  const activeTermsQuery = useQuery({
    queryKey: ["terminology", { status: "active" }],
    queryFn: () => fetchTerminology({ status: "active" }),
    retry: false
  });

  function refreshTermCaches(term: { termId: string }) {
    queryClient.setQueryData(["terminology", term.termId], term);
    void queryClient.invalidateQueries({ queryKey: ["terminology"] });
  }

  const createMutation = useMutation({
    mutationFn: createTerminology,
    onSuccess: (term) => {
      refreshTermCaches(term);
      setCreateForm(emptyTerminologyForm);
      setCreateError(null);
    },
    onError: (error) =>
      setCreateError(getErrorMessage(error, "用語を登録できませんでした。"))
  });

  const updateMutation = useMutation({
    mutationFn: ({
      termId,
      form
    }: {
      termId: string;
      form: TerminologyFormState;
    }) => updateTerminology(termId, terminologyFormToUpdateInput(form)),
    onSuccess: (term) => {
      refreshTermCaches(term);
      setEditingTermId(null);
      setEditingError(null);
    },
    onError: (error) =>
      setEditingError(getErrorMessage(error, "用語を保存できませんでした。"))
  });

  const statusMutation = useMutation({
    mutationFn: ({
      termId,
      status
    }: {
      termId: string;
      status: "active" | "inactive";
    }) =>
      status === "active"
        ? activateTerminology(termId)
        : deactivateTerminology(termId),
    onMutate: () => setStatusError(null),
    onSuccess: (term) => {
      refreshTermCaches(term);
      setStatusError(null);
    },
    onError: (error) =>
      setStatusError(
        getErrorMessage(error, "用語の状態を変更できませんでした。")
      )
  });

  function submitFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters(
      terminologyListQuerySchema.parse({
        surface: filterForm.surface,
        reading: filterForm.reading,
        category: filterForm.category,
        status: filterForm.status || undefined
      })
    );
  }

  function clearFilters() {
    setFilterForm(emptyFilterForm);
    setFilters({});
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      createMutation.mutate(terminologyFormToCreateInput(createForm));
    } catch (error) {
      setCreateError(getValidationMessage(error));
    }
  }

  function submitUpdate(event: FormEvent<HTMLFormElement>, termId: string) {
    event.preventDefault();
    try {
      updateMutation.mutate({ termId, form: editingForm });
    } catch (error) {
      setEditingError(getValidationMessage(error));
    }
  }

  return (
    <main className="page-shell terminology-page">
      <p className="back-link">
        <Link to="/projects">プロジェクト一覧へ</Link>
      </p>
      <header className="page-header page-header-stacked">
        <p className="eyebrow">共通用語管理</p>
        <h1>固有名詞・社内用語</h1>
        <p>
          台本の読み上げで使う固有名詞や社内用語と、その読み方を登録します。有効な用語は音声生成に反映されます。
        </p>
      </header>

      <section
        className="project-form terminology-filter-panel"
        aria-labelledby="terminology-search-title"
      >
        <h2 id="terminology-search-title">検索</h2>
        <form className="terminology-filter-grid" onSubmit={submitFilters}>
          <div className="form-field">
            <label htmlFor="terminology-filter-surface">表記</label>
            <input
              id="terminology-filter-surface"
              value={filterForm.surface}
              onChange={(event) =>
                setFilterForm({ ...filterForm, surface: event.target.value })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="terminology-filter-reading">読み</label>
            <input
              id="terminology-filter-reading"
              value={filterForm.reading}
              onChange={(event) =>
                setFilterForm({ ...filterForm, reading: event.target.value })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="terminology-filter-category">カテゴリ</label>
            <input
              id="terminology-filter-category"
              value={filterForm.category}
              onChange={(event) =>
                setFilterForm({ ...filterForm, category: event.target.value })
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="terminology-filter-status">状態</label>
            <select
              id="terminology-filter-status"
              value={filterForm.status}
              onChange={(event) =>
                setFilterForm({
                  ...filterForm,
                  status: event.target.value as FilterFormState["status"]
                })
              }
            >
              <option value="">すべて</option>
              <option value="active">有効</option>
              <option value="inactive">無効</option>
            </select>
          </div>
          <div className="form-actions terminology-filter-actions">
            <button className="button button-primary" type="submit">
              検索
            </button>
            <button className="button" type="button" onClick={clearFilters}>
              条件をクリア
            </button>
          </div>
        </form>
      </section>

      <section
        className="project-form"
        aria-labelledby="terminology-create-title"
      >
        <h2 id="terminology-create-title">新規登録</h2>
        <form onSubmit={submitCreate}>
          <TerminologyFields
            form={createForm}
            setForm={setCreateForm}
            idPrefix="terminology-create"
            disabled={createMutation.isPending}
          />
          {createError ? (
            <p className="form-error" role="alert">
              {createError}
            </p>
          ) : null}
          <div className="form-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? "登録中…" : "登録"}
            </button>
          </div>
        </form>
      </section>

      <TerminologyPreview
        activeTerms={activeTermsQuery.data ?? []}
        activeTermsLoading={activeTermsQuery.isPending}
        activeTermsError={activeTermsQuery.error}
      />

      <section aria-labelledby="terminology-list-title">
        <h2 id="terminology-list-title">登録済み用語</h2>
        <TerminologyStatusError message={statusError} />
        {termsQuery.isPending ? (
          <p className="status-message" role="status">
            用語を読み込んでいます…
          </p>
        ) : termsQuery.isError ? (
          <section className="message-panel message-panel-error" role="alert">
            <h3>一覧を取得できませんでした</h3>
            <p>
              {getErrorMessage(
                termsQuery.error,
                "用語一覧の取得に失敗しました。"
              )}
            </p>
            <button
              className="button"
              type="button"
              onClick={() => void termsQuery.refetch()}
            >
              再試行
            </button>
          </section>
        ) : termsQuery.data.length === 0 ? (
          <section className="message-panel">
            {hasTerminologyListFilters(filters) ? (
              <>
                <h3>条件に一致する用語がありません</h3>
                <p>検索条件を変更するか、条件をクリアしてください。</p>
                <button className="button" type="button" onClick={clearFilters}>
                  条件をクリア
                </button>
              </>
            ) : (
              <>
                <h3>用語はまだありません</h3>
                <p>上のフォームから最初の用語を登録してください。</p>
              </>
            )}
          </section>
        ) : (
          <ul className="terminology-list">
            {termsQuery.data.map((term) => {
              const isEditing = editingTermId === term.termId;
              const isStatusPending =
                statusMutation.isPending &&
                statusMutation.variables?.termId === term.termId;
              return (
                <li className="terminology-card" key={term.termId}>
                  <div className="terminology-card-header">
                    <div>
                      <h3>{term.surface}</h3>
                      <p className="terminology-reading">
                        {term.readingKatakana}
                      </p>
                    </div>
                    <span
                      className={`terminology-status terminology-status-${term.status}`}
                    >
                      {terminologyStatusLabel(term.status)}
                    </span>
                  </div>
                  {isEditing ? (
                    <form
                      onSubmit={(event) => submitUpdate(event, term.termId)}
                    >
                      <TerminologyFields
                        form={editingForm}
                        setForm={setEditingForm}
                        idPrefix={`terminology-edit-${term.termId}`}
                        disabled={updateMutation.isPending}
                      />
                      {editingError ? (
                        <p className="form-error" role="alert">
                          {editingError}
                        </p>
                      ) : null}
                      <div className="form-actions">
                        <button
                          className="button button-primary"
                          type="submit"
                          disabled={updateMutation.isPending}
                        >
                          保存
                        </button>
                        <button
                          className="button"
                          type="button"
                          onClick={() => setEditingTermId(null)}
                          disabled={updateMutation.isPending}
                        >
                          キャンセル
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <dl className="terminology-details">
                        <div>
                          <dt>カテゴリ</dt>
                          <dd>{term.category}</dd>
                        </div>
                        <div>
                          <dt>読み替えの優先度</dt>
                          <dd>{term.priority}</dd>
                        </div>
                        <div>
                          <dt>メモ</dt>
                          <dd>{term.notes || "—"}</dd>
                        </div>
                        <div>
                          <dt>識別子</dt>
                          <dd>
                            <code>{term.termId}</code>
                          </dd>
                        </div>
                      </dl>
                      <div className="page-header-actions">
                        <button
                          className="button button-small"
                          type="button"
                          onClick={() => {
                            setEditingTermId(term.termId);
                            setEditingForm(terminologyToForm(term));
                            setEditingError(null);
                          }}
                        >
                          編集
                        </button>
                        <button
                          className="button button-small"
                          type="button"
                          disabled={isStatusPending}
                          onClick={() =>
                            statusMutation.mutate({
                              termId: term.termId,
                              status:
                                term.status === "active" ? "inactive" : "active"
                            })
                          }
                        >
                          {isStatusPending
                            ? "処理中…"
                            : term.status === "active"
                              ? "利用停止"
                              : "再有効化"}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
