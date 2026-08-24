import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState
} from "react";
import { Link } from "react-router";

import type {
  AssetDetail,
  AssetKind,
  AssetListItem,
  AssetListResult,
  AssetListStatus,
  AssetTagDictionaryEntryResponse
} from "../schema/asset.js";
import type {
  AssetMetadataUpdateRequest,
  AssetUploadFields
} from "../schema/api.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  activateAsset,
  createAsset,
  deactivateAsset,
  fetchAsset,
  fetchAssetTags,
  replaceAsset,
  searchAssets,
  updateAssetMetadata,
  type AssetUploadBlob
} from "./lib/api-client";

type AssetFilterKind = AssetKind | "";

type AssetFilters = {
  readonly q: string;
  readonly kind: AssetFilterKind;
  readonly status: AssetListStatus;
  readonly department: string;
  readonly system: string;
  readonly tagIds: string[];
  readonly page: number;
};

type AssetKindConfig = {
  readonly label: string;
  readonly accept: string;
  readonly formats: string;
  readonly hint: string;
};

const PAGE_SIZE = 24;
const PROCESSING_POLL_INTERVAL_MS = 2000;

const ASSET_KIND_CONFIG: Record<AssetKind, AssetKindConfig> = {
  video: {
    label: "動画",
    accept: "video/mp4,.mp4",
    formats: "MP4",
    hint: "MP4形式の動画を登録します。ファイル内容とMIME typeはサーバーで検証されます。"
  },
  bgm: {
    label: "BGM",
    accept: "audio/mpeg,.mp3",
    formats: "MP3",
    hint: "MP3形式のBGMを登録します。"
  },
  photo: {
    label: "写真",
    accept: "image/png,image/jpeg,.png,.jpg,.jpeg",
    formats: "PNG / JPEG",
    hint: "現在はPNGまたはJPEG形式の画像を登録できます。"
  },
  document_scan: {
    label: "帳票スキャン",
    accept: "application/pdf,.pdf",
    formats: "PDF",
    hint: "帳票スキャンはPDF形式で登録します。"
  },
  sound_effect: {
    label: "効果音",
    accept: "audio/wav,audio/x-wav,.wav",
    formats: "WAV",
    hint: "WAV形式の効果音を登録します。confirm / attention / warning のいずれかの利用タグが必要です。"
  }
};

const ASSET_KINDS = Object.keys(ASSET_KIND_CONFIG) as AssetKind[];
const ASSET_STATUSES: readonly AssetListStatus[] = [
  "all",
  "active",
  "inactive",
  "processing",
  "error"
];

const INITIAL_FILTERS: AssetFilters = {
  q: "",
  kind: "",
  status: "all",
  department: "",
  system: "",
  tagIds: [],
  page: 1
};

const SOUND_EFFECT_USAGE_TAGS = new Set(["confirm", "attention", "warning"]);

function assetKindLabel(kind: AssetKind): string {
  return ASSET_KIND_CONFIG[kind].label;
}

function assetStatusLabel(status: AssetListStatus): string {
  switch (status) {
    case "all":
      return "すべて";
    case "active":
      return "利用中";
    case "inactive":
      return "利用停止";
    case "processing":
      return "処理中";
    case "error":
      return "エラー";
  }
}

function assetVersionLabel(
  asset: Pick<AssetListItem, "currentVersion" | "version">
): string {
  const version = asset.currentVersion ?? asset.version;
  return version === null || version === undefined ? "未確定" : `v${version}`;
}

