import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";

import {
  ApiClientError,
  ApiClientProtocolError,
  activateCharacterVisualVariant,
  createCharacterVisual,
  createCharacterVisualVariant,
  deactivateCharacterVisualVariant,
  fetchCharacterVisualCatalog,
  fetchCharacterVisualFile,
  updateCharacterVisual,
  updateCharacterVisualVariant,
  type CharacterVisualVariantUploadFiles
} from "./lib/api-client";
import type {
  CharacterVariant,
  CharacterVariantRenderType,
  CharacterVisualSet
} from "../schema/character-visual.js";

type VariantFileKey = "single" | "closed" | "open";

const fileSlots: readonly {
  readonly key: VariantFileKey;
  readonly label: string;
}[] = [
  { key: "single", label: "画像" },
  { key: "closed", label: "closed（口閉じ）" },
  { key: "open", label: "open（口開き）" }
];

function characterVisualFileUrl(
  visualId: string,
  variantId: string,
  fileKey: string
): string {
  return `/api/character-visuals/${encodeURIComponent(visualId)}/${encodeURIComponent(variantId)}/${encodeURIComponent(fileKey)}`;
}

function formatCanvas(visual: CharacterVisualSet): string {
  return visual.baseWidth === null || visual.baseHeight === null
    ? "未設定"
    : `${visual.baseWidth} × ${visual.baseHeight} px`;
}

function friendlyErrorMessage(
  error: unknown,
  visual?: CharacterVisualSet
): string {
  if (error instanceof ApiClientError) {
    if (error.code === "CHARACTER_VISUAL_CANVAS_SIZE_MISMATCH") {
      return visual !== undefined &&
        visual.baseWidth !== null &&
        visual.baseHeight !== null
        ? `このキャラクタービジュアルの基準サイズは ${visual.baseWidth} × ${visual.baseHeight} px です。選択した画像のキャンバスが一致しないため登録できません。`
        : "選択した画像同士のキャンバスサイズが一致しないため登録できません。";
    }
    switch (error.code) {
      case "CHARACTER_VISUAL_MISSING_SLOT":
        return "必要な画像スロットが揃っていません。closed と open の両方を選択してください。";
      case "CHARACTER_VISUAL_UNSUPPORTED_FILE_TYPE":
        return "PNG画像だけを選択してください。";
      case "CHARACTER_VISUAL_INVALID_PNG":
        return "選択したファイルは透明背景のPNGとして読み込めません。";
      case "CHARACTER_VISUAL_FILE_TOO_LARGE":
        return "画像ファイルが大きすぎます。別のPNGを選択してください。";
      case "CHARACTER_VISUAL_CONFLICT":
        return "同じ画像が既に登録されています。別のPNGを選択してください。";
      default:
        return error.message;
    }
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  return "保存できませんでした。入力内容を確認して、もう一度お試しください。";
}

function tagsFromText(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    )
  ];
}

function domId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}

function ManagedVariantImage({
  visualId,
  variantId,
  fileKey,
  label
}: {
  readonly visualId: string;
  readonly variantId: string;
  readonly fileKey: string;
  readonly label: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="character-visual-image-error"
        role="img"
        aria-label={`${label}を読み込めません`}
      >
        <strong>画像を読み込めません</strong>
        <span>{label}</span>
      </div>
    );
  }

  return (
    <img
      alt={label}
      className="character-visual-preview-image"
      src={characterVisualFileUrl(visualId, variantId, fileKey)}
      onError={() => setFailed(true)}
    />
  );
}

function LocalFilePreview({
  file,
  label,
  expectedCanvas
}: {
  readonly file: File | null;
  readonly label: string;
  readonly expectedCanvas: string;
}) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<string | null>(null);

  useEffect(() => {
    if (file === null || typeof URL.createObjectURL !== "function") {
      setObjectUrl(null);
      setDimensions(null);
      return undefined;
    }

    const nextObjectUrl = URL.createObjectURL(file);
    setObjectUrl(nextObjectUrl);
    setDimensions(null);
    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [file]);

  if (file === null || objectUrl === null) {
    return (
      <div className="character-visual-file-placeholder" role="status">
        <span>{label}を選択してください</span>
        <small>
          登録前に対象visualの基準サイズ（{expectedCanvas}）を確認できます。
        </small>
      </div>
    );
  }

  return (
    <div className="character-visual-local-preview">
      <img
        alt={`${label}の登録前プレビュー`}
        src={objectUrl}
        onLoad={(event) => {
          const image = event.currentTarget;
          setDimensions(`${image.naturalWidth} × ${image.naturalHeight} px`);
        }}
      />
      <div>
        <strong>{label}</strong>
        <small>{dimensions ?? "画像サイズを確認しています…"}</small>
        <small>ファイル: 選択済み</small>
      </div>
    </div>
  );
}

