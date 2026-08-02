# subdub

P0-01の初期構成です。Vite + React SPAとFastify APIを、単一の`package.json`を持つTypeScriptプロジェクトとして分離しています。

## 前提

- Node.js `24.18.0`
- pnpm `11.17.0`

`.node-version`と`package.json`の`engines`に対応バージョンを固定しています。Corepackを使う場合は、Node.jsを用意したあとに次を実行してください。

```text
corepack enable
corepack install --global pnpm@11.17.0
node --version
pnpm --version
```

## セットアップ

リポジトリのルートで依存を導入します。

```text
pnpm install --frozen-lockfile
```

## 共通コマンド

| コマンド | 役割 |
| --- | --- |
| `pnpm dev` | ViteとFastifyを別プロセスで起動 |
| `pnpm dev:web` | Vite dev serverだけを起動 |
| `pnpm dev:api` | Fastifyだけを開発モードで起動 |
| `pnpm typecheck` | WebUI、API、テストの型検査 |
| `pnpm test` | Vitestを一回実行 |
| `pnpm test:watch` | Vitestをwatch modeで起動 |
| `pnpm build` | WebUIとAPIの製品用成果物を`dist/`へ生成 |
| `pnpm start` | ビルド済みSPAとAPIをFastifyから起動 |
| `pnpm verify` | `typecheck`、`test`、`build`を順番に実行 |

`pnpm dev`はNode.jsの起動スクリプトで2つの子プロセスを管理するため、Windowsでもシェル固有のバックグラウンド構文に依存しません。Ctrl+Cまたは片方の異常終了時には、もう一方のプロセスも停止します。

## 開発時の確認

```text
pnpm dev
```

- WebUI: <http://127.0.0.1:5173/>
- Fastify API: <http://127.0.0.1:3000/api/health>

Viteは`127.0.0.1:5173`でWebUIを配信し、`/api`へのリクエストを`http://127.0.0.1:3000`へproxyします。WebUIの最小画面には`/api/health`の正常・失敗状態が表示されます。

Fastifyは常に`127.0.0.1`だけでlistenします。`0.0.0.0`、LAN IP、外部公開用のfallbackは使用しません。

## 製品起動時の確認

```text
pnpm build
pnpm start
```

`pnpm build`は`pnpm dev`を別シェルで実行中でも実行できます。ただし`pnpm dev`のFastifyと`pnpm start`はどちらも`127.0.0.1:3000`を使用するため、製品起動前に開発用シェルで`Ctrl+C`を押して`pnpm dev`を停止してください。`pnpm start`はサーバーを待ち受け続け、正常時はプロンプトに戻りません。

製品起動ではFastifyが`dist/web`のVite成果物と`/api`を同一originで配信します。

- SPA: <http://127.0.0.1:3000/>
- API: <http://127.0.0.1:3000/api/health>

## CI

`.github/workflows/ci.yml`はNode.js `24.18.0`とpnpm `11.17.0`を使用し、依存導入、`pnpm verify`、開発サーバーのWebUI/API確認、製品サーバーのSPA/API確認を実行します。

## ディレクトリ境界

現在実装があるのは`src/web/`、`src/api/`、`scripts/`です。後続Issueでは、責務を次の境界へ追加します。

- `src/schema/`: 共有スキーマ
- `src/app/`: アプリケーション層
- `src/db/`: SQLiteとrepository
- `src/timeline/`: タイムライン処理
- `src/voicevox/`: VOICEVOX連携
- `src/openrouter/`: OpenRouter連携
- `src/compositions/`: Remotion composition
- `src/components/`: WebUI部品
- `src/thumbnail/`: サムネイル処理
- `public/shared-assets/characters/`: 後続Issueのキャラクター素材

P0-01の範囲には、業務スキーマ、保存処理、DB、外部サービス、動画機能、認証、業務画面、E2Eテストを含めていません。`dist/`、`coverage/`、`node_modules/`、環境変数ファイルはGit管理対象外です。
