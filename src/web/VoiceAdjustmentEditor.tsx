import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import type { VoiceAdjustmentSnapshot } from "../schema/api.js";
import type { ScriptLine } from "../schema/index.js";
import type { VoicevoxAdjustmentFile } from "../voicevox/schemas.js";
import {
  discardProjectVoiceAdjustment,
  fetchProjectVoiceAdjustment,
  previewProjectVoiceAdjustment,
  projectVoiceAdjustmentPreviewUrl,
  resetProjectVoiceAdjustments,
  saveProjectVoiceAdjustment
} from "./lib/api-client";
import {
  buildVoiceAdjustmentFile,
  createVoiceAdjustmentEditorState,
  isVoiceAdjustmentDirty,
  loadSavedVoiceAdjustment,
  resetVoiceAdjustmentAccent,
  resetVoiceAdjustmentEditing,
  resetVoiceAdjustmentMora,
  resetVoiceAdjustmentMoraDetails,
  resetVoiceAdjustmentMoraItem,
  resetVoiceAdjustmentScalar,
  type VoiceAdjustmentEditorState,
  type VoiceAdjustmentMoraKey,
  type VoiceAdjustmentScalarKey,
  updateVoiceAdjustmentAccent,
  updateVoiceAdjustmentMora,
  updateVoiceAdjustmentScalar,
  VOICE_ADJUSTMENT_SCALAR_KEYS
} from "./voice-adjustment-state";

type VoiceAdjustmentEditorProps = {
  readonly projectId: string;
  readonly line: ScriptLine;
  readonly voiceAvailable: boolean;
};

const scalarLabels: Record<VoiceAdjustmentScalarKey, string> = {
  speedScale: "話速（1.0が標準）",
  pitchScale: "音高",
  intonationScale: "抑揚（1.0が標準）",
  volumeScale: "音量（1.0が標準）",
  prePhonemeLength: "文頭の無音",
  postPhonemeLength: "文末の無音"
};

const moraLabels: Record<VoiceAdjustmentMoraKey, string> = {
  pitch: "音高",
  consonant_length: "子音長",
  vowel_length: "母音長",
  is_devoiced: "無声化"
};

function numberValue(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "音声調整の操作に失敗しました。";
}

function resetPhraseAccent(
  state: VoiceAdjustmentEditorState,
  phraseIndex: number
): VoiceAdjustmentEditorState {
  const basePhrase = state.baseQuery.accent_phrases[phraseIndex];
  const phrase = state.query.accent_phrases[phraseIndex];
  if (basePhrase === undefined || phrase === undefined) {
    return state;
  }
  return updateVoiceAdjustmentAccent(state, phraseIndex, basePhrase.accent);
}

function updateSavedSnapshot(
  snapshot: VoiceAdjustmentSnapshot,
  adjustment: VoicevoxAdjustmentFile | null
): VoiceAdjustmentSnapshot {
  return {
    ...snapshot,
    status: "current",
    adjustment
  };
}