function assetThumbnailUrl(
  asset: Pick<
    AssetListItem,
    "assetId" | "currentVersion" | "version" | "thumbnailPaths"
  >
): string | null {
  if (asset.thumbnailPaths.length === 0) {
    return null;
  }
  const version = asset.currentVersion ?? asset.version;
  if (version === null || version === undefined) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(asset.assetId)}/thumbnails/0?version=${version}`;
}

function assetMediaUrl(
  asset: Pick<AssetDetail, "assetId" | "currentVersion" | "version">
): string | null {
  const version = asset.currentVersion ?? asset.version;
  if (version === null || version === undefined) {
    return null;
  }
  return `/api/assets/${encodeURIComponent(asset.assetId)}/media?version=${version}`;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "サイズ未取得";
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let amount = value;
  let unitIndex = -1;
  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDuration(durationMs: number | null | undefined): string {
  if (durationMs === null || durationMs === undefined) {
    return "長さ未取得";
  }
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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

function technicalSummary(
  asset: Pick<
    AssetListItem,
    "mimeType" | "sizeBytes" | "width" | "height" | "durationMs" | "pageCount"
  >
): string {
  const values = [asset.mimeType ?? "MIME未取得", formatBytes(asset.sizeBytes)];
  if (asset.width !== null && asset.height !== null) {
    values.push(`${asset.width} × ${asset.height} px`);
  }
  if (asset.durationMs !== null) {
    values.push(formatDuration(asset.durationMs));
  }
  if (asset.pageCount !== null) {
    values.push(`${asset.pageCount}ページ`);
  }
  return values.join(" ・ ");
}

function checksumLabel(checksum: string | null): string {
  return checksum === null
    ? "未取得"
    : `${checksum.slice(0, 12)}…${checksum.slice(-8)}`;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case "ASSET_FORMAT_MISMATCH":
      case "ASSET_UNSUPPORTED_FORMAT":
        return `${error.message} 選択した種類に対応する形式を確認してください。`;
      case "ASSET_FILE_TOO_LARGE":
        return "アップロードファイルが大きすぎます。サイズ上限はAPIの検証結果を確認してください。";
      case "ASSET_TAG_NOT_FOUND":
        return "選択したタグが利用できません。タグ一覧を更新して再試行してください。";
      case "ASSET_REVISION_CONFLICT":
        return "別の画面で素材が更新されました。最新の内容を再取得しました。入力を確認して保存し直してください。";
      case "ASSET_VERSION_NOT_READY":
        return "利用可能なcurrent versionがありません。処理完了後に再試行してください。";
      default:
        return `${error.message}（エラーコード: ${error.code}）`;
    }
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

function isSoundEffectTag(tag: AssetTagDictionaryEntryResponse): boolean {
  return (
    SOUND_EFFECT_USAGE_TAGS.has(tag.canonicalName) ||
    SOUND_EFFECT_USAGE_TAGS.has(tag.tagId)
  );
}

function hasRequiredSoundEffectTag(
  kind: AssetKind,
  selectedTagIds: readonly string[],
  tags: readonly AssetTagDictionaryEntryResponse[]
): boolean {
  return (
    kind !== "sound_effect" ||
    tags.some(
      (tag) => selectedTagIds.includes(tag.tagId) && isSoundEffectTag(tag)
    )
  );
}

function invalidateAssetQueries(
  queryClient: ReturnType<typeof useQueryClient>
): Promise<unknown> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["assets"] }),
    queryClient.invalidateQueries({
      queryKey: ["screen-template-preview-assets"]
    })
  ]);
}

function Modal({
  open,
  title,
  labelledBy,
  onClose,
  children,
  className = ""
}: {
  readonly open: boolean;
  readonly title: string;
  readonly labelledBy: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || dialog === null) {
      return undefined;
    }

    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    if (!dialog.open) {
      try {
        dialog.showModal();
      } catch {
        dialog.setAttribute("open", "");
      }
    }
    const firstFocusable = dialog.querySelector<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])"
    );
    firstFocusable?.focus();

    return () => {
      if (dialog.open) {
        dialog.close();
      }
      previousFocus?.focus();
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      aria-labelledby={labelledBy}
      className={`asset-dialog ${className}`.trim()}
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="asset-dialog-header">
        <h2 id={labelledBy}>{title}</h2>
        <button
          aria-label="ダイアログを閉じる"
          className="button button-quiet"
          type="button"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
      {children}
    </dialog>
  );
}

function TagPicker({
  idPrefix,
  tags,
  selectedTagIds,
  disabled,
  onChange
}: {
  readonly idPrefix: string;
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly selectedTagIds: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (tagIds: string[]) => void;
}) {
  if (tags.length === 0) {
    return <p className="asset-form-note">利用可能なタグはありません。</p>;
  }

  return (
    <div className="asset-tag-picker" role="group" aria-label="素材タグ">
      {tags.map((tag) => {
        const checked = selectedTagIds.includes(tag.tagId);
        return (
          <label className="asset-tag-option" key={tag.tagId}>
            <input
              checked={checked}
              disabled={disabled}
              id={`${idPrefix}-${tag.tagId}`}
              type="checkbox"
              onChange={() => {
                onChange(
                  checked
                    ? selectedTagIds.filter((tagId) => tagId !== tag.tagId)
                    : [...selectedTagIds, tag.tagId]
                );
              }}
            />
            <span>
              <strong>{tag.canonicalName}</strong>
              <small>{tag.axis}</small>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function AssetFiltersPanel({
  filters,
  tags,
  tagsError,
  onChange,
  onReset
}: {
  readonly filters: AssetFilters;
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly tagsError: string | null;
  readonly onChange: (patch: Partial<AssetFilters>) => void;
  readonly onReset: () => void;
}) {
  return (
    <form
      aria-label="素材を検索・絞り込み"
      className="asset-filter-panel"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="asset-filter-grid">
        <div className="form-field asset-filter-search">
          <label htmlFor="asset-search">検索</label>
          <input
            id="asset-search"
            placeholder="タイトル・説明・タグを検索"
            type="search"
            value={filters.q}
            onChange={(event) => onChange({ q: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="asset-filter-kind">kind</label>
          <select
            id="asset-filter-kind"
            value={filters.kind}
            onChange={(event) =>
              onChange({ kind: event.target.value as AssetFilterKind })
            }
          >
            <option value="">すべての種類</option>
            {ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {assetKindLabel(kind)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="asset-filter-status">status</label>
          <select
            id="asset-filter-status"
            value={filters.status}
            onChange={(event) =>
              onChange({ status: event.target.value as AssetListStatus })
            }
          >
            {ASSET_STATUSES.map((status) => (
              <option key={status} value={status}>
                {assetStatusLabel(status)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="asset-filter-department">department</label>
          <input
            id="asset-filter-department"
            value={filters.department}
            onChange={(event) => onChange({ department: event.target.value })}
          />
        </div>
        <div className="form-field">
          <label htmlFor="asset-filter-system">system</label>
          <input
            id="asset-filter-system"
            value={filters.system}
            onChange={(event) => onChange({ system: event.target.value })}
          />
        </div>
      </div>

      <details className="asset-filter-tags">
        <summary>
          タグで絞り込む
          {filters.tagIds.length > 0
            ? `（${filters.tagIds.length}件選択）`
            : ""}
        </summary>
        {tagsError !== null ? (
          <p className="form-error" role="alert">
            {tagsError}
          </p>
        ) : (
          <TagPicker
            disabled={false}
            idPrefix="asset-filter-tag"
            selectedTagIds={filters.tagIds}
            tags={tags}
            onChange={(tagIds) => onChange({ tagIds })}
          />
        )}
      </details>
      <div className="asset-filter-actions">
        <button className="button button-quiet" type="button" onClick={onReset}>
          条件をクリア
        </button>
      </div>
    </form>
  );
}

function AssetStatusBadge({ status }: { readonly status: AssetListStatus }) {
  return (
    <span className={`asset-status-badge asset-status-${status}`}>
      <span aria-hidden="true" className="asset-status-dot" />
      {assetStatusLabel(status)}
    </span>
  );
}

function AssetListCard({
  asset,
  onOpen
}: {
  readonly asset: AssetListItem;
  readonly onOpen: () => void;
}) {
  const thumbnailUrl = assetThumbnailUrl(asset);
  return (
    <li className="asset-management-card">
      <button
        aria-label={`${asset.title}の詳細を開く`}
        className="asset-card-preview"
        type="button"
        onClick={onOpen}
      >
        {thumbnailUrl === null ? (
          <span aria-hidden="true" className="asset-card-placeholder">
            {asset.status === "processing"
              ? "処理中"
              : assetKindLabel(asset.kind)}
          </span>
        ) : (
          <img alt="" src={thumbnailUrl} />
        )}
      </button>
      <div className="asset-card-content">
        <div className="asset-card-heading">
          <div>
            <p className="asset-card-kind">{assetKindLabel(asset.kind)}</p>
            <h3>{asset.title}</h3>
          </div>
          <AssetStatusBadge status={asset.status} />
        </div>
        <p className="asset-card-description">
          {asset.description || "説明なし"}
        </p>
        <p className="asset-card-technical">
          {technicalSummary(asset)} ・ 現在 {assetVersionLabel(asset)}
        </p>
        <div className="asset-card-footer">
          <div className="asset-card-tags">
            {asset.tags.length === 0 ? (
              <span className="asset-card-no-tags">タグなし</span>
            ) : (
              asset.tags.map((tag) => (
                <span className="asset-tag-chip" key={tag.tagId}>
                  {tag.canonicalName}
                </span>
              ))
            )}
          </div>
          <button className="button" type="button" onClick={onOpen}>
            編集
          </button>
        </div>
        {asset.errorMessage !== null ? (
          <p className="asset-card-error" role="status">
            {asset.errorCode === null ? "" : `${asset.errorCode}: `}
            {asset.errorMessage}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function AssetPagination({
  result,
  onPageChange
}: {
  readonly result: AssetListResult;
  readonly onPageChange: (page: number) => void;
}) {
  if (result.total === 0) {
    return null;
  }
  return (
    <nav aria-label="素材一覧のページ" className="asset-pagination">
      <button
        className="button"
        disabled={result.page <= 1}
        type="button"
        onClick={() => onPageChange(result.page - 1)}
      >
        前のページ
      </button>
      <span>
        {result.page} ページ ・ {result.total} 件
      </span>
      <button
        className="button"
        disabled={!result.hasNextPage}
        type="button"
        onClick={() => onPageChange(result.page + 1)}
      >
        次のページ
      </button>
    </nav>
  );
}

function AssetMetadataFields({
  idPrefix,
  title,
  description,
  confidentiality,
  department,
  system,
  tagIds,
  tags,
  disabled,
  onTitleChange,
  onDescriptionChange,
  onConfidentialityChange,
  onDepartmentChange,
  onSystemChange,
  onTagIdsChange
}: {
  readonly idPrefix: string;
  readonly title: string;
  readonly description: string;
  readonly confidentiality: string;
  readonly department: string;
  readonly system: string;
  readonly tagIds: readonly string[];
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly disabled: boolean;
  readonly onTitleChange: (value: string) => void;
  readonly onDescriptionChange: (value: string) => void;
  readonly onConfidentialityChange: (value: string) => void;
  readonly onDepartmentChange: (value: string) => void;
  readonly onSystemChange: (value: string) => void;
  readonly onTagIdsChange: (value: string[]) => void;
}) {
  return (
    <>
      <div className="asset-metadata-grid">
        <div className="form-field">
          <label htmlFor={`${idPrefix}-title`}>タイトル</label>
          <input
            disabled={disabled}
            id={`${idPrefix}-title`}
            required
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-confidentiality`}>機密区分</label>
          <input
            disabled={disabled}
            id={`${idPrefix}-confidentiality`}
            required
            value={confidentiality}
            onChange={(event) => onConfidentialityChange(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-department`}>department</label>
          <input
            disabled={disabled}
            id={`${idPrefix}-department`}
            value={department}
            onChange={(event) => onDepartmentChange(event.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={`${idPrefix}-system`}>system</label>
          <input
            disabled={disabled}
            id={`${idPrefix}-system`}
            value={system}
            onChange={(event) => onSystemChange(event.target.value)}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`${idPrefix}-description`}>説明</label>
        <textarea
          disabled={disabled}
          id={`${idPrefix}-description`}
          rows={4}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
      </div>
      <div className="form-field">
        <span className="form-label">タグ</span>
        <TagPicker
          disabled={disabled}
          idPrefix={`${idPrefix}-tag`}
          selectedTagIds={tagIds}
          tags={tags}
          onChange={onTagIdsChange}
        />
      </div>
    </>
  );
}

export function AssetCreateDialog({
  open,
  tags,
  tagsError,
  onClose,
  onSubmitted
}: {
  readonly open: boolean;
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly tagsError: string | null;
  readonly onClose: () => void;
  readonly onSubmitted: (assetId: string) => void;
}) {
  const [kind, setKind] = useState<AssetKind>("video");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [confidentiality, setConfidentiality] = useState("internal");
  const [department, setDepartment] = useState("");
  const [system, setSystem] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null
  );
  const mutation = useMutation({
    mutationFn: ({
      input,
      uploadFile
    }: {
      readonly input: AssetUploadFields;
      readonly uploadFile: AssetUploadBlob;
    }) => createAsset(input, uploadFile),
    onSuccess: (receipt) => {
      onSubmitted(receipt.assetId);
    }
  });

  const errorMessage =
    validationMessage ??
    (mutation.isError
      ? apiErrorMessage(mutation.error, "素材を登録できませんでした。")
      : null);
  const busy = mutation.isPending;
  const missingSoundEffectTag = !hasRequiredSoundEffectTag(kind, tagIds, tags);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (busy) {
      return;
    }
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0) {
      setValidationMessage("タイトルを入力してください。");
      return;
    }
    if (file === null) {
      setValidationMessage("ファイルを選択してください。");
      return;
    }
    if (missingSoundEffectTag) {
      setValidationMessage(
        "効果音には confirm / attention / warning のいずれかの利用タグが必要です。"
      );
      return;
    }
    setValidationMessage(null);
    mutation.mutate({
      input: {
        kind,
        title: normalizedTitle,
        description: description.trim(),
        confidentiality: confidentiality.trim() || "internal",
        department: department.trim() || undefined,
        system: system.trim() || undefined,
        tagIds
      },
      uploadFile: file
    });
  }

  return (
    <Modal
      labelledBy="asset-create-dialog-title"
      open={open}
      title="素材を追加"
      onClose={onClose}
    >
      <form className="asset-dialog-form" noValidate onSubmit={handleSubmit}>
        <div className="asset-dialog-intro">
          <p>素材はアップロード後にバックグラウンドで処理されます。</p>
          <p>OSのパスを入力する代わりに、ファイルを選択してください。</p>
        </div>
        <div className="asset-metadata-grid">
          <div className="form-field">
            <label htmlFor="asset-create-kind">種類</label>
            <select
              disabled={busy}
              id="asset-create-kind"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as AssetKind);
                setFile(null);
                setValidationMessage(null);
              }}
            >
              {ASSET_KINDS.map((option) => (
                <option key={option} value={option}>
                  {assetKindLabel(option)}（{option}）
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="asset-create-file">ファイル</label>
            <input
              accept={ASSET_KIND_CONFIG[kind].accept}
              disabled={busy}
              id="asset-create-file"
              required
              type="file"
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                setFile(event.target.files?.[0] ?? null);
                setValidationMessage(null);
              }}
            />
            <small>
              {ASSET_KIND_CONFIG[kind].formats}・{file?.name ?? "未選択"}
            </small>
          </div>
        </div>
        <p className="asset-kind-hint" role="note">
          {ASSET_KIND_CONFIG[kind].hint}
        </p>
        {kind === "sound_effect" && missingSoundEffectTag ? (
          <p className="asset-form-warning" role="status">
            送信前に confirm / attention / warning
            のいずれかのタグを選択してください。
          </p>
        ) : null}
        <AssetMetadataFields
          confidentiality={confidentiality}
          department={department}
          description={description}
          disabled={busy}
          idPrefix="asset-create"
          system={system}
          tagIds={tagIds}
          tags={tags}
          title={title}
          onConfidentialityChange={setConfidentiality}
          onDepartmentChange={setDepartment}
          onDescriptionChange={setDescription}
          onSystemChange={setSystem}
          onTagIdsChange={setTagIds}
          onTitleChange={setTitle}
        />
        {tagsError !== null ? (
          <p className="form-error" role="alert">
            {tagsError}
          </p>
        ) : null}
        {errorMessage !== null ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <div className="asset-dialog-actions">
          <button
            className="button"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="button button-primary"
            disabled={busy}
            type="submit"
          >
            {busy ? "アップロード中…" : "素材を追加"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AssetMetadataEditor({
  detail,
  tags,
  tagsError,
  onCancel,
  onSaved,
  onConflict
}: {
  readonly detail: AssetDetail;
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly tagsError: string | null;
  readonly onCancel: () => void;
  readonly onSaved: () => void;
  readonly onConflict: () => Promise<void>;
}) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description);
  const [confidentiality, setConfidentiality] = useState(
    detail.confidentiality
  );
  const [department, setDepartment] = useState(detail.department ?? "");
  const [system, setSystem] = useState(detail.system ?? "");
  const [tagIds, setTagIds] = useState<string[]>(
    detail.tagIds ?? detail.tags?.map((tag) => tag.tagId) ?? []
  );
  const mutation = useMutation({
    mutationFn: (input: AssetMetadataUpdateRequest) =>
      updateAssetMetadata(detail.assetId, input),
    onSuccess: onSaved
  });

  const errorMessage = mutation.isError
    ? apiErrorMessage(mutation.error, "素材情報を更新できませんでした。")
    : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }
    if (title.trim().length === 0 || confidentiality.trim().length === 0) {
      return;
    }
    mutation.mutate({
      expectedRevision: detail.revision ?? 1,
      title,
      description,
      confidentiality,
      department: department.trim() || null,
      system: system.trim() || null,
      tagIds
    });
  }

  return (
    <form className="asset-dialog-form" noValidate onSubmit={handleSubmit}>
      <p className="asset-form-note">
        revision {detail.revision ?? 1} を確認して保存します。種類・current
        version・技術情報は変更できません。
      </p>
      <AssetMetadataFields
        confidentiality={confidentiality}
        department={department}
        description={description}
        disabled={mutation.isPending}
        idPrefix="asset-edit"
        system={system}
        tagIds={tagIds}
        tags={tags}
        title={title}
        onConfidentialityChange={setConfidentiality}
        onDepartmentChange={setDepartment}
        onDescriptionChange={setDescription}
        onSystemChange={setSystem}
        onTagIdsChange={setTagIds}
        onTitleChange={setTitle}
      />
      {tagsError !== null ? (
        <p className="form-error" role="alert">
          {tagsError}
        </p>
      ) : null}
      {errorMessage !== null ? (
        <p className="form-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {mutation.isError &&
      mutation.error instanceof ApiClientError &&
      mutation.error.code === "ASSET_REVISION_CONFLICT" ? (
        <button
          className="button"
          type="button"
          onClick={() => {
            void onConflict();
          }}
        >
          最新の内容を表示
        </button>
      ) : null}
      <div className="asset-dialog-actions">
        <button
          className="button"
          disabled={mutation.isPending}
          type="button"
          onClick={onCancel}
        >
          編集をやめる
        </button>
        <button
          className="button button-primary"
          disabled={mutation.isPending}
          type="submit"
        >
          {mutation.isPending ? "保存中…" : "変更を保存"}
        </button>
      </div>
    </form>
  );
}

function AssetPreview({ detail }: { readonly detail: AssetDetail }) {
  const mediaUrl = assetMediaUrl(detail);
  const thumbnailUrl = assetThumbnailUrl(detail);
  if (detail.versionStatus !== "ready" || mediaUrl === null) {
    return (
      <div className="asset-preview-placeholder" role="status">
        <strong>
          {detail.status === "processing"
            ? "素材を処理しています"
            : "プレビューを利用できません"}
        </strong>
        <span>
          {detail.errorCode === null ? "" : `${detail.errorCode}: `}
          {detail.errorMessage ??
            "current versionの準備が完了するとプレビューできます。"}
        </span>
      </div>
    );
  }
  if (detail.kind === "video") {
    return <video controls src={mediaUrl} />;
  }
  if (detail.kind === "bgm" || detail.kind === "sound_effect") {
    return <audio controls src={mediaUrl} />;
  }
  return thumbnailUrl === null ? (
    <div className="asset-preview-placeholder" role="status">
      <span>サムネイルはありません。</span>
    </div>
  ) : (
    <img alt={`${detail.title}のプレビュー`} src={thumbnailUrl} />
  );
}

function AssetTechnicalDetails({ detail }: { readonly detail: AssetDetail }) {
  return (
    <dl className="asset-detail-list">
      <div>
        <dt>kind</dt>
        <dd>
          {assetKindLabel(detail.kind)}（{detail.kind}）
        </dd>
      </div>
      <div>
        <dt>status</dt>
        <dd>
          <AssetStatusBadge status={detail.status} />
          {detail.versionStatus !== undefined
            ? ` / version ${detail.versionStatus}`
            : ""}
        </dd>
      </div>
      <div>
        <dt>current version</dt>
        <dd>
          {detail.currentVersion === null
            ? "未設定"
            : `v${detail.currentVersion}`}
        </dd>
      </div>
      <div>
        <dt>revision</dt>
        <dd>{detail.revision ?? "未取得"}</dd>
      </div>
      <div>
        <dt>MIME / size</dt>
        <dd>
          {detail.mimeType} / {formatBytes(detail.sizeBytes)}
        </dd>
      </div>
      <div>
        <dt>dimensions / duration / pages</dt>
        <dd>
          {detail.width !== null && detail.height !== null
            ? `${detail.width} × ${detail.height} px`
            : "寸法未取得"}
          {detail.durationMs !== null
            ? ` / ${formatDuration(detail.durationMs)}`
            : ""}
          {detail.pageCount !== null ? ` / ${detail.pageCount}ページ` : ""}
        </dd>
      </div>
      <div>
        <dt>checksum</dt>
        <dd>
          <code>{checksumLabel(detail.checksum)}</code>
        </dd>
      </div>
      {detail.errorCode !== null || detail.errorMessage !== null ? (
        <div>
          <dt>処理エラー</dt>
          <dd>
            {detail.errorCode === null ? "" : `${detail.errorCode}: `}
            {detail.errorMessage ?? "詳細なし"}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>department / system</dt>
        <dd>
          {detail.department ?? "未設定"} / {detail.system ?? "未設定"}
        </dd>
      </div>
      <div>
        <dt>更新日時</dt>
        <dd>{formatDate(detail.updatedAt)}</dd>
      </div>
    </dl>
  );
}

function ConfirmationDialog({
  open,
  assetTitle,
  busy,
  onClose,
  onConfirm
}: {
  readonly open: boolean;
  readonly assetTitle: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <Modal
      className="asset-confirm-dialog"
      labelledBy="asset-deactivate-dialog-title"
      open={open}
      title="素材の利用停止"
      onClose={onClose}
    >
      <div className="asset-confirm-content">
        <p>
          「<strong>{assetTitle}</strong>」を利用停止しますか？
        </p>
        <ul>
          <li>新しい素材 picker / search には表示されなくなります。</li>
          <li>DB・media・version history は削除されません。</li>
          <li>既存 project snapshot には影響しません。</li>
          <li>後から再有効化できます。</li>
        </ul>
        <div className="asset-dialog-actions">
          <button
            className="button"
            disabled={busy}
            type="button"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            className="button button-danger"
            disabled={busy}
            type="button"
            onClick={onConfirm}
          >
            {busy ? "更新中…" : "利用停止する"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AssetDetailDialog({
  assetId,
  tags,
  tagsError,
  onClose
}: {
  readonly assetId: string | null;
  readonly tags: readonly AssetTagDictionaryEntryResponse[];
  readonly tagsError: string | null;
  readonly onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [replacementFile, setReplacementFile] = useState<File | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const detailQuery = useQuery({
    queryKey: ["assets", assetId],
    queryFn: () => fetchAsset(assetId ?? ""),
    enabled: assetId !== null,
    retry: false,
    refetchInterval: (query) => {
      const detail = query.state.data;
      return detail?.status === "processing" ||
        detail?.pendingVersion?.status === "processing"
        ? PROCESSING_POLL_INTERVAL_MS
        : false;
    }
  });
  const statusMutation = useMutation({
    mutationFn: ({
      action,
      expectedRevision
    }: {
      readonly action: "activate" | "deactivate";
      readonly expectedRevision: number;
    }) =>
      action === "activate"
        ? activateAsset(assetId ?? "", expectedRevision)
        : deactivateAsset(assetId ?? "", expectedRevision),
    onSuccess: async () => {
      setConfirmDeactivate(false);
      await invalidateAssetQueries(queryClient);
      await detailQuery.refetch();
    }
  });
  const replacementMutation = useMutation({
    mutationFn: ({
      file,
      expectedRevision
    }: {
      readonly file: AssetUploadBlob;
      readonly expectedRevision: number;
    }) => replaceAsset(assetId ?? "", { expectedRevision }, file),
    onSuccess: async () => {
      setReplacementFile(null);
      await invalidateAssetQueries(queryClient);
      await detailQuery.refetch();
    }
  });

  useEffect(() => {
    setEditing(false);
    setReplacementFile(null);
    setConfirmDeactivate(false);
    statusMutation.reset();
    replacementMutation.reset();
  }, [assetId]);

  if (assetId === null) {
    return null;
  }

  const detail = detailQuery.data;
  const mutationError = statusMutation.isError
    ? apiErrorMessage(
        statusMutation.error,
        "素材の状態を変更できませんでした。"
      )
    : replacementMutation.isError
      ? apiErrorMessage(
          replacementMutation.error,
          "ファイルを差し替えできませんでした。"
        )
      : null;
  const busy = statusMutation.isPending || replacementMutation.isPending;

  return (
    <Modal
      className="asset-detail-dialog"
      labelledBy="asset-detail-dialog-title"
      open={assetId !== null}
      title={detail?.title ?? "素材の詳細"}
      onClose={onClose}
    >
      {detailQuery.isPending ? (
        <p className="status-message" role="status">
          素材の詳細を読み込んでいます…
        </p>
      ) : detailQuery.isError || detail === undefined ? (
        <section className="message-panel message-panel-error" role="alert">
          <h3>素材の詳細を取得できません</h3>
          <p>
            {apiErrorMessage(
              detailQuery.error,
              "素材の詳細を取得できませんでした。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void detailQuery.refetch()}
          >
            再読み込み
          </button>
        </section>
      ) : (
        <>
          <div className="asset-detail-layout">
            <section
              className="asset-detail-preview"
              aria-label="素材プレビュー"
            >
              <AssetPreview detail={detail} />
            </section>
            <section className="asset-detail-summary">
              {editing ? (
                <AssetMetadataEditor
                  detail={detail}
                  onCancel={() => setEditing(false)}
                  onConflict={async () => {
                    await detailQuery.refetch();
                  }}
                  onSaved={async () => {
                    setEditing(false);
                    await invalidateAssetQueries(queryClient);
                    await detailQuery.refetch();
                  }}
                  tags={tags}
                  tagsError={tagsError}
                />
              ) : (
                <>
                  <p className="asset-detail-description">
                    {detail.description || "説明なし"}
                  </p>
                  <div className="asset-detail-tags">
                    <span className="form-label">タグ</span>
                    {tagsForDetail(detail, tags).length === 0 ? (
                      <span className="asset-card-no-tags">タグなし</span>
                    ) : (
                      tagsForDetail(detail, tags).map((tag) => (
                        <span className="asset-tag-chip" key={tag.tagId}>
                          {tag.canonicalName}
                        </span>
                      ))
                    )}
                  </div>
                  <AssetTechnicalDetails detail={detail} />
                  <div className="asset-detail-actions">
                    <button
                      className="button"
                      disabled={busy}
                      type="button"
                      onClick={() => setEditing(true)}
                    >
                      編集
                    </button>
                    {detail.status === "active" ? (
                      <button
                        className="button button-danger"
                        disabled={busy}
                        type="button"
                        onClick={() => setConfirmDeactivate(true)}
                      >
                        利用停止
                      </button>
                    ) : detail.status === "inactive" ? (
                      <button
                        className="button button-primary"
                        disabled={busy}
                        type="button"
                        onClick={() =>
                          statusMutation.mutate({
                            action: "activate",
                            expectedRevision: detail.revision ?? 1
                          })
                        }
                      >
                        {statusMutation.isPending ? "再有効化中…" : "再有効化"}
                      </button>
                    ) : (
                      <p className="asset-form-note">
                        {detail.status === "processing"
                          ? "処理中のため利用停止・再有効化はできません。"
                          : "初回処理に失敗した素材は、再登録してください。"}
                      </p>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>

          {detail.pendingVersion !== null &&
          detail.pendingVersion !== undefined ? (
            <section className="asset-replacement-state" aria-live="polite">
              <h3>差し替え候補</h3>
              <p>
                現在:{" "}
                {detail.currentVersion === null
                  ? "なし"
                  : `v${detail.currentVersion}`}
                （利用中）
                <br />
                差し替え: v{detail.pendingVersion.version}（
                {detail.pendingVersion.status === "processing"
                  ? "処理中"
                  : "差し替え失敗"}
                ）
              </p>
              {detail.pendingVersion.errorMessage !== null ? (
                <p className="form-error" role="alert">
                  {detail.pendingVersion.errorCode === null
                    ? ""
                    : `${detail.pendingVersion.errorCode}: `}
                  {detail.pendingVersion.errorMessage}
                </p>
              ) : null}
            </section>
          ) : null}

          {detail.status === "active" || detail.status === "inactive" ? (
            <section
              aria-labelledby="asset-replace-title"
              className="asset-replace-panel"
            >
              <h3 id="asset-replace-title">ファイルを差し替え</h3>
              <p>
                種類は変更できません。現在の
                {detail.currentVersion === null
                  ? "素材"
                  : `v${detail.currentVersion}`}
                を維持したまま、新しい version を処理します。
              </p>
              <form
                className="asset-replace-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (replacementFile === null || busy) {
                    return;
                  }
                  replacementMutation.mutate({
                    file: replacementFile,
                    expectedRevision: detail.revision ?? 1
                  });
                }}
              >
                <label htmlFor="asset-replacement-file">新しいファイル</label>
                <input
                  accept={ASSET_KIND_CONFIG[detail.kind].accept}
                  disabled={busy}
                  id="asset-replacement-file"
                  type="file"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setReplacementFile(event.target.files?.[0] ?? null)
                  }
                />
                <span>{replacementFile?.name ?? "未選択"}</span>
                <button
                  className="button"
                  disabled={busy || replacementFile === null}
                  type="submit"
                >
                  {replacementMutation.isPending
                    ? "差し替え受付中…"
                    : "差し替えを受付"}
                </button>
              </form>
            </section>
          ) : null}

          {mutationError !== null ? (
            <p className="form-error" role="alert">
              {mutationError}
            </p>
          ) : null}
          <section
            aria-labelledby="asset-version-history-title"
            className="asset-version-history"
          >
            <h3 id="asset-version-history-title">version history</h3>
            <ul>
              {(detail.versionHistory ?? detail.versions ?? []).map(
                (version) => (
                  <li key={version.version}>
                    <strong>v{version.version}</strong>
                    <span>
                      {version.status === "ready"
                        ? "利用可能"
                        : version.status === "processing"
                          ? "処理中"
                          : "エラー"}
                    </span>
                    {version.errorMessage !== null ? (
                      <span>
                        {version.errorCode === null
                          ? ""
                          : `${version.errorCode}: `}
                        {version.errorMessage}
                      </span>
                    ) : null}
                  </li>
                )
              )}
            </ul>
          </section>
        </>
      )}
      <ConfirmationDialog
        assetTitle={detail?.title ?? "この素材"}
        busy={statusMutation.isPending}
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={() => {
          if (detail !== undefined) {
            statusMutation.mutate({
              action: "deactivate",
              expectedRevision: detail.revision ?? 1
            });
          }
        }}
      />
    </Modal>
  );
}

function tagsForDetail(
  detail: AssetDetail,
  tags: readonly AssetTagDictionaryEntryResponse[]
): Array<{ readonly tagId: string; readonly canonicalName: string }> {
  if (detail.tags !== undefined) {
    return detail.tags;
  }
  const tagIds = new Set(detail.tagIds ?? []);
  return tags
    .filter((tag) => tagIds.has(tag.tagId))
    .map((tag) => ({ tagId: tag.tagId, canonicalName: tag.canonicalName }));
}

export function AssetsPage() {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<AssetFilters>(INITIAL_FILTERS);
  const [createOpen, setCreateOpen] = useState(false);
  const [detailAssetId, setDetailAssetId] = useState<string | null>(null);
  const tagsQuery = useQuery({
    queryKey: ["asset-tags", "active"],
    queryFn: fetchAssetTags,
    retry: false,
    staleTime: 60_000
  });
  const assetsQuery = useQuery({
    queryKey: ["assets", "management", filters],
    queryFn: () =>
      searchAssets({
        q: filters.q || undefined,
        kind: filters.kind || undefined,
        status: filters.status,
        department: filters.department || undefined,
        system: filters.system || undefined,
        tagIds: filters.tagIds,
        page: filters.page,
        pageSize: PAGE_SIZE
      }),
    retry: false,
    refetchInterval: (query) => {
      const result = query.state.data;
      return result !== undefined &&
        result.items.some(
          (asset) =>
            asset.status === "processing" ||
            asset.versionStatus === "processing"
        )
        ? PROCESSING_POLL_INTERVAL_MS
        : false;
    }
  });

  function updateFilters(patch: Partial<AssetFilters>): void {
    setFilters((current) => ({ ...current, ...patch, page: 1 }));
  }

  function resetFilters(): void {
    setFilters(INITIAL_FILTERS);
  }

  const tags = tagsQuery.data ?? [];
  const tagsError = tagsQuery.isError
    ? apiErrorMessage(tagsQuery.error, "タグ一覧を取得できませんでした。")
    : null;

  return (
    <main className="page-shell assets-page">
      <header className="page-header page-header-stacked assets-page-header">
        <div>
          <p className="eyebrow">ライブラリ</p>
          <h1>素材管理</h1>
          <p>
            ワークスペース共通の素材を登録・編集し、処理状態と利用状態を管理します。
          </p>
        </div>
        <button
          className="button button-primary"
          type="button"
          onClick={() => setCreateOpen(true)}
        >
          素材を追加
        </button>
      </header>

      <AssetFiltersPanel
        filters={filters}
        tags={tags}
        tagsError={tagsError}
        onChange={updateFilters}
        onReset={resetFilters}
      />

      {assetsQuery.isPending ? (
        <p className="status-message" role="status">
          素材を読み込んでいます…
        </p>
      ) : assetsQuery.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>素材一覧を取得できません</h2>
          <p>
            {apiErrorMessage(
              assetsQuery.error,
              "素材一覧を取得できませんでした。"
            )}
          </p>
          <button
            className="button"
            type="button"
            onClick={() => void assetsQuery.refetch()}
          >
            再読み込み
          </button>
        </section>
      ) : assetsQuery.data.items.length === 0 ? (
        <section className="message-panel" aria-labelledby="assets-empty-title">
          <h2 id="assets-empty-title">条件に一致する素材はありません</h2>
          <p>検索条件を変更するか、新しい素材を追加してください。</p>
          <button
            className="button button-primary"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            素材を追加
          </button>
          <Link className="button" to="/character-visuals">
            キャラクタービジュアルを管理する
          </Link>
        </section>
      ) : (
        <section
          aria-labelledby="assets-list-title"
          className="asset-management-panel"
        >
          <div className="asset-library-header">
            <div>
              <h2 id="assets-list-title">登録済み素材</h2>
              <p className="asset-form-note">
                {assetStatusLabel(filters.status)} ・ {assetsQuery.data.total}{" "}
                件
              </p>
            </div>
            {assetsQuery.isFetching ? (
              <span aria-live="polite">更新中…</span>
            ) : null}
          </div>
          <ul className="asset-management-grid">
            {assetsQuery.data.items.map((asset) => (
              <AssetListCard
                asset={asset}
                key={asset.assetId}
                onOpen={() => setDetailAssetId(asset.assetId)}
              />
            ))}
          </ul>
          <AssetPagination
            result={assetsQuery.data}
            onPageChange={(page) =>
              setFilters((current) => ({ ...current, page }))
            }
          />
        </section>
      )}

      <AssetCreateDialog
        open={createOpen}
        tags={tags}
        tagsError={tagsError}
        onClose={() => setCreateOpen(false)}
        onSubmitted={(assetId) => {
          setCreateOpen(false);
          setDetailAssetId(assetId);
          void invalidateAssetQueries(queryClient);
        }}
      />
      <AssetDetailDialog
        assetId={detailAssetId}
        tags={tags}
        tagsError={tagsError}
        onClose={() => setDetailAssetId(null)}
      />
    </main>
  );
}
