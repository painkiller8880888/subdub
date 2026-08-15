# Remotion 社内マニュアル動画制作システム 実装仕様書

文書版: 0.3
作成日: 2026-07-28  
更新日: 2026-08-15<br>
上位仕様: [`doc.md`](./doc.md)

現在の正本は `doc/doc.md` と本書の 2 文書に固定する。要求、目的、機能、ユーザー体験は `doc/doc.md` を優先し、データモデル、API、保存、validation、アーキテクチャ、実装詳細は本書を正本とする。実装詳細が要求と矛盾する場合は、本書を更新して `doc/doc.md` と整合させる。`doc/legacy/` 配下は履歴資料であり、新規実装の仕様根拠または実装順序の根拠には使用しない。legacy 文書と現在の正本が矛盾する場合は、現在の正本を採用する。

本書は MVP 完了後の現行実装仕様を記述する。本文中の MVP は完了済みの現行ベースラインまたは、その範囲に対する将来拡張を指し、未実装の施工計画を意味しない。

## 1. 目的

本書は `doc.md` の方針を、実装担当者がモジュール、データ型、API、保存処理、検証、テストへ落とし込める粒度まで具体化するための文書である。

本書では次の状態を区別する。

- **確定**: 現時点で実装仕様として採用する。
- **TBD**: 判断材料または利用素材が不足しており、値や挙動を確定しない。
- **現在対象外・将来拡張**: 拡張点は確保するが、現行仕様では実装しない。

`doc.md` と本書が矛盾する場合は、要求と目的については `doc.md` を優先し、実装の具体的詳細については本書を正本として更新し、両者を整合させる。

### 1.1 Issue #87 による台本工程の更新

Issue #87 以降、`/projects/{projectId}/script` を台本・ビジュアル・音声の一体型台本画面とし、3 つのデータを引き続き同じ `project.json` に保存する。台本工程中の承認操作を後工程の開始条件にはしない。

- `outline.status === "approved"` かつ `outline.sourceHash === source.sha256` であることは、台本の初期化と現在の制作コンテキストの前提として維持する。この文書の対象範囲では、構成案の承認が唯一の明示的な工程境界である。
- `script/approve` と `visuals/approve` は新しい通常台本フローから外す。既存データ、旧クライアント、レビュー履歴との互換性のため API や `approved` status を残す場合でも、台本画面、音声操作、候補利用、素材割り当て、`RenderManifest` 生成の前提に使用しない。
- `Script.status` と `VisualPlan.status` の `draft`、`needs_review`、`approved` は、互換性、レビュー結果、stale、再生成要否の表示に使える。ただし `approved` は出力可能を意味せず、`draft` や `needs_review` だけを理由に編集や候補利用を拒否しない。
- プレビュー、`RenderManifest` 生成、MP4 レンダリングのゲートは、保存済み正本に対する validation とする。Zod、台本構造、話者・発話、`outlineHash`、音声の current/stale/missing、ビジュアル参照・適用範囲・checksum、revision、Manifest の整合性を機械検証し、失敗時は該当する操作だけを無効化して理由を表示する。
- revision 管理、自動保存、expected revision による競合拒否、安全な一時ファイル保存、生成物の stale 保持は変更しない。

### 1.2 Issue #97 / CV-04 による現在仕様の更新

Issue #97 を本書の正本となる設計判断として扱い、キャラクタービジュアルの標準選択経路を人間の明示選択へ変更した。この方針は CV-05（Issue #98）で実装済みである。`/projects/{projectId}/script` はセクションとセリフカードを中心とする 1 ペイン構成とし、現在の右ペインにあった「現在の編集対象」「制作 ビジュアル候補」「AI によるビジュアル候補 UI」「手順3-3 素材検索」「素材検索結果」「素材制作・表示設定カード」は標準台本画面に置かない。

除去するのは制作画面の主要 UI であり、機能・データの削除ではない。AI visual suggestion の backend、visual suggestion API / service / schema / log、現場動画・写真・帳票用 Asset Search、generic `VisualAssignment` と Asset Service は維持する。これらはキャラクタービジュアルの標準選択経路とは別の補助機能・別ドメインとして扱う。

`CharacterVisualSet` の登録済み visual / variant / file metadata の正本は workspace SQLite に置く。一方、プロジェクトで VOICEVOX 話者へどの visual を割り当て、どの idle variant を使うか、各 line でどの physical variant を選んだかは project-specific な `project.json` の正本に保存する。SQLite に project ID や `mentor` / `learner` の紐づけを追加せず、`visualId === characterId` も前提にしない。

CV-04 はこの3文書の更新だけを行い、schema、schema version bump、migration、API、React UI、`ScriptPage`、`CharacterAssetsPage`、compiler、RenderManifest、Remotion の変更は CV-05（Issue #98）で実装済みである。

### 1.3 Issue #107 / ED-00 による編集フェーズの追加

ED-00 は docs-only の仕様改訂であり、この Issue の作業ではコード、Zod schema、migration、API、React UI、compiler、Remotion を変更しない。次期の実装対象は、`VideoProject 1.2.0` の `EditPlan` と `RenderManifest 2.3.0` を中心とする独立した編集フェーズである。

ワークフローは次の順序とする。

```text
企画
  → 構成案
  → 台本（/projects/{projectId}/script）
  → 編集（/projects/{projectId}/edit）
  → 出力 validation
  → RenderManifest
  → プレビュー / MP4
```

現行 checkout のコードは ED-00 の文書変更だけでは version bump されない。ED-01 が明示的な migration を実装するまで、既存の `VideoProject 1.1.0` / `RenderManifest 2.2.0` を実装済み状態として扱い、以下の `1.2.0` / `2.3.0` は後続実装で採用する正本仕様として読む。

- 編集素材は workspace SQLite に登録済みで、選択・差し替え時点に `active` な Asset だけを使用する。
- intro / outro / cutin は MP4 の `video` Asset、BGM は MP3 の `bgm` Asset に限定する。
- project data には Asset 本体の `version` / `checksum` を `assetVersion` / `assetChecksum` として、`assetId`、`projectMediaPath` とともに snapshot 固定する。OS path や任意ファイルを保存しない。
- snapshot 作成後の Asset の差し替え・利用停止は既存 project の出力エラーにしない。出力時は project 内 `projectMediaPath` の存在、`assetChecksum`、MP4 / MP3 の実ファイル形式だけを検証し、live な Asset `status` や Asset Service の SQLite を必須入力にしない。
- 動画と BGM は `0 <= volume <= 1` を持つ。generic `VideoDisplay.muted` の `true → 0`、`false → 1` 変換は ED-01 の `1.1.0 → 1.2.0` schema migration が担当し、ED-07 は変換後の `volume` の UI / API / compiler / Remotion 対応だけを担当する。

## 2. 今回確定した判断

### 2.1 JSON の編集経路

- `projects/{projectId}/project.json` を動画制作データの正本とする。
- 通常の作成、編集、並べ替え、承認は WebUI から行う。
- WebUI は JSON を直接ブラウザーで編集する画面ではなく、用途別フォームを通じて編集する。
- バックエンドは全変更を Zod で検証してから保存する。
- 障害調査、移行、復旧用の CLI は将来追加できるが、通常運用の編集経路にはしない。
- 人間によるファイルの直接編集はサポート対象外とする。直接編集されたファイルも読み込み時に検証し、不正な場合は上書きせずエラーにする。

### 2.2 JSON Schema の扱い

- TypeScript 型と Zod スキーマをコード上の正本とする。
- JSON Schema を外部向けファイルとして公開しない。
- OpenRouter の structured output に必要な JSON Schema は、サーバー内部で生成または定義してリクエストへ埋め込む。
- JSON Schema の配布、互換性保証、外部利用者向けドキュメントは作らない。
- `VideoProject` と `RenderManifest` は別の Zod スキーマとして管理する。

### 2.3 VOICEVOX

- VOICEVOX ENGINE はローカル HTTP API として使用する。
- 使用する VOICEVOX キャラクターは四国めたんとずんだもんで確定する。
- メンターへ四国めたん、見習いへずんだもんを割り当てる。
- 両キャラクターの既定音声は標準スタイルの `ノーマル` とする。
- `project.json` には話者名、ENGINE から取得した話者 UUID、スタイル名を保存し、数値の style ID は正本データとして保存しない。
- 音声生成時は VOICEVOX ENGINE の `/speakers` を読み込み、話者 UUID または話者名とスタイル名から style ID を解決する。style ID をソースコード、fixture、初期 JSON へハードコードしない。
- `/speakers` に対象話者または `ノーマル` が存在しない場合は自動的に別スタイルへ切り替えず、音声操作を停止して解決エラーを表示する。
- 実行時に解決した style ID は、再現性確認のため音声調整ファイル、音声インデックス、実行ログへ記録する。
- VOICEVOX が返した未編集の `audio_query` は再生成可能な派生キャッシュとして扱う。
- 人間が確定したイントネーション調整は、セリフ単位の独立 JSON を正本として永続化する。`project.json` と query キャッシュには含めない。
- 固有名詞 DB は共通の読みを管理し、文脈依存のアクセント・モーラ調整はセリフ単位の調整 JSON で管理する。

### 2.4 固有名詞・社内用語

- 固有名詞・社内用語はワークスペース共通 SQLite に保存する。
- WebUI に一覧、検索、登録、編集、利用停止の機能を用意する。
- 読みは全角カタカナで管理する。
- イントネーション情報は今回のテーブルへ含めない。
- 読み上げ時には、有効な用語を決定論的な規則で一時的に適用する。`project.json` の字幕本文と読み上げ本文を暗黙に書き換えない。

### 2.5 AI モデル

- WebUI、OpenCode、レビュー、その他プロジェクト内外の AI 用途は、現行仕様では Gemma 4 31B Instruct を共通モデルとする。
- OpenRouter の初期モデル ID は `google/gemma-4-31b-it` とする。
- `:free` variant は既定にせず、人間がモデル選択画面から明示的に選択した場合だけ使用する。
- モデル選択画面では、入力単価と出力単価がともに `0` のモデルを `free`、それ以外を `paid` として絞り込める。これは表示上のフィルターであり、サーバーは選択されたモデル ID を既存の能力、有効期限、ZDR 条件で検証する。
- AI 呼び出しは用途を `AiTaskKind` で識別するが、現行の用途別上書きは空とし、すべて共通モデルへ解決する。
- 用途別モデルへの分離は将来の評価事項とする。各機能の実装前に別モデルを決める必要はない。
- 用途別の評価では、スキーマ検証通過率、人間による修正量、根拠のない情報を追加した回数、応答時間、入出力トークン数と料金、画像入力またはツール利用の必要性を記録する。
- モデルの差し替えに生成ロジックの変更を必要としない構造にする。
- モデル ID を生成ロジックへハードコードしない。
- モデル未選択の場合、AI を使う操作だけを実行不可にする。非 AI の編集、素材管理、音声生成、プレビュー、レンダリングは利用可能とする。
- 実行ごとに選択されたモデル ID、プロバイダー、プライバシー設定、用途別評価に必要な計測値を実行ログへ記録する。

### 2.6 その他の推奨案

`doc.md` の「推奨案」は、本書で明示的に変更した事項と競合しない限り採用する。

### 2.7 キャラクター素材の責務分離

キャラクター素材に関するデータは、次の 4 層を混同しない。

| データ | 正本または性質 | 現在の扱い |
|---|---|---|
| `projects/{projectId}/project.json` | 人間が編集する動画制作データの正本。構成案の承認と、台本・ビジュアル・音声のレビュー状態、編集フェーズの `EditPlan` もここに保持する | ED-01 の次期保存形式は `VideoProject 1.2.0`。`schemaVersion: "1.0.0"` は legacy input boundary、`1.1.0` は編集移行前の互換入力として厳密に検証し、明示的 migration で `1.2.0` へ変換する |
| `CharacterVisualSet` | ワークスペース共通の登録済みキャラクタービジュアルと variant/file メタデータの正本 | workspace SQLite の現行カタログ。P2-01 の初期 2 キャラクター、6 variant、10 PNG は idempotent seed / migration の入力として扱い、静的カタログを現行の正本にしない |
| `CharacterVisualBinding` | `project.json` に保存する、プロジェクト内の VOICEVOX 話者と visual / idle variant の選択 | ED-01 の `VideoProject 1.2.0` へ引き継ぐ project-specific な保存データ。SQLite に project binding は持たせない |
| `ScriptLine.characterVariantId` | `project.json` に保存する、line ごとの人間が選択した physical variant 参照 | ED-01 の `VideoProject 1.2.0` へ引き継ぐ explicit reference。新規 line は未選択から開始する |
| `characterVariantCatalog` | `CharacterVisualSet` から生成する型、検証入力、または純粋な catalog snapshot | DB から取得した検証済み snapshot または純粋な view model。実在項目を静的ソースへ二重管理しない |
| `RenderManifest` | 特定レンダリングへ使う解決済み派生データ | ED-08 の次期 `RenderManifest 2.3.0`。`characters`、`characterVariants`、line ごとの `characterVariantId`、実動画 insert、最終 section BGM など、explicit reference から解決した情報を保持する |

`CharacterVisualSet` と配下の物理 variant は別エンティティとして扱う。visual 全体は一部の表情・ポーズ variant が未登録でも登録できるが、`single-image` は `single`、`mouth-pair` は `closed` と `open` が揃った場合だけ完成 variant とする。最初の完成 variant のキャンバスサイズを visual 単位の基準とし、同じ visual へ異なるサイズの画像を追加しない。

登録時点で `CharacterVisualSet` を `mentor` / `learner` の役割や特定プロジェクトへ紐付けない。同一キャラクターの別衣装、将来の別キャラクター、差し替え候補をワークスペース共通カタログとして保持する。`VideoProject.characters[].role` は既存の制作・音声設定の概念であり、登録画面の固定条件ではない。

PNG は `CharacterVisualSet` の file slot から参照されるファイル実体であり、PNG 自体、`project.json`、または `RenderManifest` がメタデータの正本になることはない。ファイル本体は `library/character-visuals/{visualId}/{variantId}/` 以下へ保存し、`public/` へ直接保存しない。画像表示は Fastify の管理された配信経路を使用する。WebUI、コンパイラ、Remotion は SQLite やローカルファイルシステムを直接操作せず、バックエンドが検証して渡した snapshot または解決済み `RenderManifest` だけを使用する。

`ScriptLine.expression` と `RenderLine.expression` は論理表情であり、PNG、物理ポーズ、`variantId`、口差分を直接指定する値ではない。physical variant は `CharacterVisualBinding` と `ScriptLine.characterVariantId` へ人間が明示的に保存する。P5-02 / P5-04 はこの参照と検証済み catalog snapshot を使い、expression、tag、label、旧固定 mapping から自動選択・代替しない。

## 3. 現在サポートする範囲

### 3.1 現在サポートする範囲

1. ローカル単一ユーザー向け WebUI
2. プロジェクトの作成、一覧、読み込み
3. Markdown と企画条件の編集、自動保存
4. OpenRouter による構成案生成、編集、承認
5. 2 キャラクター形式の台本編集と、ビジュアル・音声を含む一体型の台本画面
6. P2-01 の初期 2 キャラクター設定と、CV-01〜CV-03 で追加済みの `CharacterVisualSet` の動的カタログ、PNG 検証、登録・確認画面
7. プロジェクトごとの VOICEVOX ↔ `CharacterVisualSet` binding、待機用 idle variant、セリフごとの explicit physical variant 選択
8. セクション・セリフカード中心の 1 ペイン `/projects/{projectId}/script` と、speaker に binding された active variant だけを表示する modal picker
9. `/projects/{projectId}/characters` による project binding と現在の `CharacterVisualCatalogSnapshot` の確認
10. 固有名詞・社内用語の登録、検索、読み上げへの適用
11. 素材ライブラリへの動画、写真、帳票スキャン、効果音の登録
12. タグ検索および AI による検索意図の生成
13. 台本範囲への generic `VisualAssignment` 割り当て
14. VOICEVOX によるセリフ単位の WAV 生成、セクション BGM、任意の効果音設定
15. `RenderManifest` の生成
16. Remotion による同一マニフェストのプレビューと MP4 出力
17. サムネイルのプレビューと画像出力
18. 機械検証、互換 status・レビュー結果・stale 状態、意味のある操作のログ（出力ゲートは validation）

