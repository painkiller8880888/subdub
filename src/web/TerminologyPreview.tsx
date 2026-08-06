import { useMutation } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ZodError } from "zod";

import type { TerminologyTerm } from "../schema/terminology.js";
import { ApiClientError, previewTerminology } from "./api/client";
import { TerminologyPreviewResultView } from "./terminology-preview-view";
import {
  areTerminologyPreviewExclusionsDisabled,
  buildTerminologyPreviewRequest,
  type TerminologyPreviewMode
} from "./terminology-preview-state";

function getPreviewErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message} (error code: ${error.code})`;
  }
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? "Please enter valid preview input.";
  }
  return "The terminology preview could not be completed.";
}

export function TerminologyPreview({
  activeTerms,
  activeTermsLoading,
  activeTermsError
}: {
  readonly activeTerms: readonly TerminologyTerm[];
  readonly activeTermsLoading: boolean;
  readonly activeTermsError: unknown;
}) {
  const [spokenText, setSpokenText] = useState("");
  const [mode, setMode] = useState<TerminologyPreviewMode>("dictionary");
  const [excludedTermIds, setExcludedTermIds] = useState<string[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);
  const previewMutation = useMutation({
    mutationFn: previewTerminology
  });

  function toggleExcludedTerm(termId: string, checked: boolean): void {
    setExcludedTermIds((current) => {
      if (checked) {
        return current.includes(termId) ? current : [...current, termId];
      }
      return current.filter((currentTermId) => currentTermId !== termId);
    });
  }

  function submitPreview(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setValidationError(null);
    try {
      previewMutation.mutate(
        buildTerminologyPreviewRequest({
          spokenText,
          mode,
          excludedTermIds
        })
      );
    } catch (error) {
      setValidationError(getPreviewErrorMessage(error));
    }
  }

  const previewError =
    validationError ??
    (previewMutation.isError
      ? getPreviewErrorMessage(previewMutation.error)
      : null);
  const exclusionsDisabled = areTerminologyPreviewExclusionsDisabled(mode);

  return (
    <section
      className="project-form"
      aria-labelledby="terminology-preview-title"
    >
      <h2 id="terminology-preview-title">読み上げプレビュー</h2>
      <form onSubmit={submitPreview}>
        <div className="form-field">
          <label htmlFor="terminology-preview-spoken-text">
            読み上げる文章
          </label>
          <textarea
            id="terminology-preview-spoken-text"
            rows={4}
            value={spokenText}
            onChange={(event) => {
              setSpokenText(event.target.value);
              setValidationError(null);
            }}
          />
        </div>
        <div className="form-field">
          <label htmlFor="terminology-preview-mode">読み上げモード</label>
          <select
            id="terminology-preview-mode"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as TerminologyPreviewMode);
              setValidationError(null);
            }}
          >
            <option value="dictionary">用語辞書を適用 (dictionary)</option>
            <option value="literal">入力をそのまま読む (literal)</option>
          </select>
        </div>
        <fieldset disabled={exclusionsDisabled || previewMutation.isPending}>
          <legend>除外する有効な用語</legend>
          <p className="field-hint">
            {exclusionsDisabled
              ? "literal モードでは除外指定は結果に影響しません。選択値は保持されます。"
              : "選択した用語はこのプレビューだけ除外します。"}
          </p>
          {activeTermsLoading ? (
            <p className="status-message" role="status">
              有効な用語を読み込んでいます…
            </p>
          ) : activeTerms.length === 0 ? (
            <p className="field-hint">有効な用語はありません。</p>
          ) : (
            <div>
              {activeTerms.map((term) => (
                <label key={term.termId}>
                  <input
                    type="checkbox"
                    checked={excludedTermIds.includes(term.termId)}
                    onChange={(event) =>
                      toggleExcludedTerm(term.termId, event.target.checked)
                    }
                  />{" "}
                  {term.surface} ({term.readingKatakana})
                </label>
              ))}
            </div>
          )}
        </fieldset>
        {activeTermsError !== null && activeTermsError !== undefined ? (
          <p className="form-error" role="alert">
            {getPreviewErrorMessage(activeTermsError)}
          </p>
        ) : null}
        <div className="form-actions">
          <button
            className="button button-primary"
            type="submit"
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? "プレビュー実行中…" : "プレビュー実行"}
          </button>
        </div>
      </form>
      <TerminologyPreviewResultView
        result={previewMutation.data ?? null}
        isPending={previewMutation.isPending}
        error={previewError}
      />
    </section>
  );
}
