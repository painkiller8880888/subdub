import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent
} from "react";

import type {
  LineOverlay,
  LineOverlayAnimation,
  LineOverlayColorToken,
  LineOverlayKind,
  ScreenTemplate,
  ScriptLine
} from "../schema/index.js";
import {
  ScreenLayoutFrame,
  type ScreenLayoutPreview
} from "../remotion/screen-template-layout";
import {
  constrainLineOverlayTransform,
  createDefaultLineOverlay,
  lineOverlayKindLabel
} from "./line-overlay-editor";

type OverlayEditorPoint = Readonly<{
  x: number;
  y: number;
  clientX: number;
  clientY: number;
}>;

type OverlayInteraction = Readonly<{
  overlayId: string;
  type: "move" | "resize" | "rotate";
  startPoint: OverlayEditorPoint;
  startTransform: LineOverlay["transform"];
  startAngle?: number;
}>;

export type LineOverlayEditorProps = Readonly<{
  line: Pick<ScriptLine, "id" | "subtitleText">;
  template: Pick<ScreenTemplate, "canvasWidth" | "canvasHeight" | "elements">;
  preview: ScreenLayoutPreview;
  initialOverlays: readonly LineOverlay[];
  onSave: (overlays: readonly LineOverlay[]) => void;
  onCancel: () => void;
  pending?: boolean;
  error?: unknown;
}>;

const overlayColors: readonly LineOverlayColorToken[] = [
  "accent",
  "caution",
  "warning"
];
const overlayAnimations: readonly LineOverlayAnimation[] = [
  "none",
  "blink",
  "pulse"
];
const overlayKinds: readonly LineOverlayKind[] = [
  "circle",
  "box",
  "arrow",
  "label"
];

function colorLabel(color: LineOverlayColorToken): string {
  switch (color) {
    case "accent":
      return "アクセント";
    case "caution":
      return "注意";
    case "warning":
      return "警告";
  }
}

function animationLabel(animation: LineOverlayAnimation): string {
  switch (animation) {
    case "none":
      return "なし";
    case "blink":
      return "点滅";
    case "pulse":
      return "脈動";
  }
}

function overlayIdForKind(
  overlays: readonly LineOverlay[],
  kind: LineOverlayKind
): string {
  const prefix = `line-overlay-${kind}`;
  let suffix = 1;
  let candidate = `${prefix}-${suffix}`;
  const ids = new Set(overlays.map((overlay) => overlay.id));
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = `${prefix}-${suffix}`;
  }
  return candidate;
}

function errorMessage(error: unknown): string | null {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : typeof error === "string" && error.length > 0
      ? error
      : null;
}

function lineOverlayPoint(
  event: { clientX: number; clientY: number },
  canvas: HTMLElement
): OverlayEditorPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    clientX: event.clientX,
    clientY: event.clientY
  };
}

function angleAtTransform(
  event: { clientX: number; clientY: number },
  canvas: HTMLElement,
  transform: LineOverlay["transform"]
): number {
  const rect = canvas.getBoundingClientRect();
  const centerX = rect.left + (transform.x + transform.width / 2) * rect.width;
  const centerY = rect.top + (transform.y + transform.height / 2) * rect.height;
  return Math.atan2(event.clientY - centerY, event.clientX - centerX);
}

function nudgeTransform(
  transform: LineOverlay["transform"],
  dx: number,
  dy: number
): LineOverlay["transform"] {
  return constrainLineOverlayTransform({
    ...transform,
    x: transform.x + dx,
    y: transform.y + dy
  });
}