function FileSlotInput({
  file,
  inputId,
  label,
  expectedCanvas,
  onChange
}: {
  readonly file: File | null;
  readonly inputId: string;
  readonly label: string;
  readonly expectedCanvas: string;
  readonly onChange: (file: File | null) => void;
}) {
  return (
    <div className="character-visual-file-slot">
      <label htmlFor={inputId}>{label} PNG</label>
      <input
        accept="image/png"
        id={inputId}
        type="file"
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          onChange(event.target.files?.[0] ?? null);
        }}
      />
      <LocalFilePreview
        expectedCanvas={expectedCanvas}
        file={file}
        label={label}
      />
    </div>
  );
}

function VariantEditor({
  visual,
  existingVariant,
  onSaved
}: {
  readonly visual: CharacterVisualSet;
  readonly existingVariant?: CharacterVariant;
  readonly onSaved: () => void;
}) {
  const [label, setLabel] = useState(existingVariant?.label ?? "");
  const [renderType, setRenderType] = useState<CharacterVariantRenderType>(
    existingVariant?.renderType ?? "single-image"
  );
  const [tags, setTags] = useState(existingVariant?.tags.join(", ") ?? "");
  const [files, setFiles] = useState<
    Partial<Record<VariantFileKey, File | null>>
  >({});
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const [isPreparingUpload, setIsPreparingUpload] = useState(false);
  const mutation = useMutation({
    mutationFn: async ({
      input,
      uploadFiles
    }: {
      readonly input: {
        readonly label: string;
        readonly renderType: CharacterVariantRenderType;
        readonly tags: string[];
      };
      readonly uploadFiles: CharacterVisualVariantUploadFiles;
    }) =>
      existingVariant === undefined
        ? createCharacterVisualVariant(visual.visualId, input, uploadFiles)
        : updateCharacterVisualVariant(
            visual.visualId,
            existingVariant.variantId,
            input,
            uploadFiles
          )
  });

  const activeSlots =
    renderType === "single-image"
      ? fileSlots.filter((slot) => slot.key === "single")
      : fileSlots.filter(
          (slot) => slot.key === "closed" || slot.key === "open"
        );
  const existingFiles = new Map(
    existingVariant?.files.map((file) => [file.key, file]) ?? []
  );

  async function existingFileBlob(key: VariantFileKey): Promise<Blob | null> {
    if (
      existingVariant === undefined ||
      existingVariant.renderType !== renderType
    ) {
      return null;
    }
    const existingFile = existingFiles.get(key);
    return existingFile === undefined
      ? null
      : fetchCharacterVisualFile(
          visual.visualId,
          existingVariant.variantId,
          existingFile.key
        );
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>
  ): Promise<void> {
    event.preventDefault();
    if (isPreparingUpload || mutation.isPending) {
      return;
    }
    const normalizedLabel = label.trim();
    if (normalizedLabel.length === 0) {
      setValidationMessage("variant名を入力してください。");
      return;
    }

    const uploadFiles: CharacterVisualVariantUploadFiles = {};
    setIsPreparingUpload(true);
    try {
      for (const slot of activeSlots) {
        const selectedFile = files[slot.key];
        if (selectedFile !== null && selectedFile !== undefined) {
          uploadFiles[slot.key] = selectedFile;
          continue;
        }
        const existingFile = await existingFileBlob(slot.key);
        if (existingFile === null) {
          setValidationMessage(`${slot.label} PNGを選択してください。`);
          return;
        }
        uploadFiles[slot.key] = existingFile;
      }
    } catch (error) {
      setValidationMessage(friendlyErrorMessage(error, visual));
      return;
    } finally {
      setIsPreparingUpload(false);
    }

    setValidationMessage(null);
    mutation.mutate(
      {
        input: {
          label: normalizedLabel,
          renderType,
          tags: tagsFromText(tags)
        },
        uploadFiles
      },
      {
        onSuccess: onSaved
      }
    );
  }

  return (
    <form
      className="character-visual-variant-form"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="character-visual-form-grid">
        <div className="form-field">
          <label
            htmlFor={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-label`}
          >
            variant名
          </label>
          <input
            disabled={mutation.isPending}
            id={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-label`}
            type="text"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label
            htmlFor={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-render-type`}
          >
            renderType
          </label>
          <select
            disabled={mutation.isPending}
            id={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-render-type`}
            value={renderType}
            onChange={(event) => {
              setRenderType(event.target.value as CharacterVariantRenderType);
              setFiles({});
            }}
          >
            <option value="single-image">single-image</option>
            <option value="mouth-pair">mouth-pair</option>
          </select>
        </div>
      </div>
      <div className="form-field">
        <label
          htmlFor={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-tags`}
        >
          tags（カンマ区切り・任意）
        </label>
        <input
          disabled={mutation.isPending}
          id={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-tags`}
          type="text"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
        />
      </div>

      <p className="character-visual-form-note">
        {existingVariant === undefined
          ? "登録済みvariantが0件でもvisual本体は正常です。必要な素材から追加できます。"
          : "ファイルを選び直さない場合も、現在の画像を確認してから安全に再登録します。"}
      </p>
      <div
        className={`character-visual-file-grid character-visual-file-grid-${renderType}`}
      >
        {activeSlots.map((slot) => (
          <FileSlotInput
            expectedCanvas={formatCanvas(visual)}
            file={files[slot.key] ?? null}
            inputId={`${domId(visual.visualId)}-${existingVariant?.variantId ?? "new"}-${slot.key}`}
            key={slot.key}
            label={slot.label}
            onChange={(file) => {
              setFiles((current) => ({ ...current, [slot.key]: file }));
            }}
          />
        ))}
      </div>

      {validationMessage !== null ? (
        <p className="form-error" role="alert">
          {validationMessage}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="form-error" role="alert">
          {friendlyErrorMessage(mutation.error, visual)}
        </p>
      ) : null}
      {mutation.isSuccess ? (
        <p className="form-success" role="status">
          保存しました。
        </p>
      ) : null}
      <button
        className="button button-primary"
        disabled={mutation.isPending || isPreparingUpload}
        type="submit"
      >
        {isPreparingUpload
          ? "画像を準備中…"
          : mutation.isPending
            ? "保存中…"
            : existingVariant === undefined
              ? "variantを登録"
              : "variantを更新"}
      </button>
    </form>
  );
}

