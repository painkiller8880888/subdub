import { useEffect, useState } from "react";

import type {
  AssetDetail,
  AssetListItem,
  StaticAnnotation,
  VideoProject,
  VisualAssignment
} from "../schema/index.js";
import {
  addVisualAnnotation,
  removeVisualAnnotation,
  updateVisualAnnotation
} from "./visual-assignment-editor";

type AssetView = AssetDetail | AssetListItem;

export type VisualAssignmentPanelProps = {
  readonly project: VideoProject;
  readonly assets: ReadonlyMap<string, AssetView | undefined>;
  readonly onSave: (assignment: VisualAssignment) => Promise<void>;
  readonly onRemove: (assignmentId: string) => Promise<void>;
  readonly isMutating: boolean;
};

function numberValue(value: number | null): string {
  return Number.isFinite(value) ? String(value) : "";
}

function unitValue(value: string): number {
  return value.length === 0 ? Number.NaN : Number(value);
}

function nullableUnitValue(value: string): number | null {
  return value.length === 0 ? null : Number(value);
}

function assetThumbnailUrl(assetId: string, index: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnails/${index}`;
}

function kindLabel(kind: AssetView["kind"]): string {
  switch (kind) {
    case "video":
      return "video";
    case "photo":
      return "photo";
    case "document_scan":
      return "document_scan";
    default:
      return kind;
  }
}

function displayKindLabel(kind: VisualAssignment["display"]["kind"]): string {
  return kindLabel(kind);
}

function assignmentSection(
  project: VideoProject,
  assignment: VisualAssignment
): VideoProject["script"]["sections"][number] | undefined {
  return project.script.sections.find((section) =>
    section.lines.some(
      (line) =>
        line.id === assignment.startLineId || line.id === assignment.endLineId
    )
  );
}

function metadataText(asset: AssetView | undefined): string {
  if (asset === undefined) {
    return "素材情報を読み込み中…";
  }
  if (asset.kind === "video") {
    return asset.durationMs === null
      ? "動画尺: 未取得"
      : `動画尺: ${asset.durationMs} ms`;
  }
  if (asset.kind === "document_scan") {
    return asset.pageCount === null
      ? "ページ数: 未取得"
      : `ページ数: ${asset.pageCount}`;
  }
  return "写真";
}

function StaticAnnotationEditor({
  annotation,
  onChange,
  onRemove
}: {
  readonly annotation: StaticAnnotation;
  readonly onChange: (update: Partial<StaticAnnotation>) => void;
  readonly onRemove: () => void;
}) {
  return (
    <fieldset className="visual-annotation-editor">
      <legend>{annotation.id}</legend>
      <div className="form-field-group">
        <div className="form-field">
          <label htmlFor={`${annotation.id}-kind`}>種類</label>
          <select
            id={`${annotation.id}-kind`}
            value={annotation.kind}
            onChange={(event) =>
              onChange({
                kind: event.target.value as StaticAnnotation["kind"]
              })
            }
          >
            <option value="label">label</option>
            <option value="box">box</option>
            <option value="arrow">arrow</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${annotation.id}-color`}>色トークン</label>
          <select
            id={`${annotation.id}-color`}
            value={annotation.colorToken}
            onChange={(event) =>
              onChange({
                colorToken: event.target.value as StaticAnnotation["colorToken"]
              })
            }
          >
            <option value="accent">accent</option>
            <option value="caution">caution</option>
            <option value="warning">warning</option>
          </select>
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`${annotation.id}-text`}>注釈テキスト</label>
        <input
          id={`${annotation.id}-text`}
          value={annotation.text ?? ""}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      </div>
      <div className="form-field-group">
        <div className="form-field">
          <label htmlFor={`${annotation.id}-x`}>x（0〜1）</label>
          <input
            id={`${annotation.id}-x`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={numberValue(annotation.x)}
            onChange={(event) => onChange({ x: unitValue(event.target.value) })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${annotation.id}-y`}>y（0〜1）</label>
          <input
            id={`${annotation.id}-y`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={numberValue(annotation.y)}
            onChange={(event) => onChange({ y: unitValue(event.target.value) })}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${annotation.id}-width`}>幅（0〜1、任意）</label>
          <input
            id={`${annotation.id}-width`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={numberValue(annotation.width)}
            onChange={(event) =>
              onChange({ width: nullableUnitValue(event.target.value) })
            }
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${annotation.id}-height`}>高さ（0〜1、任意）</label>
          <input
            id={`${annotation.id}-height`}
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={numberValue(annotation.height)}
            onChange={(event) =>
              onChange({ height: nullableUnitValue(event.target.value) })
            }
          />
        </div>
      </div>
      <button className="button button-small" type="button" onClick={onRemove}>
        注釈を削除
      </button>
    </fieldset>
  );
}

function VisualAssignmentEditor({
  assignment,
  project,
  asset,
  onSave,
  onRemove,
  isMutating
}: {
  readonly assignment: VisualAssignment;
  readonly project: VideoProject;
  readonly asset: AssetView | undefined;
  readonly onSave: (assignment: VisualAssignment) => Promise<void>;
  readonly onRemove: (assignmentId: string) => Promise<void>;
  readonly isMutating: boolean;
}) {
  const [draft, setDraft] = useState<VisualAssignment>(() =>
    structuredClone(assignment)
  );

  useEffect(() => {
    setDraft(structuredClone(assignment));
  }, [assignment]);

  const section = assignmentSection(project, draft);
  const updateDisplay = (
    update: Partial<VisualAssignment["display"]>
  ): void => {
    setDraft((current) => ({
      ...current,
      display: { ...current.display, ...update } as VisualAssignment["display"]
    }));
  };
  const updateCrop = (key: "x" | "y" | "width" | "height", value: string) => {
    setDraft((current) => ({
      ...current,
      display: {
        ...current.display,
        crop: { ...current.display.crop, [key]: unitValue(value) }
      } as VisualAssignment["display"]
    }));
  };
  const updatePosition = (key: "x" | "y", value: string) => {
    setDraft((current) => ({
      ...current,
      display: {
        ...current.display,
        position: { ...current.display.position, [key]: unitValue(value) }
      } as VisualAssignment["display"]
    }));
  };
  const display = draft.display;
  const thumbnailPath = asset?.thumbnailPaths[0];

  return (
    <article className="visual-assignment-card">
      <header className="visual-assignment-header">
        <div>
          <p className="eyebrow">割り当て済みビジュアル</p>
          <h3>{asset?.title ?? draft.assetId}</h3>
          <code>{draft.id}</code>
        </div>
        <span className="visual-assignment-kind">
          {asset === undefined
            ? displayKindLabel(display.kind)
            : kindLabel(asset.kind)}
        </span>
      </header>
      {thumbnailPath !== undefined ? (
        <img
          className="visual-assignment-thumbnail"
          src={assetThumbnailUrl(draft.assetId, 0)}
          alt={`${asset?.title ?? draft.assetId}のサムネイル`}
        />
      ) : (
        <div className="visual-assignment-thumbnail visual-assignment-thumbnail-empty">
          サムネイルなし
        </div>
      )}
      <dl className="visual-assignment-details">
        <div>
          <dt>素材状態</dt>
          <dd>{asset?.status ?? "確認中"}</dd>
        </div>
        <div>
          <dt>機密区分</dt>
          <dd>{asset?.confidentiality ?? "確認中"}</dd>
        </div>
        <div>
          <dt>メタデータ</dt>
          <dd>{metadataText(asset)}</dd>
        </div>
        <div>
          <dt>DBチェックサム</dt>
          <dd>
            <code>{asset?.checksum ?? "確認中"}</code>
          </dd>
        </div>
        <div>
          <dt>取り込み済みパス</dt>
          <dd>
            <code>{draft.projectMediaPath}</code>
          </dd>
        </div>
      </dl>

      <div className="form-field-group">
        <div className="form-field">
          <label htmlFor={`${draft.id}-section`}>セクション</label>
          <select
            id={`${draft.id}-section`}
            value={section?.id ?? ""}
            onChange={(event) => {
              const nextSection = project.script.sections.find(
                (candidate) => candidate.id === event.target.value
              );
              setDraft((current) => ({
                ...current,
                startLineId: nextSection?.lines[0]?.id ?? "",
                endLineId: nextSection?.lines.at(-1)?.id ?? ""
              }));
            }}
          >
            {project.script.sections.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${draft.id}-start-line`}>開始セリフ</label>
          <select
            id={`${draft.id}-start-line`}
            value={draft.startLineId}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                startLineId: event.target.value
              }))
            }
          >
            {section?.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.id}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${draft.id}-end-line`}>終了セリフ</label>
          <select
            id={`${draft.id}-end-line`}
            value={draft.endLineId}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                endLineId: event.target.value
              }))
            }
          >
            {section?.lines.map((line) => (
              <option key={line.id} value={line.id}>
                {line.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-field-group">
        <div className="form-field">
          <label htmlFor={`${draft.id}-fit`}>表示方法</label>
          <select
            id={`${draft.id}-fit`}
            value={display.fit}
            onChange={(event) =>
              updateDisplay({ fit: event.target.value as "contain" | "cover" })
            }
          >
            <option value="contain">contain</option>
            <option value="cover">cover</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${draft.id}-scale`}>拡大率</label>
          <input
            id={`${draft.id}-scale`}
            type="number"
            min={0.01}
            step={0.01}
            value={numberValue(display.scale)}
            onChange={(event) =>
              updateDisplay({ scale: Number(event.target.value) })
            }
          />
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={display.prioritizeVisual}
            onChange={(event) =>
              updateDisplay({ prioritizeVisual: event.target.checked })
            }
          />
          ビジュアルを優先
        </label>
      </div>

      <fieldset className="visual-settings-fieldset">
        <legend>切り抜き（正規化 0〜1）</legend>
        <div className="form-field-group">
          {(["x", "y", "width", "height"] as const).map((key) => (
            <div className="form-field" key={key}>
              <label htmlFor={`${draft.id}-crop-${key}`}>{key}</label>
              <input
                id={`${draft.id}-crop-${key}`}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={numberValue(display.crop[key])}
                onChange={(event) => updateCrop(key, event.target.value)}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="visual-settings-fieldset">
        <legend>位置（正規化 0〜1）</legend>
        <div className="form-field-group">
          {(["x", "y"] as const).map((key) => (
            <div className="form-field" key={key}>
              <label htmlFor={`${draft.id}-position-${key}`}>{key}</label>
              <input
                id={`${draft.id}-position-${key}`}
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={numberValue(display.position[key])}
                onChange={(event) => updatePosition(key, event.target.value)}
              />
            </div>
          ))}
        </div>
      </fieldset>

      {display.kind === "video" ? (
        <fieldset className="visual-settings-fieldset">
          <legend>動画設定</legend>
          <div className="form-field-group">
            <div className="form-field">
              <label htmlFor={`${draft.id}-start-ms`}>開始（ms）</label>
              <input
                id={`${draft.id}-start-ms`}
                type="number"
                min={0}
                step={1}
                value={numberValue(display.startMs)}
                onChange={(event) =>
                  updateDisplay({ startMs: Number(event.target.value) })
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor={`${draft.id}-end-ms`}>終了（ms）</label>
              <input
                id={`${draft.id}-end-ms`}
                type="number"
                min={1}
                step={1}
                value={numberValue(display.endMs)}
                onChange={(event) =>
                  updateDisplay({ endMs: Number(event.target.value) })
                }
              />
            </div>
            <div className="form-field">
              <label htmlFor={`${draft.id}-playback-rate`}>再生速度</label>
              <input
                id={`${draft.id}-playback-rate`}
                type="number"
                min={0.01}
                step={0.01}
                value={numberValue(display.playbackRate)}
                onChange={(event) =>
                  updateDisplay({ playbackRate: Number(event.target.value) })
                }
              />
            </div>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={display.muted}
                onChange={(event) =>
                  updateDisplay({ muted: event.target.checked })
                }
              />
              ミュート
            </label>
          </div>
        </fieldset>
      ) : null}

      {display.kind === "document_scan" ? (
        <div className="form-field">
          <label htmlFor={`${draft.id}-page`}>帳票ページ</label>
          <input
            id={`${draft.id}-page`}
            type="number"
            min={1}
            step={1}
            value={numberValue(display.page)}
            onChange={(event) =>
              updateDisplay({ page: Number(event.target.value) })
            }
          />
        </div>
      ) : null}

      <div className="visual-overlay-preview" aria-label="注釈プレビュー">
        {display.annotations.map((annotation) => (
          <span
            className={`visual-overlay-annotation visual-overlay-${annotation.colorToken}`}
            key={annotation.id}
            style={{
              left: `${annotation.x * 100}%`,
              top: `${annotation.y * 100}%`,
              width:
                annotation.width === null
                  ? undefined
                  : `${annotation.width * 100}%`,
              height:
                annotation.height === null
                  ? undefined
                  : `${annotation.height * 100}%`
            }}
          >
            {annotation.text ?? annotation.kind}
          </span>
        ))}
      </div>

      <section className="visual-annotation-list" aria-label="静的注釈">
        <div className="visual-subsection-header">
          <h4>静的注釈</h4>
          <button
            className="button button-small"
            type="button"
            onClick={() => setDraft((current) => addVisualAnnotation(current))}
          >
            注釈を追加
          </button>
        </div>
        {display.annotations.map((annotation) => (
          <StaticAnnotationEditor
            key={annotation.id}
            annotation={annotation}
            onChange={(update) =>
              setDraft((current) =>
                updateVisualAnnotation(current, annotation.id, update)
              )
            }
            onRemove={() =>
              setDraft((current) =>
                removeVisualAnnotation(current, annotation.id)
              )
            }
          />
        ))}
      </section>

      <div className="form-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={isMutating}
          onClick={() => void onSave(draft)}
        >
          {isMutating ? "保存中…" : "表示設定を保存"}
        </button>
        <button
          className="button"
          type="button"
          disabled={isMutating}
          onClick={() => void onRemove(draft.id)}
        >
          割り当てを解除
        </button>
      </div>
    </article>
  );
}

export function VisualAssignmentPanel({
  project,
  assets,
  onSave,
  onRemove,
  isMutating
}: VisualAssignmentPanelProps) {
  return (
    <section
      className="visual-assignment-panel"
      aria-labelledby="visual-plan-title"
    >
      <header className="visual-subsection-header">
        <div>
          <p className="eyebrow">P3-06 表示設定</p>
          <h2 id="visual-plan-title">割り当て済みビジュアル</h2>
        </div>
        <span
          className={`visual-status visual-status-${project.visuals.status}`}
        >
          {project.visuals.status}
        </span>
      </header>
      {project.visuals.assignments.length === 0 ? (
        <p className="status-message">割り当て済みビジュアルはありません。</p>
      ) : (
        <div className="visual-assignment-list">
          {project.visuals.assignments.map((assignment) => (
            <VisualAssignmentEditor
              key={assignment.id}
              assignment={assignment}
              project={project}
              asset={assets.get(assignment.assetId)}
              onSave={onSave}
              onRemove={onRemove}
              isMutating={isMutating}
            />
          ))}
        </div>
      )}
    </section>
  );
}