export function VoiceAdjustmentEditor({
  projectId,
  line,
  voiceAvailable
}: VoiceAdjustmentEditorProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"basic" | "accent" | "detail">("basic");
  const [snapshot, setSnapshot] = useState<VoiceAdjustmentSnapshot | null>(
    null
  );
  const [editor, setEditor] = useState<VoiceAdjustmentEditorState | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(() => setOpen(false));
  closeRef.current = () => setOpen(false);

  const adjustmentQuery = useQuery({
    queryKey: ["voice-adjustment", projectId, line.id],
    queryFn: () => fetchProjectVoiceAdjustment(projectId, line.id),
    enabled: open,
    retry: false
  });

  useEffect(() => {
    if (adjustmentQuery.data === undefined) {
      return;
    }
    setSnapshot(adjustmentQuery.data);
    setEditor(
      createVoiceAdjustmentEditorState(adjustmentQuery.data, {
        loadSaved: adjustmentQuery.data.status !== "needs_review"
      })
    );
    setPreviewId(null);
  }, [adjustmentQuery.data]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const dialogElement = dialogRef.current;
    if (dialogElement === null) {
      return;
    }

    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const getFocusableElements = (): HTMLElement[] =>
      Array.from(
        dialogElement.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute("disabled"));
    getFocusableElements()[0]?.focus();

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogElement?.focus();
        return;
      }
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [line.id, open]);

  const saveMutation = useMutation({
    mutationFn: (input: VoicevoxAdjustmentFile) =>
      saveProjectVoiceAdjustment(projectId, line.id, { adjustment: input }),
    onSuccess: (saved) => {
      setSnapshot(saved);
      setEditor(createVoiceAdjustmentEditorState(saved));
      setPreviewId(null);
      void queryClient.invalidateQueries({
        queryKey: ["voice-adjustment", projectId, line.id]
      });
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    retry: false
  });

  const previewMutation = useMutation({
    mutationFn: () => {
      if (editor === null) {
        throw new Error("音声調整を読み込んでください。");
      }
      return previewProjectVoiceAdjustment(projectId, line.id, {
        query: editor.query
      });
    },
    onSuccess: ({ previewId: nextPreviewId }) => {
      setPreviewId(nextPreviewId);
    },
    retry: false
  });

  const discardMutation = useMutation({
    mutationFn: () => discardProjectVoiceAdjustment(projectId, line.id),
    onSuccess: () => {
      if (snapshot !== null) {
        const nextSnapshot = updateSavedSnapshot(snapshot, null);
        setSnapshot(nextSnapshot);
        setEditor(createVoiceAdjustmentEditorState(nextSnapshot));
      }
      void queryClient.invalidateQueries({
        queryKey: ["voice-adjustment", projectId, line.id]
      });
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    retry: false
  });

  const resetAllMutation = useMutation({
    mutationFn: () => resetProjectVoiceAdjustments(projectId),
    onSuccess: () => {
      if (snapshot !== null) {
        const nextSnapshot = updateSavedSnapshot(snapshot, null);
        setSnapshot(nextSnapshot);
        setEditor(createVoiceAdjustmentEditorState(nextSnapshot));
      }
      void queryClient.invalidateQueries({
        queryKey: ["voice-adjustment", projectId]
      });
      void queryClient.invalidateQueries({
        queryKey: ["voice-status", projectId]
      });
    },
    retry: false
  });

  function save(): void {
    if (editor === null || snapshot === null) {
      return;
    }
    saveMutation.mutate(
      buildVoiceAdjustmentFile(editor, snapshot, new Date().toISOString())
    );
  }

  return (
    <section className="voice-adjustment-editor" aria-label="音声調整">
      <button
        className="button button-small"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={`${line.id}-voice-adjustment-dialog`}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? "音声設定を閉じる" : "このセリフの音声を調整"}
      </button>

      {open ? (
        <div className="voice-adjustment-backdrop">
          <section
            aria-labelledby={`${line.id}-voice-adjustment-title`}
            aria-modal="true"
            className="voice-adjustment-dialog"
            id={`${line.id}-voice-adjustment-dialog`}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="voice-adjustment-dialog-header">
              <div>
                <p className="eyebrow">音声調整</p>
                <h2 id={`${line.id}-voice-adjustment-title`}>
                  セリフ {line.id}
                </h2>
                <p>確定済みの音声調整は閉じても保持されます。</p>
              </div>
              <button
                className="button button-small"
                type="button"
                onClick={() => setOpen(false)}
              >
                閉じる
              </button>
            </header>

            <div className="voice-adjustment-panel">
              {adjustmentQuery.isPending ? (
                <p className="status-message">音声調整を読み込んでいます…</p>
              ) : null}
              {adjustmentQuery.isError ? (
                <p className="message-panel message-panel-warning" role="alert">
                  {errorMessage(adjustmentQuery.error)}
                </p>
              ) : null}
              {snapshot?.status === "needs_review" ? (
                <div
                  className="message-panel message-panel-warning"
                  role="alert"
                >
                  <strong>保存済み調整の基礎条件が変わっています。</strong>
                  <p>
                    位置番号による自動マージは行いません。破棄して再生成するか、保存済み値を比較用に読み込んで再調整してください。
                  </p>
                  <div className="voice-adjustment-actions">
                    <button
                      className="button button-small"
                      type="button"
                      disabled={discardMutation.isPending}
                      onClick={() => discardMutation.mutate()}
                    >
                      破棄して再生成
                    </button>
                    <button
                      className="button button-small"
                      type="button"
                      disabled={editor === null}
                      onClick={() =>
                        setEditor((current) =>
                          current === null
                            ? current
                            : loadSavedVoiceAdjustment(current)
                        )
                      }
                    >
                      比較して再調整
                    </button>
                  </div>
                </div>
              ) : null}
              {editor !== null && snapshot !== null ? (
                <>
                  <div className="voice-adjustment-tabs" role="tablist">
                    {(
                      [
                        ["basic", "基本"],
                        ["accent", "アクセント"],
                        ["detail", "詳細"]
                      ] as const
                    ).map(([value, label]) => (
                      <button
                        className="button button-small"
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={tab === value}
                        onClick={() => setTab(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {tab === "basic" ? (
                    <div className="voice-adjustment-fields">
                      {VOICE_ADJUSTMENT_SCALAR_KEYS.map((key) => (
                        <div className="form-field" key={key}>
                          <label htmlFor={`${line.id}-adjustment-${key}`}>
                            {scalarLabels[key]}
                          </label>
                          <div className="voice-adjustment-input-row">
                            <input
                              id={`${line.id}-adjustment-${key}`}
                              type="number"
                              step="any"
                              value={numberValue(editor.query[key])}
                              onChange={(event) =>
                                setEditor((current) =>
                                  current === null
                                    ? current
                                    : updateVoiceAdjustmentScalar(
                                        current,
                                        key,
                                        event.target.value.length === 0
                                          ? Number.NaN
                                          : Number(event.target.value)
                                      )
                                )
                              }
                            />
                            <button
                              className="button button-small"
                              type="button"
                              onClick={() =>
                                setEditor((current) =>
                                  current === null
                                    ? current
                                    : resetVoiceAdjustmentScalar(current, key)
                                )
                              }
                            >
                              リセット
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {tab === "accent" ? (
                    <div className="voice-adjustment-accent-list">
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() =>
                          setEditor((current) =>
                            current === null
                              ? current
                              : resetVoiceAdjustmentAccent(current)
                          )
                        }
                      >
                        アクセントを元の読み上げ設定へ戻す
                      </button>
                      {editor.query.accent_phrases.map(
                        (phrase, phraseIndex) => (
                          <div
                            className="voice-adjustment-accent-card"
                            key={phraseIndex}
                          >
                            <div>
                              <strong>
                                {phrase.moras
                                  .map((mora) => mora.text)
                                  .join("") ||
                                  `アクセント句 ${phraseIndex + 1}`}
                              </strong>
                              <span>句内のアクセント核</span>
                            </div>
                            <div className="voice-adjustment-input-row">
                              <input
                                aria-label={`アクセント句 ${phraseIndex + 1} のアクセント核`}
                                type="number"
                                min={0}
                                step={1}
                                value={phrase.accent}
                                onChange={(event) =>
                                  setEditor((current) =>
                                    current === null
                                      ? current
                                      : updateVoiceAdjustmentAccent(
                                          current,
                                          phraseIndex,
                                          Number(event.target.value)
                                        )
                                  )
                                }
                              />
                              <button
                                className="button button-small"
                                type="button"
                                onClick={() =>
                                  setEditor((current) =>
                                    current === null
                                      ? current
                                      : resetPhraseAccent(current, phraseIndex)
                                  )
                                }
                              >
                                リセット
                              </button>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  ) : null}

                  {tab === "detail" ? (
                    <div className="voice-adjustment-detail-list">
                      <button
                        className="button button-small"
                        type="button"
                        onClick={() =>
                          setEditor((current) =>
                            current === null
                              ? current
                              : resetVoiceAdjustmentMoraDetails(current)
                          )
                        }
                      >
                        モーラの詳細を元の読み上げ設定へ戻す
                      </button>
                      {editor.query.accent_phrases.map(
                        (phrase, phraseIndex) => (
                          <fieldset
                            className="voice-adjustment-detail-card"
                            key={phraseIndex}
                          >
                            <legend>
                              {phrase.moras.map((mora) => mora.text).join("") ||
                                `アクセント句 ${phraseIndex + 1}`}
                            </legend>
                            {phrase.moras.map((mora, moraIndex) => (
                              <div
                                className="voice-adjustment-mora"
                                key={moraIndex}
                              >
                                <strong>
                                  {mora.text || `モーラ ${moraIndex + 1}`}
                                </strong>
                                {(
                                  [
                                    "pitch",
                                    "consonant_length",
                                    "vowel_length"
                                  ] as const
                                ).map((key) => (
                                  <label key={key}>
                                    {moraLabels[key]}
                                    <input
                                      type="number"
                                      step="any"
                                      value={numberValue(mora[key] as number)}
                                      onChange={(event) =>
                                        setEditor((current) =>
                                          current === null
                                            ? current
                                            : updateVoiceAdjustmentMora(
                                                current,
                                                phraseIndex,
                                                moraIndex,
                                                key,
                                                event.target.value.length === 0
                                                  ? Number.NaN
                                                  : Number(event.target.value)
                                              )
                                        )
                                      }
                                    />
                                    <button
                                      className="button button-small"
                                      type="button"
                                      onClick={() =>
                                        setEditor((current) =>
                                          current === null
                                            ? current
                                            : resetVoiceAdjustmentMora(
                                                current,
                                                phraseIndex,
                                                moraIndex,
                                                key
                                              )
                                        )
                                      }
                                    >
                                      リセット
                                    </button>
                                  </label>
                                ))}
                                <div className="voice-adjustment-checkbox-row">
                                  <label className="checkbox-field">
                                    <input
                                      type="checkbox"
                                      checked={mora.is_devoiced === true}
                                      onChange={(event) =>
                                        setEditor((current) =>
                                          current === null
                                            ? current
                                            : updateVoiceAdjustmentMora(
                                                current,
                                                phraseIndex,
                                                moraIndex,
                                                "is_devoiced",
                                                event.target.checked
                                              )
                                        )
                                      }
                                    />
                                    {moraLabels.is_devoiced}
                                  </label>
                                  <button
                                    className="button button-small"
                                    type="button"
                                    onClick={() =>
                                      setEditor((current) =>
                                        current === null
                                          ? current
                                          : resetVoiceAdjustmentMora(
                                              current,
                                              phraseIndex,
                                              moraIndex,
                                              "is_devoiced"
                                            )
                                      )
                                    }
                                  >
                                    リセット
                                  </button>
                                </div>
                                <button
                                  className="button button-small"
                                  type="button"
                                  onClick={() =>
                                    setEditor((current) =>
                                      current === null
                                        ? current
                                        : resetVoiceAdjustmentMoraItem(
                                            current,
                                            phraseIndex,
                                            moraIndex
                                          )
                                    )
                                  }
                                >
                                  モーラをリセット
                                </button>
                              </div>
                            ))}
                          </fieldset>
                        )
                      )}
                    </div>
                  ) : null}

                  <div className="voice-adjustment-actions">
                    <button
                      className="button"
                      type="button"
                      disabled={!voiceAvailable || previewMutation.isPending}
                      onClick={() => previewMutation.mutate()}
                    >
                      {previewMutation.isPending ? "試聴生成中…" : "試聴"}
                    </button>
                    <button
                      className="button"
                      type="button"
                      disabled={
                        saveMutation.isPending ||
                        !isVoiceAdjustmentDirty(editor)
                      }
                      onClick={save}
                    >
                      {saveMutation.isPending ? "保存中…" : "明示保存"}
                    </button>
                    <button
                      className="button button-small"
                      type="button"
                      disabled={!isVoiceAdjustmentDirty(editor)}
                      onClick={() =>
                        setEditor((current) =>
                          current === null
                            ? current
                            : resetVoiceAdjustmentEditing(current)
                        )
                      }
                    >
                      未保存変更を破棄
                    </button>
                    <button
                      className="button button-small"
                      type="button"
                      disabled={resetAllMutation.isPending}
                      onClick={() => resetAllMutation.mutate()}
                    >
                      保存済み全調整をリセット
                    </button>
                  </div>
                  {!voiceAvailable ? (
                    <p
                      className="message-panel message-panel-warning"
                      role="status"
                    >
                      VOICEVOX停止中のため試聴だけ無効です。編集中の値は保持されます。
                    </p>
                  ) : null}
                  {previewMutation.isError ? (
                    <p className="form-error" role="alert">
                      {errorMessage(previewMutation.error)}
                    </p>
                  ) : null}
                  {saveMutation.isError ? (
                    <p className="form-error" role="alert">
                      {errorMessage(saveMutation.error)}
                    </p>
                  ) : null}
                  {discardMutation.isError || resetAllMutation.isError ? (
                    <p className="form-error" role="alert">
                      {errorMessage(
                        discardMutation.error ?? resetAllMutation.error
                      )}
                    </p>
                  ) : null}
                  {previewId !== null ? (
                    <audio
                      controls
                      src={projectVoiceAdjustmentPreviewUrl(
                        projectId,
                        line.id,
                        previewId
                      )}
                    />
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
