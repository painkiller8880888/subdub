# Remotion 社内マニュアル動画制作システム 実装仕様書

文書版: 0.2  
作成日: 2026-07-28  
更新日: 2026-08-02  
上位仕様: [`doc.md`](./doc.md)

## 1. 目的

本書は `doc.md` の方針を、実装担当者がモジュール、データ型、API、保存処理、検証、テストへ落とし込める粒度まで具体化するための文書である。

本書では次の状態を区別する。

- **確定**: 現時点で実装仕様として採用する。
- **TBD**: 判断材料または利用素材が不足しており、値や挙動を確定しない。
- **初期対象外**: 拡張点は確保するが、MVP では実装しない。

`doc.md` と本書が矛盾する場合は、要求と目的については `doc.md` を優先し、実装の詳細については本書を更新して整合させる。

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

- WebUI、OpenCode、レビュー、その他プロジェクト内外の AI 用途は、MVP では Gemma 4 31B Instruct を共通モデルとする。
- OpenRouter の初期モデル ID は `google/gemma-4-31b-it` とする。
- `:free` variant は既定にせず、人間がモデル選択画面から明示的に選択した場合だけ使用する。
- AI 呼び出しは用途を `AiTaskKind` で識別するが、MVP の用途別上書きは空とし、すべて共通モデルへ解決する。
- 用途別モデルへの分離は MVP 後の評価事項とする。MVP の該当機能を実装する前に別モデルを決める必要はない。
- 用途別の評価では、スキーマ検証通過率、人間による修正量、根拠のない情報を追加した回数、応答時間、入出力トークン数と料金、画像入力またはツール利用の必要性を記録する。
- モデルの差し替えに生成ロジックの変更を必要としない構造にする。
- モデル ID を生成ロジックへハードコードしない。
- モデル未選択の場合、AI を使う操作だけを実行不可にする。非 AI の編集、素材管理、音声生成、プレビュー、レンダリングは利用可能とする。
- 実行ごとに選択されたモデル ID、プロバイダー、プライバシー設定、用途別評価に必要な計測値を実行ログへ記録する。

### 2.6 その他の推奨案

`doc.md` の「推奨案」は、本書で明示的に変更した事項と競合しない限り採用する。

## 3. MVP のスコープ

### 3.1 MVP に含める

1. ローカル単一ユーザー向け WebUI
2. プロジェクトの作成、一覧、読み込み
3. Markdown と企画条件の編集、自動保存
4. OpenRouter による構成案生成、編集、承認
5. 2 キャラクター形式の人力台本編集、承認
6. 固有名詞・社内用語の登録、検索、読み上げへの適用
7. 素材ライブラリへの動画、写真、帳票スキャン、効果音の登録
8. タグ検索および AI による検索意図の生成
9. 台本範囲へのビジュアル割り当て
10. VOICEVOX によるセリフ単位の WAV 生成、セクション BGM、任意の効果音設定
11. `RenderManifest` の生成
12. Remotion による同一マニフェストのプレビューと MP4 出力
13. サムネイルのプレビューと画像出力
14. 機械検証、承認ゲート、意味のある操作のログ

### 3.2 初期対象外

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

## 4. アーキテクチャ

### 4.1 コンポーネント

```text
WebUI
  │
  ▼
Local Backend API
  ├─ Project Service ───── projects/{projectId}/project.json
  ├─ Asset Service ─────── library/media + SQLite
  ├─ Terminology Service ─ SQLite
  ├─ OpenRouter Adapter ── OpenRouter API
  ├─ VOICEVOX Adapter ──── Local VOICEVOX ENGINE
  ├─ Timeline Compiler ─── RenderManifest
  ├─ Validation Service
  └─ Render Service ────── Remotion / FFmpeg
```

WebUI はファイル、SQLite、外部 API を直接操作しない。ファイルパスと API キーはバックエンドだけが扱う。

### 4.2 依存方向

- UI は API 契約と共有型へ依存する。
- API ハンドラーはアプリケーションサービスへ処理を委譲する。
- アプリケーションサービスはドメインスキーマ、リポジトリ、外部アダプターへ依存する。
- ドメインスキーマとタイムライン計算は React、Web フレームワーク、SQLite ドライバーへ依存させない。
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