`EditPlan`、`bgm` Asset、`/projects/{projectId}/edit`、`RenderManifest 2.3.0` は ED-00 で次期仕様として確定した項目であり、ED-01〜ED-09 の実装完了前に現行コードがサポート済みであることを示さない。

### 3.2 現在対象外・将来拡張

- 複数ユーザー、ログイン、権限管理
- 外部公開および配布用パッケージ
- AI による完成映像、スライド、図解、素材の生成
- AI による台本初稿生成
- ベクトル検索
- OCR、音声文字起こし
- VOICEVOX のイントネーション編集 UI
- 音量解析に基づく口パク
- 任意座標によるキャラクター配置
- JSON Schema の外部公開
- AI による physical character variant の自動選択、タグ・label・expression による代替
- AI visual suggestion、Asset Search、generic `VisualAssignment` backend の削除
- 口パク方式の変更、VOICEVOX 話者設定の変更
- 現場動画・写真・帳票素材ライブラリとの統合

## 4. アーキテクチャ

### 4.1 コンポーネント

```text
Shared TypeScript Modules
  └─ Character Visual Types / Catalog Snapshot
       ├─ CharacterVisualSet view model
       ├─ Character Visual Validation (Node)
       └─ Resolved compiler input types

WebUI
  │
  ▼
Local Backend API
  ├─ Project Service ───── projects/{projectId}/project.json
  ├─ Character Visual Service ─ library/character-visuals + SQLite
  ├─ Asset Service ─────── library/media + SQLite
  ├─ Terminology Service ─ SQLite
  ├─ OpenRouter Adapter ── OpenRouter API
  ├─ VOICEVOX Adapter ──── Local VOICEVOX ENGINE
  ├─ Timeline Compiler ─── RenderManifest
  ├─ Validation Service
  └─ Render Service ────── Remotion / FFmpeg

Build / CI
  └─ Character Asset Validation (Node)
```

`CharacterVisualSet` はバックエンドの Character Visual Service が SQLite と `library/character-visuals/` を管理する。`characterVariantCatalog` は DB レコードを検証済み snapshot として受け渡すための TypeScript 型または純粋な view model であり、一覧の静的正本ではない。WebUI は API から取得した `CharacterVisualSet` を使って `/character-visuals` を表示し、ビルド時に実在項目を取り込まない。PNG の形式、slot、checksum、visual 基準キャンバスを検査するのはバックエンドと Node/CI の責務である。

WebUI はプロジェクト保存、SQLite、キャラクターファイル、ローカルファイルシステム、外部 API を直接操作しない。キャラクタービジュアルの読み書きは Character Visual Service の API を経由し、画像は Fastify の管理された配信経路から取得する。キャラクタービジュアルは現場素材の `Asset Service ─ SQLite` と別エンティティ・別責務だが、同じ workspace SQLite と管理ルートを共有してよい。

### 4.2 依存方向

- UI は API 契約と共有型へ依存する。
- API ハンドラーはアプリケーションサービスへ処理を委譲する。
- アプリケーションサービスはドメインスキーマ、リポジトリ、外部アダプターへ依存する。
- ドメインスキーマとタイムライン計算は React、Web フレームワーク、SQLite ドライバーへ依存させない。
- Character Visual Service は `CharacterVisualSet`、variant、file slot、checksum、canvas metadata、status、created/updated timestamps を workspace SQLite で管理する。P2-01 の静的 catalog は CV-01 の idempotent seed / migration の入力としてのみ扱う。
- キャラクター素材検証は snapshot と管理領域の PNG を入力として slot、形式、checksum、visual 単位のキャンバス基準を検査する専用処理とし、現場素材の汎用 Asset DB と責務を分離する。
- WebUI の一覧、タイムラインコンパイラ、Remotion は Character Visual Service の DB を直接参照しない。コンパイラへ渡すのはバックエンドが選択・検証した解決済み snapshot だけとする。
- Remotion コンポーネントは `RenderManifest` だけを描画入力とし、SQLite 検索、ファイル探索、音声長計測を行わない。

### 4.3 採用ランタイム

- Node.js 24 LTS
- pnpm
- TypeScript strict mode
- React
- Remotion
- Zod
- SQLite

具体的な WebUI フレームワーク、HTTP ルーター、SQLite ドライバー、テストランナー、および初期バージョンは 4.4 のとおり確定する。

### 4.4 確定した技術選定

以下を現行実装の構成として採用する。

#### WebUI とローカルサーバー

- WebUI: React SPA + Vite
- 画面ルーティング: React Router の library mode
- サーバー状態: TanStack Query
- HTTP API: Fastify
- 開発時:
  - Vite dev server が WebUI を配信する。
  - `/api` を Fastify の loopback address へ proxy する。
- 製品実行時:
  - Vite が WebUI を静的ファイルへビルドする。
  - Fastify が同一 origin で静的 WebUI と `/api` を配信する。
  - listen address は `127.0.0.1` とし、LAN へ公開しない。
- Remotion のプレビューは `@remotion/player` を WebUI に埋め込む。
- MP4 レンダリング、サムネイル生成、メディア解析は Fastify のリクエスト処理内で直接完了を待たず、子プロセスまたは worker へ渡す。
- SSR、React Server Components、Server Actions は使用しない。
- 現行実装は 1 つの `package.json` を持つ単一パッケージとし、WebUI、API、共有スキーマを `src/` 内のディレクトリ境界で分離する。

採用理由:

- ローカル単一ユーザー用で SEO、SSR、エッジ配信が不要なため、SPA の方が実行モデルと障害範囲が単純になる。
- ファイル、SQLite、VOICEVOX、Remotion renderer を扱う Node.js バックエンドの生存期間を、画面フレームワークのサーバー機能から独立させられる。
- 開発時は Vite の HMR を利用し、製品実行時は Fastify だけを起動するため、利用者が複数プロセスを管理する必要がない。
- Fastify v5 は Node.js 20 以上を対象としており、Node.js 24 LTS の方針と整合する。

#### SQLite とマイグレーション

- SQLite ドライバー: `better-sqlite3`
- クエリと型: `drizzle-orm`
- マイグレーション生成: `drizzle-kit`
- マイグレーション適用: バックエンド起動時に Drizzle migrator を実行
- スキーマの正本: `src/db/schema.ts`
- 生成 SQL: `src/db/migrations/` へ保存し Git 管理
- 適用履歴: SQLite 内の migration table

運用規則:

- `drizzle-kit generate` で SQL を生成し、人間が内容を確認してからコミットする。
- 既存 DB へ `drizzle-kit push` を直接実行しない。
- マイグレーション前に SQLite backup API または安全なファイルコピーでバックアップする。
- 起動時は `PRAGMA foreign_keys = ON`、`journal_mode = WAL`、適切な `busy_timeout` を設定する。
- 複数テーブルを更新する操作は明示的な transaction にする。
- DB 接続はバックエンドプロセスが所有し、WebUI とレンダリング子プロセスから直接開かない。
- 全文検索は SQLite FTS5 を使用し、通常テーブルと同期する migration または trigger を明示的に管理する。

採用理由:

- `better-sqlite3` は transaction を含む同期 API が単純で、単一ユーザーのローカルアプリに適する。
- Node.js 24 の組み込み `node:sqlite` は保存基盤に採用せず、現行の保存基盤は better-sqlite3 とする。
- Drizzle は SQLite と `better-sqlite3` を公式にサポートし、TypeScript スキーマからレビュー可能な SQL migration を生成できる。

#### 初期バージョン基準

次表を初回 scaffold 時の固定値とする。実際の導入時には `pnpm install --save-exact` を使用し、Node.js 24、VOICEVOX 接続、Remotion の短いレンダリング、SQLite migration のスモークテストが通った組み合わせを `pnpm-lock.yaml` で固定する。

| 分類 | パッケージ | 初期固定値 |
|---|---|---:|
| Runtime | Node.js | `24.18.0` |
| Package manager | pnpm | `11.17.0` |
| UI | `react`, `react-dom` | `19.2.8` |
| UI build | `vite` | `8.1.5` |
| UI build | `@vitejs/plugin-react` | `6.0.4` |
| Routing | `react-router` | `7.18.0` |
| Server state | `@tanstack/react-query` | `5.101.4` |
| API | `fastify` | `5.10.0` |
| Schema | `zod` | `4.4.3` |
| Database | `better-sqlite3` | `12.10.0` |
| Database | `drizzle-orm` | `0.45.2` |
| Migration | `drizzle-kit` | `0.31.10` |
| Video | `remotion`, `@remotion/player`, `@remotion/renderer`, `@remotion/cli` | `4.0.499` |
| Language | `typescript` | `6.0.3` |
| Unit/integration test | `vitest` | `4.1.10` |
| E2E test | `@playwright/test` | `1.61.1` |

バージョン規則:

- `package.json` の直接依存は `^` や `~` を付けず exact version とする。
- すべての `remotion` と `@remotion/*` は必ず同じ exact version に揃える。
- canary、alpha、beta、RC パッケージは使用しない。
- TypeScript は現行の 6.0.3 を使用する。メジャー移行は主要ツールの対応確認後に別変更として行う。
- minor、major update は自動適用しない。依存更新専用ブランチで型検査、テスト、短い動画レンダリング、代表フレーム比較を通す。
- セキュリティ修正を除き、MVP 開発時はバージョン更新をまとめて行わない。この記述は施工時の運用ルールであり、現在の未実装事項を示さない。

参考:

