# Phase 0 完了条件の対応表

Issue #11 の判定は、P0-01 から P0-05 で追加された実装を、外部サービスなしの一時 workspace で結合して確認することを基準にする。新規統合テストは `tests/integration/phase0-smoke.test.ts` の1シナリオである。

## 仕様書22章との対応

| 22章の条件                                                             | コード／証拠                                                                                                                                                                                                                                                                    | 判定                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 空のプロジェクトをZodで生成し、保存・再読込できる                      | `createEmptyVideoProject`、`ProjectRepository.create`、統合テスト `joins workspace setup, project persistence, migrations, and API health`                                                                                                                                      | 充足                                         |
| 不正なJSONで既存ファイルを上書きしない                                 | 既存テスト `distinguishes a missing project and malformed JSON`、`rejects invalid current data and never repairs it`、統合テストのUTF-8・2スペース・末尾改行確認                                                                                                                | 既存テスト＋統合で充足                       |
| revision競合を読み取り、非破壊で失敗する                               | 統合テストの `PROJECT_REVISION_CONFLICT` と競合前後の `project.json` byte 比較、既存テスト `rejects a revision conflict before creating a temporary file`                                                                                                                       | 充足                                         |
| 空DBと既存DBの両方へSQLite migrationを適用する                         | 統合テストの `migrationResult.applied`、`__drizzle_migrations` 履歴、再初期化後の履歴一致。既存の `workspace SQLite` テストも参照                                                                                                                                               | 充足                                         |
| 用語レコードを登録し、決定論的に読み上げ文へ適用する                   | 開発計画ではP2-03／P2-04へ延期。用語DB、CRUD、置換ロジックは本PRに追加していない                                                                                                                                                                                                | 仕様書と計画の不整合。Phase 2へ延期          |
| `VideoProject` と `RenderManifest` の型をUI・API・コンパイラで共有する | `src/web/shared-schema-types.ts` と `src/api/shared-schema-types.ts` が実際の境界型としてbarrelからimportし、`src/timeline/shared-schema-types.ts` は将来compilerのcompile-only consumerとして同じimportを強制。`tests/schema/shared-types.contract.test.ts` が3 consumerを検証 | UI／APIは充足、timeline compiler本体は未実装 |
| JSON Schemaの外部公開生成物を作らない                                  | 正本はTypeScript＋Zod。PR差分に `*.schema.json` を追加していない                                                                                                                                                                                                                | 充足                                         |

用語項目はこのPRで実装済みではない。開発計画ではP2-03／P2-04へ延期されている仕様不整合であり、用語DB・CRUD・置換ロジックを先取りしていない。したがって、この表のP0-06の統合スコープは充足するが、仕様書22章の全項目を文字どおりPhase 0で完了したとは扱わない。

## ゲート

`pnpm verify` は次の順で実行し、途中の失敗を伝播する。

1. `pnpm lint`
2. `pnpm format:check`
3. `pnpm typecheck`
4. `pnpm test`
5. `pnpm build`
6. `pnpm verify:build`

`.github/workflows/ci.yml` はこの `pnpm verify` と既存のdevelopment／production server smokeを継続して実行する。統合テストは `vitest` の `tests/**/*.test.ts` includeにより通常の `pnpm test`、CIのverify、build後の検証で実行される。

## 手動確認

Phase 0の自動確認は一時workspace、実ファイル、実SQLite、Fastify `inject()`で完結する。利用者データ、固定ポート、ネットワーク、OpenRouter、VOICEVOXは使用しない。手動確認が必要な場合は `pnpm verify` の成功後、既存CI smokeと同じくdevelopment／production serverの `/api/health` を確認する。
