import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from "@tanstack/react-query";
import {
  Fragment,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { ZodError } from "zod";

import type { ProjectEditResponse, ProjectSummary } from "../schema/api.js";
import type { AssetDetail, AssetListItem } from "../schema/asset.js";
import {
  editPlanSchema,
  type EditPlan,
  type EditVideoElement,
  type ScriptSection,
  type SectionBgmAssignment,
  type VideoProject
} from "../schema/video-project.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchAsset,
  fetchProject,
  fetchProjectEdit,
  saveProjectEdit,
  searchAssets
} from "./lib/api-client";
import {
  addEditVideoElement,
  addSectionBgm,
  clampUnitInterval,
  cloneEditPlan,
  createEditCutinDropTargets,
  createEditPlanReadModel,
  createEditSectionReadModels,
  createProjectEditInput,
  editAssetSearchInput,
  formatDurationMs,
  isSelectableEditAsset,
  moveEditVideoElement,
  reconcileSavedEditPlan,
  removeEditVideoElement,
  removeSectionBgm,
  replaceEditVideoElement,
  replaceSectionBgm,
  editAssetReferenceKey,
  type EditCutinDropTarget,
  type EditPlanReadModel,
  type EditSectionReadModel,
  type SelectableEditAsset
} from "./edit-page";
import {
  AutosaveCoordinator,
  navigateAfterAutosave,
  type AutosaveState
} from "./brief-autosave";
import { WorkflowIndicator } from "./WorkflowIndicator";

function projectPath(projectId: string, path: string): string {
  return `/projects/${encodeURIComponent(projectId)}/${path}`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "編集情報の応答形式を確認できませんでした。";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return fallback;
}

function errorDetails(error: unknown): string[] {
  if (!(error instanceof ApiClientError)) {
    return [];
  }
  return error.details.map(
    (detail) => `${detail.path.join(".") || "project"}: ${detail.message}`
  );
}

function editRoleLabel(role: EditVideoElement["role"]): string {
  switch (role) {
    case "intro":
      return "イントロ";
    case "outro":
      return "アウトロ";
    case "cutin":
      return "カットイン";
  }
}

function placementLabel(
  element: EditVideoElement,
  sections: VideoProject["script"]["sections"]
): string {
  if (element.role === "intro") {
    return "最初のセクションより前";
  }
  if (element.role === "outro") {
    return "最後のセクションより後";
  }

  const placement = element.placement;
  if (placement.kind !== "before_section") {
    return "セクション境界";
  }

  const section = sections.find(
    (candidate) => candidate.id === placement.sectionId
  );
  const sectionName = section?.name ?? placement.sectionId;
  return `「${sectionName}」の前・順序 ${placement.order + 1}`;
}