- [Vite Getting Started](https://vite.dev/guide/)
- [Fastify v5 migration guide](https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/)
- [Drizzle SQLite](https://orm.drizzle.team/docs/sqlite/get-started-sqlite)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [Node.js 24 SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Remotion npm package](https://www.npmjs.com/package/remotion)
- [OpenRouter: Gemma 4 31B](https://openrouter.ai/google/gemma-4-31b-it)

## 5. リポジトリ構成

```text
project-root/
├─ src/
│  ├─ api/
│  │  ├─ routes/
│  │  ├─ errors/
│  │  └─ middleware/
│  ├─ app/
│  │  ├─ projects/
│  │  ├─ outlines/
│  │  ├─ scripts/
│  │  ├─ assets/
│  │  ├─ terminology/
│  │  ├─ voice/
│  │  └─ rendering/
│  ├─ db/
│  │  ├─ migrations/
│  │  └─ repositories/
│  ├─ schema/
│  │  ├─ video-project.ts
│  │  ├─ render-manifest.ts
│  │  ├─ asset.ts
│  │  ├─ character-visual.ts
│  │  ├─ terminology.ts
│  │  └─ api.ts
│  ├─ timeline/
│  ├─ voicevox/
│  ├─ openrouter/
│  ├─ validation/
│  ├─ compositions/
│  ├─ components/
│  │  ├─ characters/
│  │  ├─ subtitles/
│  │  └─ visuals/
│  ├─ thumbnail/
│  └─ web/
├─ projects/
│  └─ {projectId}/
│     ├─ project.json
│     ├─ source/
│     │  └─ source.md
│     ├─ media/
│     │  └─ visuals/
│     ├─ audio/
│     │  └─ voice/
│     ├─ cache/
│     │  ├─ render-manifest.json
│     │  ├─ audio-index.json
│     │  └─ voicevox-query/
│     ├─ runs/
│     ├─ output/
│     └─ logs/
│        └─ migration-log.jsonl
├─ library/
│  ├─ media/
│  ├─ character-visuals/
│  │  └─ {visualId}/
│  │     └─ {variantId}/
│  ├─ thumbnails/
│  └─ workspace.sqlite
├─ public/
│  └─ (SPA の静的アセットのみ)
├─ scripts/
├─ opencode.json
├─ package.json
├─ pnpm-lock.yaml
└─ .node-version
```

## 6. ファイルと保存の共通規則

### 6.1 ID

- ID は URL とファイル名に安全な `lower-kebab-case` を基本とする。
- プロジェクト ID は作成後に変更しない。
- セクション、セリフ、キャラクター、ビジュアル割り当て、素材、用語は安定 ID を持つ。
- 表示順は ID から導出せず、配列順または明示的な `order` で管理する。
- ID の生成はバックエンドで行う。

### 6.2 日時

- 永続化する日時は ISO 8601 UTC 文字列とする。
- 動画内時間はミリ秒、Remotion の派生タイムラインはフレーム数で管理する。

### 6.3 パス

- JSON と SQLite に保存する管理対象ファイルのパスは、プロジェクトルートまたはワークスペースルートからの相対パスとする。
- `..`、絶対パス、UNC パス、シンボリックリンクによる管理ルート外参照を拒否する。
- WebUI へ OS 上の絶対パスを返さない。

### 6.4 JSON 保存

1. 現在の `project.json` を読み込む。
2. Zod による構造検証とドメイン検証を行う。
3. クライアントの `expectedRevision` と現在の `revision` を照合する。
4. `revision` を 1 増加し、`updatedAt` を更新する。
5. 同じディレクトリの一時ファイルへ UTF-8、2 スペースインデント、末尾改行付きで書き出す。
6. 一時ファイルを `project.json` へ置換する。
7. 成功した revision を返す。

検証または保存に失敗した場合、既存の `project.json` は変更しない。revision が一致しない場合は `409 PROJECT_REVISION_CONFLICT` を返し、ブラウザー側で暗黙の上書きをしない。

### 6.5 自動保存

- フォーム変更後、短い debounce を経てセクションまたは画面単位で保存する。
- 保存中、保存済み、失敗、競合の状態を常時表示する。
- 自動保存と、プレビュー・`RenderManifest`・レンダリング時の validation を分離する。
- script/visual の保存は承認操作を要求せず、保存済み status は互換性、レビュー結果、stale、再生成要否の表示に使う。
- 出力実行時は、構成案の承認・最新性と、台本、音声、素材参照、assignment 範囲、checksum、Manifest の整合性を validation する。script/visual の `approved` status は要求しない。

## 7. 正本データ `VideoProject`

以下の型例では、ED-01 で採用する `schemaVersion: "1.2.0"` と、編集移行前の `schemaVersion: "1.1.0"`、MVP 開発初期の `schemaVersion: "1.0.0"` 互換境界を実装引き継ぎのために同じ場所に示している。`characterVisual`、`characterVariantId`、`edit` は、明示的な version bump と migration を通過した `1.2.0` schema で保存する。`schemaVersion: "1.0.0"` または `"1.1.0"` のデータへ新しい意味を暗黙に追加してはならない。

### 7.1 ルート

```ts
type VideoProject = {
  schemaVersion: "1.2.0";
  revision: number;
  metadata: ProjectMetadata;
  source: ProjectSource;
  brief: ProjectBrief;
  aiSettings: AiSettings;
  characters: Character[];
  outline: Outline;
  script: Script;
  visuals: VisualPlan;
  audio: AudioPlan;
  edit: EditPlan;
  thumbnail: ThumbnailPlan;
};
```

すべてのオブジェクトは既知でないキーを拒否する strict object とする。スキーマを変更する場合は `schemaVersion` 単位で明示的なマイグレーション関数を追加する。MVP 開発初期の `1.0.0` と編集移行前の `1.1.0` は legacy input として検証し、ED-01 の migration 後は現行の `1.2.0` を使用する。

ED-01 では `1.1.0` から `1.2.0` へ migration する。`1.1.0` の `audio.sectionBgms` と `inserts` は legacy input として読み取るが、現行 schema の `edit` へ暗黙に拡張しない。migration が完了した後の BGM と動画要素の正本は `edit` だけとする。

### 7.1.1 `VideoProject 1.1.0 → 1.2.0` migration 方針

- 旧 `opening`、`ending`、`eyeCatches` は実 MP4 Asset の参照を持たないため、架空 Asset や動画要素へ変換せず、`edit.videoElements` の空状態へ移行する。placeholder を現行正本へ持ち越さない。
- ED-01 は ED-02 より先に実行され、`bgm` Asset がまだ現行入力として存在しないため、旧 `AudioPlan.sectionBgms` は `edit.sectionBgms` へ変換しない。旧 path から Asset を検索・推測・復元せず、`edit.sectionBgms` は未設定のままにして、ED-02 以降に再登録または再選択を要求する。
- 未解決 BGM ごとに、`projects/{projectId}/logs/migration-log.jsonl` へ `migrationId`、`fromSchemaVersion`、`toSchemaVersion`、`kind: "unresolved_legacy_bgm"`、`sectionId`、`legacyPath`、`legacyVolume`、`reason` を永続化する。このログは strict な `VideoProject` の一部ではなく、再登録時に旧 BGM の section、path、volume を確認するための migration diagnostics とする。ログを永続化できない場合は `1.2.0` の project 保存を完了させず、同じ migration ID の再実行で重複記録しない。
- 旧 BGM の `loop`、`fadeInMs`、`fadeOutMs`、開始オフセット、トリム、volume は現行 `EditPlan` へ持ち越さない。旧 volume は migration log にだけ記録し、新しい BGM を選択した時点で現行の `volume` と固定 loop を設定する。
- generic `VisualAssignment` の旧 `VideoDisplay.muted` は `true → volume: 0`、`false → volume: 1` として変換し、`muted` は `1.2.0` の保存値に残さない。
- migration は一時ファイルへ出力してから atomic rename し、失敗時に既存 `project.json` を壊さない。未解決 BGM がある場合も、架空の Asset や推測による path を保存しない。

### 7.2 メタデータ

```ts
type ProjectMetadata = {
  id: string;
  title: string;
  description: string;
  department: string;
  manualVersion: string;
  createdAt: string;
  updatedAt: string;
  outputSettings: {
    width: 1920;
    height: 1080;
    fps: 30;
    videoCodec: "h264";
    pixelFormat: "yuv420p";
    audioCodec: "aac";
    audioSampleRate: 48000;
    audioChannels: 2;
  };
};
```

### 7.3 入力資料と企画条件

```ts
type ProjectSource = {
  id: string;
  path: "source/source.md";
  sha256: string;
};

type ProjectBrief = {
  audience: string;
  postViewingGoal: string;
  prerequisites: string[];
  targetDurationSec: number;
  requiredItems: string[];
  prohibitedItems: string[];
  globalDirectives: string[];
};
```

- `targetDurationSec` は正の整数とする。
- Markdown 保存と `sha256` 更新は 1 回のアプリケーション操作として扱う。
- 構成案の `sourceHash` が現在の `source.sha256` と異なる場合、構成案を stale と表示し、再承認を要求する。

### 7.4 AI 設定

```ts
type AiTaskKind =
  | "outline_generation"
  | "script_generation"
  | "script_review"
  | "visual_search_intent"
  | "layout_review"
  | "opencode";

type AiSettings = {
  defaultModelId: string | null;
  taskModelOverrides: Partial<Record<AiTaskKind, string>>;
  zdr: boolean;
  dataCollection: "deny";
  allowProviderFallbacks: true;
};
```

- 新規プロジェクトの `defaultModelId` は `google/gemma-4-31b-it` とする。
- 新規プロジェクトの `taskModelOverrides` は空オブジェクトとする。したがって現行仕様では、すべての `AiTaskKind` が `google/gemma-4-31b-it` へ解決される。
- 実行モデルは「実行時の明示上書き、`taskModelOverrides[taskKind]`、`defaultModelId`」の優先順で決定する。
- プロンプト、入力組み立て、structured output schema、評価指標は `AiTaskKind` ごとに分離し、モデル ID とは独立して管理する。
- `null` は AI を使用しないプロジェクトまたは移行中データのために許可する。
- ZDR の初期値は `true` とする。
- AI 実行画面ではプロジェクトの現行既定値を初期選択し、人間が実行ごとに変更できる。
- 設定されたモデルがモデル一覧に存在しない、structured output に非対応、または ZDR 条件を満たさない場合は自動代替せず実行を拒否する。

### 7.5 キャラクター

```ts
type Character = {
  id: string;
  name: string;
  role: "mentor" | "learner";
  personality: string;
  speakingStyle: string;
  voicevox: {
    speakerName: "四国めたん" | "ずんだもん";
    speakerUuid: string | null;
    styleName: "ノーマル";
  };
  themeColorToken: "character.metan" | "character.zundamon";
  voice: {
    speedScale: number;
    pitchScale: number;
    intonationScale: number;
    volumeScale: number;
    prePhonemeLength: number;
    postPhonemeLength: number;
  };
  lipSyncPeriodFrames: number;
  /** CV-05 で追加済み。明示的な schema bump 後の project.json に保存する。 */
  characterVisual: CharacterVisualBinding;
  /** Legacy 1.0.0 compatibility field. It is not the CharacterVisualSet source of truth. */
  visualAssets: {
    neutral: MouthPair;
    smile: MouthPair;
    explain: MouthPair;
    caution: MouthPair;
  };
};

type MouthPair = {
  closed: string;
  open: string;
};

type CharacterVisualBinding = {
  visualId: string | null;
  idleVariantId: string | null;
};
```

この `visualAssets.neutral` / `smile` / `explain` / `caution` は旧 `VideoProject 1.0.0` の既存プロジェクト互換性のために残すフィールドである。`CharacterVisualSet` とは別であり、確認画面と素材検証はこのフィールドを物理素材の正本として使用しない。物理 variant をこの 4 キーへ推測で重複割り当てない。CV-05 で `characterVisual` binding を新しい schema version に導入済みであり、`1.0.0` の意味を暗黙に変更しない。

- `VideoProject` の現行初期データは従来どおり四国めたんとずんだもんの 2 件を使用する。ただし、これはワークスペースの `CharacterVisualSet` 登録を 2 件へ制限する意味ではなく、登録時点で `mentor` / `learner` へ固定する意味でもない。
- P2-01 の素材確認結果は CV-01 で `CharacterVisualSet` へ idempotent に seed / migration 済みである。新規キャラクター、別衣装、差し替え候補を登録できる拡張点はこの動的カタログで確保する。
- 初期キャラクター設定は、既存の音声・制作データ互換のため次の対応とする。

| 安定 ID | 役割 | VOICEVOX | P2-01 物理素材 | 色トークン |
|---|---|---|---|---|
| `character-mentor` | `mentor` | 四国めたん／`ノーマル` | CV-01 で seed する四国めたん側 `CharacterVisualSet` 3 variant / 5 ファイル | `character.metan` |
| `character-learner` | `learner` | ずんだもん／`ノーマル` | CV-01 で seed するずんだもん側 `CharacterVisualSet` 3 variant / 5 ファイル | `character.zundamon` |

- 四国めたん側は既存の `mentor`・案内役、ずんだもん側は既存の `learner`・生徒役を基本とする。これは `VideoProject.characters[].role` と音声設定の互換であり、登録画面の `CharacterVisualSet` に継承しない。
- P2-01 で確認済みの素材は透過 PNG、初期 seed では 600 × 1000 px の同一キャンバスで、非会話状態の単一画像と、通常会話・指差し状態の会話それぞれの `closed` / `open` ペアから成る。身体の基準位置は画像を並べた手動確認で検証し、ポーズによる外形差を理由に alpha bounding box の完全一致は要求しない。600 × 1000 は workspace 共通の固定値ではない。
- 台本上の表情語彙 `neutral`、`smile`、`explain`、`caution` は `ScriptLine.expression` の論理指定として維持する。P2-01では、これらと物理バリアントの対応を決定しない。
- 実在素材の正本は workspace SQLite の `CharacterVisualSet` とし、各 variant に安定した `variantId`、`label`、`renderType`（`single-image` または `mouth-pair`）、自由な `tags`、`files` を持たせる。`characterId` や `mentor` / `learner` を variant の必須属性にしない。`stand`、`normal`、`pointing`、`smile`、`caution` などのポーズ・表情名を永続スキーマの固定 enum にはしない。
- `VideoProject.characters[].visualAssets` は既存の `1.0.0` 構造を維持し、物理バリアントを埋め込まない。確認画面と検証処理は API が返す `CharacterVisualSet` snapshot を走査する。
- 実装用素材は `library/character-visuals/{visualId}/{variantId}/` へ配置し、元データは seed / migration の入力として `doc/assets` に保持する。各ファイルについて、不足、危険な相対パス、PNG構造・CRC、variant 内必須 slot、透過有無、checksum、visual 基準キャンバスとの不一致を検証する。`public/` への直接保存や source/public のバイト一致を前提にしない。
- CV-05 でプロジェクトが必要な visual / idle variant / line variant 参照を `project.json` から読み、バックエンドが `CharacterVisualCatalogSnapshot` と照合して `RenderManifest` 用のパスと checksum を解決する。CV-04 は仕様確定の Issue であり、CV-05 で SQLite 登録 UI、プロジェクト binding、line picker、Remotion 描画を実装済みである。
- 制服の差し色、字幕の話者色、WebUI の speaker chip は `character.metan` と `character.zundamon` のデザイントークンから取得する。
- テーマ色の具体値は `doc/assets` のキャラクターデータに合わせてデザイントークンへ登録し、字幕背景とのコントラストを検証する。
- 話者の区別を色だけに依存させず、キャラクター名、話者チップ、左右配置でも区別する。
- `speakerUuid` は初回接続時または設定更新時に `/speakers` から取得して保存する。初期 JSON やソースコードへ UUID と style ID を埋め込まない。
- 音声生成前に、`speakerUuid` または `speakerName` と `styleName` から style ID を一意に解決できることを検証する。
- 各 voice 設定の許容範囲は接続中の VOICEVOX ENGINE の仕様に合わせてアダプター層で検証する。

### 7.5.1 キャラクタービジュアル型と snapshot

`CharacterVisualSet` は DB レコードを API view model として集約した型であり、variant と file は別テーブル・別エンティティとして保存する。型の最小構造は次のとおりである。

```ts
type CharacterVariantRenderType = "single-image" | "mouth-pair";

type CharacterVisualFile = {
  key: string;
  libraryPath: string;
  mimeType: "image/png";
  checksum: string;
  sizeBytes: number;
  width: number;
  height: number;
};

type CharacterVariant = {
  variantId: string;
  label: string;
  renderType: CharacterVariantRenderType;
  status: "active" | "inactive";
  tags: readonly string[];
  files: readonly CharacterVisualFile[];
};

type CharacterVisualSet = {
  visualId: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  baseWidth: number | null;
  baseHeight: number | null;
  variants: readonly CharacterVariant[];
  createdAt: string;
  updatedAt: string;
};

type CharacterVisualCatalogSnapshot = readonly CharacterVisualSet[];

// 互換名。実在項目を静的配列で export しない。
type CharacterVariantCatalog = readonly CharacterVariant[];
```

The database is the source of truth for both visual-set and variant status. Existing rows are migrated with `status = 'active'`; deactivation is a status update and never a physical delete. Ordinary candidate adapters used by the API/UI and render input include only active visuals and active variants, while list/detail snapshots retain inactive rows for management and reactivation.

CV-01 では `status` を `active` / `inactive` とし、visual 単位の基準キャンバスを nullable な `baseWidth` / `baseHeight` として保持する。variant が 0 件の visual は両方を null にでき、最初の完成 variant を登録する時点で両方を確定する。snapshot の版表現は後続設計で扱う。ファイルの MIME type、checksum、サイズ、キャンバス技術情報はバックエンド検証と API 応答に必要なため保持する。

P2-01 の当時の静的カタログには各キャラクター 3 variant、5 ファイル、2 キャラクター合計 6 variant、10 ファイルが登録されていた。CV-01 の migration 後は、この件数を初期 DB seed として保持し、一覧・検証・配信の実行時正本は SQLite と管理領域に切り替える。

### 7.5.2 キャラクター素材検証

検証処理は、注入された管理ルート、SQLite の `CharacterVisualSet` snapshot、variant/file を走査する。set 全体に全表情・全ポーズが揃っていることは要求しない。一方、snapshot に含まれる永続化済み variant は必須 slot が揃った完成状態でなければならない。作成リクエストの slot 欠落は variant を不完全なまま保存するのではなく、ファイル移動と DB 更新の前に拒否する。検証項目は次のとおりである。

- `visualId`、`variantId`、file slot の重複
- visual、variant、library path の unsafe relative path
- `libraryPath` が `library/character-visuals/{visualId}/{variantId}/` 配下であること
- ファイルが許可形式の PNG であること
- `single-image` が `single` ファイルを 1 件持つこと
- `mouth-pair` が `closed` と `open` を 1 件ずつ持つこと
- 管理領域の存在、サイズ、mime type、checksum
- PNG signature、chunk 構造、CRC、IHDR、IDAT、IEND
- 各 visual の最初の完成 variant から決まる基準キャンバスとの一致
- `mouth-pair` の `closed` / `open` キャンバス一致
- alpha channel または `tRNS`

初期 seed / migration では `doc/assets` の既存 10 PNG を管理領域へコピーし、checksum と技術情報を DB へ保存する。新規登録では未登録 variant の存在をエラーにせず、`single-image` の `single`、`mouth-pair` の `closed` / `open` を揃えた作成リクエストだけを永続化する。必須 slot 欠落、形式不正、checksum 不一致、基準キャンバス不一致は、variant 行や最終ファイルを残さず操作全体を失敗させる。既存の完成 variant の差し替えは complete file set 単位で行い、必須 slot を削除する操作は提供しない。PNG の完全デコードによる透明ピクセル量や alpha bounding box の数値解析は行わない。身体の基準位置は、同じ visual の代表画像を並べた手動確認で扱い、根拠のない alpha bounding box 許容値は導入しない。

### 7.6 構成案

```ts
type ApprovalStatus = "draft" | "needs_review" | "approved";
type SectionRole = "intro" | "main" | "outro";

type Outline = {
  status: ApprovalStatus;
  sourceHash: string;
  generationRunId: string | null;
  openQuestions: OpenQuestion[];
  sections: OutlineSection[];
};

type OutlineSection = {
  id: string;
  order: number;
  role: SectionRole;
  title: string;
  overview: string;
  keyPoints: string[];
  targetDurationSec: number;
  sourceRefs: SourceRef[];
  openQuestions: OpenQuestion[];
  humanDirectives: {
    requiredItems: string[];
    prohibitedItems: string[];
    scriptConstraints: string[];
  };
  lockedFields: string[];
};

type SourceRef = {
  sourceId: string;
  headingPath: string[];
};

type OpenQuestion = {
  id: string;
  question: string;
  resolution: string | null;
  status: "open" | "resolved";
};
```

`ApprovalStatus` は既存 JSON の共通 enum として維持する。`Outline.status` の `approved` は構成案の明示的な前提に使うが、`Script.status` と `VisualPlan.status` の同じ値は互換性、レビュー、stale、再生成要否を表すだけで、制作や出力の承認ゲートには使わない。

承認条件:

- `intro` が先頭に 1 件ある。
- `outro` が末尾に 1 件ある。
- `main` が 1 件以上ある。
- `order` が重複せず表示順と一致する。
- 未解決の `openQuestions` がない。
- `sourceHash` が現在の入力資料のハッシュと一致する。

構成案は、AI 生成または人間の手入力から開始できる。手入力で保存した構成案は `generationRunId: null` とし、AI 生成を経由しない。どちらの経路も同じ編集、自動保存、構成案の承認条件を使用する。構成案の承認・最新性確認は、この仕様で制作の前提として残す唯一の明示的な承認境界である。

### 7.7 台本

```ts
type Script = {
  status: ApprovalStatus;
  origin: "manual" | "ai" | "imported";
  outlineHash: string;
  sections: ScriptSection[];
};

type ScriptSection = {
  id: string;
  outlineSectionId: string;
  name: string;
  background: BackgroundDefinition;
  lines: ScriptLine[];
};

type ScriptLine = {
  id: string;
  speakerId: string;
  spokenText: string;
  subtitleText: string;
  expression: "neutral" | "smile" | "explain" | "caution";
  /** CV-05 で追加済み。人間が physical variant を選ぶまでは null。 */
  characterVariantId: string | null;
  pauseBeforeMs: number;
  pauseAfterMs: number;
  voiceOverrides: Partial<Character["voice"]>;
  pronunciation: {
    mode: "dictionary" | "literal";
    excludedTermIds: string[];
  };
};
```

- `origin` の初期値は `manual` とする。
- `outlineHash` は台本作成元となった承認済み・最新の構成案の内容ハッシュとする。現在の構成案と一致しない台本は stale とするが、編集やビジュアル・音声操作を承認待ちに戻すゲートにはしない。
- `pauseBeforeMs` の初期値は `0`、`pauseAfterMs` の初期値は `250` とする。
- `spokenText` と `subtitleText` は別々に保存する。
- `speakerId` は `characters[].id` を参照する。
- `characterVariantId` は、line の speaker に `project.json` 上で binding された `CharacterVisualSet` 配下の variant を人間が選択した参照とする。新規 line の初期値は `null` とし、`expression`、tag、label から自動設定しない。
- `characterVariantId` が missing、inactive、speaker の binding と異なる visual 所属の場合は、別 variant を推測せず保存・出力時の validation error とする。編集中の未選択は許可できるが、通常レンダリングの入力にはしない。
- 1 セクション内の line ID は重複不可とし、プロジェクト全体でも一意にする。
- 構成案・台本の変更時は、対象ビジュアル範囲、音声生成物、`RenderManifest` の freshness/status を再計算し、stale または `needs_review` を表示する。これは承認ゲートへ戻す処理ではなく、出力時 validation が検出・ブロックするための状態である。

### 7.8 ビジュアル

```ts
type VisualPlan = {
  status: ApprovalStatus;
  suggestionRunIds: string[];
  assignments: VisualAssignment[];
};

type VisualAssignment = {
  id: string;
  startLineId: string;
  endLineId: string;
  assetId: string;
  assetChecksum: string;
  projectMediaPath: string;
  display: VideoDisplay | ImageDisplay | DocumentDisplay;
};
```

`VisualPlan.status` は既存データ互換、レビュー結果、stale 表示のために保持できる。素材検索、AI 候補表示、割り当て、差し替え、解除、表示設定の更新、音声操作、`RenderManifest` のコンパイルは、ビジュアル承認を要求しない。

`VisualPlan.assignments` は現場動画・写真・帳票スキャンを扱う generic `VisualAssignment` のデータであり、CharacterVisualSet の visual binding / variant 選択とは別ドメインである。AI visual suggestion、Asset Search、Asset Service、`VisualAssignment` の backend と保存データは維持する。キャラクターの physical variant は `ScriptLine.characterVariantId` と `CharacterVisualBinding` で管理し、`VisualPlan.assignments` へ混在させない。

表示設定の共通部分:

```ts
type CommonDisplay = {
  fit: "contain" | "cover";
  crop: { x: number; y: number; width: number; height: number };
  scale: number;
  position: { x: number; y: number };
  prioritizeVisual: boolean;
  annotations: StaticAnnotation[];
};

type StaticAnnotation = {
  id: string;
  kind: "label" | "box" | "arrow";
  text: string | null;
  x: number;
  y: number;
  width: number | null;
  height: number | null;
  colorToken: "accent" | "caution" | "warning";
};
```

- `crop` と `position` は素材表示領域に対する 0 以上 1 以下の正規化座標とする。
- 注釈は現行仕様では静的定義とし、WebUI の数値フォームと簡易オーバーレイ操作から編集する。
- `startLineId` と `endLineId` は同じセクション内に存在し、開始が終了より後にならないこと。
- `VisualAssignment.assetId` が参照できる素材種別は `video`、`photo`、`document_scan` に限定し、`sound_effect` は `AudioPlan.soundEffects` から参照する。

種別ごとの表示設定:

```ts
type VideoDisplay = CommonDisplay & {
  kind: "video";
  startMs: number;
  endMs: number;
  playbackRate: number;
  volume: number;
};

type ImageDisplay = CommonDisplay & {
  kind: "photo";
};

type DocumentDisplay = CommonDisplay & {
  kind: "document_scan";
  page: number;
};

type BackgroundDefinition =
  | {
      kind: "solid";
      colorToken: "background";
    }
  | {
      kind: "image";
      src: string;
      fit: "contain" | "cover";
    };
```

- `endMs` は `startMs` より大きく、素材の duration 以下とする。
- `playbackRate` は `0` より大きい値とする。
- `volume` は `0` 以上 `1` 以下とする。旧 generic `muted` は ED-01 migration 時に `true → 0`、`false → 1` として変換し、`1.2.0` では保存しない。ED-07 はこの変換後の `volume` を UI、API、compiler、Remotion で扱う。
- 帳票の `page` は 1 始まりとし、素材の `pageCount` 以下とする。

### 7.9 音声、編集、サムネイル

生成済み音声の duration、VOICEVOX query、フレーム値は派生データであり `project.json` へ保存しない。人間が確定した音声調整は `projects/{projectId}/voice-adjustments/{lineId}.json` へ分離し、Git 管理可能な正本データとして保存する。

```ts
type VoiceAdjustmentFile = {
  adjustmentVersion: "1.0.0";
  lineId: string;
  base: {
    baseHash: string;
    resolvedSpokenText: string;
    speakerUuid: string;
    styleName: "ノーマル";
    resolvedStyleId: number;
    voicevoxEngineVersion: string;
  };
  scalarOverrides: Partial<{
    speedScale: number;
    pitchScale: number;
    intonationScale: number;
    volumeScale: number;
    prePhonemeLength: number;
    postPhonemeLength: number;
  }>;
  accentPhrases: VoicevoxAccentPhrase[] | null;
  editedAt: string;
};

type VoicevoxAccentPhrase = {
  moras: VoicevoxMora[];
  accent: number;
  pause_mora: VoicevoxMora | null;
  is_interrogative: boolean;
};

type VoicevoxMora = {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
};
```

- `VoicevoxAccentPhrase` と `VoicevoxMora` の実装型は、接続対象の VOICEVOX ENGINE OpenAPI から生成した型を使用し、上記フィールドを Zod で検証する。
- `baseHash` は解決後の読み上げ文、話者 UUID、スタイル名、実行時に解決した style ID、VOICEVOX ENGINE の互換性に影響する版情報、キャラクター既定値、セリフ上書きから生成する。
- 全体パラメーターだけを変更した場合、`accentPhrases` は `null` とし、最新の未編集 query に `scalarOverrides` を適用する。
- アクセント句、アクセント核、モーラ単位の音高・長さ・無声化を変更した場合、確定した `accent_phrases` のスナップショットを `accentPhrases` に保存する。
- 保存済み `baseHash` が現在値と一致しない調整は `needs_review` と表示し、音声生成へ自動適用しない。
- 不一致時は「調整を破棄して再生成」「未編集 query と比較して再調整」のいずれかを人間が選択する。位置番号を使った自動マージは行わない。
- 調整ファイルは一時ファイルへ書き出してから rename し、保存途中の破損を防ぐ。
- 調整をすべてリセットした場合は、対応する調整ファイルを削除し、未編集 query とキャラクター既定値へ戻す。

```ts
type AudioPlan = {
  soundEffects: SoundEffect[];
};

type ProjectAssetSnapshot = {
  assetId: string;
  assetVersion: number;
  assetChecksum: string;
  projectMediaPath: string;
};

type EditVideoPlacement =
  | { kind: "before_first_section" }
  | { kind: "before_section"; sectionId: string; order: number }
  | { kind: "after_last_section" };

type EditVideoElement = ProjectAssetSnapshot & {
  id: string;
  role: "intro" | "outro" | "cutin";
  placement: EditVideoPlacement;
  volume: number;
};

type SectionBgmAssignment = ProjectAssetSnapshot & {
  id: string;
  sectionId: string;
  volume: number;
};

type EditPlan = {
  videoElements: EditVideoElement[];
  sectionBgms: SectionBgmAssignment[];
};

type ThumbnailPlan = {
  backgroundImage: string | null;
  title: string;
  subtitle: string | null;
  departmentOrSystem: string;
  manualVersion: string | null;
  characterId: string | null;
  representativeVisualPath: string | null;
  layout: "standard";
};

/** `1.1.0` compatibility input only. It is not part of `EditPlan`. */
type LegacySectionBgm = {
  id: string;
  sectionId: string;
  path: string;
  volume: number;
  loop: boolean;
  fadeInMs: number;
  fadeOutMs: number;
};

type SoundEffect = {
  id: string;
  soundEffectAssetId: string;
  assetChecksum: string;
  projectMediaPath: string;
  category: "confirm" | "attention" | "warning";
  lineId: string;
  offsetMs: number;
  volume: number;
};

/** `1.1.0` compatibility input only. Current projects do not persist placeholders. */
type LegacyPlaceholderInsert = {
  id: string;
  kind: "placeholder";
  slot: "opening" | "ending";
  durationMs: 2000;
};

type LegacyEyeCatchPlaceholder = {
  id: string;
  kind: "placeholder";
  slot: "eye_catch";
  beforeSectionId: string;
  durationMs: 2000;
};
```

- 音量は `0` 以上 `1` 以下とする。
- 効果音は任意とし、用途を `confirm`、`attention`、`warning` の 3 種類に限定する。通常のセリフ切り替えや発話開始ごとには自動再生しない。
- 効果音はワークスペースの素材ライブラリから選択し、プロジェクトへ取り込んだパスとチェックサムを保存する。
- `offsetMs` は音声の発話開始位置からの相対値とし、1 セリフへ複数の効果音を設定できる。
- 効果音の新規追加時の `volume` 初期値は `0.2` とし、人間が変更できる。
- 同時に 3 音以上の効果音が重なる場合は警告する。警告は保存を禁止しない。
- セクション音声との合成試聴を提供し、ナレーションより効果音が大きく聞こえる場合は警告する。現行仕様では自動音量補正を行わず、保存を禁止しない。
- 素材登録時のラウドネス解析と音量正規化は将来の評価事項とする。
- `EditPlan.videoElements` の Asset は `kind: "video"` かつ `.mp4`、`video/mp4`、MP4 container を満たすこと。`role: "intro"` は `before_first_section` に最大 1 件、`role: "outro"` は `after_last_section` に最大 1 件、`role: "cutin"` は `before_section` にだけ置く。`cutin` の `sectionId` は `script.sections[0].id` と一致してはならず、最初のセクション直前の境界を拒否する。同じ境界の cutin は `order` の昇順で解決する。
- `EditPlan.sectionBgms` は section ごとに 0 件または 1 件とし、同じ `sectionId` の重複を拒否する。Asset は `kind: "bgm"` かつ `.mp3`、`audio/mpeg`、MP3 を満たすこと。
- BGM の再生範囲は、動画要素の shift 後に確定した対象セクションの全区間とする。素材の長さに関係なく固定 loop し、セクション終了で停止する。動画要素の区間では BGM を再生しない。
- 動画要素と BGM の `volume` は `0` 以上 `1` 以下とする。`loop`、開始オフセット、トリム、`fadeInMs`、`fadeOutMs`、音量キーフレーム、自動ダッキング、曲同士のクロスフェードは `EditPlan` に持たせない。
- 旧 `LegacySectionBgm` と `LegacyPlaceholderInsert` / `LegacyEyeCatchPlaceholder` は migration の入力境界だけで使用し、現行の project data や manifest へ placeholder を保存しない。未解決の旧 BGM の sectionId、path、volume は `logs/migration-log.jsonl` へ記録する。
- サムネイルは `title` と `departmentOrSystem` を必須の非空文字列とする。背景画像、補足、版数、キャラクター、代表ビジュアルは任意とし、未指定時は共通テンプレートの既定背景を使用する。

## 8. 派生データ

### 8.1 `RenderManifest`（次期 `2.3.0`）

ED-08 では `RenderManifest 2.3.0` を採用する。次の `1.0.0` 型と既存 `2.2.0` キャッシュは、MVP / ED-00 前の互換性確認のために履歴として保持するものであり、新規実装の正本ではない。次期モデルは 8.1.1 に示す。

```ts
type LegacyRenderManifestV1 = {
  manifestVersion: "1.0.0";
  sourceProjectHash: string;
  sourceAssetChecksums: { path: string; sha256: string }[];
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  lines: LegacyRenderLine[];
  visuals: RenderVisual[];
  backgrounds: RenderBackground[];
  audioTracks: LegacyRenderAudioTrack[];
  soundEffects: RenderSoundEffect[];
  inserts: LegacyRenderInsert[];
};
```

`RenderLine` は少なくとも次を持つ。

```ts
type LegacyRenderLine = {
  id: string;
  sectionId: string;
  from: number;
  durationInFrames: number;
  speechFrom: number;
  speechDurationInFrames: number;
  audioPath: string;
  subtitleText: string;
  speakerId: string;
  expression: ScriptLine["expression"];
};

type RenderVisual = {
  id: string;
  from: number;
  durationInFrames: number;
  kind: "video" | "photo" | "document_scan";
  src: string;
  display: VideoDisplay | ImageDisplay | DocumentDisplay;
};

type RenderBackground = {
  sectionId: string;
  from: number;
  durationInFrames: number;
  background: BackgroundDefinition;
};

type LegacyRenderAudioTrack = {
  id: string;
  sectionId: string;
  from: number;
  durationInFrames: number;
  src: string;
  volume: number;
  loop: boolean;
  fadeInFrames: number;
  fadeOutFrames: number;
};

type RenderSoundEffect = {
  id: string;
  lineId: string;
  category: "confirm" | "attention" | "warning";
  from: number;
  durationInFrames: number;
  src: string;
  volume: number;
};

type LegacyRenderInsert = {
  id: string;
  kind: "placeholder";
  slot: "opening" | "ending" | "eye_catch";
  beforeSectionId: string | null;
  from: number;
  durationInFrames: number;
  label: string;
};
```

旧 `RenderManifest 1.0.0` の `lines[].expression` は `ScriptLine["expression"]`、つまり `neutral` / `smile` / `explain` / `caution` の論理表情である。これは物理ファイルパスや `variantId` を意味しない。互換 `2.2.0` ではこれに加えて明示的な character variant 解決フィールドを保持した。ED-08 の `2.3.0` では、その責務に実動画 insert と編集 BGM の最終範囲を加える。

### 8.1.1 次期 `RenderManifest 2.3.0` model

CV-05 で導入した explicit variant 解決を引き継ぐ次期モデルは `RenderManifest 1.0.0` / `2.2.0` と意味を分離し、`manifestVersion: "2.3.0"` として保存する。`characterMappingVersion` は既存キャッシュ・run-log との互換メタデータとして残すが、expression や mapping table から physical variant を解決する入力ではない。

production の compile endpoint は `POST /api/projects/{projectId}/manifest/compile` とする。endpoint の compile service は project と audio index を読み、`CharacterVisualCatalogService.verifyFiles()` が返す SQLite の validated snapshot から character file metadata を組み立て、checksum を保持したまま `RenderManifestStore.compileAndStore()` へ渡す。編集 Asset は `project.json` の `assetId` / `assetVersion` / `assetChecksum` / `projectMediaPath` snapshot と project 内ファイルから解決し、Asset Service の SQLite や live な Asset `status` を必須入力にしない。静的 legacy catalog をこの経路の入力にせず、snapshot checksum と実ファイルの不一致は validation error とする。

```ts
type RenderManifest = {
  manifestVersion: "2.3.0";
  sourceProjectHash: string;
  compilerInputHash: string;
  characterCatalogVersion: string;
  characterMappingVersion: string;
  sourceAssetChecksums: { path: string; sha256: string }[];
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  characters: RenderCharacter[];
  characterVariants: RenderCharacterVariant[];
  lines: RenderLineCurrent[];
  visuals: RenderVisual[];
  backgrounds: RenderBackground[];
  audioTracks: RenderAudioTrack[];
  soundEffects: RenderSoundEffect[];
  inserts: RenderVideoInsert[];
};

type RenderLineCurrent = LegacyRenderLine & {
  characterVariantId: string;
};

type RenderCharacter = {
  characterId: string;
  visualId: string;
  displayName: string;
  themeColorToken: string;
  lipSyncPeriodFrames: number;
  idleVariantId: string;
};

type RenderCharacterVariant =
  | {
      variantId: string;
      visualId: string;
      renderType: "single-image";
      files: { single: { path: string; sha256: string } };
    }
  | {
      variantId: string;
      visualId: string;
      renderType: "mouth-pair";
      files: {
        closed: { path: string; sha256: string };
        open: { path: string; sha256: string };
      };
    };

type RenderAudioTrack = {
  id: string;
  sectionId: string;
  from: number;
  durationInFrames: number;
  src: string;
  volume: number;
  loop: true;
};

type RenderVideoInsert = {
  id: string;
  role: "intro" | "outro" | "cutin";
  from: number;
  durationInFrames: number;
  src: string;
  volume: number;
};
```

#### 次期の explicit character variant resolution

現行の explicit character variant resolution では、次を入力として受け取る。

```text
project.characters[].characterVisual.visualId
project.characters[].characterVisual.idleVariantId
project.script.sections[].lines[].characterVariantId
        +
validated CharacterVisualCatalogSnapshot
        ↓
RenderManifest.characters[].idleVariantId
RenderManifest.lines[].characterVariantId
RenderManifest.characterVariants[]
```

compiler は explicit reference を snapshot と照合し、解決元 `visualId`、variant の active 状態、speaker の project character、renderType、相対ファイルパス、checksum、`mouth-pair` の `closed` / `open` を manifest に固定する。`RenderCharacterVariant` は physical visual の `(visualId, variantId)` を識別し、同じ physical variant を複数の project character が共有できる。expression、tag、label、旧固定 mapping から physical variant を自動選択・代替しない。missing、inactive、cross-visual、variant / mouth slot 欠落、checksum 不一致は validation error とする。Remotion は SQLite、CharacterVisual Service、ファイル探索を直接参照せず、解決済み manifest だけを入力とする。

実際の project schema、snapshot version、variant version、`manifestVersion` の互換性は ED-01 / ED-08 で `VideoProject 1.2.0` と整合させる。ED-00 は仕様文書で `2.3.0` の責務を定め、project schema `1.0.0` / `1.1.0` の意味を暗黙に変更しない。

- フレーム範囲は半開区間 `[from, from + durationInFrames)` とする。
- ミリ秒からフレームへの変換は `Math.ceil((ms / 1000) * fps)` とする。
- 30 fps の現行仕様では、動画要素の実尺をメディア技術情報からフレームへ変換する。
- タイムラインコンパイラは本編内のセリフ相対位置を計算した後、cutin、intro、outro の順序で実動画を挿入し、後続要素をシフトする。
- セクション BGM は動画要素挿入後の最終的なセクションフレーム範囲へ解決し、その区間を固定 loop する。動画要素の区間では BGM track を無効にする。
- 効果音の `from` は対象 `RenderLine.speechFrom` に `offsetMs` をフレーム変換した値を加えて決定する。効果音素材の実尺から `durationInFrames` を計算する。
- 配列はタイムライン順に安定ソートする。
- 同一入力に対する出力順序と JSON シリアライズ順を固定する。
- `sourceProjectHash` または参照チェックサムが不一致の場合、キャッシュを使用しない。

### 8.2 音声インデックス

`projects/{projectId}/cache/audio-index.json` は次の派生情報を line ID ごとに保持する。

```ts
type AudioIndexEntry = {
  lineId: string;
  audioPath: string;
  cacheKey: string;
  audioSha256: string;
  durationMs: number;
  generatedAt: string;
  voicevoxEngineVersion: string;
  speakerUuid: string;
  styleName: "ノーマル";
  resolvedStyleId: number;
  resolvedSpokenText: string;
  appliedTerms: {
    termId: string;
    surface: string;
    reading: string;
    termUpdatedAt: string;
  }[];
  queryPath: string;
};
```

`cacheKey` は少なくとも、解決後の読み上げ文、話者 UUID、スタイル名、実行時に解決した style ID、キャラクター音声設定、セリフ単位の上書き、適用用語の ID と更新日時、VOICEVOX ENGINE の互換性に影響する版情報、適用した調整ファイルのチェックサムから生成する。

## 9. 固有名詞・社内用語 DB

### 9.1 テーブル

```sql
CREATE TABLE terminology_terms (
  term_id TEXT PRIMARY KEY,
  surface TEXT NOT NULL,
  normalized_surface TEXT NOT NULL,
  reading_katakana TEXT NOT NULL,
  category TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX terminology_terms_surface_uq
  ON terminology_terms(normalized_surface);

CREATE INDEX terminology_terms_status_idx
  ON terminology_terms(status);
```

`category` の初期候補は `person`、`department`、`system`、`product`、`location`、`operation`、`other` とする。値はコード上の列挙ではなく、将来マスター化できる文字列として保存する。

### 9.2 正規化と検証

- `surface` は前後空白を除去し、Unicode NFC へ正規化する。
- `normalized_surface` は検索と重複判定用に生成する。
- `reading_katakana` は空文字を禁止し、全角カタカナ、長音、空白、許可する記号だけを受け付ける。
- 同じ `normalized_surface` の有効・無効レコードを複数作らない。再登録は既存レコードの再有効化として扱う。
- 物理削除 API は用意せず `inactive` にする。

### 9.3 読み上げへの適用

1. `spokenText` を Unicode NFC へ正規化する。
2. `pronunciation.mode` が `literal` の場合は用語を適用しない。
3. `active` かつ `excludedTermIds` に含まれない用語を読み込む。
4. `surface` の文字数が長い順、`priority` が高い順、`termId` の昇順で並べる。
5. 重複しない最長一致で `surface` を `reading_katakana` へ置換し、一時的な `resolvedSpokenText` を作る。
6. 元の `spokenText` と `subtitleText` は変更しない。
7. 適用した用語を音声インデックスと実行ログへ記録する。
8. `resolvedSpokenText` を WebUI の音声生成確認画面へ表示する。

用語更新後も既存 WAV を暗黙に置き換えない。cache key が変化したセリフを「再生成が必要」と表示し、人間の操作で再生成する。

### 9.4 WebUI

用語画面は次を提供する。

- 表記、読み、カテゴリ、状態による検索
- 新規登録
- 表記、読み、カテゴリ、優先度、メモの編集
- 利用停止と再有効化
- 入力中の読みの検証
- 同一表記の重複警告
- 任意の文を使った置換プレビュー
- 対象用語を使用する台本セリフの検索

## 10. 素材ライブラリ DB

キャラクタービジュアルは現場素材の `Asset` と同じ workspace SQLite を使用するが、別エンティティとして管理する。`project.json` は動画制作データの正本であり、キャラクタービジュアルの一覧・variant・file metadata を持たせない。

### 10.1 キャラクタービジュアルのエンティティ

論理モデルは次の 3 層とする。

```text
character_visual_sets
├─ visual_id (PK)
├─ name
├─ description
├─ status
├─ canvas_width / canvas_height (nullable until first complete variant)
├─ created_at / updated_at
│
└─ character_visual_variants
   ├─ variant_id (PK)
   ├─ visual_id (FK)
   ├─ label
   ├─ render_type: single-image | mouth-pair
   ├─ created_at / updated_at
   │
   └─ character_visual_files
      ├─ file_id (PK)
      ├─ variant_id (FK)
      ├─ slot_key: single | closed | open | other future slot
      ├─ library_path
      ├─ checksum
      ├─ mime_type
      ├─ width / height
      └─ created_at / updated_at
```

`tags[]` は CharacterVisual variant とそのタグの関連として保持する。これは現場素材 `Asset` のタグ辞書・tag ID・関連付けとは別ドメインであり、同じ workspace SQLite に置く場合でも ID namespace、関連テーブル、API / schema 上の意味を共有・混同しない。CharacterVisual variant のタグは picker 内の sort 補助だけに使い、generic Asset のタグは現場素材用 Asset Search の検索語彙として使う。`renderType` と必須 slot の検証はアプリケーション層で行う。visual 全体は一部 variant が未登録でも有効にできるが、永続化する variant は必須 slot が揃った完成状態に限る。`single-image` の作成は `single` 1 件、`mouth-pair` の作成は `closed` と `open` 各 1 件を同一リクエストで検証・登録し、必須 slot 欠落の variant 行や file を残さない。登録後の差し替えは complete file set 単位で許可するが、必須 slot の削除は許可しない。最初の完成 variant で `canvas_width` / `canvas_height` を設定し、以後の file 登録時に同じ visual の値と比較する。異なるサイズは保存せず、既存レコードとファイルを壊さない。

`status` の具体的な enum・遷移と、slot key の将来拡張は CV-01 で確定する。ただし、未登録 variant の存在だけで `CharacterVisualSet` を error にしないこと、登録時点で `mentor` / `learner` や project ID を持たせないことは確定する。

この DB モデルへ project ID、VOICEVOX 話者、`mentor` / `learner`、line ID を追加して project binding を表現してはならない。binding は `project.json` の `CharacterVisualBinding`、line の physical variant は `ScriptLine.characterVariantId` が正本である。picker と compiler は project.json の参照を SQLite の catalog snapshot と照合するだけで、SQLite 側へプロジェクト固有の選択状態を書き戻さない。

### 10.2 既存素材の seed / migration

CV-01 では、P2-01 の当時の TypeScript 静的カタログと `doc/assets` を migration の入力として扱う。ファイルシステム操作と SQLite transaction を単一 transaction とはみなさず、seed visual 単位のアプリケーション操作として idempotent に実行する。

1. 2 つの初期 `CharacterVisualSet` と配下の 6 variant、10 PNG を安定 ID と checksum で検査し、各 variant の必須 slot が揃うことを確認する。
2. PNG を staging 領域へコピーし、形式、PNG 構造、キャンバス、checksum を検証する。
3. 検証済みのファイルを `library/character-visuals/{visualId}/{variantId}/` へ atomic rename し、SQLite transaction で完全な variant と file metadata を upsert する。SQLite transaction 自体はファイルコピーや rename をロールバックしない。
4. 既存 DB に同じ seed ID と checksum がある場合は再登録せず、差分がある場合は最終領域を変更する前に migration エラーとして報告する。
5. DB 更新に失敗した場合は今回作成した未参照ファイルを compensating cleanup し、クラッシュで残った staging/final の未参照ファイルは orphan として診断・回収する。
6. migration 成功後の一覧、検証、配信は SQLite と管理領域だけを正本として使用する。

seed は「2 キャラクターしか登録できない」という制約を作らない。初期素材の 600 × 1000 px は seed visual の基準サイズであり、新規 visual の全体固定値ではない。

### 10.3 エンティティ

素材レコードは少なくとも次を持つ。

```ts
type Asset = {
  assetId: string;
  version: number;
  kind: "video" | "photo" | "document_scan" | "sound_effect" | "bgm";
  title: string;
  description: string;
  libraryMediaPath: string;
  thumbnailPaths: string[];
  checksum: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  pageCount: number | null;
  confidentiality: string;
  department: string | null;
  system: string | null;
  status: "processing" | "active" | "inactive" | "error";
  createdAt: string;
  updatedAt: string;
};
```

タグは素材との多対多関連、タグの分類軸、正規名、別名、利用状態を別テーブルで管理する。全文検索対象はタイトル、説明、部門、対象システム、タグ正規名、タグ別名とする。`sound_effect` は `confirm`、`attention`、`warning` の用途タグを必須とする。動画、写真、帳票では `width` と `height` を必須とし、動画、BGM、効果音では `durationMs` を必須とする。

編集フェーズの形式 validation は次のとおりとする。

| Asset kind | 拡張子 | MIME | 実ファイル形式 | 使用先 |
|---|---|---|---|---|
| `video` | `.mp4` | `video/mp4` | MP4 container | intro / outro / cutin |
| `bgm` | `.mp3` | `audio/mpeg` | MP3 | section BGM |

拡張子だけで許可せず、MIME と実ファイル形式を登録時に検証する。`bgm` は generic `VisualAssignment` の候補に含めず、編集画面の BGM picker だけへ返す。Asset 本体の `version` / `checksum` は、動画要素と BGM の project snapshot では `assetVersion` / `assetChecksum` として `assetId`、`projectMediaPath` とともに固定し、Asset の後続更新で既存 project を変更しない。`active` は選択・差し替え時だけ要求し、出力時は project 内ファイルの存在、`assetChecksum`、MP4 / MP3 の実ファイル形式を検証する。

### 10.4 登録

1. 許可した MIME type と実ファイル形式を検証する。
2. 一時領域へ受信する。
3. SHA-256、サイズ、該当する場合は解像度、動画尺、音声尺またはページ数を取得する。
4. 素材 ID と版を確定し `library/media/` へ移動する。
5. 動画、写真、帳票ではサムネイルを生成する。効果音では試聴用波形の生成を必須にしない。
6. SQLite レコードを `processing` で作成し、全処理成功後に `active` にする。
7. 失敗時は `error` と理由を記録し、検索候補に含めない。

同一チェックサムの重複登録は警告し、既存素材を返すか別メタデータとして登録するかを人間に選ばせる。素材の差し替えは同じファイルを上書きせず、新しい版として登録する。

### 10.5 プロジェクトへの取り込み

1. 対象素材が `active` であることを確認する。
2. 素材をプロジェクト内の一時パスへコピーする。
3. コピー後の SHA-256 を DB の値と照合する。
4. 最終パスへ移動する。
5. `project.json` の assignment を revision 付きで保存する。
6. JSON 保存に失敗した場合は、今回作成した未参照ファイルを取り除く。

プロセス異常終了で残った未参照ファイルは、診断画面で orphan として検出する。自動削除はしない。

## 11. バックエンド API

### 11.1 共通形式

成功:

```json
{
  "data": {},
  "revision": 12
}
```

失敗:

```json
{
  "error": {
    "code": "PROJECT_VALIDATION_FAILED",
    "message": "保存できませんでした。",
    "details": [],
    "requestId": "req-..."
  }
}
```

- 予期した業務エラーは 4xx、外部サービスまたは予期しない失敗は 5xx とする。
- バリデーションエラーの `details` はフィールドパスと理由を持つ。
- スタックトレース、API キー、絶対パス、入力資料本文をブラウザーへ返さない。
- project mutation は `expectedRevision` を必須とする。

### 11.2 プロジェクト

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/{projectId}
PUT    /api/projects/{projectId}/metadata
PUT    /api/projects/{projectId}/source
PUT    /api/projects/{projectId}/brief
PUT    /api/projects/{projectId}/characters
PUT    /api/projects/{projectId}/audio
PUT    /api/projects/{projectId}/edit
GET    /api/projects/{projectId}/validation
```

現行の project character mutation（CV-05 実装）は、VOICEVOX 話者と `CharacterVisualBinding` を `project.json` へ保存する責務を持つ。`CharacterVisualSet` の visual / variant / file metadata は `GET /api/character-visuals` 系の workspace catalog から取得し、project API が SQLite へ project binding を保存する設計にはしない。

ED-03〜ED-05 の edit mutation は `EditPlan` を `expectedRevision` 付きで保存する。`PUT /api/projects/{projectId}/edit` は台本の section order を受け付けず、video element の role / placement / order、登録済み Asset の `assetId` / `assetVersion` / `assetChecksum` / `projectMediaPath` snapshot、section BGM 0/1、volume だけを更新する。Asset の選択・差し替え時には `active` を要求するが、snapshot 後の live な status は出力条件にしない。Asset の取り込みと `project.json` 更新は、片方だけが成功した状態を残さない。

### 11.3 構成案と台本

```text
GET    /api/models
POST   /api/projects/{projectId}/outline/generate
POST   /api/projects/{projectId}/outline/regenerate-section
PUT    /api/projects/{projectId}/outline
POST   /api/projects/{projectId}/outline/review
POST   /api/projects/{projectId}/outline/approve
PUT    /api/projects/{projectId}/script
POST   /api/projects/{projectId}/script/review
POST   /api/projects/{projectId}/script/approve
```

AI 生成 API はエンドポイントに対応する `taskKind` をサーバー側で確定し、リクエストの `modelId` は実行時上書きとして任意に受け取る。上書きがない場合はプロジェクト設定から上記の優先順で解決し、解決結果が `null` の場合は実行を拒否する。生成に失敗した場合、既存の構成案または台本を変更しない。

構成案生成は任意の開始経路である。AI を使わない場合は WebUI の手入力開始操作から `PUT /api/projects/{projectId}/outline` で構成案を保存し、その後は AI 生成時と同じ編集・承認フローを使用する。台本の保存、現場素材用の generic 候補・Asset Search の利用、素材割り当て、音声生成は、台本承認を要求しない。generic 素材の UI は現在の標準 `/script` 右ペインを前提にせず、別画面または補助導線で扱う。キャラクタービジュアルの physical variant は別途 `project.json` の explicit reference を人間が選択する。

`script/approve` は旧クライアントおよび既存履歴との互換性のため残せるが、成功しても台本・ビジュアル・音声・出力の実行条件を変えない。通常の UI からは呼び出さず、保存後のレビュー結果または status 表示に限定して扱う。
`visuals/approve` も同じ互換扱いとする。通常の UI からは呼び出さず、素材検索、候補表示、割り当て、差し替え、解除、音声操作、`RenderManifest`、プレビュー、レンダリングの前提にしない。

### 11.4 用語

```text
GET    /api/terminology
POST   /api/terminology
GET    /api/terminology/{termId}
PUT    /api/terminology/{termId}
POST   /api/terminology/{termId}/deactivate
POST   /api/terminology/{termId}/activate
POST   /api/terminology/preview
GET    /api/terminology/{termId}/usages
```

### 11.5 キャラクタービジュアル

```text
GET    /api/character-visuals
POST   /api/character-visuals
GET    /api/character-visuals/{visualId}
PUT    /api/character-visuals/{visualId}
POST   /api/character-visuals/{visualId}/variants
PUT    /api/character-visuals/{visualId}/variants/{variantId}
POST   /api/character-visuals/{visualId}/variants/{variantId}/deactivate
POST   /api/character-visuals/{visualId}/variants/{variantId}/activate
```

The current mutation contract uses one multipart request to replace a complete variant. `POST .../deactivate` and `POST .../activate` persist variant status without deleting rows or managed files; inactive records remain visible in list/detail responses but are excluded from ordinary API/UI candidates. The generated SQL migration adds `character_variants.status` with a check constraint and backfills existing rows as `active`; `drizzle-kit push` is not part of the workflow.

The legacy character visual seed is used only when a visual ID is not yet present in SQLite. Startup must not compare or restore seed metadata, variant metadata, checksums, or library paths for an existing visual; SQLite is authoritative after initial registration.

Multipart character PNGs are streamed directly into workspace staging and capped at 32 MiB per file independently of the asset/video upload cap. A replacement uses a generation-qualified immutable `libraryPath`, keeps old referenced files untouched until the SQLite transaction commits, and removes old paths only afterward. Promotion or commit interruption therefore leaves the previous ready variant usable; unreferenced final/staging files are reported by orphan diagnostics and are not deleted automatically.

CV-02 で実装した API の責務は次のとおりである。

- 一覧・詳細は SQLite から `CharacterVisualSet` を読み、variant と管理された画像 URL を返す。TypeScript の静的配列を実在項目の一覧として使用しない。
- `POST /api/character-visuals/{visualId}/variants` は variant metadata と完全な file set を受け取る。`single-image` は `single`、`mouth-pair` は `closed` と `open` を同一リクエストに含め、全ファイルを検証できた場合だけ variant row と file metadata を永続化する。
- `PUT /api/character-visuals/{visualId}/variants/{variantId}` は、既存の完成 variant の complete file set だけを差し替える。対象 variant が存在しない場合、slot key が renderType に適合しない場合、または必須 slot を削除しようとする場合は拒否する。
- 作成・差し替えは一時領域で受信し、形式・PNG 構造・必須 slot・visual 基準キャンバス・checksum を検証してから管理領域へ移す。作成リクエストの slot 欠落は DB 行や最終ファイルを残さず失敗させる。
- ファイル保存と SQLite metadata 更新は、単一の SQLite/filesystem transaction とはみなさない。1つのアプリケーション操作として staged file、atomic rename、SQLite transaction、失敗時の compensating cleanup を組み合わせ、作成時の全ファイルまたは差し替え対象の新ファイルだけが未参照で残る場合は回収する。既存の有効ファイルを新規アップロード失敗で壊さない。クラッシュ残骸は orphan として診断する。
- `public/` へ直接保存せず、画像は Fastify の管理された配信経路から返す。WebUI に OS 絶対パスを返さない。
- 未登録の variant があることはエラーにしない。作成リクエストの必須 slot 欠落、checksum 不一致、基準キャンバス不一致は validation detail として返すが、variant を不完全な状態で永続化しない。
- `mentor` / `learner`、project ID、`ScriptLine.expression` の mapping はこの API の入力に含めない。

multipart の細部、status の enum/遷移、エラーコード、既存ファイル差し替えの版管理は CV-02 で固定する。

### 11.6 素材と割り当て

```text
POST   /api/assets
GET    /api/assets
GET    /api/assets/{assetId}
PUT    /api/assets/{assetId}
POST   /api/assets/{assetId}/deactivate
POST   /api/projects/{projectId}/visual-suggestions
PUT    /api/projects/{projectId}/visual-assignments
POST   /api/projects/{projectId}/visuals/approve
```

ここで扱う `visual-suggestions`、Asset Search、`visual-assignments` は現場動画・写真・帳票スキャン用の generic domain である。AI suggestion backend、Asset Service、検索 schema、`VisualAssignment` data は CV-04 / CV-05 で削除しない。キャラクターの variant picker はこの API 群へ混在させず、speaker に binding された CharacterVisualSet の active variant を対象にする。

### 11.7 音声、プレビュー、レンダリング

```text
GET    /api/voicevox/status
GET    /api/voicevox/styles
POST   /api/projects/{projectId}/voice/resolve-text
GET    /api/projects/{projectId}/lines/{lineId}/voice/query
GET    /api/projects/{projectId}/lines/{lineId}/voice/adjustment
PUT    /api/projects/{projectId}/lines/{lineId}/voice/adjustment
DELETE /api/projects/{projectId}/lines/{lineId}/voice/adjustment
POST   /api/projects/{projectId}/lines/{lineId}/voice/preview
POST   /api/projects/{projectId}/voice/generate
POST   /api/projects/{projectId}/voice/generate-all
GET    /api/projects/{projectId}/voice/status
POST   /api/projects/{projectId}/manifest/compile
GET    /api/projects/{projectId}/manifest
POST   /api/projects/{projectId}/render
GET    /api/projects/{projectId}/render/{runId}
POST   /api/projects/{projectId}/thumbnail/render
```

長時間処理は `202 Accepted` と `runId` を返し、状態取得 API で `queued`、`running`、`succeeded`、`failed` を確認する。単一プロセスの現行実装でも、HTTP リクエストをレンダリング完了まで保持しない。

## 12. 外部サービス

### 12.1 OpenRouter

- API キーは `OPENROUTER_API_KEY` からバックエンドだけが読む。
- 現行の既定モデルは `google/gemma-4-31b-it` とする。
- 構成案生成、台本生成、台本レビュー、ビジュアル検索意図、レイアウトレビュー、OpenCode の各用途は、用途識別のための `AiTaskKind` として定義済みである。これは各機能が利用可能または実装済みであることを意味しない。特に AI による台本初稿生成は現在対象外・将来拡張であり、本仕様では実装済みとして扱わない。用途別評価を行うまでは同じ共通モデルを使用する。
- OpenCode のエージェントは役割別に分けても、初期設定ではすべて `google/gemma-4-31b-it` を参照する。
- 実行ログには `taskKind`、解決されたモデル ID、モデル選択元 `run_override | task_override | default` を記録する。
- モデル一覧は認証済み利用可能モデルを取得し、text 出力と structured output 対応で絞り込む。
- WebUI のモデル選択では、入出力単価がともに `0` の `free` と、それ以外の `paid` を切り替えて表示できる。
- 構成案生成は非ストリーミングとする。
- structured output は strict JSON Schema を使用し、受信後に Zod で再検証する。
- ZDR 有効時はリクエストへ ZDR を指定する。
- data collection は常に deny とする。
- 同じモデル内の provider fallback は許可する。
- 別モデルへの自動 fallback はしない。
- 429、502、503 は上限付きで再試行し、`Retry-After` を優先する。
- 入力超過時に Markdown を暗黙に切り捨てない。

### 12.2 VOICEVOX

- 接続先は `VOICEVOX_ENGINE_URL`、既定値は `http://127.0.0.1:50021` とする。
- 起動確認に失敗した場合、音声操作だけを無効にし、編集内容は保持する。
- 接続時に `/speakers` を取得し、四国めたんとずんだもんの話者 UUID、および各話者の `ノーマル` に対応する style ID を解決する。
- 解決結果は接続中 ENGINE に対するランタイム情報として扱い、生成ロジックへ数値 ID をハードコードしない。話者 UUID は設定へ保存できるが、style ID は音声調整ファイル、音声インデックス、実行ログの生成履歴としてのみ記録する。
- 対象話者または `ノーマル` を一意に解決できない場合は、別スタイルへの自動 fallback を行わず音声操作を無効にする。
- セリフごとに `audio_query` を取得し、`cache/voicevox-query/{lineId}-{cacheKey}.json` へ保存する。
- WebUI は「基本」「アクセント」「詳細」の 3 段階で編集する。「基本」は全体パラメーター、「アクセント」はアクセント句とアクセント核、「詳細」はモーラ単位の音高、長さ、無声化を扱う。
- 編集中の試聴 WAV は一時キャッシュへ生成し、明示的な保存操作でのみ `voice-adjustments/{lineId}.json` を更新する。
- 項目単位のリセット、セリフ全体のリセット、キャラクター既定値への復帰を提供する。
- 音声生成時は未編集 query を基礎とし、`baseHash` が一致する手動調整を適用してから `synthesis` へ送る。
- `synthesis` の WAV を再エンコードせず保存する。
- ファイル名は `doc.md` 6.5 の規則に従う。
- 生成中にエラーが発生しても、以前成功した WAV と audio index を壊さない。

## 13. タイムラインコンパイラ

以下の `RenderManifest.characters[]`、`RenderManifest.lines[].characterVariantId`、`RenderManifest.characterVariants[]` は、8.1.1 の次期 `RenderManifest 2.3.0` model の出力である。旧 `RenderManifest 1.0.0` / `2.2.0` の互換モデルへ新しい意味を追加する仕様ではない。

入力:

- 検証済み `VideoProject`
- `audio-index.json`
- プロジェクトへ取り込んだ素材
- 素材の技術メタデータ
- `project.json` の `CharacterVisualBinding` と各 line の `characterVariantId`
- `EditPlan` の `assetId` / `assetVersion` / `assetChecksum` / `projectMediaPath` snapshot と project 内の動画・BGMファイル
- バックエンドが SQLite から取得して検証した `CharacterVisualCatalogSnapshot`

処理:

1. project schema を検証する。CV-05 で導入済みの binding / line reference を含むデータは、明示的に bump された schema version と migration を通過したものだけを受け付ける。
2. 出力条件と参照整合性を検証する。構成案の承認・最新性は確認するが、台本・ビジュアルの `approved` status は要求しない。
3. 全セリフに有効な音声インデックスがあることを確認する。
4. `CharacterVisualBinding.visualId` / `idleVariantId` と各 `ScriptLine.characterVariantId` を catalog snapshot と照合する。missing、inactive、cross-visual、speaker 不一致、必須 file slot 欠落、checksum 不一致は validation error とする。未選択 line に対して expression、tag、label、旧固定 mapping から代替しない。
5. valid な explicit reference から `RenderManifest.characters[].idleVariantId`、`RenderManifest.lines[].characterVariantId`、`RenderManifest.characterVariants[]` を解決する。compiler は SQLite を直接検索せず、渡された snapshot だけを使う。
6. `EditPlan` の snapshot について、project 内 `projectMediaPath` の存在、`assetChecksum` との一致、MP4 / MP3 の実ファイル形式を検証する。snapshot 作成後の live な Asset `status` は確認せず、Asset Service の SQLite を再検索しない。
7. 無音時間と音声長をフレームへ変換する。
8. セリフを累積して line range を作る。
9. visual assignment の line ID 範囲を frame range へ解決する。
10. section background を frame range へ解決する。
11. `EditPlan.videoElements` の cutin を、最初のセクションを除く `before_section` 境界へ `order` 順に挿入する。最初のセクション直前の cutin は validation error とする。
12. 先頭へ intro、末尾へ outro を挿入し、後続の section / line / visual / background の frame range を shift する。
13. shift 後の section range へ `EditPlan.sectionBgms` を解決し、動画要素の区間では BGM を再生しない。効果音をセリフ基準の位置へ統合する。
14. `RenderVideoInsert`、`RenderAudioTrack`、全体 duration、ハッシュ、チェックサムを確定し、Zod で検証する。
15. 一時ファイルから `cache/render-manifest.json` へ置換する。

失敗時は新しいマニフェストを保存せず、全エラーを line ID、assignment ID、パスと関連付けて返す。

## 14. WebUI

### 14.0 UI イメージ

![台本編集画面のUIコンセプト](./assets/webui-script-editor-concept.png)

この画像は Issue #87 時点の台本編集画面の情報設計を確認するための履歴コンセプトであり、現在の最終レイアウトではない。CV-04 で方針を確定し、CV-05 でセクションとセリフカードを中心とする 1 ペイン構成へ移行した。画像にある右側のビジュアル設定・候補・素材検索・表示設定 UI は標準制作画面から除去済みである。画像内の人物、素材、具体的な配色、細かな文言は確定仕様に含めない。

生成条件は [`webui-script-editor-concept.prompt.md`](./legacy/webui-script-editor-concept.prompt.md) に保存する。

画像内の人物は仮置きである。実装時のプレビューには 7.5 の四国めたん／ずんだもん音声へ対応するワシ型キャラクター素材を使用し、speaker chip と字幕の色も同じキャラクター色トークンへ置き換える。

### 14.1 画面

```text
/projects
/projects/new
/projects/{projectId}/brief
/projects/{projectId}/outline
/projects/{projectId}/script
/projects/{projectId}/edit
/projects/{projectId}/characters
/projects/{projectId}/visuals
/projects/{projectId}/voice
/projects/{projectId}/preview
/projects/{projectId}/thumbnail
/character-visuals
/assets
/terminology
/runs
```

ルーティング表現は採用フレームワークに合わせて変更してよいが、画面責務は維持する。

`/projects/{projectId}/script` はセクションとセリフカードを中心とする 1 ペインの台本画面である。各カードの「ビジュアルを変更」から modal picker を開き、speaker に project 上で binding された `CharacterVisualSet` の active variant だけを表示する。`project.json` の binding / line reference と、バックエンドが解決した `CharacterVisualCatalogSnapshot` を組み合わせ、選択結果をカード内へ統合する。画像読込失敗時は管理された配信 URL と対象 ID を表示し、DB に登録されていない物理素材を表示しない。台本、generic 素材 assignment、音声状態は同じ `project.json` の revision と自動保存で扱い、ワークスペース共通の visual metadata は `project.json` へ保存しない。

`/projects/{projectId}/edit` は独立した編集画面である。`script.sections` から導出した section card の順番と内容を読み取り専用で表示し、編集対象の video element card と BGM を追加で表示する。未編集状態では section card だけを表示する。

`/character-visuals` はプロジェクトに依存しないワークスペース共通の登録・管理画面である。サイドバーから開き、一覧、作成、基本情報編集、完全な variant の作成、既存 file slot の差し替え、status 更新を行う。全表情・全ポーズの一括登録は要求しない。未登録 variant は未登録として表示し、variant 作成フォームでは `single-image` の `single`、`mouth-pair` の `closed` / `open` を揃えるまで登録操作を完了できない。必須 slot 欠落や形式不正はフォームの validation として表示するが、不完全な variant は DB や管理領域へ保存しない。既存の完成 variant は complete file set 単位で差し替えでき、必須 slot の削除は行わない。`mentor` / `learner` の役割付与、プロジェクトへの自動紐付け、`ScriptLine.expression` との mapping はこの画面の責務に含めない。
`/projects/{projectId}/characters` は、`project.json` の VOICEVOX 話者と `CharacterVisualSet` の binding、および workspace SQLite の現在の snapshot を組み合わせた確認画面である。`visualId === characterId` を前提にせず、binding がない場合は「未設定」と表示する。catalog が inactive、missing、別 visual の参照を返した場合は自動代替せず validation error とする。

WebUI は SQLite、`library/character-visuals/`、ローカルファイルシステムを直接操作しない。Character Visual API が返す metadata と管理された画像 URL だけを使用する。

### 14.2 ワークフローステップ

```text
企画
  → 構成案（承認・最新性確認）
  → 台本（台本・キャラクタービジュアル・音声）
  → 編集（動画要素・セクション BGM）
  → 出力 validation
  → `RenderManifest` 生成
  → プレビュー／レンダリング
```

台本画面は台本承認・ビジュアル承認なしで、台本、セリフカード上のキャラクタービジュアル、音声生成・調整を行える。編集画面は台本の section 順を変更せず、登録済み Asset から video element と BGM を選択する。generic 素材の候補表示・素材割り当ては backend と保存データを維持し、必要な UI は別画面または補助導線で扱う。プレビュー、`RenderManifest` 生成、レンダリングは、構成案の承認・最新性、入力内容、編集要素、音声、素材参照、範囲、checksum、実ファイル形式などの validation に失敗した場合だけ無効化し、理由と修正先へのリンクを表示する。

### 14.3 台本画面

以下は現在の `/script` 制作画面の基本責務である。CV-05 で実装済みの画面は、台本・ビジュアル・音声を別々の承認工程へ戻さない。`ScriptLine.expression` は論理表情として編集し、physical variant は explicit `characterVariantId` として人間が選択する。

- 1 ペイン: セクションとセリフカードを主役にする。プレビュー、保存状態、validation は補助表示として統合してよい。
- 各セクション見出し: 台本の背景、セクション情報、音声状態の確認。BGM の編集は `/projects/{projectId}/edit` で行う
- セリフカード: ID、話者、論理表情、字幕、読み上げ、字幕プレビュー、音声状態、選択中 variant の preview / label / renderType、未選択表示、ビジュアル変更ボタン、並べ替え、複製、削除
- 「ビジュアルを変更」modal picker: speaker に binding された `CharacterVisualSet` の active variant だけを表示し、preview、label、renderType、tags、選択中状態を表示する。`mouth-pair` は `closed` / `open` を表示する。
- picker のタグ: 未指定では全 active variant を表示し、指定時は一致数の多い順へ移動するだけ。不一致を除外せず、同点は catalog snapshot の元順序を維持する。
- 話者付きテキストの一括貼り付けと機械的なカード分割
- `spokenText` に登録用語が含まれる場合、解決後読み上げと適用用語を表示
- 変更は自動保存する。`characterVariantId` の未選択、missing、inactive、cross-visual、binding 不一致は validation として表示し、expression、tag、label から代替しない。

現在の標準 `/script` 画面には、現在の編集対象、制作 ビジュアル候補、AI ビジュアル候補 UI、手順3-3 素材検索、素材検索結果、素材制作・表示設定カードを置かない。AI visual suggestion、Asset Search、generic `VisualAssignment` は backend とデータを維持し、必要なら別画面または補助導線で再利用する。

### 14.4 編集画面とサムネイル

`/projects/{projectId}/edit` では、台本の section card を固定したまま、登録済み Asset だけで編集する。

- 未編集状態では `script.sections` から導出した section card だけを表示する。
- `intro` は先頭セクション前に最大 1 件、`outro` は末尾セクション後に最大 1 件、`cutin` は最初のセクションを除く `before_section` 境界に 0 件以上配置する。同じ境界の cutin は video element card の順序だけを drag & drop で変更できる。最初のセクション直前への cutin は許可しない。
- section 自体の追加、削除、並べ替え、内部任意時刻への cutin 配置はこの画面の責務に含めない。
- video element picker は選択・差し替え時点で active な `video` Asset のうち `.mp4`、`video/mp4`、MP4 container を満たすものだけを候補にする。BGM picker も選択・差し替え時点で active な `bgm` Asset のうち `.mp3`、`audio/mpeg`、MP3 を満たすものだけを候補にする。OS path と任意ファイルは受け付けない。
- video element は追加、差し替え、削除、音量調整を行い、BGM はセクションごとに追加、差し替え、解除、単体試聴、音量調整を行う。
- 動画と BGM の volume は 0〜1 とする。BGM は対象 section の全区間を固定 loop し、動画要素の区間では前後 section の BGM を再生しない。開始オフセット、トリム、フェード、音量キーフレーム、自動ダッキング、クロスフェードは提供しない。
- 選択した Asset は、本体の `version` / `checksum` を `assetVersion` / `assetChecksum` として `assetId`、`projectMediaPath` とともに `project.json` の `edit` snapshot へ保存し、素材ライブラリの後続変更から切り離す。

編集画面の保存時と出力前に、role と配置可能な境界、同一境界内の順序、最初のセクション直前への cutin、intro / outro の重複、BGM の section 重複、project 内ファイルの存在、MP4 / MP3 の実ファイル形式、`assetChecksum`、volume を validation する。`active` は選択・差し替え時だけ要求し、snapshot 後の live な Asset `status` は出力時に検証しない。

- サムネイル画面ではタイトルと部門名または対象システム名を必須入力とし、補足、版数、背景画像、代表ビジュアル、キャラクターは任意入力とする。
- サムネイルは固定テンプレートの 1280 × 720 プレビューを常時表示し、キャラクターの表示・非表示と、四国めたん側・ずんだもん側の選択を可能にする。

### 14.5 エラー表示

少なくとも次を区別する。

- 入力不正
- revision 競合
- 構成案の未承認または source hash の不一致
- 台本の構造不正、`outlineHash` 不一致、話者・発話の欠落
- 素材参照切れ、assignment 範囲外、checksum 不一致
- 音声の missing、stale、生成失敗、VOICEVOX 接続不可
- `RenderManifest` の生成・検証エラー

- script/visual の `approved` status は、上記 validation blocker とはみなさない。
- 未解決の要確認事項
- モデル未選択
- OpenRouter 認証、残高、非対応、入力超過、一時障害
- VOICEVOX 未起動、対象話者または標準スタイルの解決失敗、合成失敗
- 素材参照切れ、チェックサム不一致、範囲外
- レンダリング失敗

## 15. 検証と依存アーティファクトの stale 規則

| 変更 | stale または再検証が必要になる依存アーティファクト |
|---|---|
| Markdown または企画条件 | 構成案と、その下流の台本・ビジュアル・音声・Manifest |
| 構成案の内容または source hash | 台本の `outlineHash`、ビジュアル候補の検索コンテキスト、出力 validation |
| 台本のセリフ追加・削除・順序変更 | ビジュアル assignment の範囲、音声、Manifest |
| `spokenText`、話者、音声設定 | 対象音声、Manifest |
| `subtitleText`、表情 | Manifest |
| character の `visualId` / `idleVariantId` binding | キャラクター確認画面、Manifest |
| line の `characterVariantId` | 該当 line、Manifest |
| CharacterVisualSet の status、variant files、checksum | binding / line variant validation、Manifest |
| ビジュアル割り当て | Manifest |
| 背景、`EditPlan.videoElements`、`EditPlan.sectionBgms`、BGM / 動画の volume、効果音 | Manifest |
| サムネイル構成 | サムネイル出力 |
| 用語の読みまたは状態 | 該当セリフの音声 |

「見直し対象」は既存ファイルの削除を意味しない。古い生成物を stale と表示し、新しい生成が成功するまで保持する。

`needs_review`、`stale`、`missing` は依存生成物の再生成や出力 validation のための状態であり、script/visual の人間による承認を再要求するための状態ではない。構成案の承認・最新性だけは台本の作成元と現在の制作コンテキストを確認するために維持する。

## 16. 検証

### 16.1 保存前

- Zod strict schema
- ID の形式、重複、不正参照
- 数値範囲
- 相対パスの安全性
- `CharacterVisualSet` の `visualId`、`variantId`、file slot、library path の重複
- `library/character-visuals/{visualId}/{variantId}/` namespace と安全な相対パス
- `single-image` の `single`、`mouth-pair` の `closed` / `open` スロット
- 必須 slot 欠落の variant 作成リクエストを拒否し、variant row や最終ファイルを残さないこと
- 既存の完成 variant の complete file set 差し替え失敗時に、旧ファイルと旧 metadata を維持すること
- 管理領域のファイル存在、許可 MIME type、checksum、PNG 技術情報
- PNG signature、chunk 構造、CRC、IHDR、IDAT/IEND、alpha / `tRNS`
- visual ごとの最初の完成 variant から決まる基準キャンバスとの一致
- `mouth-pair` の `closed` / `open` キャンバス一致
- 未登録 variant が set 全体のエラーになっていないこと
- セクションとセリフの順序
- `EditPlan` の video element の role / placement / order、cutin の最初のセクション直前配置拒否、intro / outro の最大 1 件制約、section BGM の 0/1 重複
- 編集 Asset の `assetId`、`assetVersion`、`assetChecksum`、`projectMediaPath`、選択・差し替え時の active 状態、MP4 / MP3 の MIME・実ファイル形式。出力時に live な Asset `status` を要求しないこと
- 動画要素と BGM の volume が 0〜1 であること。`muted`、loop、開始オフセット、トリム、fade を現行 `EditPlan` へ保存しないこと
- 効果音の素材種別、参照先、チェックサム、カテゴリ、オフセット、音量
- サムネイルの必須タイトルと部門・対象システム名

### 16.2 制作・出力前 validation

- 構成案の role 順序、未解決質問、承認状態、source hash の最新性
- 台本の空セリフ、話者、`outlineHash`、section/line 参照
- ビジュアルの割り当て範囲、素材状態、チェックサム、機密区分
- 編集要素の境界、実尺、Asset snapshot、project 内ファイルの存在・`assetChecksum`、MP4 / MP3 validation、BGM の最終 section 範囲、動画要素中の BGM 停止。Asset Service の SQLite や snapshot 後の live な status を入力にしないこと
- character binding の visual / idle variant、line の `characterVariantId` が存在し、active で、speaker に binding された同一 visual 配下であること。missing、inactive、cross-visual は自動代替しない。
- 音声の current/stale/missing、生成エラー、音声 index の参照
- 前工程の revision、assignment 範囲、Manifest の入力ハッシュ

この validation は保存・編集を一律に止めるものではない。該当する候補、音声操作、プレビュー、Manifest、レンダリングだけを、必要な条件が満たされるまで無効化する。

### 16.3 音声生成前

- VOICEVOX 接続
- 全キャラクターについて `/speakers` から話者 UUID と `ノーマル` の style ID を一意に解決できること
- 空でない `spokenText`
- 用語適用結果
- 音声パラメーターの範囲
- 調整ファイルの Zod 検証
- 調整ファイルの `lineId` と `baseHash`

### 16.4 レンダリング前

- 最新 `RenderManifest` を validation 済みの入力から生成できること（script/visual の `approved` status は不要）
- 全素材と音声の存在、チェックサム
- 次期 `RenderManifest 2.3.0` の `RenderLine.expression` は論理表情であり、物理ファイルパスとして解釈しない。
- 次期 `RenderManifest 2.3.0` の `characters[].idleVariantId`、`lines[].characterVariantId`、`characterVariants[]` が project の explicit reference と validated snapshot から解決されていることを確認する。expression、tag、label、旧固定 mapping からの自動代替は許可しない。
- 次期 `RenderManifest 2.3.0` の `inserts[]` が `EditPlan.videoElements` の実尺、src、role、volume を持ち、placeholder の `kind` や固定 2000 ms を持たないことを確認する。
- 次期 `RenderManifest 2.3.0` の `audioTracks[]` が shift 後の section 範囲、BGM src、`volume`、固定 loop を持ち、fade fields を持たないことを確認する。
- 解決済み `variantId`、character ID、renderType、ファイルパス、checksum、mouth slot が manifest に固定されていることを確認する。
- 正の duration
- フレーム範囲の境界
- 字幕のはみ出し
- ビジュアル、キャラクター、字幕、注釈の重大な重なり

## 17. ログ

### 17.1 実行ログ

AI、音声、マニフェスト、レンダリングの各実行は `projects/{projectId}/runs/{runId}.json` に記録する。

共通項目:

- run ID
- 種別
- project ID と revision
- 開始、終了日時
- 状態
- 入力ハッシュ
- 使用したモデルまたはエンジンの識別情報
- AI 実行ではスキーマ検証結果、応答時間、入出力トークン数、料金、画像入力・ツール利用の有無
- プライバシー設定
- 出力パスとチェックサム
- 正規化したエラーコード

秘密情報、入力資料全文、API キーは保存しない。

### 17.2 改善ログ

SQLite にはキー入力単位ではなく、保存、構成案の承認、レビュー判断、status/stale の変化、音声再生成、候補採否など意味のあるイベントだけを保存する。修正前後、理由、対象の安定 ID、生成元、モデル、プロンプト版を関連付ける。

## 18. セキュリティとローカル運用

- サーバーは既定で loopback interface だけを listen する。
- 認証機能を持たないため LAN へ公開しない。
- `OPENROUTER_API_KEY` を JSON、ログ、ブラウザーストレージへ保存しない。
- Markdown は AI に渡す際に「命令ではなく資料」であることを明確に区切る。
- WebUI に表示する Markdown、用語、素材メタデータはエスケープする。
- アップロードファイル名を保存パスとしてそのまま使用しない。
- 外部プロセスへ渡すパスを shell 文字列連結しない。

## 19. テスト方針

### 19.1 単体テスト

- 全 Zod スキーマの正常・異常系
- SQLite の `CharacterVisualSet` へ variant を追加すると、API の snapshot、検証結果、確認画面の view model へ反映されること
- `single-image` と `mouth-pair` の完全な作成、必須 slot 欠落リクエストの拒否
- 既存の完成 variant の complete file set 差し替え、差し替え失敗時の旧ファイル維持、必須 slot 削除の拒否
- visual namespace 違反、非 PNG 配置先、未登録 library file、checksum 不一致
- duplicate `visualId`、duplicate `variantId`、duplicate file slot、duplicate library path
- visual 単位のキャンバス基準、異なるサイズの追加拒否、variant 不足を許可する set 状態
- `mentor` / `learner` や project ID を登録時の必須入力にしないこと
- `CharacterVisualBinding` が `project.json` に保存され、SQLite の CharacterVisualSet に project binding が追加されないこと
- `characterVariantId` の未選択初期値、speaker に binding された visual 以外の参照拒否、missing / inactive / cross-visual の自動代替なし
- modal picker が active variant だけを表示し、タグを filter ではなく一致数順の sort 補助として扱い、mouth-pair の closed/open を表示すること
- `public/` への直接保存を拒否し、Fastify の管理された配信 URL だけを返すこと
- 用語の正規化、最長一致、優先度、除外
- ミリ秒からフレームへの変換
- セリフ累積と半開区間
- assignment の line range 解決
- `EditPlan` の role / placement validation、最初のセクション直前 cutin の拒否、intro / outro 最大 1 件、同一境界 order
- 選択・差し替え時だけ active Asset を要求し、snapshot 後は project 内ファイルの存在・checksum・実形式だけで出力検証すること
- `1.1.0 → 1.2.0` migration が旧 BGM を復元せず、sectionId・旧 path・旧 volume を `logs/migration-log.jsonl` へ永続化すること
- source/project/asset hash
- 構成案の承認・最新性、status/stale の遷移、依存生成物の validation
- パストラバーサル拒否

### 19.2 統合テスト

- project revision 競合
- Markdown と hash の一体保存
- 素材コピーと project update の成功、ロールバック
- SQLite migration と P2-01 の 2 visual / 6 variant / 10 PNG seed の idempotency
- project schema version bump と migration が `1.0.0` / `1.1.0` の意味を暗黙変更せず、`1.1.0 → 1.2.0` で旧 placeholder を空状態へ移し、旧 BGM を `edit.sectionBgms` へ推測復元せず、sectionId・path・volume を `logs/migration-log.jsonl` へ永続化すること
- キャラクタービジュアルの staged file、atomic rename、checksum 検証、SQLite transaction、compensating cleanup、orphan 診断
- OpenRouter 成功、schema 違反、429、認証失敗
- VOICEVOX query と WAV のキャッシュ
- 音声調整の保存、再読込、リセット、base hash 不一致時の適用拒否
- `EditPlan` の MP4 video element、MP3 BGM、volume、固定 loop、cutin / intro / outro の timeline 計算
- 効果音の発話開始相対オフセット、複数設定、3 音以上の同時再生警告
- 任意項目がすべて未設定のサムネイル生成
- `VideoProject` から `RenderManifest` 生成
- explicit character binding / line variant と validated catalog snapshot から、次期 `RenderManifest 2.3.0` の `characters[].idleVariantId`、`lines[].characterVariantId`、`characterVariants[]`、`inserts[]`、`audioTracks[]` を解決すること
- レンダリングジョブの状態遷移

外部 API は fixture またはローカル stub を使用し、通常のテスト実行で課金や実サービス依存を発生させない。

### 19.3 E2E

最低 1 つの fixture project で次を自動化する。

1. プロジェクト作成
2. Markdown と企画条件保存
3. 構成案の取り込み、編集、承認・最新性確認
4. ワークスペース準備として `/character-visuals` の初期 seed を確認し、一部 variant が未登録の visual と完全な mouth-pair variant を再読込する
5. 2 キャラクター、複数セリフの台本作成と、セリフカードからのキャラクタービジュアル・音声制作
6. 台本・ビジュアルの承認操作なしで制作を続け、stale/missing validation を確認する
7. 固有名詞登録と読み上げ解決
8. 動画、写真、帳票の 3 種類の素材登録と割り当て、および効果音素材の登録
9. 編集画面で登録済み MP4 の intro / cutin / outro と MP3 BGM を選び、section card を固定したまま video element card だけを並べ替える
10. fixture WAV と編集 Asset snapshot から validation を通した `RenderManifest 2.3.0` 生成
11. 代表フレームの画像比較
12. 短い MP4 とサムネイルの生成

## 20. MVP 開発時の実装順序（履歴）

この節は MVP を完成させるために使用した施工時系列を履歴として保持するものであり、現在の仕様や今後の開発順序を定義しない。Phase 0〜6 と各項目は MVP 開発完了済みの過去の判断・作業記録である。現在の仕様は本書の各機能節と `doc/doc.md` を参照し、今後の作業順序は GitHub Issue で管理する。

### Phase 0: 基盤

- Node.js、pnpm、TypeScript、lint、format、test
- Zod スキーマ
- project repository と原子的保存
- SQLite migration と repository
- 共通エラー形式

### Phase 1: 企画と構成案

- プロジェクト画面
- Markdown、企画条件
- OpenRouter モデル一覧（`free` / `paid` 絞り込み）と構成案生成・手入力開始
- 構成案編集、要確認事項、承認（この承認境界は維持）

### Phase 2: 台本と用語

- 2 キャラクター設定
- 台本編集と一括入力
- 固有名詞・社内用語 CRUD
- 読み上げ解決プレビュー
- 台本の構造 validation、依存音声・ビジュアルの stale 検出、承認なしの制作操作

### Phase 2 後続（履歴）: キャラクタービジュアル登録

P2-01 は当時の 2 キャラクター静的素材確認の実装履歴として残す。現在の動的登録方式について、次の CV-00〜CV-05 の施工履歴を保持する。

1. **CV-00 仕様書改訂**: `doc/doc.md`、本書、`doc/legacy/development-plan-chatgpt-codex.md` の静的カタログ前提を動的 `CharacterVisualSet` 方式へ揃えた。コード実装は行わなかった。
2. **CV-01 動的カタログ基盤**: workspace SQLite の schema / migration、`CharacterVisualSet`・variant・file の repository、既存 2 visual / 6 variant / 10 PNG の idempotent seed を実装した。
3. **CV-02 登録 API・ファイル管理**: Fastify API、管理領域への保存、形式・checksum・slot・visual 単位キャンバス検証、管理された画像配信を実装した。
4. **CV-03 折りたたみサイドバー・登録 UI**: `/character-visuals` の一覧・登録・編集 UI とサイドバー導線を実装した。プロジェクトの role 固定、expression mapping、project 選択は含めていない。
5. **CV-04 仕様書改訂**: Issue #97 に基づき、3文書の現在仕様を human explicit selection、project.json binding、line explicit variant、1 ペイン ScriptPage、modal picker、CharacterAssetsPage の project binding 基準、explicit compiler 解決、schema version bump / migration 要件へ更新した。CV-04 は文書のみとし、コード、schema、migration、API、UI、compiler、Remotion は変更しなかった。
6. **CV-05 人間主導のキャラクタービジュアル選択実装**: Issue #98 に基づき、明示的な schema version bump、migration、project.json の character binding / line variant 保存、ScriptPage の 1 ペイン化と modal picker、CharacterAssetsPage の binding + snapshot 表示、validation、compiler / RenderManifest / Remotion の explicit variant 解決を実装した。AI suggestion、Asset Search、generic `VisualAssignment` backend は削除していない。

CV-00〜CV-03 は `/projects/{projectId}/script` の script-centric 制作画面を置き換えず、ワークスペース共通の登録ライブラリを追加した履歴である。CV-04 で仕様を確定し、CV-05 で制作画面と compiler の責務を更新した。RenderManifest/compiler/Remotion は SQLite を直接参照せず、validated catalog snapshot を受け取る。

### Phase 3: 素材とビジュアル

- 素材登録、サムネイル、タグ、検索
- AI 検索意図
- 素材ピッカー
- プロジェクトへの取り込み
- 表示設定、静的注釈、assignment 範囲 validation

### Phase 4: 音声

- VOICEVOX 接続確認、`/speakers` 読み込み、標準スタイル `ノーマル` の ID 解決
- query、WAV、audio index
- 差分再生成
- 基本、アクセント、モーラ詳細の編集とセリフ単位の試聴
- `voice-adjustments/{lineId}.json` の保存、stale 判定、リセット

この Phase では数値の style ID を事前決定しない。接続中の ENGINE から `ノーマル` の ID を解決できることを完了条件とする。

### Phase 5: 動画

- タイムラインコンパイラ
- Remotion コンポーネント
- WebUI プレビュー
- MP4、サムネイル
- セクション別 BGM と境界フェード
- `confirm`、`attention`、`warning` の任意効果音、合成試聴、重複警告
- opening、ending、eye catch の 2 秒プレースホルダー
- 検証と代表フレーム比較

### Phase 6: 改善ログ

- AI レビュー
- 判断ログ
- 正解例
- 検索、集計、エクスポート

## 21. MVP 開発時の決定事項と現在の将来拡張

21.1 と 21.2 は MVP 開発時の判断・設計ゲートを履歴として保持する。現在の未実装事項を示す一覧ではない。21.3 は現行仕様における将来拡張・利用実績に基づく評価項目である。

### 21.1 MVP 開発時に確定した事項（履歴）

1. **WebUI フレームワークとローカルサーバー構成**  
   Vite + React SPA、Fastify API、製品実行時は Fastify から同一 origin 配信する構成を採用する。

2. **SQLite ドライバーとマイグレーション手段**  
   better-sqlite3 + Drizzle ORM + Drizzle Kit、起動時 migration を採用する。

3. **パッケージの具体的なバージョン**  
   4.4 のバージョン表を初期固定値として採用する。

4. **AI の MVP モデル**  
   全 AI 用途の MVP 初期値を `google/gemma-4-31b-it` とした。用途別モデルの本採用は利用実績に基づく将来評価とし、MVP 開発時点では決定事項にしなかった。

5. **VOICEVOX の既定スタイル**  
   四国めたんとずんだもんはいずれも標準スタイルの `ノーマル` を使用する。数値の style ID は `/speakers` から実行時に解決し、ソースコードまたは初期データへハードコードしない。

6. **キャラクタービジュアルとテーマ**
    P2-01 で確認済みの初期 2 キャラクター、6 variant、10 PNG は、CV-01 で `CharacterVisualSet` として workspace SQLite へ idempotent に seed / migration する。TypeScript の `characterVariantCatalog` は型または DB snapshot として残せるが、実在項目の静的正本にはしない。各 visual は一部 variant が未登録でもよく、variant 内では `single-image` の `single`、`mouth-pair` の `closed` / `open` を必須とする。初期 seed は 600 × 1000 px だが、キャンバス基準は visual 単位で持ち、全体固定値にはしない。ファイルは `library/character-visuals/{visualId}/{variantId}/` に保存し、`public/` へ直接保存しない。登録時点で `mentor` / `learner` や project へ紐付けない。`ScriptLine.expression` の論理表情と物理 variant の mapping は登録機能とは分離する。`VideoProject 1.0.0` の互換 `visualAssets` は維持するが、物理素材の正本とはしない。

7. **Issue #97 / CV-04 のキャラクタービジュアル選択方針**
   人間による explicit selection を通常経路とする。`CharacterVisualSet` の catalog 正本は workspace SQLite、project-specific な VOICEVOX ↔ visual binding と idle variant、line の `characterVariantId` は `project.json` の正本とする。`expression`、tag、label、旧固定 mapping から physical variant を自動選択・代替しない。`/script` は 1 ペインのセリフカード中心、picker は speaker-bound active variant の modal、タグは sort 補助、`/characters` は binding + snapshot の確認画面とする。AI suggestion、Asset Search、generic `VisualAssignment` backend は維持する。

8. **CV-05 の schema versioning / migration 境界**
   project data の意味を変更するため、`schemaVersion: "1.0.0"` を暗黙に再利用せず、explicit version bump と migration を実装する。migration は SQLite の tag / label を検索して visual / variant を推測しない。旧固定 mapping を既知の compatibility input として決定論的に利用できる場合だけ使い、解決不能なデータは未設定として人間の確認を要求する。

9. **効果音の採用範囲**
   効果音は任意とし、`confirm`、`attention`、`warning` の 3 用途だけを採用する。セリフ開始からの相対時間で 1 セリフへ複数設定でき、素材ライブラリから選択する。初期音量は `0.2`、3 音以上の同時再生とナレーションより大きく聞こえる場合は警告するが、保存は原則として禁止しない。

10. **イントネーション編集の正本と UI**
   未編集の `audio_query` は派生キャッシュ、人間が確定した調整は `voice-adjustments/{lineId}.json` に保存する。WebUI では基本、アクセント、モーラ詳細の 3 段階で編集する。

11. **BGM**
   MVP からセクションごとに 0 件または 1 件の曲を設定する。固定音量、ループ、前後フェードを扱い、自動ダッキングとクロスフェードは行わない。

12. **サムネイル**
    タイトルと部門名または対象システム名だけを必須とし、補足、版数、背景、代表ビジュアル、キャラクター表示は任意とする。レイアウトは `standard` を採用する。

13. **OP、ED、アイキャッチ**
    MVP では本番素材を生成せず、OP と ED は常設、アイキャッチは選択したセクション境界へ、いずれも 2 秒の無音プレースホルダーを挿入する。

### 21.2 MVP 開発時の設計ゲート（履歴）

VOICEVOX の数値 style ID は実装前に人間が決定する値ではなく、Phase 4 で接続中 ENGINE から解決する、という MVP 開発時の設計ゲートを記録する。キャラクター素材について CV-04 で責務を確定し、CV-05 実装前に確認した実装詳細を履歴として残す。以下を現在の未実装判定に使用しない。

- `CharacterVisualBinding` と `ScriptLine.characterVariantId` の既存 schema 命名への適合
- `schemaVersion` の bump 値と `1.0.0` からの migration の具体的手順
- snapshot の版または更新時点と variant version の表現
- `RenderManifest 2.2.0` の `visualId` 分離、共有 physical variant、`characterMappingVersion` の compatibility-only 扱いは CV-05 で確定済み
- 登録 API の multipart 形式、status の enum/遷移、file version の詳細

論理表情から physical variant への既定 mapping、tag / label による推測、missing / inactive / cross-visual の自動代替は未決事項ではなく、採用しない仕様として確定している。

P2-01 は当時の静的カタログと検証を実装した履歴として残す。現在の登録機能では CV-01 の SQLite seed / migration、CV-02 の API・ファイル管理、CV-03 の `/character-visuals` UI が実装済みである。上記の設計ゲートを理由に、SQLite を静的カタログへ戻したり、プロジェクトへ role 固定の visual metadata を埋め込んだりしない。

### 21.3 現在の将来拡張・利用実績で判断する事項

| 項目 | 判断内容 | 判断時期 |
|---|---|---|
| 用途別 AI モデル | Gemma 4 31B から別モデルへ分離する用途と評価基準 | 用途別のスキーマ検証通過率、修正量、根拠のない情報、速度、トークン、料金、画像・ツール要件の記録後 |
| OCR・文字起こし | 帳票や動画内容を検索可能にするか | 素材増加により手動タグ付けが負担になってから |
| ベクトル検索 | 意味の近い素材を検索するか | タグ検索と全文検索の不足が確認されてから |
| 音量解析型口パク | WAV 音量に合わせた口パクへ移行するか | 定周期口パクの品質確認後 |
| 複数レイアウト | キャラクター配置プリセットを増やすか | 実動画で標準配置の不足が発生してから |
| AI 台本初稿 | AI に最初の台本を書かせるか | 正解例と評価基準が十分に蓄積してから |
| SQLite 運用バックアップ | 定期バックアップ周期、復旧 UI、UTF-8 JSON Lines（拡張子 `.jsonl`）による標準エクスポート | 最低限の migration 前バックアップ運用後、利用実績と復旧要件を確認してから |
| 編集動画要素の追加拡張 | cutin の自由配置、トリム、可変速度、音声付き要素などを追加するか | ED-01〜ED-09 の利用実績と編集負荷を確認した後 |
| 効果音ラウドネス正規化 | 素材登録時に音量解析と正規化を行うか | 効果音素材ごとの音量差が運用上の問題になってから |

上表は現行仕様における将来拡張と、利用実績に基づく評価項目である。実装の優先順位や受け入れ条件は、今後の GitHub Issue で定義する。

## 22. MVP 開発開始時の完了条件（履歴）

この節は MVP 開発を開始する際に使用した完了条件の履歴である。MVP の対象実装は完了済みであり、ここに記載する条件は現在の未実装作業、Phase の開始条件、今後の開発順序を示さない。CV-04 の完了は当時の文書仕様確定を意味し、CV-05 の実装完了前に確認した条件も含む。

当時は、21.1 の実装判断が確定し、21.2 の設計ゲートが解消されたことを確認したうえで、依存関係導入直後に 4.4 のスモークテストを実施した。以下は当時の MVP 基盤完了条件である。

- 空のプロジェクトを Zod で生成、保存、再読込できる。
- 不正 JSON を既存ファイルへ上書きしない。
- revision 競合を検出できる。
- SQLite migration を空 DB と既存 DB の両方へ適用できる。
- 用語レコードを登録し、決定論的に読み上げ文へ適用できる。
- `VideoProject` と `RenderManifest` の型が UI、API、コンパイラで共有される。
- JSON Schema の外部公開物を生成しない。

## 23. ED-01〜ED-09 の実装境界

ED-00 はこの文書の仕様確定だけを行い、以下の後続 Issue へ実装責務を分割する。ここで定義した `EditPlan`、Asset snapshot、volume、固定 loop、配置規則を越える自由編集機能は追加しない。

| Issue | 実装責務 |
|---|---|
| ED-01 | `VideoProject 1.2.0`、`EditPlan`、schema / Zod、`1.1.0 → 1.2.0` migration。旧 placeholder は空状態へ移し、generic `VideoDisplay.muted` を `volume` へ変換し、旧 BGM path は架空 Asset にせず `logs/migration-log.jsonl` へ sectionId・path・volume を記録する。 |
| ED-02 | `Asset.kind = "bgm"`、MP4 / MP3 の拡張子・MIME・実ファイル形式 validation。 |
| ED-03 | 編集 Asset の候補取得、安全な project 取り込み、`assetId` / `assetVersion` / `assetChecksum` / `projectMediaPath` snapshot API。選択・差し替え時だけ Asset を active とし、出力時は project 内 snapshot を検証する。 |
| ED-04 | workflow 表示の「制作」→「台本」、`/projects/{projectId}/edit` の画面骨格、section card の読み取り専用表示。 |
| ED-05 | video element card、MP4 / BGM picker、追加・差し替え・削除・解除、volume UI、保存 validation。 |
| ED-06 | section card を並べ替えず、video element card だけを同一境界内で drag & drop する処理。 |
| ED-07 | ED-01 で変換済みの generic `VisualAssignment` の `VideoDisplay.volume` を UI、API、compiler、Remotion で扱う。`muted → volume` の schema / migration 変換は担当しない。 |
| ED-08 | `RenderManifest 2.3.0`、実動画 `RenderVideoInsert`、timeline shift、最終 section BGM range の compiler。 |
| ED-09 | Remotion、preview、MP4、編集画面の E2E、実素材形式・音量・BGM 停止の検証。 |
