import { useEffect, useRef, type ReactNode } from "react";

import type {
  AssetDetail,
  AssetListItem,
  ScriptLine,
  ScriptSection,
  VisualAssignment
} from "../schema/index.js";
import {
  isSelectableGenericVisualAsset,
  type SelectableGenericVisualAsset
} from "./visual-assignment-editor";
import {
  screenPreviewAssetKey,
  type PersistentVisualLifecycle,
  type PersistentVisualPlaybackIssue,
  type PersistentVisualPresentationState
} from "./screen-template-preview";

export type ScriptMediaPickerAction = "start" | "replace";

const mediaDialogFocusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export type ScriptMediaDialogProps = Readonly<{
  titleId: string;
  describedById?: string;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}>;

export function ScriptMediaDialog({
  titleId,
  describedById,
  className = "script-media-picker",
  onClose,
  children
}: ScriptMediaDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const activeElement = document.activeElement;
    openerRef.current =
      activeElement instanceof HTMLElement ? activeElement : null;
    const dialog = dialogRef.current;
    const firstControl = dialog?.querySelector<HTMLElement>(
      mediaDialogFocusableSelector
    );
    (firstControl ?? dialog)?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const currentDialog = dialogRef.current;
      if (currentDialog === null) {
        return;
      }
      const controls = Array.from(
        currentDialog.querySelectorAll<HTMLElement>(
          mediaDialogFocusableSelector
        )
      );
      if (controls.length === 0) {
        event.preventDefault();
        currentDialog.focus();
        return;
      }

      const active = document.activeElement;
      const currentIndex = controls.indexOf(active as HTMLElement);
      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          controls.at(-1)?.focus();
        }
      } else if (currentIndex < 0 || currentIndex === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (openerRef.current?.isConnected === true) {
        openerRef.current.focus();
      }
    };
  }, []);

  return (
    <div className="script-media-picker-overlay">
      <section
        ref={dialogRef}
        aria-describedby={describedById}
        aria-labelledby={titleId}
        aria-modal="true"
        className={className}
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

function mediaKindLabel(kind: AssetListItem["kind"]): string {
  switch (kind) {
    case "video":
      return "動画";
    case "photo":
      return "写真";
    case "document_scan":
      return "帳票スキャン";
    case "bgm":
      return "BGM";
    case "sound_effect":
      return "効果音";
  }
}

function lifecycleLabel(lifecycle: PersistentVisualLifecycle): string {
  switch (lifecycle) {
    case "hidden":
      return "非表示 / cue競合";
    case "static-visible":
      return "static-visible（表示中）";
    case "playing":
      return "playing（再生中）";
    case "paused":
      return "paused（一時停止中）";
    case "ended":
      return "ended（素材終端）";
  }
}

function assignmentRangeLabel(
  assignment: VisualAssignment,
  section: Pick<ScriptSection, "lines">
): string {
  const lastLineId = section.lines.at(-1)?.id;
  return assignment.endLineId === lastLineId
    ? `開始: ${assignment.startLineId} / 終了: セクション末（未指定）`
    : `開始: ${assignment.startLineId} / 終了: ${assignment.endLineId}`;
}

function thumbnailUrl(
  assetId: string,
  thumbnailIndex: number,
  version: number | null | undefined
): string {
  const query =
    version === null || version === undefined ? "" : `?version=${version}`;
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnails/${thumbnailIndex}${query}`;
}

function mediaUrl(assetId: string, version: number | null | undefined): string {
  const query =
    version === null || version === undefined ? "" : `?version=${version}`;
  return `/api/assets/${encodeURIComponent(assetId)}/media${query}`;
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) {
    return "尺未取得";
  }
  const seconds = Math.floor(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function playbackIssueText(
  issues: readonly PersistentVisualPlaybackIssue[]
): string {
  return issues[0]?.message ?? "cueの状態を解決できません。";
}

function MediaPreview({
  assignment,
  asset
}: {
  readonly assignment: VisualAssignment;
  readonly asset: AssetDetail | undefined;
}) {
  if (asset === undefined) {
    return (
      <div
        className="script-media-preview script-media-preview-empty"
        role="img"
      >
        素材情報を読み込み中…
      </div>
    );
  }

  if (asset.kind === "video") {
    return (
      <video
        aria-label={`${asset.title}の管理素材プレビュー`}
        className="script-media-preview"
        controls
        preload="metadata"
        src={mediaUrl(asset.assetId, asset.version)}
      />
    );
  }

  const thumbnailIndex =
    assignment.display.kind === "document_scan"
      ? assignment.display.page - 1
      : 0;
  if (asset.thumbnailPaths[thumbnailIndex] === undefined) {
    return (
      <div
        className="script-media-preview script-media-preview-empty"
        role="img"
      >
        サムネイルなし
      </div>
    );
  }
  return (
    <img
      alt={`${asset.title}の管理素材プレビュー`}
      className="script-media-preview"
      src={thumbnailUrl(asset.assetId, thumbnailIndex, asset.version)}
    />
  );
}

export type ScriptMediaPaneProps = {
  readonly line: ScriptLine;
  readonly section: Pick<ScriptSection, "lines">;
  readonly assignments: readonly VisualAssignment[];
  readonly presentationStates: readonly PersistentVisualPresentationState[];
  readonly assets: ReadonlyMap<string, AssetDetail | undefined>;
  readonly isPending: boolean;
  readonly onStart: () => void;
  readonly onPause: (assignmentId: string) => void;
  readonly onResume: (assignmentId: string) => void;
  readonly onEnd: (assignmentId: string) => void;
  readonly onReplace: (assignmentId: string) => void;
};

export function ScriptMediaPane({
  line,
  section,
  assignments,
  presentationStates,
  assets,
  isPending,
  onStart,
  onPause,
  onResume,
  onEnd,
  onReplace
}: ScriptMediaPaneProps) {
  const headingId = `${line.id}-media-pane-title`;
  if (assignments.length === 0) {
    return (
      <aside aria-labelledby={headingId} className="script-line-media-pane">
        <header className="script-media-pane-header">
          <div>
            <p className="eyebrow">表示素材</p>
            <h3 id={headingId}>素材 state</h3>
          </div>
          <span className="script-media-state">hidden</span>
        </header>
        <p className="status-message">
          このセリフには表示中の素材がありません。
        </p>
        <button
          className="button button-small button-primary"
          disabled={isPending}
          type="button"
          onClick={onStart}
        >
          {isPending ? "保存中…" : "素材を表示 / 再生開始"}
        </button>
      </aside>
    );
  }

  if (assignments.length > 1) {
    return (
      <aside
        aria-labelledby={headingId}
        className="script-line-media-pane script-line-media-pane-conflict"
      >
        <header className="script-media-pane-header">
          <div>
            <p className="eyebrow">表示素材</p>
            <h3 id={headingId}>素材 state</h3>
          </div>
          <span className="script-media-state script-media-state-error">
            conflict
          </span>
        </header>
        <p role="alert">
          同じセリフに複数のgeneric
          visualが重なっています。z-orderはこの画面では変更できません。
        </p>
        <ul className="script-media-conflict-list">
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              {assets.get(screenPreviewAssetKey(assignment))?.title ??
                assignment.assetId}
            </li>
          ))}
        </ul>
      </aside>
    );
  }

  const assignment = assignments[0];
  if (assignment === undefined) {
    return null;
  }
  const state = presentationStates.find(
    (candidate) => candidate.assignmentId === assignment.id
  );
  const asset = assets.get(screenPreviewAssetKey(assignment));
  const lifecycle = state?.lifecycle ?? "hidden";
  const issues = state?.playbackIssues ?? [];
  const hasPlaybackConflict = issues.length > 0;
  const actionDisabled = isPending || hasPlaybackConflict;
  const pauseAtStartDisabled =
    lifecycle === "playing" && assignment.startLineId === line.id;
  const boundaryCue =
    assignment.display.kind === "video"
      ? assignment.display.playbackCues.find(
          (cue) => cue.lineId === line.id && cue.edge === "before"
        )
      : undefined;
  const boundaryCueDisabled = boundaryCue !== undefined;
  const endDisabled = actionDisabled || assignment.endLineId === line.id;
  const assetTitle = asset?.title ?? assignment.assetId;

  return (
    <aside aria-labelledby={headingId} className="script-line-media-pane">
      <header className="script-media-pane-header">
        <div>
          <p className="eyebrow">表示素材</p>
          <h3 id={headingId}>素材 state</h3>
        </div>
        <span
          aria-label={`${line.id}の素材状態: ${lifecycleLabel(lifecycle)}`}
          className={`script-media-state script-media-state-${lifecycle}`}
        >
          {lifecycleLabel(lifecycle)}
        </span>
      </header>

      <div className="script-media-asset-heading">
        <strong>{assetTitle}</strong>
        <span>{mediaKindLabel(assignment.display.kind)}</span>
      </div>
      <MediaPreview assignment={assignment} asset={asset} />

      <dl className="script-media-details">
        <div>
          <dt>素材</dt>
          <dd>{assetTitle}</dd>
        </div>
        <div>
          <dt>種類</dt>
          <dd>{mediaKindLabel(assignment.display.kind)}</dd>
        </div>
        <div>
          <dt>範囲</dt>
          <dd>{assignmentRangeLabel(assignment, section)}</dd>
        </div>
        {asset?.kind === "video" ? (
          <div>
            <dt>素材の尺</dt>
            <dd>{formatDuration(asset.durationMs)}</dd>
          </div>
        ) : null}
      </dl>

      {hasPlaybackConflict ? (
        <p className="script-media-conflict-message" role="alert">
          cueを解決できないため操作を停止しています: {playbackIssueText(issues)}
        </p>
      ) : null}
      {pauseAtStartDisabled ? (
        <p className="status-message" role="status">
          開始行のBEFOREは暗黙の再生開始境界のため、ここでは一時停止できません。
        </p>
      ) : null}
      {boundaryCueDisabled ? (
        <p className="status-message" role="status">
          このセリフのBEFOREには既存の
          {boundaryCue.action === "pause" ? "一時停止" : "再開"}
          cueがあります。
          {boundaryCue.action === "pause" ? "再開" : "一時停止"}
          は次のセリフ以降で指定してください。
        </p>
      ) : null}

      <div className="script-media-actions">
        {lifecycle === "playing" ? (
          <button
            className="button button-small"
            disabled={
              actionDisabled || pauseAtStartDisabled || boundaryCueDisabled
            }
            title={
              pauseAtStartDisabled
                ? "開始行のBEFOREでは一時停止できません"
                : boundaryCueDisabled
                  ? "このセリフのBEFOREには既存cueがあるため、次のセリフ以降で指定してください"
                  : undefined
            }
            type="button"
            onClick={() => onPause(assignment.id)}
          >
            一時停止
          </button>
        ) : null}
        {lifecycle === "paused" ? (
          <button
            className="button button-small"
            disabled={actionDisabled || boundaryCueDisabled}
            title={
              boundaryCueDisabled
                ? "このセリフのBEFOREには既存cueがあるため、次のセリフ以降で指定してください"
                : undefined
            }
            type="button"
            onClick={() => onResume(assignment.id)}
          >
            再開
          </button>
        ) : null}
        {lifecycle === "static-visible" ||
        lifecycle === "playing" ||
        lifecycle === "paused" ? (
          <button
            className="button button-small"
            disabled={endDisabled}
            title={
              endDisabled && assignment.endLineId === line.id
                ? "このセリフがすでに終了位置です"
                : undefined
            }
            type="button"
            onClick={() => onEnd(assignment.id)}
          >
            終了
          </button>
        ) : null}
        <button
          className="button button-small"
          disabled={isPending}
          type="button"
          onClick={() => onReplace(assignment.id)}
        >
          素材を変更
        </button>
      </div>
      {isPending ? (
        <p className="status-message" role="status">
          表示素材の変更を保存しています…
        </p>
      ) : null}
    </aside>
  );
}

export type ScriptMediaAssetPickerProps = {
  readonly action: ScriptMediaPickerAction;
  readonly lineId: string;
  readonly items: readonly AssetListItem[];
  readonly isPending: boolean;
  readonly error: unknown;
  readonly search: string;
  readonly disabled: boolean;
  readonly onSearch: (value: string) => void;
  readonly onClose: () => void;
  readonly onSelect: (asset: SelectableGenericVisualAsset) => void;
};

function pickerErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "素材候補の取得に失敗しました。";
}

export function ScriptMediaAssetPicker({
  action,
  lineId,
  items,
  isPending,
  error,
  search,
  disabled,
  onSearch,
  onClose,
  onSelect
}: ScriptMediaAssetPickerProps) {
  const titleId = `script-media-picker-title-${lineId}`;
  const candidates = items
    .filter(isSelectableGenericVisualAsset)
    .sort((left, right) => left.title.localeCompare(right.title, "ja"));

  return (
    <ScriptMediaDialog
      describedById={`${titleId}-description`}
      onClose={onClose}
      titleId={titleId}
    >
      <header className="script-media-picker-header">
        <div>
          <p className="eyebrow">登録済み素材から選択</p>
          <h2 id={titleId}>
            {action === "start" ? "表示素材を選択" : "表示素材を差し替え"}
          </h2>
          <p id={`${titleId}-description`}>
            video / photo / document_scan の active
            Assetだけを候補にしています。OS pathは入力できません。
          </p>
        </div>
        <button
          className="button button-small"
          disabled={disabled}
          type="button"
          onClick={onClose}
        >
          閉じる
        </button>
      </header>

      <div className="form-field script-media-picker-search">
        <label htmlFor={`${titleId}-search`}>素材を検索</label>
        <input
          autoFocus
          id={`${titleId}-search`}
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>

      {isPending ? (
        <p className="status-message" role="status">
          素材候補を読み込んでいます…
        </p>
      ) : error !== null ? (
        <section className="message-panel message-panel-error" role="alert">
          <h3>素材候補を取得できません</h3>
          <p>{pickerErrorMessage(error)}</p>
        </section>
      ) : candidates.length === 0 ? (
        <p className="status-message">
          条件に一致する利用可能な表示素材がありません。
        </p>
      ) : (
        <ul className="script-media-picker-list">
          {candidates.map((asset) => (
            <li key={`${asset.assetId}-${asset.version}`}>
              {asset.thumbnailPaths[0] !== undefined ? (
                <img
                  alt={`${asset.title}のサムネイル`}
                  className="script-media-picker-thumbnail"
                  src={thumbnailUrl(asset.assetId, 0, asset.version)}
                />
              ) : (
                <div className="script-media-picker-thumbnail script-media-picker-thumbnail-empty">
                  プレビューなし
                </div>
              )}
              <div className="script-media-picker-asset-info">
                <strong>{asset.title}</strong>
                <span>{mediaKindLabel(asset.kind)}</span>
                <span>
                  {asset.kind === "video"
                    ? `動画 ${formatDuration(asset.durationMs)}`
                    : asset.kind === "document_scan"
                      ? `ページ数 ${asset.pageCount}`
                      : "写真"}
                </span>
              </div>
              <button
                className="button button-small button-primary"
                disabled={disabled}
                type="button"
                onClick={() => onSelect(asset)}
              >
                この素材を選択
              </button>
            </li>
          ))}
        </ul>
      )}
    </ScriptMediaDialog>
  );
}
