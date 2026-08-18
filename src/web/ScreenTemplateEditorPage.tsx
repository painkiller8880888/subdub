import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { Link, useParams } from "react-router";

import type { AssetListItem } from "../schema/asset.js";
import type {
  ScreenTemplateDetail,
  ScreenTemplateUpdateRequest
} from "../schema/api.js";
import type {
  CharacterVisualCatalogSnapshot,
  CharacterVisualSet,
  CharacterVariant
} from "../schema/character-visual.js";
import type {
  ScreenTemplate,
  ScreenTemplateElement
} from "../schema/screen-template.js";
import {
  SCREEN_TEMPLATE_CANVAS_HEIGHT,
  SCREEN_TEMPLATE_CANVAS_WIDTH
} from "../schema/screen-template.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  activateScreenTemplate,
  fetchCharacterVisualCatalog,
  fetchScreenTemplate,
  searchAssets,
  updateScreenTemplate
} from "./lib/api-client";
import { characterVisualFileUrl } from "./character-visuals-view";
import {
  DEFAULT_SCREEN_LAYOUT_PREVIEW,
  ScreenLayoutFrame,
  screenTemplateElementStyle,
  type ScreenCharacterSlot,
  type ScreenLayoutCharacterPreview,
  type ScreenLayoutPreview
} from "../remotion/screen-template-layout";
import {
  findScreenTemplateElement,
  moveScreenTemplateElement,
  normalizedPointerDelta,
  resizeScreenTemplateElement,
  rotationDeltaForPointer,
  screenTemplateElementDescription,
  screenTemplateElementLabel,
  screenTemplateElementValidationMessages,
  screenTemplateElementValidationWarningMessages,
  screenTemplateValidationMessages,
  screenTemplateValidationWarningMessages,
  type NumericElementField,
  type ResizeHandle,
  updateScreenTemplateElementNumericField,
  updateScreenTemplateElementRect,
  updateScreenTemplateElementRotation
} from "./screen-template-editor";

type SaveState = "saved" | "dirty" | "saving" | "error" | "conflict";

type CharacterPreviewSelection = Readonly<{
  visualId: string | null;
  variantId: string | null;
  fileKey: string;
}>;

type CharacterPreviewSelections = Readonly<
  Record<ScreenCharacterSlot, CharacterPreviewSelection>
>;

type EditorInteraction = Readonly<{
  mode: "move" | "resize" | "rotate";
  elementId: string;
  startPointer: Readonly<{ x: number; y: number }>;
  startElement: ScreenTemplateElement;
  handle?: ResizeHandle;
}>;

type CanvasClientRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

type PointerCaptureTarget = Readonly<{
  setPointerCapture: (pointerId: number) => void;
  hasPointerCapture: (pointerId: number) => boolean;
  releasePointerCapture: (pointerId: number) => void;
}>;

const CHARACTER_SLOTS: readonly ScreenCharacterSlot[] = [
  "speaker-1",
  "speaker-2"
];

const EMPTY_CHARACTER_SELECTION: CharacterPreviewSelection = {
  visualId: null,
  variantId: null,
  fileKey: "single"
};

const EMPTY_CHARACTER_SELECTIONS: CharacterPreviewSelections = {
  "speaker-1": EMPTY_CHARACTER_SELECTION,
  "speaker-2": EMPTY_CHARACTER_SELECTION
};

const GENERIC_ASSET_KINDS = new Set(["photo", "video", "document_scan"]);