以下を 2026-07-28 時点の初期実装構成として採用する。

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
- 初期実装は 1 つの `package.json` を持つ単一パッケージとし、WebUI、API、共有スキーマを `src/` 内のディレクトリ境界で分離する。

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
- 2026-07-28 時点で Node.js 24 の組み込み `node:sqlite` は Release Candidate のため、初期版の保存基盤には採用しない。
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
- TypeScript 7.0.2 は調査時点で公開直後のため、初期版は 6.0.3 を使用する。移行は主要ツールの対応確認後に別変更として行う。
- minor、major update は自動適用しない。依存更新専用ブランチで型検査、テスト、短い動画レンダリング、代表フレーム比較を通す。
- セキュリティ修正を除き、MVP 実装中はバージョン更新をまとめて行わない。

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
├─ library/
│  ├─ media/
│  ├─ thumbnails/
│  └─ workspace.sqlite
├─ public/
│  └─ shared-assets/
│     └─ characters/
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
- 自動保存と承認操作を分離する。
- 承認操作は対象データを保存した後、承認用の検証を通過した場合だけ状態を `approved` にする。

## 7. 正本データ `VideoProject`

### 7.1 ルート

```ts
type VideoProject = {
  schemaVersion: "1.1.0";
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
  inserts: InsertPlan;
  thumbnail: ThumbnailPlan;
};
```

すべてのオブジェクトは既知でないキーを拒否する strict object とする。移行は `schemaVersion` 単位で明示的なマイグレーション関数を実行する。現在の `VideoProject` は `1.1.0` とし、`1.0.0` の旧キャラクター素材構造は読み込み時にキャラクターIDごとの正規素材manifestへ移行する。

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
- 新規プロジェクトの `taskModelOverrides` は空オブジェクトとする。したがって初期実装では、すべての `AiTaskKind` が `google/gemma-4-31b-it` へ解決される。
- 実行モデルは「実行時の明示上書き、`taskModelOverrides[taskKind]`、`defaultModelId`」の優先順で決定する。
- プロンプト、入力組み立て、structured output schema、評価指標は `AiTaskKind` ごとに分離し、モデル ID とは独立して管理する。
- `null` は AI を使用しないプロジェクトまたは移行中データのために許可する。
- ZDR の初期値は `true` とする。
- AI 実行画面ではプロジェクトの MVP 既定値を初期選択し、人間が実行ごとに変更できる。
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
  visualAssets: {
    stand: string;
    speak: {
      normal: MouthPair;
      pointing: MouthPair;
    };
  };
};

