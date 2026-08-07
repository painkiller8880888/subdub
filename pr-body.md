## 変更内容

### 1. ファイルサイズ上限処理の修正 (`src/app/assets/asset-file-store.ts`)

multipart の `fileSize` 上限で stream が truncate された場合、従来は汎用的な `Error("upload truncated by the multipart size limit")` を投げていましたが、公式の `@fastify/multipart` ドキュメントに従い `stream.truncated` をチェックし、確実に `AssetFileTooLargeError` を投げるようにしました。これにより API 側で 413 / `ASSET_FILE_TOO_LARGE` に正しく変換されます。

### 2. API テスト追加 (`tests/api/assets.test.ts`)

`maxGlobalFileBytes: 1024` に制限したサーバーで 2KB ファイルをアップロードし、413 `ASSET_FILE_TOO_LARGE` になることを検証するテストを追加しました。

### 3. dist/ の git 追跡除外

`.gitignore` に既に含まれていた `dist/` を `git rm -r --cached` で追跡から削除しました。これによりソース修正のみのコミットになります。

## テスト結果

全 355 件のテストがパスしています。