function assetThumbnailUrl(assetId: string, assetVersion: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/thumbnails/0?version=${assetVersion}`;
}

function assetMediaUrl(assetId: string, assetVersion: number): string {
  return `/api/assets/${encodeURIComponent(assetId)}/media?version=${assetVersion}`;
}

function assetTitle(asset: AssetDetail | undefined, assetId: string): string {
  return asset?.title ?? `素材（${assetId}）`;
}

function assetDuration(asset: AssetDetail | undefined): string {
  return formatDurationMs(asset?.durationMs ?? null);
}

function projectSummaryFromProject(project: VideoProject): ProjectSummary {
  return {
    id: project.metadata.id,
    title: project.metadata.title,
    department: project.metadata.department,
    manualVersion: project.metadata.manualVersion,
    revision: project.revision,
    createdAt: project.metadata.createdAt,
    updatedAt: project.metadata.updatedAt
  };
}

function EditVideoElementCard({
  element,
  asset,
  sections,
  disabled,
  volumeDisabled,
  isKeyboardDragging = false,
  isDragging = false,
  onReplace,
  onDelete,
  onVolumeChange,
  onDragStart,
  onDragEnd,
  onKeyboardKey
}: {
  readonly element: EditVideoElement;
  readonly asset: AssetDetail | undefined;
  readonly sections: VideoProject["script"]["sections"];
  readonly disabled: boolean;
  readonly volumeDisabled: boolean;
  readonly isKeyboardDragging?: boolean;
  readonly isDragging?: boolean;
  readonly onReplace: () => void;
  readonly onDelete: () => void;
  readonly onVolumeChange: (volume: number) => void;
  readonly onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  readonly onDragEnd?: () => void;
  readonly onKeyboardKey?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const title = assetTitle(asset, element.assetId);
  const volumeId = `${element.id}-video-volume`;
  const thumbnailAvailable = asset?.thumbnailPaths[0] !== undefined;
  const canReorder = element.role === "cutin" && onDragStart !== undefined;

  return (
    <article
      aria-label={`${editRoleLabel(element.role)}動画`}
      className={`edit-video-element-card${isDragging ? " is-dragging" : ""}`}
      data-edit-video-element-id={element.id}
    >
      <header className="edit-card-header">
        <div>
          <p className="eyebrow">動画要素</p>
          <h3>{editRoleLabel(element.role)}動画</h3>
        </div>
        <div className="edit-card-header-actions">
          <span className="edit-role-badge">{editRoleLabel(element.role)}</span>
          {canReorder ? (
            <button
              aria-keyshortcuts="Space Enter ArrowUp ArrowDown Escape"
              aria-label={`${title}のカットインを移動`}
              aria-pressed={isKeyboardDragging}
              className="edit-drag-handle"
              disabled={disabled}
              draggable={!disabled}
              title="ドラッグ、またはSpace/Enterで選択して矢印キーで移動"
              type="button"
              onDragEnd={onDragEnd}
              onDragStart={(event) => {
                const dataTransfer = event.dataTransfer as unknown as {
                  effectAllowed: string;
                  setData: (format: string, data: string) => void;
                };
                dataTransfer.effectAllowed = "move";
                dataTransfer.setData("text/plain", element.id);
                onDragStart(event);
              }}
              onKeyDown={onKeyboardKey}
            >
              ↕ 並べ替え
            </button>
          ) : (
            <span className="edit-fixed-placement">固定配置</span>
          )}
        </div>
      </header>

      {thumbnailAvailable ? (
        <img
          alt={`${title}のサムネイル`}
          className="edit-asset-thumbnail"
          src={assetThumbnailUrl(element.assetId, element.assetVersion)}
        />
      ) : (
        <div className="edit-asset-thumbnail edit-asset-thumbnail-empty">
          {asset === undefined ? "素材情報を読み込み中…" : "サムネイルなし"}
        </div>
      )}

      <dl className="edit-detail-list">
        <div>
          <dt>配置</dt>
          <dd>{placementLabel(element, sections)}</dd>
        </div>
        <div>
          <dt>素材</dt>
          <dd>
            <strong>{title}</strong>
            <span className="edit-detail-secondary">
              {assetDuration(asset)}
            </span>
          </dd>
        </div>
      </dl>

      <div className="edit-volume-control">
        <label htmlFor={volumeId}>動画の音量</label>
        <input
          aria-valuetext={`${element.volume.toFixed(2)}`}
          disabled={volumeDisabled}
          id={volumeId}
          max={1}
          min={0}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
          step={0.01}
          type="range"
          value={element.volume}
        />
        <output htmlFor={volumeId}>{element.volume.toFixed(2)}</output>
      </div>

      <div className="edit-card-actions">
        <button
          className="button button-small"
          disabled={disabled}
          type="button"
          onClick={onReplace}
        >
          差し替え
        </button>
        <button
          className="button button-small button-danger"
          disabled={disabled}
          type="button"
          onClick={onDelete}
        >
          削除
        </button>
      </div>
    </article>
  );
}

function CutinDropTarget({
  target,
  section,
  active,
  disabled,
  onDragOver,
  onDrop
}: {
  readonly target: EditCutinDropTarget;
  readonly section: ScriptSection;
  readonly active: boolean;
  readonly disabled: boolean;
  readonly onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  readonly onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      aria-disabled={disabled}
      aria-label={`「${section.name}」の前・順序 ${target.index + 1} にカットインを配置`}
      className={`edit-cutin-drop-target${active ? " is-active" : ""}`}
      data-cutin-drop-target={`${target.sectionId}:${target.index}`}
      role="button"
      tabIndex={-1}
      onDragOver={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        (event.dataTransfer as unknown as { dropEffect: string }).dropEffect =
          "move";
        onDragOver(event);
      }}
      onDrop={(event) => {
        if (disabled) {
          return;
        }
        event.preventDefault();
        onDrop(event);
      }}
    >
      <span>{active ? "ここにドロップ" : "カットインをここへ"}</span>
    </div>
  );
}

function SectionBgmSlot({
  section,
  bgm,
  asset,
  disabled,
  volumeDisabled,
  onAdd,
  onReplace,
  onRemove,
  onVolumeChange
}: {
  readonly section: EditSectionReadModel["section"];
  readonly bgm: SectionBgmAssignment | undefined;
  readonly asset: AssetDetail | undefined;
  readonly disabled: boolean;
  readonly volumeDisabled: boolean;
  readonly onAdd: () => void;
  readonly onReplace: () => void;
  readonly onRemove: () => void;
  readonly onVolumeChange: (volume: number) => void;
}) {
  const volumeId = `${section.id}-bgm-volume`;

  return (
    <section
      aria-label={`${section.name}のBGM`}
      className="edit-section-bgm-slot"
    >
      <div className="edit-card-header">
        <div>
          <p className="eyebrow">セクション音声</p>
          <h3>BGM</h3>
        </div>
        {bgm === undefined ? null : (
          <span className="edit-role-badge">設定済み</span>
        )}
      </div>

      {bgm === undefined ? (
        <div className="edit-empty-state-row">
          <p className="edit-empty-state">BGM: 未設定</p>
          <button
            className="button button-small"
            disabled={disabled}
            type="button"
            onClick={onAdd}
          >
            BGMを追加
          </button>
        </div>
      ) : (
        <>
          <div className="edit-assigned-state">
            <strong>{assetTitle(asset, bgm.assetId)}</strong>
            <span>{assetDuration(asset)}</span>
            <span>セクション再生中はループ（固定）</span>
          </div>
          <div className="edit-bgm-preview">
            <span className="edit-detail-secondary">単体試聴</span>
            <audio
              aria-label={`${assetTitle(asset, bgm.assetId)}を試聴`}
              controls
              preload="metadata"
              src={assetMediaUrl(bgm.assetId, bgm.assetVersion)}
            />
          </div>
          <div className="edit-volume-control">
            <label htmlFor={volumeId}>BGMの音量</label>
            <input
              aria-valuetext={`${bgm.volume.toFixed(2)}`}
              disabled={volumeDisabled}
              id={volumeId}
              max={1}
              min={0}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              step={0.01}
              type="range"
              value={bgm.volume}
            />
            <output htmlFor={volumeId}>{bgm.volume.toFixed(2)}</output>
          </div>
          <div className="edit-card-actions">
            <button
              className="button button-small"
              disabled={disabled}
              type="button"
              onClick={onReplace}
            >
              差し替え
            </button>
            <button
              className="button button-small button-danger"
              disabled={disabled}
              type="button"
              onClick={onRemove}
            >
              解除
            </button>
          </div>
        </>
      )}
    </section>
  );
}

type PickerState =
  | {
      readonly kind: "video";
      readonly action: "add";
      readonly role: EditVideoElement["role"];
      readonly sectionId?: string;
    }
  | {
      readonly kind: "video";
      readonly action: "replace";
      readonly elementId: string;
    }
  | {
      readonly kind: "bgm";
      readonly action: "add";
      readonly sectionId: string;
    }
  | {
      readonly kind: "bgm";
      readonly action: "replace";
      readonly bgmId: string;
    };

type AssetPickerQueryState = {
  readonly items: readonly AssetListItem[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
};

function pickerTitle(picker: PickerState): string {
  if (picker.kind === "video") {
    return picker.action === "add"
      ? `${editRoleLabel(picker.role)}動画を追加`
      : "動画要素を差し替え";
  }
  return picker.action === "add" ? "BGMを追加" : "BGMを差し替え";
}

function EditAssetPicker({
  picker,
  query,
  onClose,
  onSelect
}: {
  readonly picker: PickerState;
  readonly query: AssetPickerQueryState;
  readonly onClose: () => void;
  readonly onSelect: (asset: SelectableEditAsset) => void;
}) {
  const candidates = query.items.filter((asset) =>
    isSelectableEditAsset(asset, picker.kind)
  );
  const dialogTitleId = `edit-picker-title-${picker.kind}`;

  return (
    <div className="edit-picker-overlay">
      <section
        aria-labelledby={dialogTitleId}
        aria-modal="true"
        className="edit-asset-picker"
        role="dialog"
      >
        <header className="edit-picker-header">
          <div>
            <p className="eyebrow">素材ライブラリから選択</p>
            <h2 id={dialogTitleId}>{pickerTitle(picker)}</h2>
            <p>
              {picker.kind === "video"
                ? "active の MP4 動画だけを表示しています。"
                : "active の MP3 音源だけを表示しています。"}
            </p>
          </div>
          <button
            className="button button-small"
            type="button"
            onClick={onClose}
          >
            閉じる
          </button>
        </header>

        {query.isPending ? (
          <p className="status-message" role="status">
            素材候補を読み込んでいます…
          </p>
        ) : query.isError ? (
          <section className="message-panel message-panel-error" role="alert">
            <h3>素材候補を取得できません</h3>
            <p>
              {getErrorMessage(query.error, "素材候補の取得に失敗しました。")}
            </p>
            <button className="button" type="button" onClick={query.onRetry}>
              再読み込み
            </button>
          </section>
        ) : (
          <>
            {candidates.length === 0 ? (
              <p className="edit-empty-state">
                利用可能な再生素材がありません。active
                かつ形式・メタデータが確認済みの素材を登録してください。
              </p>
            ) : (
              <ul className="edit-asset-picker-list">
                {candidates.map((asset) => (
                  <li
                    className="edit-asset-picker-item"
                    key={`${asset.assetId}-${asset.version}`}
                  >
                    {asset.thumbnailPaths[0] !== undefined ? (
                      <img
                        alt={`${asset.title}のサムネイル`}
                        className="edit-picker-thumbnail"
                        src={assetThumbnailUrl(asset.assetId, asset.version)}
                      />
                    ) : (
                      <div className="edit-picker-thumbnail edit-picker-thumbnail-empty">
                        プレビューなし
                      </div>
                    )}
                    <div className="edit-picker-asset-info">
                      <h3>{asset.title}</h3>
                      <p>{formatDurationMs(asset.durationMs)}</p>
                      <span>{asset.mimeType}</span>
                    </div>
                    <button
                      className="button button-small button-primary"
                      type="button"
                      onClick={() => onSelect(asset)}
                    >
                      この素材を選択
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.hasNextPage ? (
              <button
                className="button"
                disabled={query.isFetchingNextPage}
                type="button"
                onClick={query.onLoadMore}
              >
                {query.isFetchingNextPage
                  ? "次の素材を読み込んでいます…"
                  : "次の素材を読み込む"}
              </button>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function EditPlanSummary({
  readModel
}: {
  readonly readModel: EditPlanReadModel;
}) {
  const videoCount =
    readModel.cutins.length +
    (readModel.intro === undefined ? 0 : 1) +
    (readModel.outro === undefined ? 0 : 1);
  return (
    <section className="edit-plan-summary" aria-label="編集状態">
      <strong>編集状態</strong>
      <span>動画要素 {videoCount} 件</span>
      <span>セクション BGM {readModel.sectionBgms.length} 件</span>
    </section>
  );
}

function EditLoadError({
  error,
  projectError,
  onRetry
}: {
  readonly error: unknown;
  readonly projectError: boolean;
  readonly onRetry: () => void;
}) {
  const details = errorDetails(error);
  return (
    <section className="message-panel message-panel-error" role="alert">
      <h1>
        {projectError
          ? "プロジェクトを読み込めませんでした"
          : "編集情報を読み込めませんでした"}
      </h1>
      <p>
        {getErrorMessage(
          error,
          projectError
            ? "プロジェクトの検証または取得に失敗しました。"
            : "編集データの取得に失敗しました。"
        )}
      </p>
      {details.length > 0 ? (
        <ul>
          {details.map((detail) => (
            <li key={detail}>{detail}</li>
          ))}
        </ul>
      ) : null}
      <button className="button" type="button" onClick={onRetry}>
        再試行
      </button>
    </section>
  );
}

type PendingAction =
  "adding" | "replacing" | "removing" | "reordering" | "saving";

function pendingActionLabel(action: PendingAction): string {
  switch (action) {
    case "adding":
      return "追加中…";
    case "replacing":
      return "差し替え中…";
    case "removing":
      return "削除中…";
    case "reordering":
      return "並べ替え中…";
    case "saving":
      return "保存中…";
  }
}

function EditPlanEditor({
  projectId,
  project,
  editResponse,
  videoPickerQuery,
  bgmPickerQuery,
  onRetry
}: {
  readonly projectId: string;
  readonly project: VideoProject;
  readonly editResponse: ProjectEditResponse;
  readonly videoPickerQuery: AssetPickerQueryState;
  readonly bgmPickerQuery: AssetPickerQueryState;
  readonly onRetry: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<EditPlan>(() =>
    cloneEditPlan(editResponse.data)
  );
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null
  );
  const [autosaveState, setAutosaveState] = useState<AutosaveState>({
    status: "idle",
    error: undefined
  });
  const revisionRef = useRef(editResponse.revision);
  const draftRef = useRef<EditPlan>(cloneEditPlan(editResponse.data));
  const lastSavedRef = useRef<EditPlan>(cloneEditPlan(editResponse.data));
  const handledServerRevisionRef = useRef(editResponse.revision);
  const lastAttemptActionRef = useRef<PendingAction | null>(null);
  const restoreRemovalOnNextSuccessRef = useRef(false);
  const reorderRollbackDraftRef = useRef<EditPlan | null>(null);
  const coordinatorRef = useRef<AutosaveCoordinator<EditPlan> | null>(null);
  const [coordinator, setCoordinator] =
    useState<AutosaveCoordinator<EditPlan> | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState(false);
  const [draggingElementId, setDraggingElementId] = useState<string | null>(
    null
  );
  const [keyboardDraggingElementId, setKeyboardDraggingElementId] = useState<
    string | null
  >(null);
  const [activeDropTarget, setActiveDropTarget] =
    useState<EditCutinDropTarget | null>(null);
  const [rollbackNotice, setRollbackNotice] = useState(false);

  const saveMutation = useMutation({
    mutationFn: ({
      edit,
      expectedRevision
    }: {
      readonly edit: EditPlan;
      readonly expectedRevision: number;
    }) =>
      saveProjectEdit(projectId, {
        edit: createProjectEditInput(edit),
        expectedRevision
      }),
    retry: false
  });
  const saveMutationRef = useRef(saveMutation);
  saveMutationRef.current = saveMutation;

  const assignedAssetRefs = useMemo(() => {
    const refs = new Map<string, { assetId: string; assetVersion: number }>();
    for (const element of draft.videoElements) {
      refs.set(editAssetReferenceKey(element.assetId, element.assetVersion), {
        assetId: element.assetId,
        assetVersion: element.assetVersion
      });
    }
    for (const bgm of draft.sectionBgms) {
      refs.set(editAssetReferenceKey(bgm.assetId, bgm.assetVersion), {
        assetId: bgm.assetId,
        assetVersion: bgm.assetVersion
      });
    }
    return [...refs.values()];
  }, [draft]);
  const assignedAssetQueries = useQueries({
    queries: assignedAssetRefs.map((asset) => ({
      queryKey: [
        "assets",
        "edit",
        "assignment",
        asset.assetId,
        asset.assetVersion
      ],
      queryFn: () => fetchAsset(asset.assetId, asset.assetVersion),
      retry: false
    }))
  });
  const assignedAssetByRef = useMemo(() => {
    const assets = new Map<string, AssetDetail>();
    assignedAssetQueries.forEach((query, index) => {
      const asset = query.data;
      const reference = assignedAssetRefs[index];
      if (asset !== undefined && reference !== undefined) {
        assets.set(
          editAssetReferenceKey(reference.assetId, reference.assetVersion),
          asset
        );
      }
    });
    return assets;
  }, [assignedAssetQueries, assignedAssetRefs]);

  function updateMutationCaches(savedProject: VideoProject): void {
    queryClient.setQueryData(["projects", projectId], savedProject);
    queryClient.setQueryData(["projects", projectId, "edit"], {
      data: savedProject.edit,
      revision: savedProject.revision
    });
    queryClient.setQueryData<ProjectSummary[]>(["projects"], (summaries) =>
      summaries?.map((summary) =>
        summary.id === savedProject.metadata.id
          ? projectSummaryFromProject(savedProject)
          : summary
      )
    );
  }

  async function saveDraft(nextDraft: EditPlan): Promise<void> {
    const lastSaved = lastSavedRef.current;
    if (JSON.stringify(lastSaved) === JSON.stringify(nextDraft)) {
      return;
    }

    const savedProject = await saveMutationRef.current.mutateAsync({
      edit: nextDraft,
      expectedRevision: revisionRef.current
    });
    updateMutationCaches(savedProject);
    revisionRef.current = savedProject.revision;
    handledServerRevisionRef.current = savedProject.revision;
    lastSavedRef.current = cloneEditPlan(savedProject.edit);
    reorderRollbackDraftRef.current = null;
    setRollbackNotice(false);

    const reconciledDraft = restoreRemovalOnNextSuccessRef.current
      ? cloneEditPlan(savedProject.edit)
      : reconcileSavedEditPlan(nextDraft, savedProject.edit, draftRef.current);
    restoreRemovalOnNextSuccessRef.current = false;
    draftRef.current = reconciledDraft;
    coordinatorRef.current?.replaceDraft(reconciledDraft);
    setDraft(reconciledDraft);
  }

  useEffect(() => {
    const nextCoordinator = new AutosaveCoordinator<EditPlan>({
      debounceMs: 350,
      save: saveDraft,
      isConflict: (error) =>
        error instanceof ApiClientError &&
        error.status === 409 &&
        error.code === "PROJECT_REVISION_CONFLICT",
      onStateChange: setAutosaveState
    });
    coordinatorRef.current = nextCoordinator;
    setCoordinator(nextCoordinator);
    return () => {
      nextCoordinator.dispose();
      if (coordinatorRef.current === nextCoordinator) {
        coordinatorRef.current = null;
      }
    };
  }, [projectId, queryClient]);

  useEffect(() => {
    if (editResponse.revision === handledServerRevisionRef.current) {
      return;
    }
    handledServerRevisionRef.current = editResponse.revision;
    const nextDraft = cloneEditPlan(editResponse.data);
    revisionRef.current = editResponse.revision;
    draftRef.current = nextDraft;
    lastSavedRef.current = cloneEditPlan(nextDraft);
    setDraft(nextDraft);
    setPicker(null);
    setPendingAction(null);
    coordinatorRef.current?.reset();
  }, [editResponse.data, editResponse.revision]);

  useEffect(() => {
    if (
      (autosaveState.status === "error" ||
        autosaveState.status === "conflict") &&
      lastAttemptActionRef.current === "reordering"
    ) {
      const restoredDraft = cloneEditPlan(
        reorderRollbackDraftRef.current ?? lastSavedRef.current
      );
      reorderRollbackDraftRef.current = null;
      draftRef.current = restoredDraft;
      coordinatorRef.current?.replaceDraft(restoredDraft);
      setDraft(restoredDraft);
      setRollbackNotice(true);
      lastAttemptActionRef.current = null;
    }
    if (
      autosaveState.status === "error" &&
      lastAttemptActionRef.current === "removing"
    ) {
      const restoredDraft = cloneEditPlan(lastSavedRef.current);
      draftRef.current = restoredDraft;
      setDraft(restoredDraft);
      restoreRemovalOnNextSuccessRef.current = true;
    }
    if (
      autosaveState.status === "saved" ||
      autosaveState.status === "error" ||
      autosaveState.status === "conflict"
    ) {
      setPendingAction(null);
    }
  }, [autosaveState.status]);

  function updateDraft(nextDraft: EditPlan, action: PendingAction): void {
    const validatedDraft = editPlanSchema.parse(nextDraft);
    const clonedDraft = cloneEditPlan(validatedDraft);
    draftRef.current = clonedDraft;
    setDraft(clonedDraft);
    setPendingAction(action);
    setRollbackNotice(false);
    lastAttemptActionRef.current = action;
    if (action !== "removing") {
      restoreRemovalOnNextSuccessRef.current = false;
    }
    coordinatorRef.current?.update(clonedDraft);
  }

  function updateVideoVolume(elementId: string, volume: number): void {
    const current = draftRef.current;
    updateDraft(
      {
        ...current,
        videoElements: current.videoElements.map((element) =>
          element.id === elementId
            ? { ...element, volume: clampUnitInterval(volume) }
            : element
        )
      },
      "saving"
    );
  }

  function updateBgmVolume(bgmId: string, volume: number): void {
    const current = draftRef.current;
    updateDraft(
      {
        ...current,
        sectionBgms: current.sectionBgms.map((bgm) =>
          bgm.id === bgmId ? { ...bgm, volume: clampUnitInterval(volume) } : bgm
        )
      },
      "saving"
    );
  }

  function selectAsset(asset: SelectableEditAsset): void {
    if (picker === null) {
      return;
    }
    const current = draftRef.current;
    let nextDraft: EditPlan;
    if (picker.kind === "video") {
      nextDraft =
        picker.action === "add"
          ? addEditVideoElement(
              current,
              picker.role,
              picker.sectionId,
              asset,
              project.script.sections[0]?.id
            )
          : replaceEditVideoElement(current, picker.elementId, asset);
    } else {
      nextDraft =
        picker.action === "add"
          ? addSectionBgm(current, picker.sectionId, asset)
          : replaceSectionBgm(current, picker.bgmId, asset);
    }
    setPicker(null);
    updateDraft(nextDraft, picker.action === "add" ? "adding" : "replacing");
  }

  function removeVideo(elementId: string): void {
    updateDraft(
      removeEditVideoElement(draftRef.current, elementId),
      "removing"
    );
  }

  function removeBgm(bgmId: string): void {
    updateDraft(removeSectionBgm(draftRef.current, bgmId), "removing");
  }

  function reloadLatest(): void {
    coordinatorRef.current?.reset();
    setPendingAction(null);
    onRetry();
  }

  async function navigateAway(
    event: MouseEvent<HTMLAnchorElement>,
    destination: string
  ): Promise<void> {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    event.preventDefault();
    if (pendingNavigation) {
      return;
    }
    setPendingNavigation(true);
    const flushed = await navigateAfterAutosave(
      coordinatorRef.current,
      destination,
      navigate
    );
    if (flushed) {
      return;
    }
    setPendingNavigation(false);
  }

  const readModel = createEditPlanReadModel(draft);
  const sectionModels = createEditSectionReadModels(
    project.script.sections,
    readModel
  );
  const sectionIds = project.script.sections.map((section) => section.id);
  const cutinDropTargets = createEditCutinDropTargets(sectionModels);

  function isSameDropTarget(
    left: EditCutinDropTarget | null,
    right: EditCutinDropTarget | null
  ): boolean {
    return left?.sectionId === right?.sectionId && left?.index === right?.index;
  }

  function clearDragState(): void {
    setDraggingElementId(null);
    setKeyboardDraggingElementId(null);
    setActiveDropTarget(null);
  }

  function commitCutinDrop(
    elementId: string,
    target: EditCutinDropTarget
  ): void {
    const current = draftRef.current;
    const next = moveEditVideoElement(current, elementId, target, sectionIds);
    clearDragState();
    if (JSON.stringify(current) === JSON.stringify(next)) {
      return;
    }
    reorderRollbackDraftRef.current = cloneEditPlan(current);
    updateDraft(next, "reordering");
  }

  function startNativeDrag(elementId: string): void {
    setDraggingElementId(elementId);
    setKeyboardDraggingElementId(null);
    setActiveDropTarget(null);
  }

  function handleNativeDragOver(
    target: EditCutinDropTarget,
    event: DragEvent<HTMLDivElement>
  ): void {
    if (draggingElementId === null || keyboardDraggingElementId !== null) {
      return;
    }
    if (!isSameDropTarget(activeDropTarget, target)) {
      setActiveDropTarget(target);
    }
    (event.dataTransfer as unknown as { dropEffect: string }).dropEffect =
      "move";
  }

  function handleNativeDrop(
    target: EditCutinDropTarget,
    event: DragEvent<HTMLDivElement>
  ): void {
    if (draggingElementId === null || keyboardDraggingElementId !== null) {
      return;
    }
    event.preventDefault();
    commitCutinDrop(draggingElementId, target);
  }

  function currentCutinDropTarget(
    element: EditVideoElement
  ): EditCutinDropTarget | null {
    const placement = element.placement;
    if (element.role !== "cutin" || placement.kind !== "before_section") {
      return null;
    }
    const sectionModel = sectionModels.find(
      (model) => model.section.id === placement.sectionId
    );
    const index = sectionModel?.cutins.findIndex(
      (cutin) => cutin.id === element.id
    );
    return index === undefined || index < 0
      ? null
      : { sectionId: placement.sectionId, index };
  }

  function moveKeyboardDropTarget(direction: "previous" | "next"): void {
    if (activeDropTarget === null || keyboardDraggingElementId === null) {
      return;
    }
    const currentIndex = cutinDropTargets.findIndex((target) =>
      isSameDropTarget(target, activeDropTarget)
    );
    if (currentIndex < 0) {
      return;
    }
    const step = direction === "next" ? 1 : -1;
    let nextIndex = currentIndex + step;
    while (nextIndex >= 0 && nextIndex < cutinDropTargets.length) {
      const nextTarget = cutinDropTargets[nextIndex];
      if (nextTarget === undefined) {
        return;
      }
      const nextDraft = moveEditVideoElement(
        draftRef.current,
        keyboardDraggingElementId,
        nextTarget,
        sectionIds
      );
      if (JSON.stringify(nextDraft) !== JSON.stringify(draftRef.current)) {
        setActiveDropTarget(nextTarget);
        return;
      }
      // A slot immediately after the source card can describe the same
      // result after the source is removed. Skip that no-op slot so one
      // ArrowDown/ArrowRight always advances the cutin when possible.
      nextIndex += step;
    }
  }

  function handleKeyboardKey(
    element: EditVideoElement,
    event: KeyboardEvent<HTMLButtonElement>
  ): void {
    const isConfirmKey = event.key === " " || event.key === "Enter";
    if (keyboardDraggingElementId === null) {
      if (!isConfirmKey) {
        return;
      }
      const target = currentCutinDropTarget(element);
      if (target === null || interactionDisabled) {
        return;
      }
      event.preventDefault();
      setDraggingElementId(element.id);
      setKeyboardDraggingElementId(element.id);
      setActiveDropTarget(target);
      return;
    }
    if (keyboardDraggingElementId !== element.id) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearDragState();
      return;
    }
    if (isConfirmKey) {
      event.preventDefault();
      if (activeDropTarget !== null) {
        commitCutinDrop(element.id, activeDropTarget);
      }
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveKeyboardDropTarget("previous");
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveKeyboardDropTarget("next");
    }
  }

  const saveInProgress =
    autosaveState.status === "pending" || autosaveState.status === "saving";
  const interactionDisabled =
    saveInProgress || autosaveState.status === "conflict";
  const autosaveMessage = pendingNavigation
    ? "移動前に保存しています…"
    : pendingAction !== null
      ? pendingActionLabel(pendingAction)
      : autosaveState.status === "saving"
        ? "保存中…"
        : autosaveState.status === "saved"
          ? "保存済み"
          : autosaveState.status === "error"
            ? "保存失敗"
            : autosaveState.status === "conflict"
              ? "競合"
              : autosaveState.status === "pending"
                ? "保存待ち"
                : "変更なし";

  return (
    <>
      <main className="page-shell edit-page">
        <p className="back-link">
          <Link
            to={projectPath(projectId, "script")}
            onClick={(event) => {
              void navigateAway(event, projectPath(projectId, "script"));
            }}
          >
            台本へ戻る
          </Link>
        </p>
        <WorkflowIndicator
          projectId={projectId}
          currentStep="edit"
          onNavigate={navigateAway}
        />
        <header className="page-header page-header-stacked">
          <p className="eyebrow">編集</p>
          <h1>{project.metadata.title} の編集</h1>
          <p>
            台本のセクション順を正本として、動画要素とセクション BGM
            を素材ライブラリから設定します。
          </p>
          <div className="page-header-actions">
            <Link
              className="button"
              to={projectPath(projectId, "script")}
              onClick={(event) => {
                void navigateAway(event, projectPath(projectId, "script"));
              }}
            >
              台本を開く
            </Link>
            <Link
              className="button"
              to={projectPath(projectId, "preview")}
              onClick={(event) => {
                void navigateAway(event, projectPath(projectId, "preview"));
              }}
            >
              プレビューを開く
            </Link>
          </div>
        </header>

        <div className="autosave-status" role="status" aria-live="polite">
          <strong>{autosaveMessage}</strong>
          <span>更新番号 {revisionRef.current}</span>
          <span>
            動画要素 {draft.videoElements.length} / BGM{" "}
            {draft.sectionBgms.length}
          </span>
        </div>

        {autosaveState.status === "error" ? (
          <section className="message-panel message-panel-error" role="alert">
            <h2>保存できませんでした</h2>
            <p>
              {getErrorMessage(
                autosaveState.error,
                "現在の編集内容は画面に保持されています。"
              )}
            </p>
            {rollbackNotice ? (
              <p>並べ替えの保存に失敗したため、変更前の順序へ戻しました。</p>
            ) : null}
            {errorDetails(autosaveState.error).length > 0 ? (
              <ul>
                {errorDetails(autosaveState.error).map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
            <button
              className="button"
              type="button"
              onClick={() => coordinator?.retry()}
            >
              再試行
            </button>
          </section>
        ) : null}
        {autosaveState.status === "conflict" ? (
          <section className="message-panel message-panel-error" role="alert">
            <h2>保存競合</h2>
            <p>
              別の画面でプロジェクトが更新されました。最新データを再読込するまで自動保存を停止します。
            </p>
            {rollbackNotice ? (
              <p>競合した並べ替えは適用せず、変更前の順序へ戻しました。</p>
            ) : null}
            <button className="button" type="button" onClick={reloadLatest}>
              最新データを再読込
            </button>
          </section>
        ) : null}

        <EditPlanSummary readModel={readModel} />

        {draggingElementId !== null && activeDropTarget !== null ? (
          <p className="edit-dnd-status" role="status" aria-live="polite">
            {keyboardDraggingElementId !== null
              ? "カットインを選択中。矢印キーで配置先を選び、SpaceまたはEnterで決定、Escapeでキャンセルできます。"
              : "カットインをドラッグ中です。点線の配置先へドロップしてください。"}{" "}
            現在の配置先: 「
            {project.script.sections.find(
              (section) => section.id === activeDropTarget.sectionId
            )?.name ?? activeDropTarget.sectionId}
            」前・順序 {activeDropTarget.index + 1}
          </p>
        ) : null}

        <section
          aria-labelledby="edit-video-title"
          className="edit-video-toolbar"
        >
          <div>
            <p className="eyebrow">動画要素</p>
            <h2 id="edit-video-title">イントロ・アウトロ・カットイン</h2>
            <p>
              イントロとアウトロは各 1
              件、カットインはセクション境界ごとに複数設定できます。
            </p>
          </div>
          <div className="edit-card-actions">
            {readModel.intro === undefined ? (
              <button
                className="button button-small"
                disabled={
                  interactionDisabled || project.script.sections.length === 0
                }
                type="button"
                onClick={() =>
                  setPicker({ kind: "video", action: "add", role: "intro" })
                }
              >
                イントロを追加
              </button>
            ) : null}
            {readModel.outro === undefined ? (
              <button
                className="button button-small"
                disabled={
                  interactionDisabled || project.script.sections.length === 0
                }
                type="button"
                onClick={() =>
                  setPicker({ kind: "video", action: "add", role: "outro" })
                }
              >
                アウトロを追加
              </button>
            ) : null}
          </div>
        </section>

        {sectionModels.length === 0 ? (
          <section className="message-panel" aria-live="polite">
            <h2>台本セクションがありません</h2>
            <p>
              台本を初期化すると、編集画面にセクションカードが表示されます。
            </p>
            <Link
              className="button"
              to={projectPath(projectId, "script")}
              onClick={(event) => {
                void navigateAway(event, projectPath(projectId, "script"));
              }}
            >
              台本を開く
            </Link>
          </section>
        ) : (
          <section className="edit-section-list" aria-label="編集セクション">
            {readModel.intro !== undefined ? (
              <EditVideoElementCard
                asset={assignedAssetByRef.get(
                  editAssetReferenceKey(
                    readModel.intro.assetId,
                    readModel.intro.assetVersion
                  )
                )}
                disabled={interactionDisabled}
                element={readModel.intro}
                volumeDisabled={
                  autosaveState.status === "saving" ||
                  autosaveState.status === "conflict"
                }
                sections={project.script.sections}
                onDelete={() => removeVideo(readModel.intro!.id)}
                onReplace={() =>
                  setPicker({
                    kind: "video",
                    action: "replace",
                    elementId: readModel.intro!.id
                  })
                }
                onVolumeChange={(volume) =>
                  updateVideoVolume(readModel.intro!.id, volume)
                }
              />
            ) : null}
            {sectionModels.map((model) => (
              <div className="edit-section-flow" key={model.section.id}>
                {model.order > 1 ? (
                  <CutinDropTarget
                    active={isSameDropTarget(activeDropTarget, {
                      sectionId: model.section.id,
                      index: 0
                    })}
                    disabled={interactionDisabled || draggingElementId === null}
                    section={model.section}
                    target={{ sectionId: model.section.id, index: 0 }}
                    onDragOver={(event) =>
                      handleNativeDragOver(
                        { sectionId: model.section.id, index: 0 },
                        event
                      )
                    }
                    onDrop={(event) =>
                      handleNativeDrop(
                        { sectionId: model.section.id, index: 0 },
                        event
                      )
                    }
                  />
                ) : (
                  <div
                    aria-disabled="true"
                    className="edit-cutin-drop-target edit-cutin-drop-target-invalid"
                    role="note"
                  >
                    最初のセクションより前にはカットインを配置できません
                  </div>
                )}
                {model.cutins.map((cutin, index) => (
                  <Fragment key={cutin.id}>
                    <EditVideoElementCard
                      asset={assignedAssetByRef.get(
                        editAssetReferenceKey(cutin.assetId, cutin.assetVersion)
                      )}
                      disabled={interactionDisabled}
                      element={cutin}
                      isDragging={draggingElementId === cutin.id}
                      isKeyboardDragging={
                        keyboardDraggingElementId === cutin.id
                      }
                      sections={project.script.sections}
                      volumeDisabled={
                        autosaveState.status === "saving" ||
                        autosaveState.status === "conflict"
                      }
                      onDelete={() => removeVideo(cutin.id)}
                      onReplace={() =>
                        setPicker({
                          kind: "video",
                          action: "replace",
                          elementId: cutin.id
                        })
                      }
                      onVolumeChange={(volume) =>
                        updateVideoVolume(cutin.id, volume)
                      }
                      onDragEnd={clearDragState}
                      onDragStart={() => startNativeDrag(cutin.id)}
                      onKeyboardKey={(event) => handleKeyboardKey(cutin, event)}
                    />
                    <CutinDropTarget
                      active={isSameDropTarget(activeDropTarget, {
                        sectionId: model.section.id,
                        index: index + 1
                      })}
                      disabled={
                        interactionDisabled || draggingElementId === null
                      }
                      section={model.section}
                      target={{
                        sectionId: model.section.id,
                        index: index + 1
                      }}
                      onDragOver={(event) =>
                        handleNativeDragOver(
                          { sectionId: model.section.id, index: index + 1 },
                          event
                        )
                      }
                      onDrop={(event) =>
                        handleNativeDrop(
                          { sectionId: model.section.id, index: index + 1 },
                          event
                        )
                      }
                    />
                  </Fragment>
                ))}
                <section className="script-section-card edit-section-card">
                  <header className="script-section-header">
                    <div>
                      <p className="eyebrow">セクション {model.order}</p>
                      <h2>{model.section.name}</h2>
                      <code>{model.section.id}</code>
                    </div>
                    <div className="edit-section-header-actions">
                      <span className="edit-section-order">
                        台本順 {model.order}
                      </span>
                      {model.order > 1 ? (
                        <button
                          className="button button-small"
                          disabled={interactionDisabled}
                          type="button"
                          onClick={() =>
                            setPicker({
                              kind: "video",
                              action: "add",
                              role: "cutin",
                              sectionId: model.section.id
                            })
                          }
                        >
                          カットインを追加
                        </button>
                      ) : null}
                    </div>
                  </header>
                  <SectionBgmSlot
                    asset={
                      model.bgm === undefined
                        ? undefined
                        : assignedAssetByRef.get(
                            editAssetReferenceKey(
                              model.bgm.assetId,
                              model.bgm.assetVersion
                            )
                          )
                    }
                    bgm={model.bgm}
                    disabled={interactionDisabled}
                    section={model.section}
                    volumeDisabled={
                      autosaveState.status === "saving" ||
                      autosaveState.status === "conflict"
                    }
                    onAdd={() =>
                      setPicker({
                        kind: "bgm",
                        action: "add",
                        sectionId: model.section.id
                      })
                    }
                    onRemove={() => {
                      if (model.bgm !== undefined) {
                        removeBgm(model.bgm.id);
                      }
                    }}
                    onReplace={() => {
                      if (model.bgm !== undefined) {
                        setPicker({
                          kind: "bgm",
                          action: "replace",
                          bgmId: model.bgm.id
                        });
                      }
                    }}
                    onVolumeChange={(volume) => {
                      if (model.bgm !== undefined) {
                        updateBgmVolume(model.bgm.id, volume);
                      }
                    }}
                  />
                </section>
              </div>
            ))}
            {readModel.outro !== undefined ? (
              <EditVideoElementCard
                asset={assignedAssetByRef.get(
                  editAssetReferenceKey(
                    readModel.outro.assetId,
                    readModel.outro.assetVersion
                  )
                )}
                disabled={interactionDisabled}
                element={readModel.outro}
                sections={project.script.sections}
                volumeDisabled={
                  autosaveState.status === "saving" ||
                  autosaveState.status === "conflict"
                }
                onDelete={() => removeVideo(readModel.outro!.id)}
                onReplace={() =>
                  setPicker({
                    kind: "video",
                    action: "replace",
                    elementId: readModel.outro!.id
                  })
                }
                onVolumeChange={(volume) =>
                  updateVideoVolume(readModel.outro!.id, volume)
                }
              />
            ) : null}
          </section>
        )}
      </main>

      {picker !== null ? (
        <EditAssetPicker
          picker={picker}
          query={picker.kind === "video" ? videoPickerQuery : bgmPickerQuery}
          onClose={() => setPicker(null)}
          onSelect={selectAsset}
        />
      ) : null}
    </>
  );
}

export function EditPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const editQuery = useQuery({
    queryKey: ["projects", projectId, "edit"],
    queryFn: () => fetchProjectEdit(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const videoAssetsQuery = useInfiniteQuery({
    queryKey: ["assets", "edit", "video"],
    queryFn: ({ pageParam }) =>
      searchAssets(editAssetSearchInput("video", pageParam)),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasNextPage ? lastPage.page + 1 : undefined,
    enabled: projectId !== undefined,
    retry: false
  });
  const bgmAssetsQuery = useInfiniteQuery({
    queryKey: ["assets", "edit", "bgm"],
    queryFn: ({ pageParam }) =>
      searchAssets(editAssetSearchInput("bgm", pageParam)),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasNextPage ? lastPage.page + 1 : undefined,
    enabled: projectId !== undefined,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  const retry = (): void => {
    void Promise.all([projectQuery.refetch(), editQuery.refetch()]);
  };

  if (projectQuery.isPending || editQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <p className="status-message" role="status" aria-live="polite">
          プロジェクトと編集情報を読み込んでいます…
        </p>
      </main>
    );
  }

  if (projectQuery.isError || editQuery.isError) {
    const error = projectQuery.error ?? editQuery.error;
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <EditLoadError
          error={error}
          projectError={projectQuery.isError}
          onRetry={retry}
        />
      </main>
    );
  }

  const project = projectQuery.data;
  const editResponse = editQuery.data;
  if (project === undefined || editResponse === undefined) {
    return null;
  }

  if (project.revision !== editResponse.revision) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to="/projects">プロジェクト一覧へ戻る</Link>
        </p>
        <WorkflowIndicator projectId={projectId} currentStep="edit" />
        <section className="message-panel message-panel-error" role="alert">
          <h1>読み込み中にプロジェクト情報が更新されました</h1>
          <p>
            プロジェクト本体と編集情報の更新番号が一致しないため、異なる状態を混ぜないよう編集画面を開始していません。
          </p>
          <button className="button" type="button" onClick={retry}>
            最新データを再読み込み
          </button>
        </section>
      </main>
    );
  }

  return (
    <EditPlanEditor
      bgmPickerQuery={{
        items: bgmAssetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
        isPending: bgmAssetsQuery.isPending,
        isError: bgmAssetsQuery.isError,
        error: bgmAssetsQuery.error,
        hasNextPage: bgmAssetsQuery.hasNextPage ?? false,
        isFetchingNextPage: bgmAssetsQuery.isFetchingNextPage,
        onRetry: () => {
          void bgmAssetsQuery.refetch();
        },
        onLoadMore: () => {
          void bgmAssetsQuery.fetchNextPage();
        }
      }}
      editResponse={editResponse}
      onRetry={retry}
      project={project}
      projectId={projectId}
      videoPickerQuery={{
        items: videoAssetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
        isPending: videoAssetsQuery.isPending,
        isError: videoAssetsQuery.isError,
        error: videoAssetsQuery.error,
        hasNextPage: videoAssetsQuery.hasNextPage ?? false,
        isFetchingNextPage: videoAssetsQuery.isFetchingNextPage,
        onRetry: () => {
          void videoAssetsQuery.refetch();
        },
        onLoadMore: () => {
          void videoAssetsQuery.fetchNextPage();
        }
      }}
    />
  );
}