type MouthPair = {
  closed: string;
  open: string;
};
```

- キャラクターは MVP では正確に 2 件とし、[`assets`](./assets/) に用意された四国めたん側とずんだもん側のキャラクターデータだけを使用する。MVP 中に追加キャラクターを制作または登録する機能は実装しない。
- 初期キャラクター設定は次の対応とする。

| 安定 ID | 役割 | VOICEVOX | MVP 素材 | 色トークン |
|---|---|---|---|---|
| `character-mentor` | `mentor` | 四国めたん／`ノーマル` | [`assets`](./assets/) 内の四国めたん側データ | `character.metan` |
| `character-learner` | `learner` | ずんだもん／`ノーマル` | [`assets`](./assets/) 内のずんだもん側データ | `character.zundamon` |

- 四国めたん側はメンター・案内役、ずんだもん側は生徒・見習い役を基本とする。
- P2-01 で確認済みの素材は透過 PNG、600 × 1000 px の同一キャンバスで、非会話状態の単一画像と、通常会話・指差し状態の会話それぞれの `closed` / `open` ペアから成る。身体の基準位置は画像を並べた手動確認で検証し、ポーズによる外形差を理由に alpha bounding box の完全一致は要求しない。
- 台本上の表情語彙 `neutral`、`smile`、`explain`、`caution` は `ScriptLine.expression` の将来の演出指定として維持する。P2-01 では、これらを今回の2種類の会話ポーズへ推測で対応付けない。
- 全身と会話ポーズの使い分け、画像キャンバスサイズ、キャラクターの基準位置は `assets` 内のデータを正とし、Remotion 側で画像ごとの補正値を持たせない。
- 実装用素材は `public/shared-assets/characters/{characterId}/stand/stand.png`、`speak-normal/{mouth}.png`、`speak-pointing/{mouth}.png` へ配置する。元データは `assets` に保持し、不足ファイル、予期しない命名、キャンバス不一致、close/open ペア不一致、透過有無を検証する。
- 制服の差し色、字幕の話者色、WebUI の speaker chip は `character.metan` と `character.zundamon` のデザイントークンから取得する。
- テーマ色の具体値は `assets` のキャラクターデータに合わせてデザイントークンへ登録し、字幕背景とのコントラストを検証する。
- 話者の区別を色だけに依存させず、キャラクター名、話者チップ、左右配置でも区別する。
- `speakerUuid` は初回接続時または設定更新時に `/speakers` から取得して保存する。初期 JSON やソースコードへ UUID と style ID を埋め込まない。
- 音声生成前に、`speakerUuid` または `speakerName` と `styleName` から style ID を一意に解決できることを検証する。
- 各 voice 設定の許容範囲は接続中の VOICEVOX ENGINE の仕様に合わせてアダプター層で検証する。

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

承認条件:

- `intro` が先頭に 1 件ある。
- `outro` が末尾に 1 件ある。
- `main` が 1 件以上ある。
- `order` が重複せず表示順と一致する。
- 未解決の `openQuestions` がない。
- `sourceHash` が現在の入力資料のハッシュと一致する。

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
- `outlineHash` は台本作成元となった承認済み構成案の内容ハッシュとする。現在の構成案と一致しない台本は stale とする。
- `pauseBeforeMs` の初期値は `0`、`pauseAfterMs` の初期値は `250` とする。
- `spokenText` と `subtitleText` は別々に保存する。
- `speakerId` は `characters[].id` を参照する。
- 1 セクション内の line ID は重複不可とし、プロジェクト全体でも一意にする。
- 台本承認後に構成案または台本を変更した場合は、影響を受ける後工程の承認状態を `needs_review` に戻す。

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
- 注釈は MVP では静的定義とし、WebUI の数値フォームと簡易オーバーレイ操作から編集する。
- `startLineId` と `endLineId` は同じセクション内に存在し、開始が終了より後にならないこと。
- `VisualAssignment.assetId` が参照できる素材種別は `video`、`photo`、`document_scan` に限定し、`sound_effect` は `AudioPlan.soundEffects` から参照する。

種別ごとの表示設定:

```ts
type VideoDisplay = CommonDisplay & {
  kind: "video";
  startMs: number;
  endMs: number;
  playbackRate: number;
  muted: boolean;
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
- 帳票の `page` は 1 始まりとし、素材の `pageCount` 以下とする。

### 7.9 音声、挿入素材、サムネイル

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
  sectionBgms: SectionBgm[];
  soundEffects: SoundEffect[];
};

