import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useParams } from "react-router";
import { ZodError } from "zod";

import {
  ApiClientError,
  ApiClientProtocolError,
  fetchProject
} from "./api/client";
import {
  characterAssetUrl,
  toCharacterAssetViewModels,
  type CharacterAssetPoseView
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

function PosePreview({
  pose,
  characterName,
  onError
}: {
  readonly pose: CharacterAssetPoseView;
  readonly characterName: string;
  readonly onError: (assetPath: string) => void;
}) {
  if (pose.key === "stand") {
    return (
      <article className="character-pose-card">
        <h3>{pose.label}</h3>
        <AssetImage
          alt={`${characterName}の${pose.label}`}
          assetPath={pose.path}
          onError={onError}
        />
        <code>{pose.path}</code>
      </article>
    );
  }

  return (
    <article className="character-pose-card">
      <h3>{pose.label}</h3>
      <div className="character-mouth-grid">
        <figure>
          <AssetImage
            alt={`${characterName}の${pose.label}・口を閉じた状態`}
            assetPath={pose.closed}
            onError={onError}
          />
          <figcaption>口閉じ</figcaption>
          <code>{pose.closed}</code>
        </figure>
        <figure>
          <AssetImage
            alt={`${characterName}の${pose.label}・口を開いた状態`}
            assetPath={pose.open}
            onError={onError}
          />
          <figcaption>口開き</figcaption>
          <code>{pose.open}</code>
        </figure>
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
          <p className="eyebrow">{character.role}</p>
          <h2 id={`${character.id}-title`}>{character.name}</h2>
        </div>
        <span className="character-id">{character.id}</span>
      </header>
      <dl className="character-details">
        <div>
          <dt>VOICEVOX話者</dt>
          <dd>{character.speakerName}</dd>
        </div>
        <div>
          <dt>スタイル</dt>
          <dd>{character.styleName}</dd>
        </div>
      </dl>
      <p className="character-pose-summary">
        利用可能なポーズ:{" "}
        {character.availablePoses.map((pose) => pose.label).join("、")}
      </p>
      <div className="character-pose-list">
        {character.availablePoses.map((pose) => (
          <PosePreview
            key={pose.key}
            pose={pose}
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
        <p className="eyebrow">P2-01</p>
        <h1>キャラクター素材の確認</h1>
        <p>
          実在するポーズと口差分だけを表示しています。ここではキャラクター設定を編集しません。
        </p>
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
          プロジェクトデータの素材参照を読み込みます。画像の読み込み状態を確認しています。
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
