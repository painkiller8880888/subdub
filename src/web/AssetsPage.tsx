import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";

import {
  ApiClientError,
  ApiClientProtocolError,
  searchAssets
} from "./lib/api-client";

function errorMessage(error: unknown): string {
  if (
    error instanceof ApiClientError ||
    error instanceof ApiClientProtocolError
  ) {
    return error.message;
  }
  return "素材一覧を取得できませんでした。";
}

function assetKindLabel(kind: string): string {
  switch (kind) {
    case "video":
      return "動画";
    case "photo":
      return "写真";
    case "document_scan":
      return "帳票スキャン";
    case "sound_effect":
      return "効果音";
    default:
      return kind;
  }
}

export function AssetsPage() {
  const assetsQuery = useQuery({
    queryKey: ["assets", { page: 1, pageSize: 50 }],
    queryFn: () => searchAssets({ page: 1, pageSize: 50 }),
    retry: false
  });

  return (
    <main className="page-shell assets-page">
      <header className="page-header page-header-stacked">
        <p className="eyebrow">ライブラリ</p>
        <h1>素材</h1>
        <p>
          台本のビジュアルや音声で利用する、ワークスペース共通の素材を確認します。
        </p>
      </header>

      {assetsQuery.isPending ? (
        <p className="status-message" role="status">
          素材を読み込んでいます…
        </p>
      ) : assetsQuery.isError ? (
        <section className="message-panel message-panel-error" role="alert">
          <h2>素材一覧を取得できません</h2>
          <p>{errorMessage(assetsQuery.error)}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void assetsQuery.refetch();
            }}
          >
            再読み込み
          </button>
        </section>
      ) : assetsQuery.data.items.length === 0 ? (
        <section className="message-panel" aria-labelledby="assets-empty-title">
          <h2 id="assets-empty-title">登録済みの素材はありません</h2>
          <p>素材登録APIで登録した素材がここに表示されます。</p>
          <Link className="button" to="/character-visuals">
            キャラクタービジュアルを管理する
          </Link>
        </section>
      ) : (
        <section
          className="asset-library-panel"
          aria-labelledby="assets-list-title"
        >
          <div className="asset-library-header">
            <h2 id="assets-list-title">登録済み素材</h2>
            <span>{assetsQuery.data.total} 件</span>
          </div>
          <ul className="asset-library-list">
            {assetsQuery.data.items.map((asset) => (
              <li className="asset-library-item" key={asset.assetId}>
                <div>
                  <h3>{asset.title}</h3>
                  <p>{asset.description || "説明なし"}</p>
                </div>
                <div className="asset-library-meta">
                  <span>{assetKindLabel(asset.kind)}</span>
                  <span>{asset.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