function VariantCard({
  visual,
  variant,
  editing,
  onEdit,
  onSaved
}: {
  readonly visual: CharacterVisualSet;
  readonly variant: CharacterVariant;
  readonly editing: boolean;
  readonly onEdit: () => void;
  readonly onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const statusMutation = useMutation({
    mutationFn: () =>
      variant.status === "active"
        ? deactivateCharacterVisualVariant(visual.visualId, variant.variantId)
        : activateCharacterVisualVariant(visual.visualId, variant.variantId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["character-visuals"] });
    }
  });
  const slots =
    variant.renderType === "single-image"
      ? [{ key: "single", label: "画像" }]
      : [
          { key: "closed", label: "closed（口閉じ）" },
          { key: "open", label: "open（口開き）" }
        ];

  return (
    <article
      className={`character-visual-variant-card${variant.status === "inactive" ? " character-visual-variant-card-inactive" : ""}`}
    >
      <header className="character-visual-variant-header">
        <div>
          <h4>{variant.label}</h4>
          <p>
            <code>{variant.renderType}</code>
            <span
              className={`character-visual-status character-visual-status-${variant.status}`}
            >
              {variant.status === "active" ? "利用中" : "利用停止"}
            </span>
          </p>
        </div>
        <div className="character-visual-variant-actions">
          <button className="button" type="button" onClick={onEdit}>
            {editing ? "編集を閉じる" : "編集"}
          </button>
          <button
            className="button"
            disabled={statusMutation.isPending}
            type="button"
            onClick={() => statusMutation.mutate()}
          >
            {statusMutation.isPending
              ? "更新中…"
              : variant.status === "active"
                ? "利用停止"
                : "利用を再開"}
          </button>
        </div>
      </header>
      <p className="character-visual-variant-tags">
        {variant.tags.length > 0
          ? `tags: ${variant.tags.join(", ")}`
          : "tagsなし"}
      </p>
      <div
        className={`character-visual-variant-preview character-visual-variant-preview-${variant.renderType}`}
      >
        {slots.map((slot) => (
          <figure key={slot.key}>
            <ManagedVariantImage
              fileKey={slot.key}
              label={`${variant.label}・${slot.label}`}
              variantId={variant.variantId}
              visualId={visual.visualId}
            />
            <figcaption>{slot.label}</figcaption>
          </figure>
        ))}
      </div>
      {statusMutation.isError ? (
        <p className="form-error" role="alert">
          {friendlyErrorMessage(statusMutation.error, visual)}
        </p>
      ) : null}
      {editing ? (
        <VariantEditor
          existingVariant={variant}
          onSaved={onSaved}
          visual={visual}
        />
      ) : null}
    </article>
  );
}

