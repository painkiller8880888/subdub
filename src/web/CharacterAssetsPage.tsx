import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import type {
  CharacterVariant,
  CharacterVisualBinding,
  CharacterVisualSet,
  VideoProject
} from "../schema/index.js";
import type { ProjectSummary } from "../schema/api.js";
import {
  ApiClientError,
  ApiClientProtocolError,
  fetchCharacterVisualCatalog,
  fetchProject,
  saveProjectCharacterVisualBindings
} from "./lib/api-client";
import { characterVisualFileUrl } from "./character-visual-picker";
import { WorkflowIndicator } from "./WorkflowIndicator";

type BindingDraft = Record<string, CharacterVisualBinding>;

function getErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return `${error.message}（エラーコード: ${error.code}）`;
  }
  if (error instanceof ApiClientProtocolError) {
    return error.message;
  }
  if (error instanceof ZodError) {
    return "プロジェクトデータの検証に失敗しました。";
  }
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }
  return "プロジェクトを取得できませんでした。";
}

function characterRoleLabel(role: string): string {
  switch (role) {
    case "mentor":
      return "解説役";
    case "learner":
      return "聞き役";
    default:
      return role;
  }
}

function createBindingDraft(project: VideoProject): BindingDraft {
  return Object.fromEntries(
    project.characters.map((character) => [
      character.id,
      { ...character.characterVisual }
    ])
  );
}

function bindingsEqual(
  project: VideoProject,
  draft: BindingDraft | null
): boolean {
  if (draft === null) {
    return true;
  }
  return project.characters.every(
    (character) =>
      JSON.stringify(character.characterVisual) ===
      JSON.stringify(draft[character.id])
  );
}

function variantFileSlots(variant: CharacterVariant): readonly {
  key: "single" | "closed" | "open";
  label: string;
}[] {
  return variant.renderType === "single-image"
    ? [{ key: "single", label: "素材" }]
    : [
        { key: "closed", label: "口閉じ" },
        { key: "open", label: "口開き" }
      ];
}

function AssetImage({
  visual,
  variant,
  fileKey,
  label,
  onError
}: {
  readonly visual: CharacterVisualSet;
  readonly variant: CharacterVariant;
  readonly fileKey: string;
  readonly label: string;
  readonly onError: (path: string) => void;
}) {
  const file = variant.files.find((candidate) => candidate.key === fileKey);
  if (file === undefined) {
    return (
      <div
        className="character-asset-error"
        role="img"
        aria-label={`${label}が未登録`}
      >
        <strong>素材が未登録です</strong>
      </div>
    );
  }
  const src = characterVisualFileUrl(
    visual.visualId,
    variant.variantId,
    file.key
  );
  return (
    <img
      alt={label}
      className="character-asset-image"
      src={src}
      onError={() => onError(file.libraryPath)}
    />
  );
}

function CatalogVariantCard({
  visual,
  variant,
  onError
}: {
  readonly visual: CharacterVisualSet;
  readonly variant: CharacterVariant;
  readonly onError: (path: string) => void;
}) {
  return (
    <article className="character-pose-card">
      <div className="character-pose-card-header">
        <div>
          <h3>{variant.label}</h3>
          <p className="status-message">
            {variant.renderType} ·{" "}
            {variant.status === "active" ? "active" : "inactive"}
          </p>
        </div>
        <code>{variant.variantId}</code>
      </div>
      <div
        className={
          variant.renderType === "mouth-pair"
            ? "character-mouth-grid"
            : undefined
        }
      >
        {variantFileSlots(variant).map((slot) => (
          <figure key={slot.key}>
            <AssetImage
              visual={visual}
              variant={variant}
              fileKey={slot.key}
              label={`${visual.name}の${variant.label}・${slot.label}`}
              onError={onError}
            />
            <figcaption>{slot.label}</figcaption>
          </figure>
        ))}
      </div>
      <p className="character-asset-tags">
        タグ: {variant.tags.join("、") || "なし"}
      </p>
    </article>
  );
}