export function LineOverlayEditor({
  line,
  template,
  preview,
  initialOverlays,
  onSave,
  onCancel,
  pending = false,
  error
}: LineOverlayEditorProps) {
  const [overlays, setOverlays] = useState<LineOverlay[]>(() => [
    ...initialOverlays
  ]);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOverlays[0]?.id ?? null
  );
  const [interaction, setInteraction] = useState<OverlayInteraction | null>(
    null
  );
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (interaction === null) {
      return;
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const canvas = canvasRef.current;
      if (canvas === null) {
        return;
      }
      const point = lineOverlayPoint(event, canvas);
      setOverlays((current) =>
        current.map((overlay) => {
          if (overlay.id !== interaction.overlayId) {
            return overlay;
          }
          const dx = point.x - interaction.startPoint.x;
          const dy = point.y - interaction.startPoint.y;
          if (interaction.type === "move") {
            return {
              ...overlay,
              transform: constrainLineOverlayTransform({
                ...interaction.startTransform,
                x: interaction.startTransform.x + dx,
                y: interaction.startTransform.y + dy
              })
            };
          }
          if (interaction.type === "resize") {
            return {
              ...overlay,
              transform: constrainLineOverlayTransform({
                ...interaction.startTransform,
                width: interaction.startTransform.width + dx,
                height: interaction.startTransform.height + dy
              })
            };
          }
          const startAngle = interaction.startAngle ?? 0;
          const currentAngle = angleAtTransform(
            event,
            canvas,
            interaction.startTransform
          );
          return {
            ...overlay,
            transform: {
              ...interaction.startTransform,
              rotationDeg:
                interaction.startTransform.rotationDeg +
                ((currentAngle - startAngle) * 180) / Math.PI
            }
          };
        })
      );
    };
    const handlePointerUp = (): void => setInteraction(null);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [interaction]);

  const selected = overlays.find((overlay) => overlay.id === selectedId);
  const hasInvalidLabel = overlays.some(
    (overlay) => overlay.kind === "label" && overlay.text.trim().length === 0
  );

  function updateOverlay(
    overlayId: string,
    update: (overlay: LineOverlay) => LineOverlay
  ): void {
    setOverlays((current) =>
      current.map((overlay) =>
        overlay.id === overlayId ? update(overlay) : overlay
      )
    );
  }

  function beginInteraction(
    event: ReactPointerEvent<HTMLElement>,
    overlay: LineOverlay,
    type: OverlayInteraction["type"]
  ): void {
    const canvas = canvasRef.current;
    if (canvas === null || pending) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const startPoint = lineOverlayPoint(event, canvas);
    setSelectedId(overlay.id);
    setInteraction({
      overlayId: overlay.id,
      type,
      startPoint,
      startTransform: overlay.transform,
      ...(type === "rotate"
        ? { startAngle: angleAtTransform(event, canvas, overlay.transform) }
        : {})
    });
  }

  function addOverlay(kind: LineOverlayKind): void {
    if (pending) {
      return;
    }
    const id = overlayIdForKind(overlays, kind);
    const overlay = createDefaultLineOverlay(
      id,
      line.id,
      kind,
      overlays.length
    );
    setOverlays((current) => [...current, overlay]);
    setSelectedId(id);
  }

  function deleteSelected(): void {
    if (selected === undefined || pending) {
      return;
    }
    setOverlays((current) =>
      current.filter((overlay) => overlay.id !== selected.id)
    );
    setSelectedId(null);
  }

  function duplicateSelected(): void {
    if (selected === undefined || pending) {
      return;
    }
    const id = overlayIdForKind(overlays, selected.kind);
    const duplicate = {
      ...selected,
      id,
      transform: constrainLineOverlayTransform({
        ...selected.transform,
        x: selected.transform.x + 0.03,
        y: selected.transform.y + 0.03
      })
    };
    setOverlays((current) => {
      const index = current.findIndex((overlay) => overlay.id === selected.id);
      return [
        ...current.slice(0, index + 1),
        duplicate,
        ...current.slice(index + 1)
      ];
    });
    setSelectedId(id);
  }

  function handleOverlayKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    overlay: LineOverlay
  ): void {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      setSelectedId(overlay.id);
      setOverlays((current) =>
        current.filter((candidate) => candidate.id !== overlay.id)
      );
      return;
    }
    const step = event.shiftKey ? 0.02 : 0.005;
    const movement =
      event.key === "ArrowLeft"
        ? [-step, 0]
        : event.key === "ArrowRight"
          ? [step, 0]
          : event.key === "ArrowUp"
            ? [0, -step]
            : event.key === "ArrowDown"
              ? [0, step]
              : undefined;
    if (movement === undefined) {
      return;
    }
    event.preventDefault();
    updateOverlay(overlay.id, (current) => ({
      ...current,
      transform: nudgeTransform(current.transform, movement[0], movement[1])
    }));
  }

  function updateSelectedTransform(
    field: keyof LineOverlay["transform"],
    value: string
  ): void {
    if (selected === undefined) {
      return;
    }
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    updateOverlay(selected.id, (current) => ({
      ...current,
      transform:
        field === "rotationDeg"
          ? { ...current.transform, rotationDeg: numericValue }
          : constrainLineOverlayTransform({
              ...current.transform,
              [field]: numericValue
            })
    }));
  }

  return (
    <div className="line-overlay-editor-content">
      <div className="line-overlay-editor-header">
        <div>
          <p className="eyebrow">セリフの自由配置オーバーレイ</p>
          <h2 id="line-overlay-editor-title">{line.id} の画面注釈</h2>
          <p id="line-overlay-editor-description">
            {line.subtitleText || "字幕なしのセリフ"}
          </p>
        </div>
        <div
          className="line-overlay-editor-add-actions"
          role="toolbar"
          aria-label="オーバーレイを追加"
        >
          {overlayKinds.map((kind) => (
            <button
              className="button button-small"
              disabled={pending}
              key={kind}
              type="button"
              onClick={() => addOverlay(kind)}
            >
              + {lineOverlayKindLabel(kind)}
            </button>
          ))}
        </div>
      </div>

      <div className="line-overlay-editor-workspace">
        <div
          ref={canvasRef}
          aria-label="16対9オーバーレイ編集キャンバス"
          className="line-overlay-editor-canvas"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedId(null);
            }
          }}
        >
          <ScreenLayoutFrame
            ariaLabel="オーバーレイ付き16対9プレビュー"
            className="line-overlay-editor-screen"
            preview={{ ...preview, lineOverlays: overlays }}
            template={template}
          />
          <div
            className="line-overlay-editor-interaction-layer"
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                setSelectedId(null);
              }
            }}
          >
            {overlays.map((overlay) => {
              const isSelected = overlay.id === selectedId;
              const { x, y, width, height, rotationDeg } = overlay.transform;
              return (
                <div
                  aria-label={`${lineOverlayKindLabel(overlay.kind)} ${overlay.id}`}
                  className={`line-overlay-editor-item${isSelected ? " line-overlay-editor-item-selected" : ""}`}
                  key={overlay.id}
                  role="button"
                  tabIndex={0}
                  style={{
                    height: `${height * 100}%`,
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                    transform: `rotate(${rotationDeg}deg)`,
                    width: `${width * 100}%`
                  }}
                  onClick={() => setSelectedId(overlay.id)}
                  onKeyDown={(event) => handleOverlayKeyDown(event, overlay)}
                  onPointerDown={(event) =>
                    beginInteraction(event, overlay, "move")
                  }
                >
                  {isSelected ? (
                    <>
                      <button
                        aria-label="サイズを変更"
                        className="line-overlay-editor-resize-handle"
                        disabled={pending}
                        type="button"
                        onPointerDown={(event) =>
                          beginInteraction(event, overlay, "resize")
                        }
                      />
                      <button
                        aria-label="回転"
                        className="line-overlay-editor-rotate-handle"
                        disabled={pending}
                        type="button"
                        onPointerDown={(event) =>
                          beginInteraction(event, overlay, "rotate")
                        }
                      />
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <aside
          className="line-overlay-editor-inspector"
          aria-label="選択中オーバーレイの設定"
        >
          <h3>選択中の設定</h3>
          {selected === undefined ? (
            <p className="status-message">
              キャンバス上の注釈を選択してください。
            </p>
          ) : (
            <>
              <p>
                <strong>{lineOverlayKindLabel(selected.kind)}</strong>{" "}
                <code>{selected.id}</code>
              </p>
              <div className="line-overlay-editor-field-grid">
                {(["x", "y", "width", "height", "rotationDeg"] as const).map(
                  (field) => (
                    <label key={field}>
                      <span>
                        {field === "rotationDeg" ? "回転" : field}{" "}
                        {field === "rotationDeg" ? "(度)" : "(0–1)"}
                      </span>
                      <input
                        disabled={pending}
                        inputMode="decimal"
                        step="0.01"
                        type="number"
                        value={selected.transform[field]}
                        onChange={(event) =>
                          updateSelectedTransform(field, event.target.value)
                        }
                      />
                    </label>
                  )
                )}
              </div>
              <label className="form-field">
                <span>色</span>
                <select
                  disabled={pending}
                  value={selected.colorToken}
                  onChange={(event) =>
                    updateOverlay(selected.id, (current) => ({
                      ...current,
                      colorToken: event.target.value as LineOverlayColorToken
                    }))
                  }
                >
                  {overlayColors.map((color) => (
                    <option key={color} value={color}>
                      {colorLabel(color)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>アニメーション</span>
                <select
                  disabled={pending}
                  value={selected.animation}
                  onChange={(event) =>
                    updateOverlay(selected.id, (current) => ({
                      ...current,
                      animation: event.target.value as LineOverlayAnimation
                    }))
                  }
                >
                  {overlayAnimations.map((animation) => (
                    <option key={animation} value={animation}>
                      {animationLabel(animation)}
                    </option>
                  ))}
                </select>
              </label>
              {selected.kind === "label" ? (
                <label className="form-field">
                  <span>ラベル本文</span>
                  <input
                    disabled={pending}
                    type="text"
                    value={selected.text}
                    onChange={(event) =>
                      updateOverlay(selected.id, (current) =>
                        current.kind === "label"
                          ? { ...current, text: event.target.value }
                          : current
                      )
                    }
                  />
                </label>
              ) : null}
              <div className="line-overlay-editor-item-actions">
                <button
                  className="button button-small"
                  disabled={pending}
                  type="button"
                  onClick={duplicateSelected}
                >
                  複製
                </button>
                <button
                  className="button button-small"
                  disabled={pending}
                  type="button"
                  onClick={deleteSelected}
                >
                  削除
                </button>
              </div>
              <p className="line-overlay-editor-help">
                ドラッグで移動、右下でサイズ変更、上のハンドルで回転。矢印キーで微調整できます。
              </p>
            </>
          )}
        </aside>
      </div>

      {errorMessage(error) !== null ? (
        <p className="form-error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {hasInvalidLabel ? (
        <p className="form-error" role="alert">
          ラベル本文を入力してください。
        </p>
      ) : null}
      <div className="script-media-confirm-actions line-overlay-editor-actions">
        <button
          className="button"
          disabled={pending}
          type="button"
          onClick={onCancel}
        >
          キャンセル
        </button>
        <button
          className="button button-primary"
          disabled={pending || hasInvalidLabel}
          type="button"
          onClick={() => onSave(overlays)}
        >
          {pending ? "保存中…" : "このセリフの注釈を保存"}
        </button>
      </div>
    </div>
  );
}
