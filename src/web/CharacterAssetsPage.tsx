import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import {
  ApiClientError,
  ApiClientProtocolError,
  fetchProject
} from "./lib/api-client";
import {
  characterAssetUrl,
  toCharacterAssetViewModels,
  type CharacterAssetVariantView
} from "./character-assets-view";

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

function AssetImage({
  alt,
  assetPath,
  onError
}: {
  readonly alt: string;
  readonly assetPath: string;
  readonly onError: (assetPath: string) => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="character-asset-error" role="img" aria-label={alt}>
        <strong>素材を読み込めません</strong>
        <code>{assetPath}</code>
      </div>
    );
  }

  return (
    <img
      alt={alt}
      className="character-asset-image"
      src={characterAssetUrl(assetPath)}
      onError={() => {
        setFailed(true);
        onError(assetPath);
      }}
    />
  );
}

function VariantPreview({
  variant,
  characterName,
  onError
}: {
  readonly variant: CharacterAssetVariantView;
  readonly characterName: string;
  readonly onError: (assetPath: string) => void;
}) {
  const fileSlots =
    variant.renderType === "single-image"
      ? [{ key: "single", label: "素材" }]
      : [
          { key: "closed", label: "口閉じ" },
          { key: "open", label: "口開き" }
        ];

  return (
    <article className="character-pose-card">
      <div className="character-pose-card-header">
        <h3>{variant.label}</h3>
        <code>{variant.variantId}</code>
      </div>
      <div
        className={
          variant.renderType === "mouth-pair"
            ? "character-mouth-grid"
            : undefined
        }
      >
        {fileSlots.map((slot) => {
          const file = variant.files.find(
            (candidate) => candidate.key === slot.key
          );
          return (
            <figure key={slot.key}>
              {file === undefined ? (
                <div
                  className="character-asset-error"
                  role="img"
                  aria-label={`${characterName}の${variant.label}・${slot.label}が未登録`}
                >
                  <strong>素材が未登録です</strong>
                  <code>
                    {variant.variantId}/{slot.key}
                  </code>
                </div>
              ) : (
                <AssetImage
                  alt={`${characterName}の${variant.label}・${slot.label}`}
                  assetPath={file.path}
                  onError={onError}
                />
              )}
              <figcaption>{slot.label}</figcaption>
              <code>{file?.path ?? "未登録"}</code>
            </figure>
          );
        })}
      </div>
    </article>
  );
}

function CharacterCard({
  character,
  onError
}: {
  readonly character: ReturnType<typeof toCharacterAssetViewModels>[number];
  readonly onError: (assetPath: string) => void;
}) {
  return (
    <section
      className="character-card"
      aria-labelledby={`${character.id}-title`}
    >
      <header className="character-card-header">
        <div>
          <p className="eyebrow">{characterRoleLabel(character.role)}</p>
          <h2 id={`${character.id}-title`}>{character.name}</h2>
        </div>
        <span className="character-id">{character.id}</span>
      </header>
      <dl className="character-details">
        <div>
          <dt>読み上げ話者（VOICEVOX）</dt>
          <dd>{character.speakerName}</dd>
        </div>
        <div>
          <dt>スタイル</dt>
          <dd>{character.styleName}</dd>
        </div>
      </dl>
      <p className="character-pose-summary">
        利用できる素材の種類:{" "}
        {character.availableVariants.map((variant) => variant.label).join("、")}
      </p>
      <div className="character-pose-list">
        {character.availableVariants.map((variant) => (
          <VariantPreview
            key={variant.variantId}
            variant={variant}
            characterName={character.name}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

export function CharacterAssetsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [failedAssetPaths, setFailedAssetPaths] = useState<string[]>([]);
  const projectQuery = useQuery({
    queryKey: ["projects", projectId],
    queryFn: () => fetchProject(projectId ?? ""),
    enabled: projectId !== undefined,
    retry: false
  });

  if (projectId === undefined) {
    return <Navigate replace to="/projects" />;
  }

  if (projectQuery.isPending) {
    return (
      <main className="page-shell narrow-shell">
        <p className="status-message" role="status">
          プロジェクトを読み込んでいます…
        </p>
      </main>
    );
  }

  if (projectQuery.isError || projectQuery.data === undefined) {
    return (
      <main className="page-shell narrow-shell">
        <p className="back-link">
          <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
            企画画面へ戻る
          </Link>
        </p>
        <section className="message-panel message-panel-error" role="alert">
          <h1>キャラクター素材を確認できません</h1>
          <p>{getErrorMessage(projectQuery.error)}</p>
        </section>
      </main>
    );
  }

  const characters = toCharacterAssetViewModels(projectQuery.data);
  const handleAssetError = (assetPath: string): void => {
    setFailedAssetPaths((current) =>
      current.includes(assetPath) ? current : [...current, assetPath]
    );
  };

  return (
    <main className="page-shell character-assets-page">
      <p className="back-link">
        <Link to={`/projects/${encodeURIComponent(projectId)}/brief`}>
          企画画面へ戻る
        </Link>
      </p>
      <header className="page-header page-header-stacked">
        <p className="eyebrow">手順2-1</p>
        <h1>キャラクター素材の確認</h1>
        <p>
          台本で使うキャラクター画像を確認します。素材カタログに登録されている画像だけを表示し、ここではキャラクター設定を編集しません。
        </p>
        <Link
          className="button"
          to={`/projects/${encodeURIComponent(projectId)}/script`}
        >
          台本へ戻る
        </Link>
      </header>

      {failedAssetPaths.length > 0 ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>素材の読み込みに失敗しました</h2>
          <p>次の配置先を確認してください。</p>
          <ul>
            {failedAssetPaths.map((assetPath) => (
              <li key={assetPath}>
                <code>{assetPath}</code>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="asset-validation-status" role="status">
          素材カタログの登録内容を表示しています。画像の読み込み状態を確認しています。
        </p>
      )}

      <div className="character-card-grid">
        {characters.map((character) => (
          <CharacterCard
            key={character.id}
            character={character}
            onError={handleAssetError}
          />
        ))}
      </div>
    </main>
  );
}