function CatalogVisualCard({
  visual,
  onError
}: {
  readonly visual: CharacterVisualSet;
  readonly onError: (path: string) => void;
}) {
  return (
    <section
      className="character-card"
      aria-labelledby={`${visual.visualId}-catalog-title`}
    >
      <header className="character-card-header">
        <div>
          <p className="eyebrow">SQLiteカタログ snapshot</p>
          <h2 id={`${visual.visualId}-catalog-title`}>{visual.name}</h2>
        </div>
        <span className="character-id">
          {visual.visualId} · {visual.status}
        </span>
      </header>
      <p>{visual.description || "説明なし"}</p>
      <div className="character-pose-list">
        {visual.variants.map((variant) => (
          <CatalogVariantCard
            key={variant.variantId}
            visual={visual}
            variant={variant}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

function BindingStatus({
  binding,
  visual,
  variant
}: {
  readonly binding: CharacterVisualBinding;
  readonly visual: CharacterVisualSet | undefined;
  readonly variant: CharacterVariant | undefined;
}) {
  if (binding.visualId === null) {
    return <span className="status-message">未設定</span>;
  }
  if (visual === undefined) {
    return <span className="form-error">snapshotにない visualId です</span>;
  }
  if (visual.status !== "active") {
    return <span className="form-error">inactive の visualId です</span>;
  }
  if (binding.idleVariantId === null) {
    return <span className="status-message">idle variant 未選択</span>;
  }
  if (variant === undefined) {
    return <span className="form-error">snapshotにない idle variant です</span>;
  }
  if (variant.status !== "active") {
    return <span className="form-error">inactive の idle variant です</span>;
  }
  return (
    <span className="status-message">
      {visual.name} / {variant.label}
    </span>
  );
}

export function CharacterAssetsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const queryClient = useQueryClient();
  const [failedAssetPaths, setFailedAssetPaths] = useState<string[]>([]);
  const [bindingDraft, setBindingDraft] = useState<BindingDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });
  const catalogQuery = useQuery({
    queryKey: ["character-visuals"],
    queryFn: fetchCharacterVisualCatalog,
    enabled: projectId !== undefined,
    retry: false
  });
  const bindingMutation = useMutation({
    mutationFn: ({
      projectId: savingProjectId,
      expectedRevision,
      characters
    }: {
      projectId: string;
      expectedRevision: number;
      characters: Array<{
        characterId: string;
        characterVisual: CharacterVisualBinding;
      }>;
    }) =>
      saveProjectCharacterVisualBindings(savingProjectId, {
        characters,
        expectedRevision
      }),
    onSuccess: (project) => {
      queryClient.setQueryData(["projects", project.metadata.id], project);
      queryClient.setQueryData<ProjectSummary[]>(["projects"], (projects) =>
        projects?.map((candidate) =>
          candidate.id === project.metadata.id
            ? {
                ...candidate,
                revision: project.revision,
                updatedAt: project.metadata.updatedAt
              }
            : candidate
        )
      );
      setBindingDraft(createBindingDraft(project));
      setDraftRevision(project.revision);
    },
    retry: false
  });

  useEffect(() => {
    const project = projectQuery.data;
    if (
      project !== undefined &&
      (bindingDraft === null || draftRevision !== project.revision)
    ) {
      setBindingDraft(createBindingDraft(project));
      setDraftRevision(project.revision);
    }
  }, [bindingDraft, draftRevision, projectQuery.data]);

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (projectQuery.isPending || catalogQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          プロジェクトとキャラクタービジュアルを読み込んでいます…
        </p>
      </main>
    );
  }

  if (
    projectQuery.isError ||
    projectQuery.data === undefined ||
    catalogQuery.isError ||
    catalogQuery.data === undefined
  ) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/script`}>
            台本へ戻る
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>キャラクター素材を確認できません</h1>
          <p>{getErrorMessage(projectQuery.error ?? catalogQuery.error)}</p>
        </section>
      </main>
    );
  }

  const project = projectQuery.data;
  const catalog = catalogQuery.data;
  const currentDraft = bindingDraft ?? createBindingDraft(project);
  const dirty = !bindingsEqual(project, bindingDraft);
  const failedAsset = (path: string): void => {
    setFailedAssetPaths((current) =>
      current.includes(path) ? current : [...current, path]
    );
  };

  function updateBinding(
    characterId: string,
    binding: CharacterVisualBinding
  ): void {
    setBindingDraft((current) => ({
      ...(current ?? createBindingDraft(project)),
      [characterId]: binding
    }));
  }

  function saveBindings(): void {
    if (!dirty || bindingMutation.isPending) {
      return;
    }
    bindingMutation.mutate({
      projectId: projectId ?? "",
      expectedRevision: draftRevision ?? project.revision,
      characters: project.characters.map((character) => ({
        characterId: character.id,
        characterVisual: currentDraft[character.id] ?? character.characterVisual
      }))
    });
  }

  return (
    <main className="page-shell character-assets-page">
      <p className="back-link">
        <Link to={`/projects/${encodeURIComponent(projectId)}/script`}>
          台本へ戻る
        </Link>
      </p>
      <WorkflowIndicator projectId={projectId} currentStep="production" />
      <header className="page-header page-header-stacked">
        <p className="eyebrow">手順2-1</p>
        <h1>プロジェクトのキャラクタービジュアル設定</h1>
        <p>
          VOICEVOX話者をプロジェクト内のキャラクターとして確認し、SQLiteカタログの
          visual set と idle variant を明示的に binding
          します。IDやラベルからの自動推測は行いません。
        </p>
        <div className="page-header-actions">
          <Link
            className="button"
            to={`/projects/${encodeURIComponent(projectId)}/script`}
          >
            台本へ戻る
          </Link>
          <button
            className="button button-primary"
            type="button"
            disabled={!dirty || bindingMutation.isPending}
            onClick={saveBindings}
          >
            {bindingMutation.isPending ? "保存中…" : "bindingを保存"}
          </button>
        </div>
      </header>

      {bindingMutation.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>bindingを保存できません</h2>
          <p>{getErrorMessage(bindingMutation.error)}</p>
          {bindingMutation.error instanceof ApiClientError &&
          bindingMutation.error.status === 409 ? (
            <>
              <p>最新データを再読み込みしてから、もう一度設定してください。</p>
              <button
                className="button"
                type="button"
                onClick={() => void projectQuery.refetch()}
              >
                最新データを再読込
              </button>
            </>
          ) : null}
        </section>
      ) : null}
      {bindingMutation.isSuccess && !dirty ? (
        <p className="asset-validation-status" role="status">
          プロジェクトの visual binding を保存しました（更新番号 {draftRevision}
          ）。
        </p>
      ) : null}
      {failedAssetPaths.length > 0 ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>素材の読み込みに失敗しました</h2>
          <ul>
            {failedAssetPaths.map((path) => (
              <li key={path}>
                <code>{path}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section
        className="character-binding-list"
        aria-label="プロジェクトの話者 binding"
      >
        {project.characters.map((character) => {
          const binding =
            currentDraft[character.id] ?? character.characterVisual;
          const visual =
            binding.visualId === null
              ? undefined
              : catalog.find(
                  (candidate) => candidate.visualId === binding.visualId
                );
          const selectedVariant = visual?.variants.find(
            (variant) => variant.variantId === binding.idleVariantId
          );
          const currentVisualMissing =
            binding.visualId !== null && visual === undefined;
          const currentVariantMissing =
            binding.idleVariantId !== null && selectedVariant === undefined;
          const selectableVariants = visual?.variants ?? [];

          return (
            <section className="character-binding-card" key={character.id}>
              <header className="character-card-header">
                <div>
                  <p className="eyebrow">
                    {characterRoleLabel(character.role)}
                  </p>
                  <h2>{character.name}</h2>
                </div>
                <span className="character-id">
                  {character.voicevox.speakerName}
                </span>
              </header>
              <p>
                VOICEVOX speaker:{" "}
                <code>{character.voicevox.speakerUuid ?? "未固定UUID"}</code> ·
                style: {character.voicevox.styleName}
              </p>
              <div className="character-binding-fields">
                <div className="form-field">
                  <label htmlFor={`${character.id}-visual`}>visual set</label>
                  <select
                    id={`${character.id}-visual`}
                    value={binding.visualId ?? ""}
                    onChange={(event) =>
                      updateBinding(character.id, {
                        visualId:
                          event.target.value.length === 0
                            ? null
                            : event.target.value,
                        idleVariantId: null
                      })
                    }
                  >
                    <option value="">未設定</option>
                    {currentVisualMissing ? (
                      <option value={binding.visualId ?? ""}>
                        {binding.visualId}（snapshotにありません）
                      </option>
                    ) : null}
                    {catalog.map((candidate) => (
                      <option
                        key={candidate.visualId}
                        value={candidate.visualId}
                        disabled={candidate.status !== "active"}
                      >
                        {candidate.name} · {candidate.visualId}（
                        {candidate.status}）
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-field">
                  <label htmlFor={`${character.id}-idle`}>idle variant</label>
                  <select
                    id={`${character.id}-idle`}
                    value={binding.idleVariantId ?? ""}
                    disabled={
                      visual === undefined || visual.status !== "active"
                    }
                    onChange={(event) =>
                      updateBinding(character.id, {
                        ...binding,
                        idleVariantId:
                          event.target.value.length === 0
                            ? null
                            : event.target.value
                      })
                    }
                  >
                    <option value="">未設定</option>
                    {currentVariantMissing ? (
                      <option value={binding.idleVariantId ?? ""}>
                        {binding.idleVariantId}（snapshotにありません）
                      </option>
                    ) : null}
                    {selectableVariants.map((variant) => (
                      <option
                        key={variant.variantId}
                        value={variant.variantId}
                        disabled={variant.status !== "active"}
                      >
                        {variant.label} · {variant.variantId}（{variant.status}
                        ）
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="character-binding-status">
                <span className="eyebrow">現在の binding</span>
                <BindingStatus
                  binding={binding}
                  visual={visual}
                  variant={selectedVariant}
                />
              </div>
              {visual !== undefined ? (
                <p className="status-message">
                  選択中 visual: {visual.name}（{visual.visualId}）
                </p>
              ) : null}
            </section>
          );
        })}
      </section>

      <section aria-labelledby="catalog-snapshot-title">
        <header className="page-section-header">
          <div>
            <p className="eyebrow">参照専用</p>
            <h2 id="catalog-snapshot-title">現在のSQLiteカタログ snapshot</h2>
          </div>
          <p className="status-message">
            {catalog.length} visual set · inactiveも含めて現在値を表示
          </p>
        </header>
        <div className="character-card-grid">
          {catalog.map((visual) => (
            <CatalogVisualCard
              key={visual.visualId}
              visual={visual}
              onError={failedAsset}
            />
          ))}
        </div>
      </section>
    </main>
  );
}