function VisualListItem({
  visual,
  selected,
  onSelect
}: {
  readonly visual: CharacterVisualSet;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const representative = visual.variants[0]?.files[0];

  return (
    <li>
      <button
        aria-current={selected ? "true" : undefined}
        className={`character-visual-list-item${selected ? " character-visual-list-item-selected" : ""}`}
        type="button"
        onClick={onSelect}
      >
        {representative === undefined || failed ? (
          <span
            className="character-visual-list-placeholder"
            aria-hidden="true"
          >
            {visual.name.slice(0, 1)}
          </span>
        ) : (
          <img
            alt=""
            className="character-visual-list-image"
            src={characterVisualFileUrl(
              visual.visualId,
              visual.variants[0]!.variantId,
              representative.key
            )}
            onError={() => setFailed(true)}
          />
        )}
        <span className="character-visual-list-copy">
          <strong>{visual.name}</strong>
          <small>
            {visual.variants.length} variant / {formatCanvas(visual)}
          </small>
        </span>
      </button>
    </li>
  );
}

export function CharacterVisualsPage() {
  const queryClient = useQueryClient();
  const catalogQuery = useQuery({
    queryKey: ["character-visuals"],
    queryFn: fetchCharacterVisualCatalog,
    retry: false
  });
  const [selectedVisualId, setSelectedVisualId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [showVariantForm, setShowVariantForm] = useState(false);
  const [visualName, setVisualName] = useState("");
  const [visualDescription, setVisualDescription] = useState("");
  const [visualStatus, setVisualStatus] = useState<"active" | "inactive">(
    "active"
  );
  const [visualValidationMessage, setVisualValidationMessage] = useState<
    string | null
  >(null);

  useEffect(() => {
    const catalog = catalogQuery.data;
    if (catalog === undefined) {
      return;
    }
    setSelectedVisualId((current) =>
      current !== null && catalog.some((visual) => visual.visualId === current)
        ? current
        : (catalog[0]?.visualId ?? null)
    );
  }, [catalogQuery.data]);

  const selectedVisual = catalogQuery.data?.find(
    (visual) => visual.visualId === selectedVisualId
  );

  useEffect(() => {
    if (selectedVisual === undefined) {
      return;
    }
    setVisualName(selectedVisual.name);
    setVisualDescription(selectedVisual.description);
    setVisualStatus(selectedVisual.status);
    setEditingVariantId(null);
    setShowVariantForm(false);
    setVisualValidationMessage(null);
  }, [selectedVisual]);

  const createMutation = useMutation({
    mutationFn: createCharacterVisual,
    onSuccess: async (visual) => {
      setIsCreating(false);
      setSelectedVisualId(visual.visualId);
      setVisualName(visual.name);
      setVisualDescription(visual.description);
      setVisualStatus(visual.status);
      await queryClient.invalidateQueries({ queryKey: ["character-visuals"] });
    }
  });
  const updateMutation = useMutation({
    mutationFn: ({
      visualId,
      name,
      description,
      status
    }: {
      readonly visualId: string;
      readonly name: string;
      readonly description: string;
      readonly status: "active" | "inactive";
    }) => updateCharacterVisual(visualId, { name, description, status }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["character-visuals"] });
    }
  });

  function submitNewVisual(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (visualName.trim().length === 0) {
      setVisualValidationMessage("visual名を入力してください。");
      return;
    }
    setVisualValidationMessage(null);
    createMutation.mutate({
      name: visualName,
      description: visualDescription,
      status: visualStatus
    });
  }

  function submitVisualMetadata(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (selectedVisual === undefined || visualName.trim().length === 0) {
      setVisualValidationMessage("visual名を入力してください。");
      return;
    }
    setVisualValidationMessage(null);
    updateMutation.mutate({
      visualId: selectedVisual.visualId,
      name: visualName,
      description: visualDescription,
      status: visualStatus
    });
  }

  if (catalogQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          キャラクタービジュアルを読み込んでいます…
        </p>
      </main>
    );
  }

  if (catalogQuery.isError || catalogQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <section className="message-panel message-panel-error" role="alert">
          <h1>キャラクタービジュアルを取得できません</h1>
          <p>{friendlyErrorMessage(catalogQuery.error)}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void catalogQuery.refetch();
            }}
          >
            再読み込み
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell character-visuals-page">
      <header className="page-header page-header-stacked">
        <p className="eyebrow">ワークスペース共通ライブラリ</p>
        <h1>キャラクタービジュアル</h1>
        <p>
          visual本体を先に登録し、必要なsingle-image / mouth-pair
          variantを後から追加できます。未登録の表情やポーズは不足エラーとして推測しません。
        </p>
      </header>

      <div className="character-visuals-actions">
        <button
          className="button button-primary"
          type="button"
          onClick={() => {
            setIsCreating((current) => !current);
            setVisualName("");
            setVisualDescription("");
            setVisualStatus("active");
            setVisualValidationMessage(null);
          }}
        >
          {isCreating ? "新規登録を閉じる" : "+ 新規ビジュアル"}
        </button>
      </div>

      {isCreating ? (
        <form
          className="character-visual-create-panel"
          noValidate
          onSubmit={submitNewVisual}
        >
          <div>
            <p className="eyebrow">新規登録</p>
            <h2>visual本体を登録</h2>
            <p>
              PNGは後から追加できます。登録直後のvariant 0件も正常な状態です。
            </p>
          </div>
          <div className="character-visual-form-grid">
            <div className="form-field">
              <label htmlFor="new-character-visual-name">名前</label>
              <input
                autoComplete="off"
                disabled={createMutation.isPending}
                id="new-character-visual-name"
                required
                type="text"
                value={visualName}
                onChange={(event) => setVisualName(event.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-character-visual-status">状態</label>
              <select
                disabled={createMutation.isPending}
                id="new-character-visual-status"
                value={visualStatus}
                onChange={(event) =>
                  setVisualStatus(event.target.value as "active" | "inactive")
                }
              >
                <option value="active">active</option>
                <option value="inactive">inactive</option>
              </select>
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="new-character-visual-description">
              説明（任意）
            </label>
            <textarea
              disabled={createMutation.isPending}
              id="new-character-visual-description"
              rows={3}
              value={visualDescription}
              onChange={(event) => setVisualDescription(event.target.value)}
            />
          </div>
          {visualValidationMessage !== null ? (
            <p className="form-error" role="alert">
              {visualValidationMessage}
            </p>
          ) : null}
          {createMutation.isError ? (
            <p className="form-error" role="alert">
              {friendlyErrorMessage(createMutation.error)}
            </p>
          ) : null}
          <button
            className="button button-primary"
            disabled={createMutation.isPending}
            type="submit"
          >
            {createMutation.isPending ? "登録中…" : "visualを登録"}
          </button>
        </form>
      ) : null}

      {catalogQuery.data.length === 0 ? (
        <section
          className="message-panel"
          aria-labelledby="character-visuals-empty-title"
        >
          <h2 id="character-visuals-empty-title">登録済みvisualはありません</h2>
          <p>
            名前だけでvisual本体を登録し、必要なvariantを順番に追加できます。
          </p>
        </section>
      ) : (
        <div className="character-visual-manager">
          <aside
            className="character-visual-list-panel"
            aria-label="登録済みキャラクタービジュアル"
          >
            <div className="character-visual-list-header">
              <h2>登録済みvisual</h2>
              <span>{catalogQuery.data.length} 件</span>
            </div>
            <ul className="character-visual-list">
              {catalogQuery.data.map((visual) => (
                <VisualListItem
                  key={visual.visualId}
                  selected={visual.visualId === selectedVisualId}
                  visual={visual}
                  onSelect={() => setSelectedVisualId(visual.visualId)}
                />
              ))}
            </ul>
          </aside>

          {selectedVisual === undefined ? (
            <section className="message-panel">
              <h2>visualを選択してください</h2>
            </section>
          ) : (
            <section
              className="character-visual-detail-panel"
              aria-labelledby="selected-character-visual-title"
            >
              <form
                className="character-visual-detail-header"
                noValidate
                onSubmit={submitVisualMetadata}
              >
                <div>
                  <p className="eyebrow">選択中のvisual</p>
                  <h2 id="selected-character-visual-title">
                    {selectedVisual.name}
                  </h2>
                </div>
                <div className="character-visual-detail-status">
                  <span
                    className={`character-visual-status character-visual-status-${selectedVisual.status}`}
                  >
                    {selectedVisual.status === "active" ? "active" : "inactive"}
                  </span>
                  <span>基準サイズ: {formatCanvas(selectedVisual)}</span>
                </div>
                <div className="character-visual-form-grid">
                  <div className="form-field">
                    <label htmlFor="selected-character-visual-name">名前</label>
                    <input
                      disabled={updateMutation.isPending}
                      id="selected-character-visual-name"
                      type="text"
                      value={visualName}
                      onChange={(event) => setVisualName(event.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="selected-character-visual-status">
                      状態
                    </label>
                    <select
                      disabled={updateMutation.isPending}
                      id="selected-character-visual-status"
                      value={visualStatus}
                      onChange={(event) =>
                        setVisualStatus(
                          event.target.value as "active" | "inactive"
                        )
                      }
                    >
                      <option value="active">active</option>
                      <option value="inactive">inactive</option>
                    </select>
                  </div>
                </div>
                <div className="form-field">
                  <label htmlFor="selected-character-visual-description">
                    説明
                  </label>
                  <textarea
                    disabled={updateMutation.isPending}
                    id="selected-character-visual-description"
                    rows={3}
                    value={visualDescription}
                    onChange={(event) =>
                      setVisualDescription(event.target.value)
                    }
                  />
                </div>
                {visualValidationMessage !== null ? (
                  <p className="form-error" role="alert">
                    {visualValidationMessage}
                  </p>
                ) : null}
                {updateMutation.isError ? (
                  <p className="form-error" role="alert">
                    {friendlyErrorMessage(updateMutation.error, selectedVisual)}
                  </p>
                ) : null}
                {updateMutation.isSuccess ? (
                  <p className="form-success" role="status">
                    保存しました。
                  </p>
                ) : null}
                <button
                  className="button"
                  disabled={updateMutation.isPending}
                  type="submit"
                >
                  {updateMutation.isPending ? "保存中…" : "visual情報を保存"}
                </button>
              </form>

              <section
                className="character-visual-variants"
                aria-labelledby="character-visual-variants-title"
              >
                <header className="character-visual-section-header">
                  <div>
                    <h3 id="character-visual-variants-title">Variant</h3>
                    <p>
                      登録済みのvariantだけを表示しています。論理表情の不足判定は行いません。
                    </p>
                  </div>
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      setShowVariantForm((current) => !current);
                      setEditingVariantId(null);
                    }}
                  >
                    {showVariantForm
                      ? "追加フォームを閉じる"
                      : "+ variantを追加"}
                  </button>
                </header>

                {showVariantForm ? (
                  <VariantEditor
                    key={`${selectedVisual.visualId}-new`}
                    onSaved={async () => {
                      await queryClient.invalidateQueries({
                        queryKey: ["character-visuals"]
                      });
                      setShowVariantForm(false);
                    }}
                    visual={selectedVisual}
                  />
                ) : null}

                {selectedVisual.variants.length === 0 ? (
                  <div className="character-visual-empty-variants">
                    <strong>まだvariantが登録されていません。</strong>
                    <span>必要な素材から順番に追加できます。</span>
                  </div>
                ) : (
                  <div className="character-visual-variant-list">
                    {selectedVisual.variants.map((variant) => (
                      <VariantCard
                        editing={editingVariantId === variant.variantId}
                        key={variant.variantId}
                        onEdit={() => {
                          setEditingVariantId((current) =>
                            current === variant.variantId
                              ? null
                              : variant.variantId
                          );
                          setShowVariantForm(false);
                        }}
                        onSaved={async () => {
                          await queryClient.invalidateQueries({
                            queryKey: ["character-visuals"]
                          });
                          setEditingVariantId(null);
                        }}
                        variant={variant}
                        visual={selectedVisual}
                      />
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