async function fetchAllActivePreviewAssets(): Promise<AssetListItem[]> {
  const pageSize = 100;
  const items: AssetListItem[] = [];
  let page = 1;

  while (true) {
    const result = await searchAssets({
      page,
      pageSize,
      status: "active"
    });
    items.push(...result.items);
    if (!result.hasNextPage || result.items.length === 0) {
      return items;
    }
    page += 1;
  }
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

function templateDraftFromDetail(detail: ScreenTemplateDetail): ScreenTemplate {
  const { contentHash: _contentHash, ...draft } = detail;
  void _contentHash;
  return draft;
}

function activeVisuals(
  catalog: CharacterVisualCatalogSnapshot | undefined
): CharacterVisualSet[] {
  return catalog?.filter((visual) => visual.status === "active") ?? [];
}

function activeVariants(
  visual: CharacterVisualSet | undefined
): CharacterVariant[] {
  return (
    visual?.variants.filter((variant) => variant.status === "active") ?? []
  );
}

function firstFileKey(variant: CharacterVariant | undefined): string {
  return variant?.renderType === "mouth-pair" ? "closed" : "single";
}

function keepCharacterSelectionValid(
  selection: CharacterPreviewSelection,
  catalog: CharacterVisualCatalogSnapshot
): CharacterPreviewSelection {
  const visuals = activeVisuals(catalog);
  const visual =
    visuals.find((candidate) => candidate.visualId === selection.visualId) ??
    visuals[0];
  if (visual === undefined) {
    return EMPTY_CHARACTER_SELECTION;
  }

  const variants = activeVariants(visual);
  const variant =
    variants.find((candidate) => candidate.variantId === selection.variantId) ??
    variants[0];
  if (variant === undefined) {
    return {
      fileKey: "single",
      variantId: null,
      visualId: visual.visualId
    };
  }

  const fileKey = variant.files.some((file) => file.key === selection.fileKey)
    ? selection.fileKey
    : firstFileKey(variant);
  return {
    fileKey,
    variantId: variant.variantId,
    visualId: visual.visualId
  };
}

function selectedCharacterPreview(
  selection: CharacterPreviewSelection,
  catalog: CharacterVisualCatalogSnapshot | undefined,
  slot: ScreenCharacterSlot
): ScreenLayoutCharacterPreview {
  const visual = activeVisuals(catalog).find(
    (candidate) => candidate.visualId === selection.visualId
  );
  const variant = activeVariants(visual).find(
    (candidate) => candidate.variantId === selection.variantId
  );
  const file = variant?.files.find(
    (candidate) => candidate.key === selection.fileKey
  );
  return {
    alt:
      visual === undefined || variant === undefined
        ? `${slot} preview未選択`
        : `${visual.name} ${variant.label}`,
    src:
      visual === undefined || variant === undefined || file === undefined
        ? null
        : characterVisualFileUrl(
            visual.visualId,
            variant.variantId,
            file.key,
            file.checksum
          )
  };
}

function assetThumbnailUrl(asset: AssetListItem | undefined): string | null {
  if (
    asset === undefined ||
    asset.version === null ||
    asset.thumbnailPaths[0] === undefined
  ) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(asset.assetId)}/thumbnails/0?version=${asset.version}`;
}

function selectedAssetPreview(
  assetId: string | null,
  assets: AssetListItem[] | undefined
): ScreenLayoutPreview["content"] {
  const asset = assets?.find((candidate) => candidate.assetId === assetId);
  return {
    alt: asset?.title ?? "コンテンツ preview",
    src: assetThumbnailUrl(asset)
  };
}

function updateDraftElement(
  template: ScreenTemplate,
  elementId: string,
  update: (element: ScreenTemplateElement) => ScreenTemplateElement
): ScreenTemplate {
  return {
    ...template,
    elements: template.elements.map((element) =>
      element.elementId === elementId ? update(element) : element
    )
  };
}

function isCharacterElement(
  element: ScreenTemplateElement
): element is Extract<ScreenTemplateElement, { type: "character-visual" }> {
  return element.type === "character-visual";
}

function flipCharacterElement(
  template: ScreenTemplate,
  elementId: string,
  flipX: boolean
): ScreenTemplate {
  return updateDraftElement(template, elementId, (element) =>
    isCharacterElement(element) ? { ...element, flipX } : element
  );
}

function formatPixels(value: number, canvasSize: number): string {
  return `${Math.round(value * canvasSize)} px`;
}

function formatRotation(value: number): string {
  return `${Number(value.toFixed(2))}°`;
}

function elementFieldValue(
  element: ScreenTemplateElement,
  field: NumericElementField
): number | null {
  if (field === "rotationDeg") {
    return element.transform.rotationDeg;
  }
  if (field === "fontSize") {
    return element.type === "dialogue-window" ||
      element.type === "section-title"
      ? element.fontSize
      : null;
  }
  return element.transform.rect[field];
}

function saveStateLabel(state: SaveState): string {
  switch (state) {
    case "saved":
      return "保存済み";
    case "dirty":
      return "未保存の変更があります";
    case "saving":
      return "保存中…";
    case "conflict":
      return "競合。入力内容を保持しています";
    case "error":
      return "保存に失敗しました。入力内容を保持しています";
  }
}

function NumericPropertyField({
  id,
  label,
  value,
  min,
  max,
  step,
  hint,
  error,
  disabled,
  onChange
}: {
  readonly id: string;
  readonly label: string;
  readonly value: number;
  readonly min?: number;
  readonly max?: number;
  readonly step: number;
  readonly hint: string;
  readonly error?: string;
  readonly disabled: boolean;
  readonly onChange: (value: number) => void;
}) {
  return (
    <div className="form-field screen-template-property-field">
      <label htmlFor={id}>{label}</label>
      <input
        aria-describedby={`${id}-hint${error === undefined ? "" : ` ${id}-error`}`}
        aria-invalid={error !== undefined}
        disabled={disabled}
        id={id}
        max={max}
        min={min}
        step={step}
        type="number"
        value={value}
        onChange={(event) => {
          const raw = event.target.value.trim();
          const parsed = Number(raw);
          if (raw.length === 0 || !Number.isFinite(parsed)) {
            return;
          }
          onChange(parsed);
        }}
      />
      <small id={`${id}-hint`}>{hint}</small>
      {error === undefined ? null : (
        <span className="form-error" id={`${id}-error`} role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function PreviewAssetControls({
  catalog,
  assets,
  catalogError,
  catalogLoading,
  assetsError,
  assetsLoading,
  selections,
  assetId,
  onRetryCatalog,
  onRetryAssets,
  onCharacterSelection,
  onAssetSelection
}: {
  readonly catalog: CharacterVisualCatalogSnapshot | undefined;
  readonly assets: AssetListItem[] | undefined;
  readonly catalogError: unknown;
  readonly catalogLoading: boolean;
  readonly assetsError: unknown;
  readonly assetsLoading: boolean;
  readonly selections: CharacterPreviewSelections;
  readonly assetId: string | null;
  readonly onRetryCatalog: () => void;
  readonly onRetryAssets: () => void;
  readonly onCharacterSelection: (
    slot: ScreenCharacterSlot,
    selection: CharacterPreviewSelection
  ) => void;
  readonly onAssetSelection: (assetId: string | null) => void;
}) {
  const visuals = activeVisuals(catalog);
  const previewAssets =
    assets?.filter((asset) => GENERIC_ASSET_KINDS.has(asset.kind)) ?? [];

  return (
    <section
      className="screen-template-preview-controls"
      aria-labelledby="screen-template-preview-title"
    >
      <div className="screen-template-section-heading">
        <div>
          <p className="eyebrow">一時UI state</p>
          <h2 id="screen-template-preview-title">実素材 preview</h2>
        </div>
        <span>保存対象外</span>
      </div>
      <p className="screen-template-preview-note">
        選択した visual / variant / asset は配置確認だけに使い、ScreenTemplate
        mutationには含めません。
      </p>
      <div className="screen-template-preview-control-grid">
        {CHARACTER_SLOTS.map((slot) => {
          const selection = selections[slot];
          const visual = visuals.find(
            (candidate) => candidate.visualId === selection.visualId
          );
          const variants = activeVariants(visual);
          const variant = variants.find(
            (candidate) => candidate.variantId === selection.variantId
          );
          return (
            <fieldset className="screen-template-preview-fieldset" key={slot}>
              <legend>{slot} preview</legend>
              <div className="form-field">
                <label htmlFor={`screen-template-${slot}-visual`}>
                  CharacterVisual
                </label>
                <select
                  id={`screen-template-${slot}-visual`}
                  value={selection.visualId ?? ""}
                  onChange={(event) => {
                    const nextVisual = visuals.find(
                      (candidate) => candidate.visualId === event.target.value
                    );
                    const nextVariant = activeVariants(nextVisual)[0];
                    onCharacterSelection(slot, {
                      fileKey: firstFileKey(nextVariant),
                      variantId: nextVariant?.variantId ?? null,
                      visualId: nextVisual?.visualId ?? null
                    });
                  }}
                >
                  <option value="">選択なし</option>
                  {visuals.map((candidate) => (
                    <option key={candidate.visualId} value={candidate.visualId}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor={`screen-template-${slot}-variant`}>
                  variant
                </label>
                <select
                  disabled={visual === undefined}
                  id={`screen-template-${slot}-variant`}
                  value={selection.variantId ?? ""}
                  onChange={(event) => {
                    const nextVariant = variants.find(
                      (candidate) => candidate.variantId === event.target.value
                    );
                    onCharacterSelection(slot, {
                      ...selection,
                      fileKey: firstFileKey(nextVariant),
                      variantId: nextVariant?.variantId ?? null
                    });
                  }}
                >
                  <option value="">選択なし</option>
                  {variants.map((candidate) => (
                    <option
                      key={candidate.variantId}
                      value={candidate.variantId}
                    >
                      {candidate.label}（{candidate.renderType}）
                    </option>
                  ))}
                </select>
              </div>
              {variant?.renderType === "mouth-pair" ? (
                <div className="form-field">
                  <label htmlFor={`screen-template-${slot}-mouth`}>
                    mouth-pair preview
                  </label>
                  <select
                    id={`screen-template-${slot}-mouth`}
                    value={selection.fileKey}
                    onChange={(event) => {
                      onCharacterSelection(slot, {
                        ...selection,
                        fileKey: event.target.value
                      });
                    }}
                  >
                    <option value="closed">closed（口閉じ）</option>
                    <option value="open">open（口開き）</option>
                  </select>
                </div>
              ) : null}
            </fieldset>
          );
        })}
        <fieldset className="screen-template-preview-fieldset">
          <legend>primary content preview</legend>
          <div className="form-field">
            <label htmlFor="screen-template-content-asset">Asset</label>
            <select
              id="screen-template-content-asset"
              value={assetId ?? ""}
              onChange={(event) => {
                onAssetSelection(
                  event.target.value.length > 0 ? event.target.value : null
                );
              }}
            >
              <option value="">選択なし</option>
              {previewAssets.map((asset) => (
                <option key={asset.assetId} value={asset.assetId}>
                  {asset.title}（{asset.kind}）
                </option>
              ))}
            </select>
            <small>activeな photo / video / document_scan のみ</small>
          </div>
        </fieldset>
      </div>
      {catalogLoading ? (
        <p className="status-message" role="status">
          CharacterVisualを読み込んでいます…
        </p>
      ) : null}
      {catalogLoading ||
      catalogError === null ||
      catalogError === undefined ? null : (
        <div className="screen-template-preview-query-error" role="alert">
          <p>
            {errorMessage(
              catalogError,
              "CharacterVisualを読み込めませんでした。"
            )}
          </p>
          <button className="button" type="button" onClick={onRetryCatalog}>
            CharacterVisualを再読み込み
          </button>
        </div>
      )}
      {assetsLoading ? (
        <p className="status-message" role="status">
          Assetを読み込んでいます…
        </p>
      ) : null}
      {assetsLoading ||
      assetsError === null ||
      assetsError === undefined ? null : (
        <div className="screen-template-preview-query-error" role="alert">
          <p>{errorMessage(assetsError, "Assetを読み込めませんでした。")}</p>
          <button className="button" type="button" onClick={onRetryAssets}>
            Assetを再読み込み
          </button>
        </div>
      )}
    </section>
  );
}

export function ScreenTemplateEditorPage() {
  const { templateId } = useParams<{ templateId: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ScreenTemplate | null>(null);
  const [expectedRevision, setExpectedRevision] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedElementId, setSelectedElementId] = useState<string | null>(
    null
  );
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [characterSelections, setCharacterSelections] =
    useState<CharacterPreviewSelections>(EMPTY_CHARACTER_SELECTIONS);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [dialogueText, setDialogueText] = useState(
    DEFAULT_SCREEN_LAYOUT_PREVIEW.dialogueText
  );
  const [sectionTitleText, setSectionTitleText] = useState(
    DEFAULT_SCREEN_LAYOUT_PREVIEW.sectionTitleText
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<EditorInteraction | null>(null);
  const initializedTemplateIdRef = useRef<string | null>(null);

  const templateQuery = useQuery({
    enabled: templateId !== undefined,
    queryKey: ["screen-template", templateId],
    queryFn: () => fetchScreenTemplate(templateId as string),
    retry: false
  });
  const characterCatalogQuery = useQuery({
    queryKey: ["character-visuals"],
    queryFn: fetchCharacterVisualCatalog,
    retry: false
  });
  const assetsQuery = useQuery({
    queryKey: ["screen-template-preview-assets"],
    queryFn: fetchAllActivePreviewAssets,
    retry: false
  });

  useEffect(() => {
    initializedTemplateIdRef.current = null;
  }, [templateId]);

  useEffect(() => {
    const detail = templateQuery.data;
    if (
      detail === undefined ||
      initializedTemplateIdRef.current === detail.templateId
    ) {
      return;
    }
    initializedTemplateIdRef.current = detail.templateId;
    setDraft(templateDraftFromDetail(detail));
    setExpectedRevision(detail.revision);
    setName(detail.name);
    setDescription(detail.description);
    setSelectedElementId(detail.elements[0]?.elementId ?? null);
    setSaveState("saved");
    setValidationErrors([]);
    setFieldErrors({});
  }, [templateQuery.data]);

  useEffect(() => {
    const catalog = characterCatalogQuery.data;
    if (catalog === undefined) {
      return;
    }
    setCharacterSelections((current) => ({
      "speaker-1": keepCharacterSelectionValid(current["speaker-1"], catalog),
      "speaker-2": keepCharacterSelectionValid(current["speaker-2"], catalog)
    }));
  }, [characterCatalogQuery.data]);

  const updateMutation = useMutation({
    mutationFn: ({ input }: { readonly input: ScreenTemplateUpdateRequest }) =>
      updateScreenTemplate(templateId as string, input),
    onSuccess: async (detail) => {
      const nextDraft = templateDraftFromDetail(detail);
      setDraft(nextDraft);
      setExpectedRevision(detail.revision);
      setName(detail.name);
      setDescription(detail.description);
      setSaveState("saved");
      setValidationErrors([]);
      setFieldErrors({});
      queryClient.setQueryData(["screen-template", templateId], detail);
      await queryClient.invalidateQueries({ queryKey: ["screen-templates"] });
    },
    onError: (error) => {
      setSaveState(
        error instanceof ApiClientError &&
          error.code === "SCREEN_TEMPLATE_REVISION_CONFLICT"
          ? "conflict"
          : "error"
      );
    }
  });

  const activateMutation = useMutation({
    mutationFn: () =>
      activateScreenTemplate(templateId as string, expectedRevision as number),
    onSuccess: async (detail) => {
      const nextDraft = templateDraftFromDetail(detail);
      setDraft(nextDraft);
      setExpectedRevision(detail.revision);
      setName(detail.name);
      setDescription(detail.description);
      setSaveState("saved");
      queryClient.setQueryData(["screen-template", templateId], detail);
      await queryClient.invalidateQueries({ queryKey: ["screen-templates"] });
    }
  });

  function setDraftDirty(next: ScreenTemplate): void {
    updateMutation.reset();
    setDraft(next);
    setSaveState("dirty");
    setValidationErrors([]);
  }

  function selectedElement(): ScreenTemplateElement | undefined {
    return draft === null || selectedElementId === null
      ? undefined
      : findScreenTemplateElement(draft, selectedElementId);
  }

  function updateElementFromPointer(
    interaction: EditorInteraction,
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    if (saveState === "saving") {
      interactionRef.current = null;
      return;
    }
    const currentDraft = draft;
    const canvasRect =
      canvasRef.current === null
        ? undefined
        : (
            canvasRef.current as unknown as {
              getBoundingClientRect: () => CanvasClientRect;
            }
          ).getBoundingClientRect();
    if (currentDraft === null || canvasRect === undefined) {
      return;
    }
    const currentElement = findScreenTemplateElement(
      currentDraft,
      interaction.elementId
    );
    if (currentElement === undefined) {
      return;
    }
    const currentPointer = { x: event.clientX, y: event.clientY };
    if (interaction.mode === "rotate") {
      const rotationDelta = rotationDeltaForPointer(
        interaction.startElement,
        interaction.startPointer,
        currentPointer,
        canvasRect
      );
      setDraftDirty(
        updateScreenTemplateElementRotation(
          currentDraft,
          interaction.elementId,
          interaction.startElement.transform.rotationDeg + rotationDelta
        )
      );
      return;
    }

    const delta = normalizedPointerDelta(
      interaction.startPointer,
      currentPointer,
      canvasRect
    );
    const nextElement =
      interaction.mode === "move"
        ? moveScreenTemplateElement(interaction.startElement, delta.x, delta.y)
        : resizeScreenTemplateElement(
            interaction.startElement,
            interaction.handle as ResizeHandle,
            delta.x,
            delta.y
          );
    setDraftDirty(
      interaction.mode === "move"
        ? updateScreenTemplateElementRect(
            currentDraft,
            interaction.elementId,
            nextElement.transform.rect
          )
        : updateDraftElement(
            currentDraft,
            interaction.elementId,
            () => nextElement
          )
    );
  }

  function beginInteraction(
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    element: ScreenTemplateElement,
    mode: EditorInteraction["mode"],
    handle?: ResizeHandle
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (saveState === "saving" || draft?.status === "inactive") {
      return;
    }
    setSelectedElementId(element.elementId);
    interactionRef.current = {
      elementId: element.elementId,
      handle,
      mode,
      startElement: element,
      startPointer: { x: event.clientX, y: event.clientY }
    };
    (event.currentTarget as unknown as PointerCaptureTarget).setPointerCapture(
      event.pointerId
    );
  }

  function finishInteraction(event: ReactPointerEvent<HTMLDivElement>): void {
    if (interactionRef.current !== null) {
      interactionRef.current = null;
      setSaveState((current) => (current === "saving" ? current : "dirty"));
    }
    const pointerTarget =
      event.currentTarget as unknown as PointerCaptureTarget;
    if (pointerTarget.hasPointerCapture(event.pointerId)) {
      pointerTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleCanvasPointerMove(
    event: ReactPointerEvent<HTMLDivElement>
  ): void {
    const interaction = interactionRef.current;
    if (interaction !== null) {
      updateElementFromPointer(interaction, event);
    }
  }

  function handleElementKeyDown(
    event: React.KeyboardEvent<HTMLDivElement>,
    element: ScreenTemplateElement
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedElementId(element.elementId);
      return;
    }

    if (draft === null || saveState === "saving") {
      return;
    }

    if (draft.status === "inactive") {
      return;
    }

    if (isCharacterElement(element) && event.key.toLowerCase() === "f") {
      event.preventDefault();
      setDraftDirty(
        flipCharacterElement(draft, element.elementId, !element.flipX)
      );
      return;
    }

    if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      setDraftDirty(
        updateScreenTemplateElementRotation(
          draft,
          element.elementId,
          element.transform.rotationDeg + (event.shiftKey ? 15 : 5)
        )
      );
      return;
    }

    const direction =
      event.key === "ArrowLeft"
        ? { x: -1, y: 0 }
        : event.key === "ArrowRight"
          ? { x: 1, y: 0 }
          : event.key === "ArrowUp"
            ? { x: 0, y: -1 }
            : event.key === "ArrowDown"
              ? { x: 0, y: 1 }
              : null;
    if (direction === null) {
      return;
    }
    event.preventDefault();
    const canvasSize =
      direction.x === 0
        ? SCREEN_TEMPLATE_CANVAS_HEIGHT
        : SCREEN_TEMPLATE_CANVAS_WIDTH;
    const step = (event.shiftKey ? 10 : 1) / canvasSize;
    const nextElement = moveScreenTemplateElement(
      element,
      direction.x * step,
      direction.y * step
    );
    setDraftDirty(
      updateScreenTemplateElementRect(
        draft,
        element.elementId,
        nextElement.transform.rect
      )
    );
  }

  function updateNumericField(
    element: ScreenTemplateElement,
    field: NumericElementField,
    value: number
  ): void {
    const key = `${element.elementId}:${field}`;
    const rectField =
      field === "x" || field === "y" || field === "width" || field === "height";
    if (rectField && (value < 0 || value > 1)) {
      setFieldErrors((current) => ({
        ...current,
        [key]: "0〜1の範囲で入力してください。"
      }));
      return;
    }
    if (field === "fontSize" && value <= 0) {
      setFieldErrors((current) => ({
        ...current,
        [key]: "0より大きい値を入力してください。"
      }));
      return;
    }
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (draft !== null) {
      setDraftDirty(
        updateScreenTemplateElementNumericField(
          draft,
          element.elementId,
          field,
          value
        )
      );
    }
  }

  function submitSave(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (
      draft === null ||
      expectedRevision === null ||
      templateId === undefined
    ) {
      return;
    }
    const messages = [
      ...screenTemplateValidationMessages(draft),
      ...(name.trim().length === 0
        ? ["テンプレート名を入力してください。"]
        : []),
      ...Object.values(fieldErrors)
    ];
    setValidationErrors([...new Set(messages)]);
    if (messages.length > 0 || draft.status === "inactive") {
      return;
    }
    interactionRef.current = null;
    setSaveState("saving");
    updateMutation.mutate({
      input: {
        description,
        elements: draft.elements,
        expectedRevision,
        name
      }
    });
  }

  async function reloadLatest(): Promise<void> {
    initializedTemplateIdRef.current = null;
    updateMutation.reset();
    setValidationErrors([]);
    await templateQuery.refetch();
  }

  function changeMetadata(
    setter: (value: string) => void,
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ): void {
    updateMutation.reset();
    setter(event.target.value);
    setSaveState("dirty");
  }

  if (templateId === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>画面テンプレートが指定されていません</h1>
          <Link className="button" to="/screen-templates">
            一覧へ戻る
          </Link>
        </section>
      </main>
    );
  }

  if (templateQuery.isError) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>画面テンプレートを取得できません</h1>
          <p>
            {errorMessage(
              templateQuery.error,
              "指定されたテンプレートを読み込めませんでした。"
            )}
          </p>
          <div className="page-header-actions">
            <button
              className="button"
              type="button"
              onClick={() => void templateQuery.refetch()}
            >
              再読み込み
            </button>
            <Link className="button" to="/screen-templates">
              一覧へ戻る
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (templateQuery.isPending || draft === null || expectedRevision === null) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          画面テンプレートを読み込んでいます…
        </p>
      </main>
    );
  }

  if (templateQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>画面テンプレートを取得できません</h1>
          <p>指定されたテンプレートを読み込めませんでした。</p>
          <Link className="button" to="/screen-templates">
            一覧へ戻る
          </Link>
        </section>
      </main>
    );
  }

  const selected = selectedElement();
  const detailError = updateMutation.isError
    ? errorMessage(updateMutation.error, "保存に失敗しました。")
    : null;
  const active = draft.status === "active";
  const structuralErrors = screenTemplateValidationMessages(draft);
  const structuralWarnings = screenTemplateValidationWarningMessages(draft);
  const allValidationErrors = [
    ...new Set([...structuralErrors, ...validationErrors])
  ];
  const allValidationWarnings = [...new Set(structuralWarnings)];
  const preview: ScreenLayoutPreview = {
    characters: {
      "speaker-1": selectedCharacterPreview(
        characterSelections["speaker-1"],
        characterCatalogQuery.data,
        "speaker-1"
      ),
      "speaker-2": selectedCharacterPreview(
        characterSelections["speaker-2"],
        characterCatalogQuery.data,
        "speaker-2"
      )
    },
    content: selectedAssetPreview(assetId, assetsQuery.data),
    dialogueText,
    sectionTitleText
  };

  return (
    <main className="page-shell screen-template-editor-page">
      <header className="page-header screen-template-editor-header">
        <div>
          <Link className="screen-template-back-link" to="/screen-templates">
            ← 画面テンプレート一覧
          </Link>
          <p className="eyebrow">ScreenTemplate editor</p>
          <h1>{name || draft.name}</h1>
          <p>1920 × 1080 の normalized geometry を編集しています。</p>
        </div>
        <div className="screen-template-editor-header-meta">
          <span
            className={`screen-template-status screen-template-status-${draft.status}`}
          >
            {draft.status}
          </span>
          <span>revision {expectedRevision}</span>
        </div>
      </header>

      {!active ? (
        <section className="message-panel message-panel-warning" role="status">
          <h2>inactive のため編集できません</h2>
          <p>再有効化すると geometry と metadata を編集して保存できます。</p>
          {activateMutation.isError ? (
            <p className="form-error">
              {errorMessage(activateMutation.error, "再有効化に失敗しました。")}
            </p>
          ) : null}
          <button
            className="button button-primary"
            disabled={activateMutation.isPending}
            type="button"
            onClick={() => activateMutation.mutate()}
          >
            {activateMutation.isPending ? "再有効化中…" : "再有効化"}
          </button>
        </section>
      ) : null}

      <form className="screen-template-editor" noValidate onSubmit={submitSave}>
        <section
          className="screen-template-editor-toolbar"
          aria-label="テンプレート metadata と保存状態"
        >
          <div className="screen-template-metadata-fields">
            <div className="form-field">
              <label htmlFor="screen-template-editor-name">名前</label>
              <input
                aria-invalid={name.trim().length === 0}
                disabled={!active || saveState === "saving"}
                id="screen-template-editor-name"
                type="text"
                value={name}
                onChange={(event) => changeMetadata(setName, event)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="screen-template-editor-description">説明</label>
              <textarea
                disabled={!active || saveState === "saving"}
                id="screen-template-editor-description"
                rows={2}
                value={description}
                onChange={(event) => changeMetadata(setDescription, event)}
              />
            </div>
          </div>
          <div className="screen-template-save-actions">
            <span
              className={`screen-template-save-state screen-template-save-state-${saveState}`}
              role="status"
            >
              {saveStateLabel(saveState)}
            </span>
            <button
              className="button button-primary"
              disabled={
                !active ||
                saveState === "saving" ||
                allValidationErrors.length > 0
              }
              type="submit"
            >
              {saveState === "saving" ? "保存中…" : "保存"}
            </button>
          </div>
        </section>

        {allValidationErrors.length > 0 ? (
          <section
            className="message-panel message-panel-error screen-template-validation-panel"
            role="alert"
          >
            <h2>保存前に確認してください</h2>
            <ul>
              {allValidationErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {allValidationWarnings.length > 0 ? (
          <section
            className="message-panel message-panel-warning screen-template-validation-panel"
            role="status"
          >
            <h2>表示上の注意</h2>
            <ul>
              {allValidationWarnings.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {detailError !== null ? (
          <section className="message-panel message-panel-error" role="alert">
            <h2>
              {saveState === "conflict" ? "保存競合" : "保存に失敗しました"}
            </h2>
            <p>{detailError}</p>
            {saveState === "conflict" ? (
              <button
                className="button"
                type="button"
                onClick={() => void reloadLatest()}
              >
                最新データを再読み込み
              </button>
            ) : null}
          </section>
        ) : null}

        <div className="screen-template-editor-grid">
          <aside
            className="screen-template-element-panel"
            aria-label="テンプレート要素"
          >
            <div className="screen-template-section-heading">
              <div>
                <p className="eyebrow">固定 element</p>
                <h2>要素一覧</h2>
              </div>
              <span>{draft.elements.length}件</span>
            </div>
            <div
              className="screen-template-element-list"
              role="listbox"
              aria-label="編集する要素を選択"
            >
              {draft.elements.map((element) => {
                const elementErrors = screenTemplateElementValidationMessages(
                  draft,
                  element.elementId
                );
                const elementWarnings =
                  screenTemplateElementValidationWarningMessages(
                    draft,
                    element.elementId
                  );
                return (
                  <button
                    aria-selected={selectedElementId === element.elementId}
                    className={`screen-template-element-list-item${selectedElementId === element.elementId ? " screen-template-element-list-item-selected" : ""}`}
                    key={element.elementId}
                    role="option"
                    type="button"
                    onClick={() => setSelectedElementId(element.elementId)}
                  >
                    <span>{screenTemplateElementLabel(element)}</span>
                    <small>{screenTemplateElementDescription(element)}</small>
                    {elementErrors.length > 0 ? (
                      <em>{elementErrors[0]}</em>
                    ) : elementWarnings.length > 0 ? (
                      <em className="screen-template-element-warning">
                        {elementWarnings[0]}
                      </em>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="screen-template-keyboard-help">
              <strong>Keyboard</strong>
              <span>矢印: 移動 / Shift+矢印: 10px移動</span>
              <span>R: 回転 / F: character flipX</span>
            </div>
          </aside>

          <section
            className="screen-template-canvas-panel"
            aria-labelledby="screen-template-canvas-title"
          >
            <div className="screen-template-section-heading">
              <div>
                <p className="eyebrow">16:9 canvas</p>
                <h2 id="screen-template-canvas-title">プレビュー canvas</h2>
              </div>
              <span>論理サイズ 1920 × 1080</span>
            </div>
            <div
              ref={canvasRef}
              aria-label="ScreenTemplate編集canvas。要素をドラッグして移動できます。"
              className="screen-template-canvas"
              onPointerCancel={finishInteraction}
              onPointerMove={handleCanvasPointerMove}
              onPointerUp={finishInteraction}
            >
              <ScreenLayoutFrame
                ariaLabel="ScreenTemplate preview"
                className="screen-template-editor-renderer"
                preview={preview}
                template={draft}
              />
              <div className="screen-template-editor-layer">
                {draft.elements.map((element) => {
                  const selectedElementOverlay =
                    element.elementId === selectedElementId;
                  return (
                    <div
                      aria-label={`${screenTemplateElementLabel(element)}を選択。ドラッグで移動`}
                      className={`screen-template-selection-box${selectedElementOverlay ? " screen-template-selection-box-selected" : ""}`}
                      key={element.elementId}
                      role="button"
                      style={screenTemplateElementStyle(element)}
                      tabIndex={0}
                      onClick={() => setSelectedElementId(element.elementId)}
                      onKeyDown={(event) =>
                        handleElementKeyDown(event, element)
                      }
                      onPointerDown={(event) =>
                        beginInteraction(event, element, "move")
                      }
                    >
                      {selectedElementOverlay ? (
                        <>
                          {(
                            [
                              ["north-west", "左上をリサイズ"],
                              ["north-east", "右上をリサイズ"],
                              ["south-east", "右下をリサイズ"],
                              ["south-west", "左下をリサイズ"]
                            ] as const
                          ).map(([handle, label]) => (
                            <button
                              aria-label={label}
                              className={`screen-template-resize-handle screen-template-resize-handle-${handle}`}
                              key={handle}
                              type="button"
                              onPointerDown={(event) =>
                                beginInteraction(
                                  event,
                                  element,
                                  "resize",
                                  handle
                                )
                              }
                            />
                          ))}
                          <button
                            aria-label="回転"
                            className="screen-template-rotation-handle"
                            type="button"
                            onPointerDown={(event) =>
                              beginInteraction(event, element, "rotate")
                            }
                          >
                            ↻
                          </button>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="screen-template-canvas-note">
              選択中 element の bounds と handle
              を表示しています。数値入力からも同じ geometry を編集できます。
            </p>
          </section>

          <aside
            className="screen-template-properties-panel"
            aria-label="選択中要素のプロパティ"
          >
            <div className="screen-template-section-heading">
              <div>
                <p className="eyebrow">Properties</p>
                <h2>
                  {selected === undefined
                    ? "要素を選択"
                    : screenTemplateElementLabel(selected)}
                </h2>
              </div>
            </div>
            {selected === undefined ? (
              <p className="status-message">
                左の要素一覧またはcanvas上の要素を選択してください。
              </p>
            ) : (
              <div className="screen-template-property-content">
                <p className="screen-template-property-description">
                  {screenTemplateElementDescription(selected)}
                </p>
                <div className="screen-template-property-grid">
                  {(["x", "y", "width", "height"] as const).map((field) => {
                    const value = elementFieldValue(selected, field);
                    if (value === null) {
                      return null;
                    }
                    const canvasSize =
                      field === "x" || field === "width" ? 1920 : 1080;
                    const fieldLabel =
                      field === "x"
                        ? "x"
                        : field === "y"
                          ? "y"
                          : field === "width"
                            ? "width"
                            : "height";
                    const key = `${selected.elementId}:${field}`;
                    return (
                      <NumericPropertyField
                        disabled={!active || saveState === "saving"}
                        error={fieldErrors[key]}
                        hint={`normalized 0〜1 / ${formatPixels(value, canvasSize)}`}
                        id={`screen-template-property-${field}`}
                        key={field}
                        label={fieldLabel}
                        max={1}
                        min={0}
                        step={0.001}
                        value={value}
                        onChange={(next) =>
                          updateNumericField(selected, field, next)
                        }
                      />
                    );
                  })}
                  {(() => {
                    const key = `${selected.elementId}:rotationDeg`;
                    return (
                      <NumericPropertyField
                        disabled={!active || saveState === "saving"}
                        error={fieldErrors[key]}
                        hint={`canvas内の中心回転 / ${formatRotation(selected.transform.rotationDeg)}`}
                        id="screen-template-property-rotation"
                        label="rotationDeg"
                        step={1}
                        value={selected.transform.rotationDeg}
                        onChange={(next) =>
                          updateNumericField(selected, "rotationDeg", next)
                        }
                      />
                    );
                  })()}
                  {selected.type === "dialogue-window" ||
                  selected.type === "section-title" ? (
                    <NumericPropertyField
                      disabled={!active || saveState === "saving"}
                      error={fieldErrors[`${selected.elementId}:fontSize`]}
                      hint="canvas上のフォントサイズ px"
                      id="screen-template-property-font-size"
                      label="fontSizePx"
                      min={1}
                      step={1}
                      value={selected.fontSize}
                      onChange={(next) =>
                        updateNumericField(selected, "fontSize", next)
                      }
                    />
                  ) : null}
                </div>
                {isCharacterElement(selected) ? (
                  <label
                    className="checkbox-field screen-template-flip-field"
                    htmlFor="screen-template-property-flip-x"
                  >
                    <input
                      checked={selected.flipX}
                      disabled={!active || saveState === "saving"}
                      id="screen-template-property-flip-x"
                      type="checkbox"
                      onChange={(event) => {
                        if (draft !== null) {
                          setDraftDirty(
                            flipCharacterElement(
                              draft,
                              selected.elementId,
                              (event.target as unknown as { checked: boolean })
                                .checked
                            )
                          );
                        }
                      }}
                    />
                    <span>flipX（左右反転）</span>
                  </label>
                ) : null}
              </div>
            )}
            <div className="screen-template-sample-fields">
              <div className="form-field">
                <label htmlFor="screen-template-sample-dialogue">
                  サンプルセリフ
                </label>
                <textarea
                  id="screen-template-sample-dialogue"
                  rows={3}
                  value={dialogueText}
                  onChange={(event) => setDialogueText(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="screen-template-sample-section-title">
                  サンプルセクション名
                </label>
                <input
                  id="screen-template-sample-section-title"
                  type="text"
                  value={sectionTitleText}
                  onChange={(event) => setSectionTitleText(event.target.value)}
                />
              </div>
            </div>
          </aside>
        </div>

        <PreviewAssetControls
          assetId={assetId}
          assets={assetsQuery.data}
          assetsError={assetsQuery.error}
          assetsLoading={assetsQuery.isPending}
          catalog={characterCatalogQuery.data}
          catalogError={characterCatalogQuery.error}
          catalogLoading={characterCatalogQuery.isPending}
          selections={characterSelections}
          onRetryAssets={() => void assetsQuery.refetch()}
          onRetryCatalog={() => void characterCatalogQuery.refetch()}
          onAssetSelection={setAssetId}
          onCharacterSelection={(slot, selection) => {
            setCharacterSelections((current) => ({
              ...current,
              [slot]: selection
            }));
          }}
        />
      </form>
    </main>
  );
}
