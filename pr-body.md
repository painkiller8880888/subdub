## 変更内容

Issue #35（P3-02 メタデータ・チェックサム・サムネイル生成）を実装します。

### 1. メディア処理パイプライン (`src/app/assets/processing/`)

- `types.ts`: `AssetMediaProcessingPort` / `AssetMediaProcessingInput` / `AssetProcessedMedia` を定義。処理を Fastify ハンドラ外に分離し、テストで差し替え可能にしました。
- `video-audio.ts`（mediabunny + @mediabunny/server + @napi-rs/canvas）: 動画・音声の長さと表示解像度を取得し、中央フレーム（`duration/2`）からサムネイルを PNG 生成します。動画の回転情報はサムネイルに反映します。WAV は長さのみ取得しサムネイルは生成しません。
- `photo.ts`（sharp）: EXIF Orientation（5〜8）を考慮した表示解像度を返し、向きを補正したサムネイルを生成します。
- `pdf.ts`（pdfjs-dist legacy + @napi-rs/canvas）: ページ数・1 ページ目の寸法・ページ順のサムネイル（`page-0001.png` …）を生成します。
- `real-media-processing.ts` + `index.ts`: 種類ごとのディスパッチと遅延読み込みファクトリ。起動時はネイティブ依存を読み込まず、初回処理時に `real-media-processing.js` を動的 import します（失敗時は `PROCESSING_INTERNAL_FAILED`）。

### 2. 処理サービスの整合性 (`asset-processing-service.ts` / `asset-repository.ts`)

- ストリーミングで SHA-256 とサイズを計算し、`asset_versions.checksum` / `size_bytes` に保存します。
- サムネイルは `thumbnails-tmp/<uuid>` に一時書き込み → `thumbnails/{assetId}/v{version}/` へ move。move は 1 件成功するたびにロールバック対象へ追加するため、途中失敗時も配置済みファイルを残しません。一時ディレクトリは成功・失敗・スキップを問わず最後に削除します。
- 成功時はバージョン更新後に `status='processing'` ガード付きで `active` へ遷移します。ガードが競合に負けた場合（別プロセスが先に `active` 化）はトランザクションを rollback してバージョン更新を破棄し、勝者のファイルを削除しません。
- 同一 `assetId:version` の同時処理はサービス内の per-key ミューテックスで直列化します。これにより単一プロセスでのファイル公開（stat → rename）と DB 更新の競合窓を閉じます。
- 失敗時は `status = 'error'` に遷移し、安定した `error_code`（`PROCESSING_MEDIA_NOT_FOUND` / `PROCESSING_METADATA_FAILED` / `PROCESSING_MEDIA_CORRUPTED` / `PROCESSING_THUMBNAIL_FAILED` / `PROCESSING_DATABASE_FAILED` / `PROCESSING_INTERNAL_FAILED`）と日本語メッセージを保存します。元のメディアは削除しません。
- `processing` 素材を対象に 5 秒間隔でポーリングするワーカー (`asset-processing-worker.ts`) をサーバ起動時に開始し、`onClose` で停止します。停止は AbortSignal により即座に反映されます。

### 3. API (`src/api/routes/assets.ts` / `src/schema/api.ts`)

- `GET /api/assets/:assetId` を追加。詳細（メタデータ・サムネイル相対パス・`errorCode`/`errorMessage`・`status`）を厳密な Zod スキーマで返します。未知の ID は 404 `ASSET_NOT_FOUND`。

### 4. 依存関係

- 追加: `mediabunny` / `@mediabunny/server`（動画・音声メタデータ）、`sharp`（画像）、`pdfjs-dist`（PDF）、`@napi-rs/canvas`（PDF/動画の PNG 描画）。すべて exact-pinned。
- `pnpm-workspace.yaml` の `allowBuilds` に `node-av: true` を追加（@mediabunny/server のネイティブビルド許可）。
- Remotion のバージョンは変更していません。

### 5. ルール

- 追加のみのマイグレーション（`size_bytes` / `error_code` / `error_message`）。既存列・意味を変更しません。
- DB / API にスタックトレース・OS 絶対パス・入力ファイルの内容は含めません。
- サムネイルは PNG・長辺 480px 上限・拡大なし。
- テストはネットワーク・グローバルバイナリ（FFmpeg/Poppler/ImageMagick）不要。実バイナリフィクスチャをリポジトリにコミット済みです。

## 状態遷移

- `processing` → `active`: メタデータ・チェックサム取得とサムネイル配置がすべて成功し、`status='processing'` ガード付きコミットが成立した場合。
- `processing` → `error`: いずれかの工程が失敗した場合。`error_code` / `error_message` を保存し、配置済みサムネイルは削除・一時ファイルは後始末します。

## マイグレーション

`src/db/migrations/0003_asset-processing-metadata.sql`（追加のみ、冪等テスト済み）:

- `asset_versions` に `size_bytes` を追加。
- `assets` に `error_code` / `error_message` を追加。

## 完了条件への対応

完了条件「処理に失敗した素材が検索候補へ出ず、理由を診断できる」: 失敗素材は `status='error'` に遷移し、`GET /api/assets/:assetId` で `errorCode` / `errorMessage` から診断できます。

## テスト結果

- `pnpm typecheck`: パス
- `pnpm lint`: パス
- `pnpm format:check`: パス
- `pnpm test`: 51 ファイル / 382 テスト パス（追加: 実メディア処理 5、処理サービス 12、ワーカー 6、API GET 詳細 3、0003 マイグレーション冪等性）
- `pnpm build`: パス
- `pnpm verify:build`: パス（マイグレーション履歴 4 件で再初期化一致）
- `pnpm verify:character-assets`: パス
- `pnpm verify`: exit 0

## 未検証

- 実サーバー上でのエンドツーエンド実行（ローテート動画 / 大量ページ PDF / 破損メディアの実運用挙動）。
- 複数プロセスが同一素材を同時処理するケース。このローカル単一ユーザー MVP はワーカーを 1 プロセス 1 インスタンスで運用するため対象外とします。競合時の DB 整合性（ガード失敗 → rollback、敗者は勝者のファイルを削除しない）は保証していますが、ファイル公開側の `rename` はプロセス間で原子性を保証しません。

## リスク

- ネイティブ依存（@mediabunny/server / sharp / pdfjs）の導入により、CI のビルド環境でネイティブビルドが必要になります（`node-av: true` で許可済み）。
- Windows では sqlite の一時ファイル `unlink` が EBUSY になるケースがあり、検証スクリプトでクローズ順序を明示しています。

Closes #35