type InsertPlan = {
  opening: PlaceholderInsert;
  ending: PlaceholderInsert;
  eyeCatches: EyeCatchPlaceholder[];
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

type SectionBgm = {
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

type PlaceholderInsert = {
  id: string;
  kind: "placeholder";
  slot: "opening" | "ending";
  durationMs: 2000;
};

type EyeCatchPlaceholder = {
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
- セクション音声との合成試聴を提供し、ナレーションより効果音が大きく聞こえる場合は警告する。MVP では自動音量補正を行わず、保存を禁止しない。
- 素材登録時のラウドネス解析と音量正規化は MVP 後の評価事項とする。
- BGM はセクションごとに 0 件または 1 件とし、同じ `sectionId` の重複を拒否する。BGM を設定しないセクションは無音とする。
- BGM の再生範囲は、対象セクションの最初のセリフ開始から最後のセリフ終了までとする。素材が短い場合は `loop` に従い、長い場合はセクション終了位置で切る。
- セクション境界では前セクションの BGM を `fadeOutMs` で終了させ、次セクションの BGM を `fadeInMs` で開始する。MVP では曲同士を重ねるクロスフェードを行わない。
- 自動ダッキング、音量キーフレーム、1 セクション内の複数曲は MVP の対象外とする。
- opening と ending は必須で、初期値と保存値をそれぞれ 2000 ms の無音プレースホルダーとする。
- eye catch はセクション境界にだけ追加でき、`beforeSectionId` が示すセクションの直前へ 2000 ms の無音プレースホルダーを挿入する。最初のセクションの前と同じ境界へは追加できない。
- プレースホルダーは Remotion の共通コンポーネントで識別用ラベルを描画し、外部動画ファイルを必要としない。本番用 OP、ED、アイキャッチへの置換は MVP 後のスキーマ拡張とする。
- プレースホルダー区間では本編用 BGM と効果音を再生しない。
- サムネイルは `title` と `departmentOrSystem` を必須の非空文字列とする。背景画像、補足、版数、キャラクター、代表ビジュアルは任意とし、未指定時は共通テンプレートの既定背景を使用する。

## 8. 派生データ

### 8.1 `RenderManifest`

```ts
type RenderManifest = {
  manifestVersion: "1.0.0";
  sourceProjectHash: string;
  sourceAssetChecksums: { path: string; sha256: string }[];
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  lines: RenderLine[];
  visuals: RenderVisual[];
  backgrounds: RenderBackground[];
  audioTracks: RenderAudioTrack[];
  soundEffects: RenderSoundEffect[];
  inserts: RenderInsert[];
};
```

`RenderLine` は少なくとも次を持つ。

```ts
type RenderLine = {
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

type RenderAudioTrack = {
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

type RenderInsert = {
  id: string;
  kind: "placeholder";
  slot: "opening" | "ending" | "eye_catch";
  beforeSectionId: string | null;
  from: number;
  durationInFrames: number;
  label: string;
};
```

- フレーム範囲は半開区間 `[from, from + durationInFrames)` とする。
- ミリ秒からフレームへの変換は `Math.ceil((ms / 1000) * fps)` とする。
- 30 fps の MVP では各 2000 ms プレースホルダーを正確に 60 フレームとして扱う。
- タイムラインコンパイラは本編内のセリフ相対位置を計算した後、opening と eye catch の長さだけ後続要素をシフトし、最後に ending を追加する。
- セクション BGM はプレースホルダー挿入後の最終的なセクションフレーム範囲へ解決する。
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

### 10.1 エンティティ

素材レコードは少なくとも次を持つ。

```ts
type Asset = {
  assetId: string;
  version: number;
  kind: "video" | "photo" | "document_scan" | "sound_effect";
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

タグは素材との多対多関連、タグの分類軸、正規名、別名、利用状態を別テーブルで管理する。全文検索対象はタイトル、説明、部門、対象システム、タグ正規名、タグ別名とする。`sound_effect` は `confirm`、`attention`、`warning` の用途タグを必須とする。動画、写真、帳票では `width` と `height` を必須とし、効果音では `durationMs` を必須とする。

### 10.2 登録

1. 許可した MIME type と実ファイル形式を検証する。
2. 一時領域へ受信する。
3. SHA-256、サイズ、該当する場合は解像度、動画尺、音声尺またはページ数を取得する。
4. 素材 ID と版を確定し `library/media/` へ移動する。
5. 動画、写真、帳票ではサムネイルを生成する。効果音では試聴用波形の生成を必須にしない。
6. SQLite レコードを `processing` で作成し、全処理成功後に `active` にする。
7. 失敗時は `error` と理由を記録し、検索候補に含めない。

同一チェックサムの重複登録は警告し、既存素材を返すか別メタデータとして登録するかを人間に選ばせる。素材の差し替えは同じファイルを上書きせず、新しい版として登録する。

### 10.3 プロジェクトへの取り込み

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
GET    /api/projects/{projectId}/validation
```

### 11.3 構成案と台本

```text
GET    /api/models
POST   /api/projects/{projectId}/outline/generate
POST   /api/projects/{projectId}/outline/regenerate-section
PUT    /api/projects/{projectId}/outline
POST   /api/projects/{projectId}/outline/review
POST   /api/projects/{projectId}/outline/approve
PUT    /api/projects/{projectId}/script
POST   /api/projects/{projectId}/script/approve
POST   /api/projects/{projectId}/script/review
```

AI 生成 API はエンドポイントに対応する `taskKind` をサーバー側で確定し、リクエストの `modelId` は実行時上書きとして任意に受け取る。上書きがない場合はプロジェクト設定から上記の優先順で解決し、解決結果が `null` の場合は実行を拒否する。生成に失敗した場合、既存の構成案または台本を変更しない。

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

### 11.5 素材と割り当て

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

### 11.6 音声、プレビュー、レンダリング

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

長時間処理は `202 Accepted` と `runId` を返し、状態取得 API で `queued`、`running`、`succeeded`、`failed` を確認する。単一プロセスの初期実装でも、HTTP リクエストをレンダリング完了まで保持しない。

## 12. 外部サービス

### 12.1 OpenRouter

- API キーは `OPENROUTER_API_KEY` からバックエンドだけが読む。
- MVP の既定モデルは `google/gemma-4-31b-it` とする。
- WebUI の構成案、台本生成、台本レビュー、ビジュアル検索意図、レイアウトレビュー、OpenCode は別の `AiTaskKind` として実装するが、MVP 後の用途別評価を行うまでは同じ共通モデルを使用する。
- OpenCode のエージェントは役割別に分けても、初期設定ではすべて `google/gemma-4-31b-it` を参照する。
- 実行ログには `taskKind`、解決されたモデル ID、モデル選択元 `run_override | task_override | default` を記録する。
- モデル一覧は認証済み利用可能モデルを取得し、text 出力と structured output 対応で絞り込む。
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

入力:

- 検証済み `VideoProject`
- `audio-index.json`
- プロジェクトへ取り込んだ素材
- 素材の技術メタデータ

処理:

1. project schema を検証する。
2. 承認状態と参照整合性を検証する。
3. 全セリフに有効な音声インデックスがあることを確認する。
4. 無音時間と音声長をフレームへ変換する。
5. セリフを累積して line range を作る。
6. visual assignment の line ID 範囲を frame range へ解決する。
7. section background を frame range へ解決する。
8. 挿入素材、BGM、効果音を統合する。
9. 全体の duration を計算する。
10. ハッシュとチェックサムを付与し Zod で検証する。
11. 一時ファイルから `cache/render-manifest.json` へ置換する。

失敗時は新しいマニフェストを保存せず、全エラーを line ID、assignment ID、パスと関連付けて返す。

## 14. WebUI

### 14.0 UI イメージ

![台本編集画面のUIコンセプト](./assets/webui-script-editor-concept.png)

この画像は台本編集画面の情報設計を確認するためのコンセプトであり、最終デザインではない。実装時に維持する要素は、左側の制作工程ナビゲーション、上部の工程状態、Remotion プレビュー、セリフカード、右側のビジュアル設定、保存状態、検証結果である。画像内の人物、素材、具体的な配色、細かな文言は確定仕様に含めない。

生成条件は [`webui-script-editor-concept.prompt.md`](./assets/webui-script-editor-concept.prompt.md) に保存する。

画像内の人物は仮置きである。実装時のプレビューには 7.5 の四国めたん／ずんだもん音声へ対応するワシ型キャラクター素材を使用し、speaker chip と字幕の色も同じキャラクター色トークンへ置き換える。

### 14.1 画面

```text
/projects
/projects/new
/projects/{projectId}/brief
/projects/{projectId}/outline
/projects/{projectId}/script
/projects/{projectId}/visuals
/projects/{projectId}/voice
/projects/{projectId}/preview
/projects/{projectId}/thumbnail
/assets
/terminology
/runs
```

ルーティング表現は採用フレームワークに合わせて変更してよいが、画面責務は維持する。

### 14.2 制作ステップ

```text
企画
  → 構成案承認
  → 台本承認
  → ビジュアル承認
  → 音声生成
  → マニフェスト検証
  → プレビュー
  → レンダリング
```

後工程の画面は閲覧可能にしてよいが、前提条件を満たさない実行操作は無効化し、理由と修正先へのリンクを表示する。

### 14.3 台本画面

- 上部: 同一 `RenderManifest` を使う Remotion プレビュー
- 中央: セクションとセリフカード
- 右側: ビジュアル、背景、キャラクター確認の切り替えペイン
- 各セクション見出し: BGM の選択、差し替え、解除、単体試聴、音量、ループ、フェード、セクション音声との合成試聴
- セリフカード: ID、話者、表情、字幕、読み上げ、字幕プレビュー、音声状態、素材、並べ替え、複製、削除
- セリフカードの効果音設定: 素材選択、`confirm`／`attention`／`warning`、発話開始からのオフセット、音量、複数追加、単体試聴、セクション音声との合成試聴
- 話者付きテキストの一括貼り付けと機械的なカード分割
- `spokenText` に登録用語が含まれる場合、解決後読み上げと適用用語を表示
- 変更は自動保存、承認は明示操作

### 14.4 挿入プレースホルダーとサムネイル

- opening と ending の 2 秒プレースホルダーをタイムラインの先頭と末尾へ常時表示する。
- セクション境界メニューから eye catch の追加と削除を行う。追加後は 2 秒のプレースホルダーをプレビューへ即時反映する。
- サムネイル画面ではタイトルと部門名または対象システム名を必須入力とし、補足、版数、背景画像、代表ビジュアル、キャラクターは任意入力とする。
- サムネイルは固定テンプレートの 1280 × 720 プレビューを常時表示し、キャラクターの表示・非表示と、四国めたん側・ずんだもん側の選択を可能にする。

### 14.5 エラー表示

少なくとも次を区別する。

- 入力不正
- revision 競合
- 未承認または stale な前工程
- 未解決の要確認事項
- モデル未選択
- OpenRouter 認証、残高、非対応、入力超過、一時障害
- VOICEVOX 未起動、対象話者または標準スタイルの解決失敗、合成失敗
- 素材参照切れ、チェックサム不一致、範囲外
- レンダリング失敗

## 15. 承認と無効化規則

| 変更 | 自動的に見直し対象へ戻す状態 |
|---|---|
| Markdown または企画条件 | 構成案、台本、ビジュアル |
| 承認済み構成案の内容 | 台本、ビジュアル |
| 台本のセリフ追加・削除・順序変更 | ビジュアル、音声、マニフェスト |
| `spokenText`、話者、音声設定 | 対象音声、マニフェスト |
| `subtitleText`、表情 | マニフェスト |
| ビジュアル割り当て | ビジュアル承認、マニフェスト |
| 背景、挿入素材、BGM、効果音 | マニフェスト |
| サムネイル構成 | サムネイル出力 |
| 用語の読みまたは状態 | 該当セリフの音声 |

「見直し対象」は既存ファイルの削除を意味しない。古い生成物を stale と表示し、新しい生成が成功するまで保持する。

## 16. 検証

### 16.1 保存前

- Zod strict schema
- ID の形式、重複、不正参照
- 数値範囲
- 相対パスの安全性
- セクションとセリフの順序
- セクション BGM の重複、参照先、フェード長
- 効果音の素材種別、参照先、チェックサム、カテゴリ、オフセット、音量
- プレースホルダーの固定長と eye catch の境界参照
- サムネイルの必須タイトルと部門・対象システム名

### 16.2 承認前

- 構成案の role 順序と未解決質問
- 台本の空セリフ、話者、構成案対応
- ビジュアルの割り当て範囲、素材状態、チェックサム、機密区分
- 前工程の source hash と revision

### 16.3 音声生成前

- VOICEVOX 接続
- 全キャラクターについて `/speakers` から話者 UUID と `ノーマル` の style ID を一意に解決できること
- 空でない `spokenText`
- 用語適用結果
- 音声パラメーターの範囲
- 調整ファイルの Zod 検証
- 調整ファイルの `lineId` と `baseHash`

### 16.4 レンダリング前

- 最新 `RenderManifest`
- 全素材と音声の存在、チェックサム
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

SQLite にはキー入力単位ではなく、保存、承認、レビュー判断、音声再生成、候補採否など意味のあるイベントだけを保存する。修正前後、理由、対象の安定 ID、生成元、モデル、プロンプト版を関連付ける。

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
- 用語の正規化、最長一致、優先度、除外
- ミリ秒からフレームへの変換
- セリフ累積と半開区間
- assignment の line range 解決
- source/project/asset hash
- 承認と stale 化
- パストラバーサル拒否

### 19.2 統合テスト

- project revision 競合
- Markdown と hash の一体保存
- 素材コピーと project update の成功、ロールバック
- SQLite migration
- OpenRouter 成功、schema 違反、429、認証失敗
- VOICEVOX query と WAV のキャッシュ
- 音声調整の保存、再読込、リセット、base hash 不一致時の適用拒否
- セクション BGM、効果音、2 秒プレースホルダーを含むタイムライン計算
- 効果音の発話開始相対オフセット、複数設定、3 音以上の同時再生警告
- 任意項目がすべて未設定のサムネイル生成
- `VideoProject` から `RenderManifest` 生成
- レンダリングジョブの状態遷移

外部 API は fixture またはローカル stub を使用し、通常のテスト実行で課金や実サービス依存を発生させない。

### 19.3 E2E

最低 1 つの fixture project で次を自動化する。

1. プロジェクト作成
2. Markdown と企画条件保存
3. 構成案の取り込みと承認
4. 2 キャラクター、複数セリフの台本作成
5. 固有名詞登録と読み上げ解決
6. 動画、写真、帳票の 3 種類の素材登録と割り当て、および効果音素材の登録
7. fixture WAV からマニフェスト生成
8. 代表フレームの画像比較
9. 短い MP4 とサムネイルの生成

## 20. 実装順序

### Phase 0: 基盤

- Node.js、pnpm、TypeScript、lint、format、test
- Zod スキーマ
- project repository と原子的保存
- SQLite migration と repository
- 共通エラー形式

### Phase 1: 企画と構成案

- プロジェクト画面
- Markdown、企画条件
- OpenRouter モデル一覧と構成案生成
- 構成案編集、要確認事項、承認

### Phase 2: 台本と用語

- 2 キャラクター設定
- 台本編集と一括入力
- 固有名詞・社内用語 CRUD
- 読み上げ解決プレビュー
- 台本承認

### Phase 3: 素材とビジュアル

- 素材登録、サムネイル、タグ、検索
- AI 検索意図
- 素材ピッカー
- プロジェクトへの取り込み
- 表示設定、静的注釈、承認

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

## 21. 決定状況と未決事項

### 21.1 今回解決した事項

1. **WebUI フレームワークとローカルサーバー構成**  
   Vite + React SPA、Fastify API、製品実行時は Fastify から同一 origin 配信する構成を採用する。

2. **SQLite ドライバーとマイグレーション手段**  
   better-sqlite3 + Drizzle ORM + Drizzle Kit、起動時 migration を採用する。

3. **パッケージの具体的なバージョン**  
   4.4 のバージョン表を初期固定値として採用する。

4. **AI の MVP モデル**  
   全 AI 用途の MVP 初期値を `google/gemma-4-31b-it` とする。用途別モデルの本採用は MVP 後の評価事項とし、MVP の各機能を実装する前の決定事項にはしない。

5. **VOICEVOX の既定スタイル**  
   四国めたんとずんだもんはいずれも標準スタイルの `ノーマル` を使用する。数値の style ID は `/speakers` から実行時に解決し、ソースコードまたは初期データへハードコードしない。

6. **キャラクター素材とテーマ**  
   [`assets`](./assets/) に用意された 2 人分のキャラクターデータだけで MVP を進める。透過 PNG、同一キャンバス、固定位置、4 表情と口差分、デザイントークン、字幕コントラスト、色以外の話者識別は推奨案を採用する。

7. **効果音の採用範囲**  
   効果音は任意とし、`confirm`、`attention`、`warning` の 3 用途だけを採用する。セリフ開始からの相対時間で 1 セリフへ複数設定でき、素材ライブラリから選択する。初期音量は `0.2`、3 音以上の同時再生とナレーションより大きく聞こえる場合は警告するが、保存は原則として禁止しない。

8. **イントネーション編集の正本と UI**  
   未編集の `audio_query` は派生キャッシュ、人間が確定した調整は `voice-adjustments/{lineId}.json` に保存する。WebUI では基本、アクセント、モーラ詳細の 3 段階で編集する。

9. **BGM**  
   MVP からセクションごとに 0 件または 1 件の曲を設定する。固定音量、ループ、前後フェードを扱い、自動ダッキングとクロスフェードは行わない。

10. **サムネイル**  
    タイトルと部門名または対象システム名だけを必須とし、補足、版数、背景、代表ビジュアル、キャラクター表示は任意とする。レイアウトは `standard` を採用する。

11. **OP、ED、アイキャッチ**  
    MVP では本番素材を生成せず、OP と ED は常設、アイキャッチは選択したセクション境界へ、いずれも 2 秒の無音プレースホルダーを挿入する。

### 21.2 MVP の該当機能を実装する前の未決事項

現時点ではない。VOICEVOX の数値 style ID は実装前に人間が決定する値ではなく、Phase 4 で接続中 ENGINE から解決する。キャラクター素材は `assets` の 2 人分を使用し、効果音とサムネイルは上記の初期仕様で実装する。

### 21.3 MVP 後に利用実績を見て判断する事項

| 項目 | 判断内容 | 判断時期 |
|---|---|---|
| 用途別 AI モデル | Gemma 4 31B から別モデルへ分離する用途と評価基準 | 用途別のスキーマ検証通過率、修正量、根拠のない情報、速度、トークン、料金、画像・ツール要件の記録後 |
| OCR・文字起こし | 帳票や動画内容を検索可能にするか | 素材増加により手動タグ付けが負担になってから |
| ベクトル検索 | 意味の近い素材を検索するか | タグ検索と全文検索の不足が確認されてから |
| 音量解析型口パク | WAV 音量に合わせた口パクへ移行するか | 定周期口パクの品質確認後 |
| 複数レイアウト | キャラクター配置プリセットを増やすか | 実動画で標準配置の不足が発生してから |
| AI 台本初稿 | AI に最初の台本を書かせるか | 正解例と評価基準が十分に蓄積してから |
| SQLite 運用バックアップ | 定期バックアップ周期、復旧 UI、JSON Lines / CSV の標準エクスポートを導入するか | 最低限の migration 前バックアップ運用後、利用実績と復旧要件を確認してから |
| 本番 OP・ED・アイキャッチ | プレースホルダーを本番映像、音声、可変尺、置換操作へ拡張するか | MVP 完成後 |
| 効果音ラウドネス正規化 | 素材登録時に音量解析と正規化を行うか | 効果音素材ごとの音量差が運用上の問題になってから |

上表は 7 件の既存将来項目に、今回 MVP 後へ移した用途別 AI モデルと、効果音仕様の運用評価項目を加えたものである。いずれも Phase 0 の開始を妨げない。

## 22. 実装開始時の完了条件

21.1 の実装判断が確定し、21.2 の未決事項がなくなったため、Phase 0 は開始可能である。依存関係を導入した直後に 4.4 のスモークテストを実施し、問題がある場合はバージョンだけを本書へ記録して調整する。Phase 0 完了条件は次のとおり。

- 空のプロジェクトを Zod で生成、保存、再読込できる。
- 不正 JSON を既存ファイルへ上書きしない。
- revision 競合を検出できる。
- SQLite migration を空 DB と既存 DB の両方へ適用できる。
- 用語レコードを登録し、決定論的に読み上げ文へ適用できる。
- `VideoProject` と `RenderManifest` の型が UI、API、コンパイラで共有される。
- JSON Schema の外部公開物を生成しない。
