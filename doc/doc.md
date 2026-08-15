# Remotion 社内マニュアル動画制作システム — カスタム仕様書

## 1. この文書の位置づけ

本書は、Remotion を中核とする動画自動制作システムを、職場の社内マニュアル動画作成用にカスタマイズした仕様書である。

### 1.1 Issue #87 による制作工程の更新

Issue #87 以降の制作工程は、台本・ビジュアル・音声を別々の承認工程として扱わず、`/projects/${projectId}/script` を中心とする一体型の制作画面で編集する。`project.json` は引き続き唯一の制作データの正本である。

Issue #89 以降、キャラクター素材を追加・更新する「キャラクタービジュアル」登録機能は、プロジェクト制作画面とは別のワークスペース共通ライブラリとして扱う。登録画面は `/character-visuals` に置き、プロジェクト固有の台本・ビジュアル割り当て・`project.json` へ登録一覧を埋め込まない。

- 構成案だけは、台本の初期化と現在の制作コンテキストの前提として、承認済みかつ元資料に対して最新であることを要求する。
- 台本承認とビジュアル承認は制作フローのゲートにしない。キャラクタービジュアルはセリフカードから人間が明示選択し、セリフごとに音声を生成・調整できるようにする。現場素材用の Asset Search / generic `VisualAssignment` は機能・データとして維持するが、CV-04 後の標準 `/script` 右ペイン UI を前提にせず、別画面または補助導線で扱う。
- `Script.status` と `VisualPlan.status` の `draft`、`needs_review`、`approved` は既存データとの互換性、stale 判定、レビュー結果の表示に残してよいが、人間の承認操作を次工程の前提にしない。
- プレビュー、`RenderManifest` 生成、MP4 レンダリングは、承認済みかどうかではなく、保存済みデータに対する validation が実行条件を満たす場合だけ実行する。台本、音声、素材参照、assignment 範囲、checksum、ハッシュ、Manifest の整合性エラーは validation の警告・エラーとして表示する。

- 対象は、業務手順、社内システムの操作方法、定型作業などを説明する日本語の社内マニュアル動画とする。
- IT 技術系の一般向け解説、ショート動画、多言語展開、外部公開を目的とした機能は対象外とする。
- 本システムは個人利用とし、第三者へ配布可能な製品形態にはしない。
- 動画および制作システムを社外へ公開する運用は想定しない。
- WebUI は制作パイプラインに沿って段階的に実装し、Markdown 入力、構成案の生成または手入力、人力台本編集、素材ライブラリ検索、ビジュアル割り当てを順に追加する。ワークスペース共通のキャラクタービジュアル登録・更新は、制作画面から分離したライブラリ画面として追加する。

### 1.2 Issue #97 によるキャラクタービジュアル選択の更新

Issue #97（CV-04）では、キャラクタービジュアルの選択を AI 候補・素材検索・右ペイン中心の導線から、人間が明示的に選択するセリフカード中心の導線へ変更する。`/projects/{projectId}/script` はセクションとセリフカードを中心とする 1 ペイン構成を標準とし、現在の右ペインにある「現在の編集対象」「制作 ビジュアル候補」「AI によるビジュアル候補 UI」「手順3-3 素材検索」「素材検索結果」「素材制作・表示設定カード」は後続実装で制作画面から除去する。

これは UI の主要導線を変更する仕様であり、機能・データの廃止を意味しない。AI visual suggestion の backend、現場動画・写真・帳票用 Asset Search、generic `VisualAssignment`、およびそれらのデータは維持する。これらは人間の選択を補助する副次機能または別ドメインの機能として扱い、キャラクタービジュアル選択の標準経路にはしない。

キャラクターごとの VOICEVOX 話者と `CharacterVisualSet` の binding、および各セリフの physical variant 参照は project-specific な制作データとして `project.json` に保存する。`CharacterVisualSet` と登録済み visual / variant / file metadata の正本は引き続き workspace SQLite とし、SQLite に project ID や `mentor` / `learner` の紐づけを追加しない。`visualId === characterId` という暗黙対応も採用しない。

CV-04 はこの責務分離を3文書で確定する作業だけを行う。schema、migration、API、UI、compiler、Remotion の変更は後続 CV-05（実装 Issue #98）の対象とする。

## 2. プロジェクト概要

### 2.1 目的

動画編集ソフトを使わず、動画の全要素を JSON で管理し、Remotion と React によって社内マニュアル動画をプログラム生成する。

狙いは次のとおり。

- 字幕配置、話者切り替え、音声同期、ビジュアル切り替えなどの反復的な編集作業を自動化する。
- 現場動画、写真、帳票スキャンなど、事前登録した社内素材を説明内容に合わせて再利用する。
- 人間が手順の正確性、説明の分かりやすさ、最終的な品質判断に集中できるようにする。
- 本編動画とサムネイルを、同じ構造化データから再生成できるようにする。
- 制作時の修正を記録し、台本生成ルールやレビュー基準を継続的に改善する。

### 2.2 中核方針

- 動画ごとの人間が編集する制作データの正本は、`project.json` とする。構成案の承認と、台本・ビジュアル・音声のレビュー状態に加え、プロジェクトで使用するキャラクタービジュアルの binding と各セリフの physical variant 参照もここへ保持する。
- 利用可能なキャラクタービジュアルの登録済み visual / variant / file metadata の正本は、ワークスペース共通 SQLite の `CharacterVisualSet` とする。`project.json` へ catalog 一覧や登録ファイルを埋め込まず、project-specific な選択参照だけを保存する。
- `CharacterVisualSet` の workspace SQLite は visual をプロジェクトや `mentor` / `learner` へ紐付けない。`visualId === characterId` を前提にせず、binding のない character は「未設定」として扱う。
- `characterVariantCatalog` という TypeScript 型または catalog snapshot は、SQLite のレコードを型付け・検証・コンパイラ入力へ渡すために残してよいが、実在する登録項目を二重管理する静的な正本にはしない。
- キャラクタービジュアルのファイル本体は `library/character-visuals/{visualId}/{variantId}/` 以下へ保存する。新規登録ファイルを `public/` へ直接保存せず、WebUI の画像表示は Fastify の管理された配信経路を使う。
- `RenderManifest` は、`project.json`、バックエンドが解決したキャラクタービジュアル情報、音声などから生成する特定レンダリング向けの解決済み派生データであり、制作データや素材カタログの正本にはしない。コンパイラと Remotion は SQLite を直接参照しない。
- `ScriptLine.expression` は演出意図を表す論理表情・互換メタデータであり、PNG のファイル名、物理ポーズ名、`variantId` ではない。physical variant は各 line の `characterVariantId` を人間が明示的に選択して保存し、expression、tag、label から自動選択しない。
- キャラクタービジュアルは登録時点で `mentor` / `learner` の役割や特定プロジェクトへ固定しない。同一キャラクターの別衣装、別キャラクター、差し替え候補をワークスペース共通資産として保持できる構造にする。
- キャラクタービジュアル全体は一部の表情・ポーズ variant が未登録でも正常な登録状態とする。ただし、`single-image` は `single` が 1 ファイル、`mouth-pair` は `closed` と `open` が各 1 ファイル揃う場合だけ完成 variant とする。キャンバスサイズは visual 単位で統一し、最初の完成 variant のサイズを基準にする。既存素材の 600 × 1000 px は初期 seed の値であり、ワークスペース全体の固定値ではない。
- 動画編集ソフトは使用しない。
- 動画生成 AI に完成映像を生成させない。
- 映像はコード、React コンポーネント、既定のレイアウト部品、および登録済み素材から構築する。
- ビジュアルは事前登録した現場動画、写真、帳票スキャンを基本とし、AI にスライドや図解を生成させない。
- AI は台本から現場素材検索用のタグと検索意図を作る補助機能として残す。素材 DB の検索と generic `VisualAssignment` の最終選択はバックエンドと人間が担い、キャラクタービジュアルの visual / variant は人間の明示選択を標準経路とする。
- AI による検証と人間によるレビューを組み合わせる。
- 外部公開、配布、複数ユーザー、権限管理は対象外とする。

## 3. 入出力仕様

### 3.1 主入力

動画ごとに 1 つの JSON を入力する。JSON には少なくとも次の情報を含む。

- 動画メタデータ
- キャラクター設定
- セクション
- セリフ
- 話者
- プロジェクトで話者へ割り当てた `CharacterVisualSet` と待機用 `idleVariantId`
- 発話時の論理表情（`ScriptLine.expression`）
- 人間がセリフごとに選択した physical variant（`ScriptLine.characterVariantId`。未選択を許可）
- 画面表示用の字幕テキスト
- セリフまたは連続する複数セリフに対応するビジュアル割り当て
- 素材DBの素材 ID、プロジェクトへ取り込んだファイルの相対パス、動画の再生範囲、画像・帳票の表示範囲
- BGM
- 背景
- オープニング、エンディング、アイキャッチ等の挿入設定
- サムネイルの構成データ

実際のフィールド名とスキーマの推奨案は 17 章に記載する。

### 3.2 補助入力

- ワークスペース共通ライブラリへ登録したキャラクタービジュアル
  - `CharacterVisualSet` と配下の variant メタデータ
  - 描画方式に応じたファイルスロット（`single` または `closed` / `open`）
  - バックエンドが解決した相対配信パスとチェックサム
  - compiler が受け取る検証済み `CharacterVisualCatalogSnapshot`
- VOICEVOX で生成したセリフ音声
- BGM・効果音ファイル
- オープニング、エンディング、アイキャッチ等の動画素材
- 素材ライブラリへ登録する現場動画、写真、帳票スキャン
- 素材のメタデータ、分類タグ、タグ辞書
- サムネイル用の背景画像、キャラクター画像、共通 UI 部品

### 3.3 出力

- 本編動画（MP4）
- サムネイル画像

ショート動画、多言語版、チャプタータイムスタンプは出力しない。

### 3.4 参照動画のメディア仕様

元プロジェクトの参照動画から確認できた値であり、本システムの推奨出力値とは異なる場合がある。

| 項目 | 値 |
|---|---:|
| 画面サイズ | 1280 × 720 |
| アスペクト比 | 16:9 |
| フレームレート | 30 fps |
| 動画コーデック | H.264 |
| 音声 | Opus、48 kHz、ステレオ |

本システムの推奨出力値は 17.14 に記載する。

## 4. システム構成

### 4.1 論理構成

1. 題材・対象作業の決定
2. 提供資料と手順の整理
3. 台本生成・レビュー
4. 人間による character と `CharacterVisualSet` の binding、およびセリフごとの physical variant 選択
5. AI による現場素材の検索意図生成と、素材DBからの候補提示（任意の補助経路）
6. 人間による現場動画、写真、帳票スキャンの選択・割り当て
7. VOICEVOX による音声生成
8. 音声長に基づくタイムライン計算
9. Remotion による動画描画
10. プレビュー・修正
11. MP4 レンダリング
12. サムネイル生成
13. 修正ログの蓄積と制作ルールの改善

ワークスペース共通のキャラクタービジュアル登録・更新は、この番号付きのプロジェクト制作フローには含めない。`/character-visuals` で行うワークスペース準備・随時管理として扱い、プロジェクト制作の開始条件や工程ゲートにはしない。

### 4.2 中核技術

- Remotion
- React
- TypeScript
- JSON による動画定義
- Zod によるスキーマ検証
- OpenCode
- OpenRouter
- VOICEVOX ENGINE
- 独自 WebUI

WebUI のバックエンドから OpenRouter API を直接呼び出し、構成案生成などのユーザー向け AI 機能を提供する。OpenRouter API キーはバックエンドだけで保持し、ブラウザへ渡さない。

OpenCode は、台本作成、レビュー、検証スクリプト実行などの開発・制作支援環境として使用する。WebUI の実行時依存にはせず、必要に応じて [OpenCode の公式プロバイダー設定](https://opencode.ai/docs/providers)に従って OpenRouter を接続する。

モデル名を生成ロジックへ直接埋め込まず、プロジェクト設定と実行時の選択値として管理する。モデル選定と OpenRouter 接続の仕様は 17.7 に記載する。

## 5. データモデル

### 5.1 概念モデル

```text
VideoProject
├─ schemaVersion
├─ metadata
│  ├─ id
│  ├─ title
│  ├─ description
│  ├─ department
│  ├─ manualVersion
│  └─ outputSettings
├─ source
│  ├─ id
│  ├─ path
│  └─ sha256
├─ brief
│  ├─ audience
│  ├─ postViewingGoal
│  ├─ prerequisites
│  ├─ targetDurationSec
│  └─ globalDirectives
├─ aiSettings
│  ├─ defaultModelId
│  ├─ taskModelOverrides
│  ├─ zdr
│  ├─ dataCollection
│  └─ allowProviderFallbacks
├─ outline
│  ├─ status
│  ├─ sourceHash
│  ├─ generationRunId
│  ├─ openQuestions[]
│  └─ sections[]
│     ├─ id
│     ├─ order
│     ├─ role
│     ├─ title
│     ├─ overview
│     ├─ keyPoints[]
│     ├─ directives
│     ├─ sourceRefs[]
│     ├─ targetDurationSec
│     └─ lockedFields[]
├─ characters[]
│  ├─ id
│  ├─ name
│  ├─ voicevoxSpeakerId
│  ├─ personality
│  ├─ characterVisual
│  │  ├─ visualId
│  │  └─ idleVariantId
│  └─ visualAssets (1.0.0 互換フィールド)
├─ sections[]
│  ├─ id
│  ├─ name
│  ├─ background
│  └─ lines[]
│     ├─ id
│     ├─ speaker
│     ├─ spokenText
│     ├─ subtitleText
│     ├─ expression (論理表情)
│     ├─ characterVariantId (人間による明示参照)
│     └─ timing
├─ visuals
│  ├─ status
│  ├─ suggestionRunIds[]
│  └─ assignments[]
│     ├─ id
│     ├─ startLineId
│     ├─ endLineId
│     ├─ assetId
│     ├─ assetChecksum
│     ├─ projectMediaPath
│     └─ display
│        ├─ crop
│        ├─ scale
│        ├─ position
│        ├─ annotation
│        └─ prioritizeVisual
├─ audio
│  ├─ sectionBgms[]
│  ├─ soundEffects
│  └─ generatedSpeechFiles
├─ inserts
│  ├─ opening
│  ├─ ending
│  └─ eyeCatches
└─ thumbnail
   ├─ backgroundImage
   ├─ title
   ├─ subtitle
   ├─ departmentOrSystem
   ├─ manualVersion
   ├─ characterId
   ├─ representativeVisualPath
   └─ layout
```

`VideoProject` は人間と WebUI が編集する制作データの正本であり、音声長、開始フレーム、終了フレームなど、素材と設定から再計算できる値は含めない。構成案の承認は初期化と制作コンテキストの前提として残すが、台本・ビジュアル・音声の status はレビューと stale を表す互換状態である。`characters[].visualAssets` は旧 `1.0.0` プロジェクトを読み込むための互換フィールドとして意図的に残すが、CV-05 で導入する `characterVisual` binding や物理素材の正本とは別物である。確認画面と素材検証はこの互換フィールドを物理素材の正本として使用しない。

CV-05 の概念モデルでは、各 character が次の project-specific binding を持つ。実際のプロパティ名は既存 schema との整合を見て後続実装で確定してよいが、選択の正本を `project.json` に置く責務は変更しない。

```ts
type CharacterVisualBinding = {
  visualId: string | null;
  idleVariantId: string | null;
};
```

ワークスペース共通のキャラクタービジュアルは、プロジェクト JSON の外部にある SQLite の `CharacterVisualSet` が正本である。登録画面では本体と配下の物理 variant を別エンティティとして扱う。

```text
CharacterVisualSet
├─ visualId
├─ name
├─ description
├─ status
├─ variants[]
│  ├─ variantId
│  ├─ label
│  ├─ renderType: single-image | mouth-pair
│  ├─ tags[]
│  └─ files[]
└─ createdAt / updatedAt
```

キャラクタービジュアルは配下の variant が一部しか存在しない状態でも登録できる。登録済み variant がない表情・ポーズを理由に `CharacterVisualSet` 全体をエラーにしない。一方、`single-image` variant は `single` が 1 ファイル、`mouth-pair` variant は `closed` と `open` が各 1 ファイル揃う場合だけ完成 variant とする。

登録時点では `CharacterVisualSet` を `mentor` / `learner` や特定プロジェクトへ紐付けない。プロジェクトでどの visual を使うか、どの variant を待機表示にするかは `project.json` の `CharacterVisualBinding` として人間が選択する。`neutral`、`smile`、`explain`、`caution` などの `ScriptLine.expression` は引き続き論理表情であり、物理 variant、PNG、`variantId` とは別概念とする。expression、tag、label から idle variant や line variant を推測しない。

最初に登録された完成 variant のキャンバスサイズを、その `CharacterVisualSet` の基準サイズとする。同じ visual へ異なるキャンバスサイズの画像を追加する場合は拒否する。初期 seed の 600 × 1000 px は既存素材の値であり、全 visual 共通の固定サイズではない。

既存の 2 キャラクター、6 variant、10 PNG は DB へ idempotent に seed / migration する。移行後のメタデータ正本は SQLite だけとし、実在する登録項目を TypeScript ソースへ二重管理しない。TypeScript には `CharacterVisualSet` の型、検証用の純粋な catalog snapshot 型、解決済み入力型だけを残してよい。

新規登録ファイルは `library/character-visuals/{visualId}/{variantId}/` 以下へ保存し、`public/` へ直接保存しない。画像表示は Fastify の管理された配信経路を使用する。

レンダリング前には、バックエンドが SQLite から現在の `CharacterVisualCatalogSnapshot` を取得して検証し、`project.json` に保存された visual binding と line の `characterVariantId` を照合したうえでタイムラインコンパイラへ渡す。コンパイラは明示参照と検証済み snapshot、音声などを入力として Remotion へ渡す派生データ `RenderManifest` を生成する。コンパイラと Remotion は SQLite を直接検索しない。expression、tag、label から物理 variant を自動解決・代替しない。

```text
RenderManifest
├─ sourceProjectHash
├─ sourceAssetChecksums[]
├─ fps
├─ width
├─ height
├─ durationInFrames
├─ lines[]
│  ├─ id
│  ├─ sectionId
│  ├─ from
│  ├─ durationInFrames
│  ├─ speechFrom
│  ├─ speechDurationInFrames
│  ├─ audioPath
│  ├─ subtitleText
│  ├─ speaker
│  └─ expression (現行 1.0.0 では論理表情)
├─ visuals[]
│  ├─ id
│  ├─ from
│  ├─ durationInFrames
│  ├─ kind
│  ├─ src
│  └─ display
└─ backgrounds[]
   ├─ sectionId
   ├─ from
   ├─ durationInFrames
   └─ background
```

`RenderManifest` は生成キャッシュであり、制作データの正本にはしない。正本 JSON、参照素材、出力設定のいずれかが変わった場合は再生成する。

将来のキャラクター素材解決では、次の情報を `RenderManifest` へ固定する。これは登録機能とは分離した後続設計であり、現行 `RenderManifest 1.0.0` の型へ追加済みとは扱わない。

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
  ↓
解決済みファイルパス、renderType、checksum、mouth-pair の closed/open
  ↓
Remotion
```

解決済み snapshot の版または更新時点、variant 単位の版管理、manifest の互換性は後続実装で確定する。missing、inactive、cross-visual、ファイルスロット欠落時は validation error とし、自動代替しない。

### 5.2 セリフ

セリフは 1 発話ずつデータ化する。各セリフは少なくとも次を持つ。

- 一意なセリフ ID
- 話者
- VOICEVOX で読み上げる本文
- 字幕として表示するテキスト
- 表情または感情タイプ（`expression`。論理表情・互換メタデータ）
- 発話中に表示する、人間が選択した physical variant の参照（`characterVariantId`。未選択を許可）
- 発話前後に追加する任意の無音時間

読み上げ用テキストと字幕テキストは分離する。VOICEVOX に読み方を合わせるための表記と、画面上で読みやすい表記が異なる場合に対応するためである。

### 5.3 ビジュアル

ビジュアルは、制作前に素材ライブラリへ登録した次の 3 種類を使用する。

- `video`: 現場作業、機器操作、画面操作などを収録した動画
- `photo`: 現場、設備、部品、完成状態、作業前後などの写真
- `document_scan`: 帳票、チェックシート、申請書、掲示物などのスキャンまたは撮影画像

素材ライブラリはワークスペース共通の SQLite で管理する。各素材は少なくとも、安定した `assetId`、種別、タイトル、説明、ファイルパス、サムネイル、タグ、技術情報、チェックサム、状態を持つ。動画の長さ、画像サイズ、帳票のページ数など、種別固有の技術情報も保持する。

タグは自由記述だけに依存せず、`department`、`system`、`task`、`action`、`object`、`location`、`documentType`、`status` などの分類軸と、管理された語彙を使用する。表記揺れや同義語はタグ辞書で正規化する。未登録語を AI が返した場合は素材 ID として解釈せず、検索語またはタグ辞書への追加候補として扱う。

1 つのビジュアルは 1 セリフまたは連続する複数セリフへ割り当てられる。割り当てには素材DB上の `assetId` だけでなく、選択時のチェックサムと、プロジェクトへ取り込んだ素材の相対パスを保存する。動画には使用開始・終了位置、切り抜き、拡大率、位置、再生速度、ミュート、注釈を指定できる。写真と帳票スキャンにはページ、切り抜き範囲、表示方法、拡大率、位置、注釈を指定できる。

AI に素材そのもの、完成スライド、図解を生成させない。AI は台本区間から検索用タグ、素材種別、検索語、候補理由を構造化して返すだけとし、実在する素材の検索、順位付け、紐付けはバックエンドで行う。最終的な素材選択は人間がサムネイルまたは動画プレビューを確認して確定する。

## 6. 制作フロー

### 6.1 企画

1. マニュアル化する社内業務または操作手順を決める。
2. 対象者、動画視聴後にできるようになるべき作業、前提知識を定義する。
3. 人間が、手順書、操作メモ、既存資料、注意事項などを 1 つの Markdown に整理する。
4. WebUI で次の企画条件を入力する。
   - 対象者
   - 動画視聴後の到達目標
   - 前提知識
   - 希望する動画尺
   - 動画全体の必須事項
   - 動画全体の禁止事項
   - 台本作成へ引き継ぐ全体制約
5. Markdown を `projects/{projectId}/source/source.md` へ保存する。
6. 保存時の SHA-256 を記録し、以後の AI 生成結果がどの版の入力資料に基づくか追跡できるようにする。
7. 人間が、Markdown と企画条件が実際の業務手順および動画の目的と一致していることを確認する。

6.1 では AI による補完や構成案生成を行わない。人間が作成した Markdown と企画条件を、6.2 の唯一の入力情報として確定する段階とする。

### 6.2 提供資料と構成の整理

情報収集、外部調査、エビデンス調査は行わない。

1. WebUI は、AI 生成または手入力の開始経路を提示する。AI 生成を選んだ場合は、6.1 で確定した Markdown、企画条件、選択されたモデルを入力にする。手入力を選んだ場合は、AI を呼び出さずに導入・本編・まとめの編集枠から開始する。
2. AI 生成を選んだ場合、バックエンドは OpenRouter API を呼び出し、JSON Schema に適合する構成案を受け取る。
3. AI 生成では、入力資料を前提、準備、操作手順、確認方法、注意事項などのセクションへ整理する。手入力では人間が同じ項目を直接入力する。
4. セクションの `role` は `intro`、`main`、`outro` のいずれかとする。
5. `intro` と `outro` はそれぞれ 1 セクション、`main` は 1 セクション以上とする。順序は `intro`、1 件以上の `main`、`outro` とする。
6. AI 生成時のメインセクション数は AI が企画条件と希望尺から提案する。手入力時は人間が必要なセクションを追加・削除・並べ替えできる。
7. 各セクションは少なくとも次を持つ。
   - 一意で安定した ID
   - 表示順
   - `role`
   - タイトル
   - 概要
   - キーポイント
   - 目標尺
   - 入力 Markdown への参照
   - 要確認事項
   - 人間が入力する必須事項、禁止事項、台本作成上の制約
   - 人間が編集し、AI に上書きさせないフィールド
8. 入力資料への参照は、基本的にソース ID と Markdown の見出し階層で表す。行番号だけを永続的な参照として使用しない。
9. 入力資料に存在しない手順や事実を AI が補完しないようにする。
10. 不明点、矛盾、根拠を割り当てられない内容は推測で埋めず、`openQuestions` またはセクションの要確認事項として出力する。
11. AI が生成・編集するタイトル、概要、キーポイントと、人間が台本生成へ渡す必須事項、禁止事項、台本制約を別フィールドで管理する。
12. 初回作成後は、同じ WebUI でセクションの追加、削除、並べ替え、直接編集、フィールドのロック、セクション単位の再生成を行えるようにする。
13. セクション単位の再生成では、対象外セクションの ID と内容、人間が入力した制約、ロック済みフィールドを変更しない。
14. 構成案の状態は `draft`、`needs_review`、`approved` の 3 種類とする。
15. 未解決の `openQuestions` がある構成案は `approved` にできない。
16. 人間が構成案を確認し、実際の業務手順と異なる箇所を修正して全体を承認する。
17. 6.3 は `approved` の構成案だけを入力として受け付ける。

セリフ数は 6.3 で台本を作成するまで確定しない。6.2 ではセクションごとの `targetDurationSec` を正本とし、想定セリフ数を表示する場合は参考値として扱う。

### 6.3 台本

初期段階では人間が初稿を作成し、AI は初稿生成ではなくレビュー補助に使用する。人間が作成した完成稿を正解例として蓄積し、15.2 の改善ループによって生成ルールとレビュー基準が十分に整ってから、AI による初稿生成を追加する。

1. `approved` の構成案から、セクション構造だけを引き継いだ空の台本を作成する。
2. 人間が WebUI でセリフを追加し、2 キャラクターの掛け合い形式で初稿を作る。
3. 台本を 1 セリフずつ JSON データにする。
4. AI が次の観点でレビューする。
   - 入力資料にない手順を追加していないか
   - 操作手順の順番が維持されているか
   - 必須操作や注意事項が抜けていないか
   - キャラクター設定からの逸脱がないか
   - 口調が不自然でないか
   - 説明が冗長または曖昧でないか
5. 人間が台本を読み、内容、口調、話者、表情を修正する。
6. 人間は台本を編集・確認しながら、各セリフカードで 6.4 のキャラクタービジュアルと 6.5 の音声を設定する。generic 現場素材の検索・割り当ては 6.4.1〜6.4.3 の別画面または補助導線で扱い、台本全体の承認操作を次工程の開始条件にはしない。

キャラクターの性格と口調は、レビュー基準として参照できる形で文書化する。

台本には初稿の生成元を保持し、少なくとも `manual`、将来追加する `ai`、外部から取り込む `imported` を区別できるようにする。初期値は `manual` とする。台本の `status` は少なくとも `draft`、`needs_review`、`approved` を区別するが、これは互換性、stale 判定、レビュー結果を示す状態であり、ビジュアル・音声・出力へ進むための承認ゲートではない。自動保存を継続し、不正な台本は保存時または実行時の validation で拒否する。

人力初稿では AI 初稿との差分が存在しないため、承認済みの構成案、完成した人力台本、使用したキャラクター設定を、将来の生成に使用する正解例として関連付けて残す。AI レビューの指摘は、採用または却下した結果と理由も記録する。

### 6.4 ビジュアル

構造化したスライドや図解を AI または自前スキルで生成する方式は採用しない。キャラクタービジュアルは、プロジェクトの character binding とセリフカード上の explicit variant selection を標準経路とする。現場動画、写真、帳票スキャンは別ドメインの素材ライブラリへ登録し、必要な場合だけ人間が検索・確認して generic `VisualAssignment` として割り当てる。AI suggestion、Asset Search、表示設定はその補助機能として残すが、キャラクタービジュアル選択の主導線にはしない。

以下の 6.4.1〜6.4.3 は、現場動画・写真・帳票スキャンを扱う generic Asset Search / `VisualAssignment` の機能・保存データ・API の仕様である。これらを維持することは、Issue #97 が除去対象とする `/projects/{projectId}/script` の旧右ペイン UI（候補、検索、検索結果、素材制作・表示設定カード）を標準画面に残す意味ではない。CV-05 以降に必要な UI を提供する場合も、キャラクタービジュアルの line picker とは分離した別画面または補助導線とする。

#### 6.4.0 キャラクタービジュアル登録（ワークスペース共通）

キャラクタービジュアル登録は、現場動画・写真・帳票スキャンの登録とは別のワークスペース共通ライブラリ機能である。サイドバーから `/character-visuals` を開き、`CharacterVisualSet` の作成、名称・説明の編集、完全な variant の作成、既存 variant の file slot 差し替え、利用状態の変更を行う。`/projects/{projectId}/script` は登録済みビジュアルを参照する制作画面であり、登録処理の正本や導線を兼ねない。

登録時点で全表情・全ポーズを揃える必要はない。不足している variant は未登録として表示し、`CharacterVisualSet` 全体の登録を失敗扱いにしない。一方、永続化する variant は必須 slot が揃った完成状態に限る。`single-image` の作成は `single` 1 件、`mouth-pair` の作成は `closed` と `open` 各 1 件を同一リクエストで検証・登録し、complete file set 欠落の variant を DB や管理領域へ残さない。作成後の差し替えは既存 variant の complete file set 単位で許可するが、必須 slot を削除する API は設けない。形式不正、checksum 不一致、visual 基準キャンバスとの不一致、作成リクエストの slot 欠落は操作全体を失敗させ、既存の完成 variant を変更しない。

登録画面は `mentor` / `learner` の役割選択を要求せず、プロジェクトへ自動紐付けしない。同一キャラクターの別衣装、将来の別キャラクター、差し替え候補を同じワークスペースで保持できるようにする。`ScriptLine.expression` と物理 variant の mapping はこの画面の責務に含めない。登録済み visual / variant / file metadata の正本は workspace SQLite とする。

#### 6.4.0.1 プロジェクト binding とセリフの明示選択

1. `/projects/{projectId}/characters` は、`project.json` に保存された VOICEVOX 話者と `CharacterVisualSet` の binding と、workspace SQLite の現在の `CharacterVisualCatalogSnapshot` を組み合わせた確認画面とする。`visualId === characterId` を前提にせず、binding がない場合は「未設定」と表示する。
2. character ごとの binding は概念的に次を持つ。`visualId` と `idleVariantId` はともに `null` を許可し、待機用 variant も人間が明示選択する。active でない、存在しない、別 visual に属する参照を別候補へ自動置換しない。
   ```ts
   type CharacterVisualBinding = {
     visualId: string | null;
     idleVariantId: string | null;
   };
   ```
3. セリフカードの「ビジュアルを変更」はモーダルを開く。モーダルにはその line の speaker に binding された `CharacterVisualSet` の active variant だけを表示し、workspace 内の別 visual の variant を混在させない。
4. variant には少なくとも preview、label、renderType、tags、選択中状態を表示する。ここでの tags は CharacterVisual variant 専用のタグドメインであり、現場素材 `Asset` のタグ辞書・tag ID・関連付けとは共有・混同しない。`mouth-pair` は `closed` / `open` の両方を確認できるようにし、`single-image` に存在しない口差分を生成・推測しない。
5. 新規 line は `characterVariantId: null` から開始する。人間が選択した variant の ID だけを保存し、line の speaker に binding された `CharacterVisualSet` 配下であることを保存時・出力前に検証する。missing、inactive、cross-visual の場合は代替せず validation error とする。
6. `expression`、variant の tag、label から physical variant を自動選択しない。タグを指定した場合も、タグ一致数が多い active variant を上位へ移動するだけで、不一致 variant を一覧から削除しない。タグ未指定では active variant をすべて表示し、同点では catalog snapshot の決定論的な元順序を維持する。
7. 選択済み variant は別の「選択セリフの表示設定」カードではなく、各セリフカード自体に preview、label、renderType、未選択状態、ビジュアル変更ボタンとして表示する。

#### 6.4.1 素材の事前登録

1. 人間が素材ライブラリ画面から動画、写真、帳票スキャンを登録する。
2. バックエンドがファイル種別、サイズ、解像度、動画尺、ページ数、チェックサムなどの技術情報を取得する。
3. バックエンドが一覧表示用サムネイルを生成する。動画は代表フレーム、複数ページ帳票はページごとのサムネイルを生成する。
4. 人間がタイトル、説明、分類タグ、機密区分、利用可否を確認・編集する。
5. 素材を `active` にした時点で generic Asset Search の検索対象にする。差し替えや利用停止は履歴を残し、既存プロジェクトの素材を暗黙に変更しない。

#### 6.4.2 AI サジェスト（現場素材の補助機能）

1. 対象は 1 セリフまたは人間が指定した連続セリフ範囲とする。これは現場動画・写真・帳票スキャン用の generic Asset Search を補助する機能であり、CharacterVisualSet の variant 選択には使用しない。
2. AI には対象台本、セクションの概要、利用可能な素材種別、タグ辞書を渡す。素材ファイル本体や素材 ID の全一覧は渡さない。
3. AI は `requiredTags`、`optionalTags`、`excludedTags`、`mediaKinds`、`freeTextQuery`、`reason` を構造化して返す。
4. バックエンドは正規化済みタグと全文検索を用いて `active` な素材だけを検索し、必須タグ一致、任意タグ一致、検索語一致の順でスコアリングする。
5. 候補にはサムネイル、素材種別、タイトル、主要タグ、一致理由、動画尺または帳票ページ数を表示する。AI が返したタグに一致する素材がない場合は「候補なし」と不足タグを表示し、存在しない素材を補完しない。
6. サジェストは候補にとどめ、自動では割り当てない。人間が候補を選択した時だけ `visuals.assignments` へ保存する。

この二段階方式は現場素材検索の補助経路として維持する。AI に素材 ID を直接選ばせる方式は、削除済み素材や誤った ID の生成を防ぐため採用しない。AI visual suggestion backend、検索ログ、suggestion schema、generic `VisualAssignment` は今回削除しない。

#### 6.4.3 手動検索と割り当て（現場素材）

1. セリフまたは連続するセリフ範囲を選択し、現場素材用の Asset Search から素材ピッカーを開いて、キーワード、タグ、素材種別、部門、対象システム、利用状態で検索する。これは CharacterVisualSet variant の picker とは別ドメインである。
2. 検索結果をサムネイルのグリッドまたは一覧で表示し、動画はその場で短くプレビューできるようにする。帳票はページを切り替えて確認できるようにする。
3. 人間が素材を選び、適用する開始セリフと終了セリフを指定する。
4. 選択時に素材を `projects/{projectId}/media/visuals/` へコピーし、プロジェクト JSON に `assetId`、チェックサム、相対パスを保存する。これをレンダリング用スナップショットとし、以後の素材DB変更から切り離す。
5. 動画は使用区間、写真・帳票はページまたは切り抜き範囲を指定し、必要に応じて拡大、位置、注釈を設定する。
6. 素材を大きく見せたい generic assignment では、保存値 `display.prioritizeVisual: boolean` により固定レイアウト規則を適用できる。有効な区間ではキャラクターを縮小または非表示にする。この値は generic `VisualAssignment` の表示設定として維持するが、CV-04 後の標準 `/projects/{projectId}/script` に旧「キャラクターペイン」のトグルや素材制作・表示設定カードを置くことは意味しない。編集 UI は別画面または補助導線で扱う。
7. 同じ台本範囲への割り当て変更、解除、前後の範囲への延長・短縮を行えるようにする。

#### 6.4.4 確認と validation

1. 各セリフカードには CharacterVisualSet から選択した variant の preview、label、renderType、または「未選択」を表示する。
2. character binding の visual、idle variant、line の `characterVariantId` が存在し、active で、speaker と同じ visual に属することを機械検証する。未選択は編集中に許可するが、出力前には validation error とする。
3. 現場素材については、未割り当ての区間、参照切れ、チェックサム不一致、動画区間外の指定、帳票ページ範囲外の指定を機械検証する。
4. 人間が台本内容と素材内容、表示区間、機密区分、キャラクターの選択内容が一致していることを確認する。
5. 確認結果は警告・エラーと `VisualPlan.status` へ反映する。人間の「ビジュアルを承認」操作や `approved` 状態を 6.5 以降の開始条件にはしない。

プレビュー、`RenderManifest` 生成、MP4 レンダリングの開始時には、台本の構造、音声の current/stale/missing、素材参照、範囲、checksum、元資料・構成案とのハッシュ整合性を機械検証する。検証に失敗した場合は実行せず、修正対象を表示する。

AI のサジェスト入力・出力、検索結果、採用した素材、却下した候補と理由は改善ログへ残す。ただし検索結果一覧そのものをプロジェクト JSON の正本にはせず、確定した割り当てだけを保存する。

### 6.5 音声

[VOICEVOX ENGINE](https://github.com/VOICEVOX/voicevox_engine) を使用する。公式 API の `audio_query` で読み上げ用クエリを生成し、`synthesis` で WAV 音声を合成する。

1. キャラクターごとに VOICEVOX の speaker ID または style ID を設定する。
2. セリフごとに `audio_query` を生成する。
3. 未編集の `audio_query` を再生成可能なキャッシュとして保存する。
4. 必要に応じて話速、音高、抑揚、音量、文前後の無音、アクセント、モーラ単位の音高・長さ・無声化を調整する。
5. 人間が確定した調整を `voice-adjustments/{lineId}.json` へ保存する。
6. `synthesis` で全セリフを個別の音声ファイルとして生成する。
7. 生成音声の再生時間を取得し、タイムライン計算へ渡す。
8. BGM と効果音は、ファイルごとに音量を管理する。

未編集の query と手動調整は分離する。前者は削除・再生成可能な派生キャッシュ、後者は Git 管理可能な正本データとする。調整ファイルには基礎となった読み上げ文、style ID、VOICEVOX ENGINE の互換バージョン等から算出したハッシュを持たせ、基礎条件が変化した調整を新しい音声へ自動適用しない。

#### 推奨音声形式

- 中間・マスター音声: WAV
- 符号化: PCM 16-bit
- サンプリングレート: 24 kHz
- チャンネル: モノラル

VOICEVOX の生成結果を再エンコードせず WAV のまま保持し、最終動画のレンダリング時に動画用音声へ変換する。これにより、タイムライン計算時の音声長とレンダリング時の音声長の差を避ける。

#### 推奨ファイル命名規則

```text
audio/voice/{projectId}/{sectionOrder}-{lineOrder}_{lineId}_spk{speakerId}_{textHash8}.wav
```

例:

```text
audio/voice/expense-manual/02-014_line-0027_spk3_a1b2c3d4.wav
```

- `sectionOrder` と `lineOrder` は、フォルダー内で再生順に並べるためにゼロ埋めする。
- `lineId` は台本修正後も可能な限り維持する。
- `speakerId` で使用音声を識別する。
- `textHash8` は読み上げ本文と音声設定から計算し、内容変更時のキャッシュ誤使用を防ぐ。
- 同一条件の音声が存在する場合は再生成しない。

#### 6.5.1 セクション BGM

1. 各セクションは BGM を 0 曲または 1 曲設定できる。
2. セクション見出しから曲の選択、差し替え、解除、単体試聴を行う。
3. 曲ごとに音量、ループ、フェードイン、フェードアウトを設定する。
4. セクション音声と合成した状態を、そのセクションだけ試聴できるようにする。
5. 再生範囲はセクションの最初のセリフ開始から最後のセリフ終了までとし、台本や音声長が変化した場合は自動的に追従する。
6. セクション境界では曲を重ねず、前曲をフェードアウトし、次曲をフェードインする。

MVP では自動ダッキング、音量キーフレーム、1 セクション内の複数曲、曲同士のクロスフェードを行わない。

### 6.6 タイムライン

正本のプロジェクト JSON をそのまま描画コンポーネントで解釈せず、レンダリング前にタイムラインコンパイラで `RenderManifest` へ変換する。音声ファイルの長さを、動画編集における duration の基準とする。

`RenderManifest` の生成は台本・ビジュアルの承認状態を確認する工程ではない。出力時の実行条件として、正本 JSON のスキーマ、構成案の承認済み・最新状態、台本の構造と `outlineHash`、音声の current 状態、素材参照・範囲・checksum、Manifest の整合性を検証する。`draft` や `needs_review` の status だけを理由に生成を拒否しない。

処理の責務は次のとおりとする。

1. Zod で正本 JSON を検証する。
2. 参照している音声とビジュアル素材の存在、チェックサム、有効範囲を検証する。キャラクタービジュアルについては、バックエンドが SQLite と管理領域から取得した snapshot、登録済みファイル、PNG 構造、透過情報、visual 基準キャンバスとの一致を専用検証で確認する。
3. `project.characters[].characterVisual.visualId`、`project.characters[].characterVisual.idleVariantId`、各 line の `characterVariantId` を、検証済み `CharacterVisualCatalogSnapshot` と照合する。`ScriptLine.expression`、tag、label から物理 variant を暗黙に自動変換・代替しない。コンパイラは SQLite を直接参照しない。
4. 各音声ファイルの再生時間を取得し、セリフ ID と対応付ける。
5. `pauseBeforeMs`、音声長、`pauseAfterMs` を fps に基づいてフレームへ変換する。
6. セリフを表示順に累積し、各セリフの `from`、`durationInFrames`、`speechFrom`、`speechDurationInFrames` を確定する。
7. `startLineId` と `endLineId` で指定されたビジュアル割り当てを、`from` と `durationInFrames` へ解決する。
8. 各セクションの最初と最後のセリフから、背景の表示範囲を確定する。
9. 先頭へ 2 秒の opening、選択されたセクション境界へ 2 秒の eye catch を挿入し、後続要素をシフトする。
10. セクションごとの BGM を、プレースホルダー挿入後の各セクション範囲へ割り当てる。
11. 効果音をセリフ基準の位置へ割り当てる。
12. 末尾へ 2 秒の ending を追加する。
13. 動画全体の `durationInFrames` を計算し、`RenderManifest` を生成する。
14. `sourceProjectHash` と参照素材のチェックサムを記録し、入力が同一の場合だけ生成済みキャッシュを再利用する。

ミリ秒からフレームへの変換は、要素が途中で欠けないように次を基本とする。

```ts
const msToFrames = (ms: number, fps: number): number =>
  Math.ceil((ms / 1000) * fps);
```

フレーム範囲は半開区間として扱い、`from <= frame < from + durationInFrames` の場合だけ要素を有効とする。これにより、隣接する要素の境界フレームが重複しない。

セリフの `from` は無言区間を含むセリフ区間の開始位置、`speechFrom` はそのセリフ区間内で音声が始まる相対フレームとする。字幕を音声区間だけ表示するか、前後の無言を含むセリフ区間全体へ表示するかは字幕コンポーネントの共通設定で決定し、セリフごとに暗黙の挙動を変えない。

生成した `RenderManifest` は `projects/{projectId}/cache/render-manifest.json` へ保存できる。ただしこれは検査と再利用のための派生キャッシュであり、人間が直接編集しない。

### 6.7 Remotion 描画

- Remotion には `RenderManifest` を通常の React props として渡す。
- Composition の `durationInFrames`、fps、幅、高さは `RenderManifest` から決定する。
- セリフ、ビジュアル、背景、音声などの各要素は、`from` と `durationInFrames` を用いて Remotion のタイムラインへ配置する。
- 動画の各フレームを React で描画する。
- Remotion から渡される現在フレーム番号を基準に、位置、透明度、表示内容、素材動画の再生位置などを計算する。
- 時間経過へ依存する通常の CSS アニメーションは基本的に使用しない。
- 背景、字幕、キャラクター、ビジュアルをすべてフレーム番号から決定し、再現可能な描画にする。
- 音声解析、素材探索、ID 解決、タイムラインの累積計算は描画コンポーネント内で繰り返さず、タイムラインコンパイラで完了させる。
- WebUI のプレビューと MP4 レンダリングには、同じタイムラインコンパイラと同じ `RenderManifest` を使用する。

### 6.8 キャラクター演出

以下の `RenderManifest.characters[]`、`RenderManifest.lines[].characterVariantId`、`RenderManifest.characterVariants[]` は CV-05 target model であり、現行 `RenderManifest 1.0.0` へ CV-04 で追加するフィールドではない。CV-05 では `manifestVersion: "2.2.0"` として保存し、`RenderCharacterVariant` は physical visual の `(visualId, variantId)` を識別する。同じ physical variant を複数の project character が共有しても、特定話者の所有権で上書きしない。既存 `characterMappingVersion` は cache / run-log 互換のメタデータとして残すが、variant 選択には使用しない。

production compile は `POST /api/projects/{projectId}/manifest/compile` を標準経路とする。backend は SQLite の `CharacterVisualCatalogSnapshot` を `verifyFiles()` で検証し、file checksum を含む validated snapshot と asset metadata を compiler へ渡してから `RenderManifestStore` に保存する。compiler や Remotion が SQLite を直接検索したり、静的 legacy catalog を通常経路として渡したりしない。

- 2 人のキャラクターを使用する。
- 各キャラクターは画面下部の左右へ配置する。
- `RenderManifest.lines[].expression` は台本の論理表情であり、PNG、物理ポーズ、`variantId` を直接指定する値ではない。
- `RenderManifest.characters[].idleVariantId` と `RenderManifest.lines[].characterVariantId` は、`project.json` に人間が保存した明示参照から解決する。`neutral`、`smile`、`explain`、`caution`、tag、label から `stand`、`normal`、`pointing` などへ自動的に割り当てない。
- 発話中のキャラクターだけ、解決済み `mouth-pair` variant の `closed` / `open` を切り替える。
- `single-image` variant に存在しない `open` 画像を推測、複製、加工して口パクに使用しない。単一画像を発話中にどう表示するかは TBD とする。
- 発話中は小さく上下に動かし、話者を視覚的に明示する。
- キャラクターの話者、論理表情、口パク、発話中演出は、project.json の明示 binding / line variant 参照、検証済み snapshot、タイムラインから決定する。キャラクタービジュアル登録では物理 variant を追加・更新できるが、プロジェクトでの採用は登録画面で自動決定しない。ユーザーが Remotion 用の物理ファイルパスを直接編集する機能も持たない。
- ビジュアル素材を大きく表示する場面では、ビジュアル割り当ての「ビジュアルを優先」トグルによりキャラクターを縮小または非表示にできる。
- 話者、論理表情、発話区間は `RenderManifest.lines[]` から取得し、物理素材のパスは解決済みのキャラクター素材情報から取得する。
- MVP の将来口パクは、解決済み `mouth-pair` variant の発話区間内で相対フレームから計算し、設定された周期で `closed` と `open` を切り替える。無言区間と発話終了後は必ず `closed` とする。
- 上下動、拡大縮小、フェードなどは現在フレームから決定する純粋な計算とし、実時間に依存する状態を持たない。

MVP の配置スキーマは固定とする。通常時は 2 人を画面下部の左右へ表示し、`visuals.assignments[].display.prioritizeVisual` が `true` の区間だけ、素材種別と表示領域に応じた既定規則で両者を縮小または非表示にする。ユーザーがキャラクターごとの座標、表情、アニメーションを直接編集する機能は持たせない。将来、複数の表示スキーマが必要になった場合は、座標値を各割り当てへ追加するのではなく、互換性を保った `layoutPreset` の切り替えとして拡張する。

### 6.9 背景

- ビジュアル表示領域の外側には共通背景を使用する。
- 背景の動きは説明を妨げない控えめなものとする。
- 現場動画、写真、帳票の場面では、背景より素材の視認性を優先する。
- 背景はセクション単位で台本編集画面の背景ペインから選択し、プレビューを確認しながら変更できるようにする。
- 背景ペインの編集結果は `sections[].background` へ保存し、同じセクション内のセリフには共通設定として適用する。
- 背景状態は現在フレーム番号から計算し、再現可能にする。
- セクションごとの背景設定はタイムラインコンパイラが `RenderManifest.backgrounds[]` のフレーム範囲へ変換する。
- 背景コンポーネントは現在フレームに対応する背景定義を選び、同じフレームに複数の背景が競合しないようにする。

### 6.10 動画全体の構成

- タイトル
- この動画の目的
- 前提・準備
- 操作手順
- 確認方法
- 注意事項
- まとめ
- エンディング

MVP では先頭に 2 秒の opening、末尾に 2 秒の ending を必ず挿入する。必要に応じてセクション境界へ 2 秒の eye catch を追加する。いずれも無音の共通プレースホルダー画面とし、本番素材への置換は MVP 後に行う。一般向け動画の視聴維持を目的とした冒頭ダイジェストは必須としない。

### 6.11 レンダリング

1. 完成した JSON をシステムに読み込む。
2. 出力時 validation で正本 JSON、構成案の最新性、台本、音声、素材参照、範囲、checksum を検証する。
3. タイムラインコンパイラで `RenderManifest` を生成し、生成結果を検証する。
4. `RenderManifest` を Remotion の props として渡し、プレビューで内容を確認する。
5. 同じ `RenderManifest` を使用して MP4 としてレンダリングする。
6. 修正が必要な場合は正本 JSON を直し、validation と `RenderManifest` を再実行してから再レンダリングする。

## 7. 独自 WebUI

WebUI は Vite + React SPA、React Router、TanStack Query で構築し、Fastify のローカル API と接続する。開発時は Vite から `/api` を Fastify へ proxy し、製品実行時は Fastify がビルド済み SPA と API を同一 origin で配信する。ワークスペース共通ライブラリには、現場素材画面とは別に `/character-visuals` のキャラクタービジュアル画面を設ける。

JSON の通常編集は用途別フォームから行い、ファイルの直接編集を通常運用にしない。画面、保存、API、エラー処理の具体仕様は 17.4 および [`implementation-spec.md`](./implementation-spec.md) 14 章に記載する。

## 8. 自動検証

### 8.1 データ検証

- Zod で JSON のスキーマを検証する。
- 必須設定の欠落や設定ミスを、音声生成・レンダリング前に検出する。
- 参照している音声とプロジェクトへ取り込んだビジュアル素材が存在し、保存済みチェックサムと一致することを確認する。
- 動画の開始・終了位置、帳票のページ、画像・帳票の切り抜き範囲が素材の有効範囲内であることを確認する。
- セクション ID、セリフ ID、キャラクター ID の重複や不正参照を検出する。
- character の `visualId` と `idleVariantId` が同じ `CharacterVisualSet` 配下の active variant を参照することを検出する。未設定は編集中に許可するが、出力前 validation ではエラーとする。
- `ScriptLine.characterVariantId` が line の speaker に project 上で binding された visual 配下の active variant を参照することを検出する。missing、inactive、cross-visual は自動代替せずエラーとする。
- `ScriptLine.expression`、variant の tag、label を physical variant の解決入力として使用しない。
- ビジュアル割り当ての開始・終了セリフが存在し、同じセクション内で順序が逆転していないことを確認する。

### 8.2 レイアウト検証

- 字幕が画面外へはみ出していないかを検証する。
- 割り当て済みビジュアルを字幕とキャラクターを含むプレビュー画像として一括出力する。
- AI が、切り抜き不良、はみ出し、重なり、コントラスト不足をレビューする。
- 動画、写真、帳票上の注釈が対象箇所を隠していないか確認する。
- 最後に人間が目視で確認する。

### 8.3 内容検証

エビデンス調査と翻訳検討は行わない。

- AI は、入力資料と台本の間で手順の順序、必須項目、注意事項に欠落がないか確認する。
- AI は、入力資料にない内容が追加されていないか確認する。
- AI は、キャラクターの口調、説明の明瞭さ、用語表記の一貫性を確認する。
- 実際の業務手順として正しいかどうかの最終判断は人間が行う。

## 9. サムネイル

### 9.1 制作方針

サムネイルは、社内で動画を識別しやすくするための表紙画像として作成する。

1. 共通テンプレートを使用する。
2. タイトルと部門名または対象システム名を必須入力とする。
3. 補足、マニュアル版数、背景画像、キャラクター、操作画面の代表画像は任意入力とする。
4. 背景画像を指定しない場合は共通テンプレートの既定背景を使用する。
5. レイアウト結果をプレビューする。
6. 完成状態を JSON に保存する。
7. PNG または JPEG として出力する。

### 9.2 制約

- 文言はタイトルと短い補足に限定する。
- 小さい一覧表示でも識別できる文字サイズを確保する。
- 動画ごとに自由なデザインを生成せず、共通テンプレートを使用する。
- タイトル、部門名または対象システム名は空にできない。
- 補足、マニュアル版数、背景画像、代表画像、キャラクターは未指定を許可する。
- 外部公開向けのクリック率最適化や広告的な表現は考慮しない。

## 12. デザイン方針

元プロジェクトの画面構成を基礎としつつ、社内マニュアルとして操作画面と文字の視認性を優先する。

- 16:9 の横長画面。
- 中央にビジュアル表示領域を配置し、その中へ現場動画、写真、帳票スキャンをアスペクト比を保って表示する。
- 2 人のキャラクターを画面下部の左右に表示する。
- 字幕は画面下部中央へ大きく表示する。
- 字幕は話者ごとに強調色を使い分ける。
- 画面上端にセクション名を表示する。
- 素材は可能な限り大きく表示し、必要な場合だけ重要箇所へ短い注釈を重ねる。
- 装飾的な動きより、操作対象と字幕の読みやすさを優先する。

推奨デザイントークンは 17.13 に記載する。

## 14. コスト・運用方針

- 本システムは単一ユーザーがローカル環境で使用する。
- 配布用パッケージ、マルチユーザー対応、認証・権限管理、外部公開機能は作らない。
- 完成映像を動画生成 AI で生成せず、映像生成単位の従量コストを発生させない。
- VOICEVOX ENGINE はローカルで実行する。
- OpenCode と OpenRouter を利用し、AI モデル呼び出し部分だけを外部サービスへ接続する。
- AI 呼び出しを用途別に識別し、初期実装では共通モデルを使う。利用実績が蓄積した後、必要な用途だけモデルを分離してコストと品質を調整する。
- AI へプロジェクト全体を無条件に渡さず、各処理に必要な入力だけを渡す。
- OpenRouter の API キーはリポジトリや JSON へ保存せず、環境変数または OpenCode の認証設定で管理する。

## 15. 継続改善

### 15.1 記録対象

- 承認済みの構成案と完成した人力台本の組み合わせ
- 台本の修正
- 手順順序の修正
- 読み方・イントネーションの修正
- 字幕の修正
- AI が付けた検索タグと検索意図の修正
- サジェスト候補の採用・却下と理由
- ビジュアル素材、適用セリフ範囲、動画区間、帳票ページ、切り抜き、注釈の修正
- サムネイルの修正
- AI レビューが指摘した内容
- AI レビューの指摘を採用または却下した結果と理由
- 音声を再生成した理由
- 制作中に発生した失敗

### 15.2 改善ループ

1. 人間と AI の修正内容、判断理由、生成元をタグ付きで SQLite へ記録する。
2. 人力初稿の段階では、承認済みの構成案と完成稿を正解例として蓄積する。
3. ログから繰り返し発生する修正傾向を分析し、生成ルールの候補を作る。
4. 生成ルールの候補に根拠となる修正ログとタグを関連付け、採用、保留、却下などの状態を管理する。
5. 採用した傾向を台本生成プロンプト、テンプレート、VOICEVOX 設定、レビュー観点へ反映する。
6. 発生した失敗を新しい自動検証またはレビュー項目として追加する。
7. 将来 AI 初稿を導入した後は、AI 初稿と人間が承認した完成稿の差分も記録する。
8. 同じ修正や失敗が再発しにくいシステムへ更新する。

SQLite は素材メタデータの検索と、複数プロジェクトを横断した改善ログの検索・集計に使用する。確定した素材はプロジェクト内へ取り込み、割り当てをプロジェクト JSON に保存するため、レンダリング時には SQLite を必須入力にしない。

## 16. 機能要件

### 16.1 必須

- JSON から Remotion 動画を生成できる。
- 正本 JSON と素材メタデータから `RenderManifest` を生成できる。
- `RenderManifest` を WebUI プレビューと MP4 レンダリングで共用できる。
- 2 キャラクターの掛け合いを表現できる。
- VOICEVOX でセリフ音声を一括生成できる。
- セリフ音声長からタイムラインを自動生成できる。
- 字幕、音声、口パク、表情、現場動画、写真、帳票スキャンを同期できる。
- 素材をメタデータとタグ付きで登録し、サムネイルを生成して検索できる。
- ワークスペース共通ライブラリへ `CharacterVisualSet` を登録・更新し、一部 variant が未登録の状態、variant 作成時の必須 slot、visual 単位のキャンバス基準を確認できる。
- `project.json` に VOICEVOX 話者と `CharacterVisualSet` の binding、各 line の explicit `characterVariantId` を保存し、人間主導で待機用 variant と physical variant を選択できる。
- `/projects/{projectId}/script` をセクション・セリフカード中心の 1 ペイン構成とし、カード内に選択中 variant の preview、label、renderType、未選択状態、ビジュアル変更ボタンを表示できる。
- ビジュアル変更 modal picker で speaker に binding された visual の active variant だけを表示し、mouth-pair の closed/open を確認できる。タグは filter ではなく一致数順の並べ替え補助とする。
- `/projects/{projectId}/characters` で project binding と SQLite snapshot を組み合わせて確認し、未紐づけを「未設定」と表示できる。
- AI が台本区間へ検索タグを付け、バックエンドが実在する素材候補を返せる。
- generic Asset Search の別画面または補助導線から、人間が候補または手動検索結果を選び、1 セリフまたは連続セリフ範囲へ割り当てられる。これは CV-04 後の標準 `/projects/{projectId}/script` 右ペインを意味しない。
- 動画の使用区間、画像・帳票のページまたは切り抜き、拡大、位置、注釈を指定できる。
- オープニング、エンディング、アイキャッチを挿入できる。
- JSON をスキーマ検証できる。
- 字幕やビジュアルのはみ出しを検証できる。
- MP4 をレンダリングできる。
- サムネイルを構成し、JSON に保存して画像出力できる。
- 人間と AI の修正内容、判断理由、生成元をタグ付きで SQLite へ記録できる。
- 複数プロジェクトのログを横断して検索・集計し、生成ルール候補と根拠となるイベントを関連付けられる。

### 16.2 品質要件

- 同じ JSON と素材から同じフレームを再現できること。
- 同じ正本 JSON、素材、出力設定から同一の `RenderManifest` を再生成できること。
- 正本 JSON と `RenderManifest` の責務を分離し、自動計算値を正本へ書き戻さないこと。
- 文字量が変わっても、既定範囲内でレイアウトが大きく崩れないこと。
- 字幕、音声、ビジュアル素材、キャラクター動作がフレーム単位で同期すること。
- 動画、写真、帳票内の文字や操作対象を視認できること。
- AI に素材や完成デザインを生成させず、タグ付けと候補理由の生成だけに限定すること。
- AI が返した存在しないタグや素材を自動割り当てせず、人間が素材内容を確認して確定すること。
- AI visual suggestion、Asset Search、generic `VisualAssignment` の backend / data を維持しつつ、キャラクタービジュアル選択の標準経路を人間の明示選択とすること。
- `expression`、tag、label、旧固定 mapping から physical variant を自動代替せず、missing / inactive / cross-visual を validation error とすること。
- 機械検証、AI レビュー、人間レビューの段階を通せること。
- 入力資料にない手順を AI が事実として追加しないこと。

## 17. 実装に向けた推奨案と未確定事項

2026-07-28 時点で、本章に記載した推奨案はすべて採用する。具体的なモジュール構成、API、型、初期バージョンは [`implementation-spec.md`](./implementation-spec.md) を正本とする。

### 17.1 JSON Schema

**推奨案**

- TypeScript の型と Zod スキーマを同じソースから管理する。
- ルートに `schemaVersion` を持たせ、将来のデータ移行に備える。
- プロジェクト、セクション、セリフ、キャラクターには、人間が読める安定 ID を付ける。
- 表示順と ID を分離する。並べ替えても音声キャッシュや修正ログとの対応が壊れないようにする。
- パスはプロジェクトルートからの相対パスで保持する。
- 自動計算できる開始フレームや音声長は入力 JSON の正本にせず、生成キャッシュへ保存する。
- 正本の `VideoProject` と派生データの `RenderManifest` は別の Zod スキーマと TypeScript 型で管理する。
- `RenderManifest` には生成元となった正本 JSON のハッシュと参照素材のチェックサムを持たせ、いずれかが不一致の場合は再生成する。
- CV-05 で project-specific binding と line の explicit variant reference を導入する際は、`schemaVersion: "1.0.0"` の意味を暗黙に変更せず、明示的な schema version bump と migration を行う。migration は tag / label 検索による推測をせず、既知の旧固定 mapping を決定論的な compatibility input として使える場合だけ利用し、解決不能な値は未設定として人間の確認を要求する。

**確定**

- JSON の通常編集は WebUI の用途別フォームから行う。ファイルの直接編集は通常運用としてサポートしない。
- JSON Schema はバックエンド内部で生成・使用し、外部ファイルとして公開しない。

### 17.2 リポジトリ構成

**確定**

単一ユーザー用のため、複雑なモノレポにはせず、1 リポジトリ内で機能別に分割する。

```text
project-root/
├─ src/
│  ├─ compositions/
│  ├─ components/
│  │  ├─ characters/
│  │  ├─ subtitles/
│  │  └─ visuals/
│  ├─ timeline/
│  ├─ schema/
│  ├─ voicevox/
│  ├─ agents/
│  ├─ validation/
│  └─ thumbnail/
├─ projects/
│  └─ {projectId}/
│     ├─ project.json
│     ├─ source/
│     ├─ media/
│     ├─ audio/
│     ├─ cache/
│     │  └─ render-manifest.json
│     ├─ output/
│     └─ logs/
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
└─ package.json
```

### 17.3 ランタイムと依存関係

**確定**

- Node.js 24 LTS
- TypeScript の strict mode
- React と Remotion
- Zod
- パッケージマネージャーは pnpm
- バージョン固定用の `pnpm-lock.yaml`
- Node.js のバージョン固定用の `.node-version`
- `package.json` の `engines` で対応 Node.js を明示

初期バージョン番号は `implementation-spec.md` 4.4 の表を採用する。導入直後に互換性を確認して `pnpm-lock.yaml` へ固定し、自動でメジャーアップデートしない。

### 17.4 WebUI

**確定仕様**

WebUI は単一ユーザーがローカル環境で使用し、同じ `project.json` を制作データの正本として編集する。workspace 共通の `CharacterVisualSet` と配下の visual / variant / file metadata は SQLite から取得し、project-specific な character binding と line の `characterVariantId` だけを `project.json` に保存する。まず 6.1 の入力作成と 6.2 の構成案生成・レビューを行い、構成案の承認・最新性を確認した後、6.3 の台本画面を制作の中心として使う。キャラクタービジュアルの登録・更新は、この制作画面とは別の `/character-visuals` ワークスペース画面で行う。

#### 画面構成

- プロジェクト選択・新規作成
- Markdown エディター
- 対象者、到達目標、前提知識、希望尺、全体制約を入力する企画フォーム
- OpenRouter モデル選択（`free` / `paid` の料金区分フィルターを含む）
- ZDR の有効・無効を切り替えるトグル
- 構成案の AI 生成または手入力開始
- 構成案のセクション一覧と編集フォーム
- セクションの追加、削除、並べ替え、複製
- セクション単位の再生成
- フィールド単位のロック
- 要確認事項の表示と解決
- 構成案全体の承認
- 生成中、失敗、再試行、保存状態の表示

セクションは折りたたみ可能なカードとして表示する。各カードでは `intro`、`main`、`outro`、タイトル、概要、キーポイント、目標尺、必須事項、禁止事項、台本制約、入力資料への参照、要確認事項を編集できるようにする。

AI が生成する内容と人間が入力する指示を視覚的にもデータ上も分離する。人間が入力した必須事項、禁止事項、台本制約は、明示的に削除しない限り AI の再生成で上書きしない。

編集内容はプロジェクトフォルダーへ自動保存する。構成案だけは、台本の初期化と制作コンテキストの前提として承認・最新性を確認する。台本、セリフカード上のキャラクタービジュアル、音声は同じ制作画面で編集し、generic 現場素材の検索・割り当ては分離した補助導線で扱う。承認操作を後工程の開始条件にしない。

#### 台本編集画面

これは Issue #97（CV-04）後の `/projects/{projectId}/script` 制作画面の基本仕様である。画面はセクションとセリフカードを中心とする 1 ペイン構成とし、キャラクタービジュアルの選択を人間の明示操作で完結させる。プレビュー、背景、VOICEVOX 音声生成・調整などの補助機能を残す場合も、右ペインを主導線にせず、各セリフカードとセクションの文脈へ統合する。

後続実装では、現在の右ペインにある次の UI を `/projects/{projectId}/script` から除去する。

- 現在の編集対象
- 制作 ビジュアル候補
- AI によるビジュアル候補 UI
- 手順3-3 素材検索
- 素材検索結果
- 素材制作・表示設定カード

これは AI visual suggestion、現場素材用 Asset Search、generic `VisualAssignment` の backend、service、schema、ログ、データを削除する指定ではない。必要な機能は別画面または後続の補助導線として維持し、キャラクタービジュアル選択の標準経路とは分離する。

各セリフカードには少なくとも次を表示する。

- セリフ ID
- 話者
- 台本が保持する論理表情（`expression`）の表示
- 字幕テキスト
- VOICEVOX 読み上げテキスト
- 実際の字幕コンポーネントを使用した字幕プレビュー
- 生成済み音声の再生
- 音声の生成・再生成
- 選択中 variant の preview、label、renderType、または「未選択」
- 「ビジュアルを変更」ボタン。押すと speaker に binding された visual の active variant だけを表示する modal picker を開く
- 現場素材の generic assignment が存在する場合の参照表示（character variant picker と混同しない）
- 並べ替え、複製、削除

読み上げテキストは、ひらがなだけでなくカタカナや読み方調整用の表記を入力する可能性があるため、UI 上では「よみがな」ではなく「VOICEVOX 読み上げ」と表記する。字幕プレビューには最終動画と同じ Remotion 字幕コンポーネントを使用し、改行、文字サイズ、はみ出しの判定を一致させる。

人間がセリフカードを 1 件ずつ追加できる操作に加え、話者付きテキストをまとめて貼り付け、セリフカードへ機械的に分割する一括入力を用意する。一括入力は AI 生成ではなく、入力テキストの構造化処理として扱う。

台本の編集内容は自動保存する。各セリフカードから `characterVariantId` の明示選択と VOICEVOX 音声生成・調整を直接操作できる。現場素材の検索・割り当て backend は維持するが、CV-04 の標準制作画面からは上記の右ペイン UI を除去する。入力エラー、character binding の未設定・参照切れ・inactive・cross-visual、line variant の未選択・参照切れ、generic 素材参照切れ、音声 stale などは validation として表示し、台本承認操作を要求しない。

#### キャラクタービジュアル画面

`/character-visuals` はワークスペース共通のキャラクタービジュアル一覧と登録画面である。サイドバーから常に開ける独立した画面とし、プロジェクト選択や `/projects/{projectId}/script` の状態に依存させない。一覧では `name`、`description`、`status`、登録済み variant 数、完成 variant 数、キャンバス基準サイズを表示する。

登録・編集画面では、`CharacterVisualSet` の基本情報、variant の `label`、`renderType`、`tags`、ファイル slot を編集する。全表情・全ポーズの一括登録は要求せず、未登録の variant は未登録として表示する。variant 作成フォームでは、`single-image` の `single`、`mouth-pair` の `closed` / `open` を揃えてから登録する。slot 欠落、形式不正、checksum 不一致、visual 基準キャンバスとの不一致は登録リクエストの validation として表示し、不完全な variant を永続化しない。既存の完成 variant は complete file set 単位で差し替えできるが、必須 slot の削除は行わない。`mentor` / `learner` の役割付与、プロジェクト選択、論理表情との mapping はこの画面に置かない。

WebUI は SQLite、キャラクターファイル、ローカルファイルシステムを直接操作しない。登録・更新は Fastify API に渡し、画像表示も管理された配信経路を使用する。

#### キャラクター素材確認画面

`/projects/{projectId}/characters` は、`project.json` の VOICEVOX 話者と `CharacterVisualSet` の project-specific binding、および workspace SQLite の現在の `CharacterVisualCatalogSnapshot` を組み合わせて表示する確認画面である。`visualId === characterId` を前提にせず、binding がない場合は「未設定」と表示する。snapshot に存在しない、inactive、別 visual の参照は別 variant へ置き換えず、validation error として表示する。

#### キャラクタービジュアル modal picker

セリフカードの「ビジュアルを変更」から開く modal picker は、対象 line の speaker に project 上で binding された一つの `CharacterVisualSet` の active variant だけを表示する。タグ未指定では active variant をすべて表示し、タグ指定時は一致数の多い variant を上位へ移動するだけで、一致しない variant も残す。同点では catalog snapshot の決定論的な元順序を維持する。各 variant は preview、label、renderType、tags、選択中状態を表示し、`mouth-pair` は `closed` / `open` の双方を確認できる。`single-image` に存在しない口差分を生成・推測しない。

#### 素材ライブラリ画面

素材ライブラリ画面では、現場動画、写真、帳票スキャンの登録、メタデータ編集、サムネイル確認、タグ検索、利用停止を行う。ファイル名だけに依存せず、タイトル、説明、分類タグ、素材種別、部門、対象システム、機密区分、状態を表示・編集できるようにする。

#### ビジュアル選択 UI

キャラクタービジュアルの picker は「キャラクタービジュアル modal picker」の仕様に従い、現場素材用の検索 picker と統合しない。現場素材の Asset Search はキーワード、タグ、素材種別、部門、対象システム、利用状態を使う既存ドメインとして維持するが、`/projects/{projectId}/script` の右ペインを標準導線にはしない。AI サジェストを実行した場合も候補と検索意図を表示するだけで、キャラクター variant や generic `VisualAssignment` を自動確定しない。

#### バックエンド API

初期実装では少なくとも次の API を用意する。

```text
GET  /api/models
POST /api/outline/generate
POST /api/outline/regenerate-section
PUT  /api/projects/{projectId}/source
PUT  /api/projects/{projectId}/outline
POST /api/projects/{projectId}/outline/review
POST /api/projects/{projectId}/outline/approve
PUT  /api/projects/{projectId}/script
POST /api/projects/{projectId}/voice/generate
POST /api/projects/{projectId}/voice/generate-all
GET  /api/projects/{projectId}/voice/status
POST /api/assets
GET  /api/assets
GET  /api/assets/{assetId}
PUT  /api/assets/{assetId}
POST /api/assets/{assetId}/deactivate
GET  /api/character-visuals
POST /api/character-visuals
GET  /api/character-visuals/{visualId}
PUT  /api/character-visuals/{visualId}
POST /api/character-visuals/{visualId}/variants
PUT  /api/character-visuals/{visualId}/variants/{variantId}
POST /api/character-visuals/{visualId}/variants/{variantId}/deactivate
POST /api/character-visuals/{visualId}/variants/{variantId}/activate
POST /api/projects/{projectId}/visual-suggestions
PUT  /api/projects/{projectId}/visual-assignments
POST /api/projects/{projectId}/visuals/approve
```

Character visual metadata is read from the workspace SQLite `CharacterVisualSet`; the TypeScript catalog is only a typed adapter or legacy seed input. Both visual sets and variants persist `active | inactive`. Deactivation changes the variant status and never physically deletes its database row or managed files. The API/UI candidate adapter excludes inactive visuals and variants from ordinary use while retaining them in the database snapshot.

The legacy character visual seed is an initial-registration fallback only. Once a visual ID exists in SQLite, startup does not compare or restore seed metadata or files; SQLite remains authoritative for mutable visual/variant metadata and managed file paths.

Uploads are streamed directly into workspace staging with a separate 32 MiB per-file character-PNG limit. Variant replacement uses a generation-qualified immutable path, commits the new SQLite file metadata before removing old paths, and exposes unreferenced final/staging files through orphan diagnostics without automatic deletion.

`script/approve` と `visuals/approve` 相当の API が既存データ互換のため残る場合でも、通常の制作画面、音声操作、Manifest 生成、プレビュー、レンダリングはそれらを呼び出さず、前提条件にも使用しない。

- `GET /api/models` は OpenRouter のモデル一覧を取得し、WebUI 用に必要な情報へ整形して返す。
- WebUI は入出力単価がともに `0` のモデルを `free`、それ以外を `paid` としてモデル一覧を絞り込める。
- 構成案生成 API は完了した JSON を一括で返す。初期実装ではストリーミングを行わない。
- 受信した JSON は保存前に Zod で検証する。
- API エラー、JSON Schema 違反、入力超過、未解決の要確認事項を区別して表示する。
- OpenRouter API キーは環境変数 `OPENROUTER_API_KEY` からバックエンドだけが読み取り、レスポンス、ログ、ブラウザストレージへ出力しない。
- `GET /api/assets` はキーワード、タグ、素材種別、部門、対象システム、状態、ページングを受け取り、サムネイル情報を含む検索結果を返す。
- `GET /api/character-visuals` と `GET /api/character-visuals/{visualId}` は SQLite の `CharacterVisualSet` を読み、登録済み variant とファイルの管理された配信情報を返す。TypeScript の静的配列を一覧の正本として使用しない。
- `POST /api/character-visuals/{visualId}/variants` は、`single-image` なら `single`、`mouth-pair` なら `closed` と `open` を含む完全な variant を一括登録する。必須 slot が欠けたリクエストは、DB 行や最終ファイルを作らずに拒否する。
- `PUT /api/character-visuals/{visualId}/variants/{variantId}` は、既存の完成 variant の complete file set だけを差し替える。必須 slot を削除する API は設けず、差し替え失敗時は既存ファイルと SQLite メタデータを維持する。
- キャラクタービジュアルのファイル保存と SQLite 更新は、単一の SQLite/filesystem transaction とはみなさない。1つのアプリケーション操作として、staged file の一時保存、形式・slot・checksum・visual 基準キャンバス検証、atomic rename、SQLite transaction、失敗時の compensating cleanup を組み合わせ、片方だけが有効な状態を残さない。`public/` へ直接書き込まない。
- キャラクタービジュアルの画像配信は Fastify の管理された経路から行い、OS の絶対パスを WebUI へ返さない。API の正確な multipart 形式、エラーコード、status 遷移は CV-02 で固定する。
- ビジュアル候補 API は AI の検索意図と、バックエンドが素材DBから取得した候補を分けて返す。AI 応答内の文字列を素材 ID として採用しない。
- ビジュアル割り当て API は選択素材をプロジェクト内へ取り込んでから、プロジェクト JSON を更新する。ファイル取り込みと JSON 更新の片方だけが成功した状態を残さない。

WebUI は Vite + React SPA、画面ルーティングは React Router、サーバー状態は TanStack Query、HTTP API は Fastify を採用する。開発時は Vite から `/api` を Fastify へ proxy し、製品実行時は Fastify がビルド済み SPA と API を同一 origin で配信する。

### 17.5 データ保存

**推奨案**

- 動画制作データの正本はプロジェクト JSON とし、生成音声、キャッシュ、出力、確定した現場素材の割り当て、character binding、line の explicit variant 参照をプロジェクト単位のフォルダーへ保存する。
- ワークスペース共通の SQLite に、素材ライブラリのメタデータ、タグ辞書、サムネイル参照、継続改善のログ、生成ルール候補を保存する。
- ワークスペース共通の SQLite に、キャラクタービジュアル本体の `CharacterVisualSet`、variant、file slot、checksum、キャンバス技術情報、status、作成・更新日時を保存する。キャラクタービジュアルのメタデータはこの DB だけを正本とする。
- 素材ファイル本体とサムネイルは `library/` 配下へ保存し、SQLite にはバイナリ本体ではなく相対パス、技術情報、チェックサムを保持する。
- キャラクタービジュアルのファイル本体は `library/character-visuals/{visualId}/{variantId}/` に保存し、新規登録ファイルを `public/` へ直接保存しない。WebUI の画像表示は Fastify の管理された配信経路を使う。
- SQLite は素材の発見と改善分析には必要だが、確定済みプロジェクトのレンダリングには不要とする。素材を割り当てる際にプロジェクトの `media/visuals/` へコピーし、プロジェクト JSON に素材 ID、チェックサム、相対パスを固定する。
- `project.json` は引き続き動画制作データの正本であり、ワークスペース共通の `CharacterVisualSet` 一覧や登録ファイルを埋め込まない。プロジェクトで採用する visual と待機用 variant の binding、各 line の physical variant 参照だけを保存する。logical expression から physical variant への自動 mapping は定義しない。
- 完成動画とサムネイルは `projects/{projectId}/output/` へ保存する。
- 生成途中の音声・プレビューは `cache/` と `audio/` へ分離する。
- プロジェクト JSON とプロンプトは Git で履歴管理する。
- SQLite ファイルはバイナリで差分確認に適さないため、Git 履歴の正本にはしない。素材メタデータ、タグ辞書、改善ログは、UTF-8 の JSON Lines（拡張子 `.jsonl`）へエクスポートできるようにする。
- 大容量の素材動画・写真・帳票、音声、完成 MP4 は原則として Git の対象外にする。

### 17.6 VOICEVOX

**推奨案**

- VOICEVOX ENGINE をローカル HTTP API として起動する。
- API の接続先は環境変数 `VOICEVOX_ENGINE_URL` で設定し、既定値を `http://127.0.0.1:50021` とする。
- 未編集の `audio_query` は再生成可能な派生キャッシュとして保持する。
- 人間が確定したイントネーション調整は、`projects/{projectId}/voice-adjustments/{lineId}.json` へセリフ単位で保存する。
- 調整 JSON は正本として Git 管理し、話速等の全体上書きと、必要な場合の `accent_phrases` スナップショットを保持する。
- 読み上げ文、style ID、VOICEVOX ENGINE の互換バージョン等が変化した場合は調整を「要再確認」とし、黙って適用しない。
- speaker ID、話速、音高、抑揚、音量、前後無音をキャラクター設定として持つ。
- セリフ単位でキャラクター既定値を上書きできるようにする。
- WebUI は「基本」「アクセント」「詳細」の編集面を提供し、セリフ単位の試聴、項目別リセット、全調整リセットを可能にする。
- 音声ファイルは 6.5 の WAV 形式と命名規則を採用する。

**確定**

- 使用キャラクターは四国めたんとずんだもんとする。
- 固有名詞・社内用語はワークスペース共通 SQLite に保存し、WebUI から登録、編集、検索、利用停止できるようにする。
- 未編集 query と手動調整を分離し、手動調整をセリフ単位の独立 JSON として永続化する。

**未確定**

- 四国めたんとずんだもんで使用する具体的な style ID。

### 17.7 OpenCode と OpenRouter

**確定仕様**

- 6.2 の AI 構成案生成では、WebUI のバックエンドから [OpenRouter の API](https://openrouter.ai/docs/quickstart) を直接呼び出す。手入力開始ではこの呼び出しを行わない。
- OpenCode は WebUI の実行時依存にせず、台本作成、レビュー、検証スクリプト実行などの開発・制作支援に使用する。ビジュアルの生成や素材割り当てには使用しない。
- OpenCode から OpenRouter を使用する場合は `opencode.json` に用途別エージェントを定義する。
- モデル ID を生成ロジックへ直接書かない。プロジェクトに既定モデルを保存し、生成実行時に別モデルへ変更できるようにする。
- 構成案生成、台本生成、台本レビュー、ビジュアル検索意図、レイアウトレビュー、OpenCode を用途 ID で区別する。
- モデル解決順は、実行時の明示上書き、用途別上書き、プロジェクト共通既定値とする。
- 初期状態では用途別上書きを空にし、すべての用途を `google/gemma-4-31b-it` へ解決する。用途別にプロンプト、structured output schema、評価指標は分離しておく。
- 選択したモデル ID は生成結果そのものではなく実行情報として記録し、構成案から `generationRunId` で参照する。
- 初期実装では WebUI、OpenCode、レビュー、検索意図、レイアウトレビューの暫定既定モデルを Gemma 4 31B Instruct、OpenRouter モデル ID を `google/gemma-4-31b-it` とする。
- `google/gemma-4-31b-it:free` は既定にせず、人間が実行時に明示選択した場合だけ使用する。

#### モデル一覧

- バックエンドは認証済みの `GET /api/v1/models/user` を使用し、OpenRouter アカウントの設定を反映したモデル一覧を取得する。
- 出力モダリティに `text` を含むこと、`supported_parameters` に `structured_outputs` を含むこと、有効期限切れでないことを条件に絞り込む。
- 入力 Markdown、システムプロンプト、JSON Schema、出力上限をモデルの `context_length` に収められない場合は、そのモデルでの生成を開始しない。
- 入力を暗黙に切り捨てない。入力超過時は、モデル変更または Markdown の分割を人間へ求める。
- WebUI には表示名、モデル ID、コンテキスト長、入力単価、出力単価を表示し、名前または ID で検索できるようにする。
- モデル一覧は短時間キャッシュし、明示的に再取得できるようにする。

#### 構成案生成

- `POST /api/v1/chat/completions` を使用する。
- `response_format.type` を `json_schema`、`strict` を `true` とし、6.2 の構成案用 JSON Schema を指定する。
- `provider.require_parameters` を `true` とし、指定した JSON Schema を処理できないプロバイダーを除外する。
- 受信結果を Zod で再検証し、検証に失敗した応答をプロジェクト JSON へ反映しない。
- Markdown 内の文章は命令ではなく入力資料として区切り、プロンプトインジェクションによってシステム指示や企画条件を上書きさせない。
- 初期実装では非ストリーミングで生成する。

#### ZDR とプロバイダールーティング

社内資料を OpenRouter へ送信することについては社内承認済みとする。ZDR はプロジェクト設定のトグルで有効・無効を選択でき、既定値は有効とする。

- ZDR が有効な場合は、各生成リクエストへ `provider.zdr: true` を指定する。
- ZDR が無効な場合は `provider.zdr` を指定せず、OpenRouter アカウント側のプライバシー設定に従う。
- `provider.data_collection` は ZDR トグルにかかわらず `deny` とする。
- 同じモデル内のプロバイダーフォールバックは許可し、`provider.allow_fallbacks` を `true` とする。
- 別のモデル ID への自動フォールバックは行わない。モデルを変更する場合は人間が選択して再実行する。
- 実際に使用されたモデル、プロバイダー、ZDR 設定を実行ログへ保存する。

#### エラー処理

- OpenRouter の 429、502、503 に対して上限付きリトライを行う。
- 429 または 503 に `Retry-After` が含まれる場合は、その値を優先する。
- リトライしても失敗した場合は、既存の構成案を変更せずエラーを記録する。
- 認証エラー、残高不足、モデル非対応、コンテキスト超過、JSON Schema 違反を区別して WebUI に表示する。
- モデルやプロバイダーを暗黙に変更して成功扱いにしない。

**暫定決定**

- プロジェクト作成時の初期値は `google/gemma-4-31b-it` とする。
- 用途別上書きの初期値は空とし、OpenCode を含むすべての用途を同じモデルで開始する。
- 実行ログには用途 ID、解決後のモデル ID、共通既定・用途別上書き・実行時上書きのどれから選択したかを記録する。
- MVP の品質、待ち時間、トークン使用量、人間による修正量を用途別に集計し、必要な用途だけモデル分離を再検討する。

### 17.8 キャラクター素材

この節では、台本の論理表情、登録済み物理素材、レンダリング時の解決済み情報を分けて扱う。

#### 論理表情

`ScriptLine.expression` が保持する次の値は、台本上の意味・演出意図を表す論理表情である。

- `neutral`
- `smile`
- `explain`
- `caution`

これらは PNG ファイル名、物理ポーズ名、`variantId` ではない。P2-01 実装時点でも論理表情から物理バリアントへの対応は決定しなかった。現在も `caution` から `pointing` へ自動的に割り当てるなどの既定 mapping は存在しない。

`expression` は互換メタデータとして保持してよいが、physical variant の選択結果ではない。各 character の visual / idle variant binding と各 line の `characterVariantId` は、人間が project-specific な制作データとして明示選択する。新規 line は `characterVariantId: null` から開始し、expression、tag、label から自動選択しない。

#### CharacterVisualSet と描画方式

キャラクタービジュアル登録の正本は、ワークスペース共通 SQLite に保存する `CharacterVisualSet` である。TypeScript の `characterVariantCatalog` は DB のレコードから生成する型付き snapshot として残してよいが、実在する登録項目を静的配列で二重管理しない。

基本モデルは次のとおりとする。

```ts
type CharacterVisualSet = {
  visualId: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  baseWidth: number | null;
  baseHeight: number | null;
  variants: CharacterVariant[];
  createdAt: string;
  updatedAt: string;
};

type CharacterVariant = {
  variantId: string;
  label: string;
  renderType: "single-image" | "mouth-pair";
  tags: string[];
  files: CharacterVisualFile[];
};

type CharacterVisualFile = {
  key: string;
  libraryPath: string;
  mimeType: "image/png";
  checksum: string;
  sizeBytes: number;
  width: number;
  height: number;
};
```

`renderType` だけを固定 enum とする。`stand`、`normal`、`pointing`、`smile`、`caution` などの表情・ポーズ名は固定 enum にしない。新しい素材は `ScriptLine.expression` へ値を追加せず、`CharacterVisualSet` へ新しい variant とメタデータを登録する。

ファイルスロットは描画方式ごとに異なる。

- `single-image`: `single` を 1 件持つ。口差分を持たない。
- `mouth-pair`: `closed` と `open` を 1 件ずつ持つ。口パクの対象にできる。

`CharacterVisualSet` 全体は、表情・ポーズに対応する variant が一部未登録でも登録可能とする。未登録 variant の存在だけで set をエラーにしない。永続化する variant は必須 slot が揃った完成状態に限り、`single-image` の作成は `single` 1 件、`mouth-pair` の作成は `closed` と `open` 各 1 件を同一リクエストで検証・登録する。必須 slot 欠落の作成リクエストは variant 行やファイルを残さず失敗させる。登録後の差し替えは complete file set 単位で許可するが、必須 slot の削除は許可しない。登録された最初の完成 variant のキャンバスサイズを visual の基準とし、以後の画像は同じ visual 内で一致させる。CV-01 では `status` を `active` / `inactive` とし、variant が 0 件の visual では `baseWidth` / `baseHeight` を null にできる。最初の完成 variant で基準サイズを確定し、以後のファイルを同じサイズに制限する。

登録時点では `CharacterVisualSet` を `mentor` / `learner` の役割や特定プロジェクトへ紐付けない。既存の `character-mentor` / `character-learner` は、現在の `VideoProject` と初期 seed を移行するための互換上の識別子としてのみ扱い、新規 visual の構造的な制約にしない。project-specific な binding は SQLite へ追加せず、`project.json` に保存する。

```ts
type CharacterVisualBinding = {
  visualId: string | null;
  idleVariantId: string | null;
};
```

`idleVariantId` は `visualId` と同じ `CharacterVisualSet` 配下の active variant を人間が選択した参照とする。binding が未設定なら「未設定」と表示し、inactive、missing、別 visual の variant を自動代替しない。

#### P2-01 で確認済みの素材（CV-01 migration seed）

P2-01 で確認した既存素材は、CV-01 で次の 2 つの `CharacterVisualSet` として idempotent に seed / migration する。これは当時の静的カタログ実装を移行するための初期データであり、移行後のメタデータ正本は SQLite だけとする。

- 各 visual について、非会話状態の `single-image`: 1 variant / 1 ファイル
- 各 visual について、通常会話の `mouth-pair`: 1 variant / `closed` と `open` の 2 ファイル
- 各 visual について、指差し状態の会話の `mouth-pair`: 1 variant / `closed` と `open` の 2 ファイル
- 2 visual 合計で 6 variant、10 PNG
- 初期 seed のキャンバスは 600 × 1000 px。これは全 visual 共通の固定値ではない

確認済みの元素材は `doc/assets` にあり、migration では管理領域へコピーして checksum を保存する。seed/migration でもファイルシステム操作と SQLite transaction を単一 transaction とはみなさず、seed visual 単位のアプリケーション操作として扱う。一時領域へコピーして checksum を検証し、atomic rename で管理領域へ移した後に SQLite を更新する。DB 更新に失敗した場合は今回作成した未参照ファイルを補償削除し、クラッシュで残った staging/final の未参照ファイルは orphan として診断・回収する。新規ファイルは次の配置規則を使用し、`public/` へ直接保存しない。

```text
library/character-visuals/{visualId}/{variantId}/...
```

画像は Fastify の管理された配信経路から WebUI へ返す。Remotion とタイムラインコンパイラは、バックエンドが解決した snapshot だけを受け取り、SQLite や管理領域を直接検索しない。

#### 現在の永続スキーマとの関係

PR #24 など過去の実装では `VideoProject.schemaVersion` を `1.0.0` のまま維持し、既存 `project.json` の `Character.visualAssets` にある `neutral`、`smile`、`explain`、`caution` の固定 `MouthPair` を互換フィールドとして残した。この記述は過去プロジェクトを読み込むための履歴・互換条件であり、CV-04 の current design が `1.0.0` の意味を暗黙に変更することを示さない。

このフィールドは CharacterVisualSet の正本ではない。既存の 4 キーへ同じ画像を重複割り当てたり、物理 variant を推測して保存したりしない。既存プロジェクトを読み込むための互換フィールドとして残すが、CV-05 では明示的な `schemaVersion` bump と migration により新しい binding / line reference の意味を導入する。`1.0.0` のまま新しい意味を保存することはしない。

#### 解決処理、version、再現性

CV-05 の通常レンダリングは、次の入力から決定する。

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

compiler は各 explicit reference が存在すること、active であること、speaker に binding された同じ `CharacterVisualSet` 配下であることを検証する。missing、inactive、cross-visual、必須 file slot 欠落、checksum 不一致は validation error とし、tag、label、expression、旧固定 mapping から自動代替しない。compiler と Remotion は SQLite を直接検索せず、バックエンドまたは呼び出し元から渡された検証済み snapshot と manifest だけを扱う。

次の実装詳細は未決定であり、TBD とする。

- 解決済み snapshot の版または更新時点の表現方法
- variant 単位の version を持つかどうか
- 既存 schema の命名規則に合わせた binding / line reference の実フィールド名
- SQLite の既存 catalog snapshot を読み出す API 境界の詳細
- 明示参照を含む新しい manifestVersion の互換性
- `1.0.0` から新 schema への migration の具体的な手順

解決不能、variant 欠落、mouth slot 欠落時は自動代替せずエラーにする。CV-04 の範囲は仕様書改訂であり、schema / migration / project binding / line picker / CharacterAssetsPage / compiler / Remotion の変更は CV-05 で実装する。旧固定 mapping が migration の compatibility input として使えるのは、既知対応を決定論的に確定できる場合だけであり、SQLite の tag や label の検索による推測は行わない。解決できないデータは未設定として人間の確認を要求する。

CV-00〜CV-03 は、キャラクタービジュアルの登録・管理をワークスペース共通資産として追加した履歴である。CV-04 で project-specific な明示選択の仕様を確定し、CV-05 で実装する。現場動画・写真・帳票素材ライブラリ、AI visual suggestion、generic `VisualAssignment` の backend は別ドメインとして維持する。

### 17.9 口パク

口パクの対象は、`closed` と `open` を持つ `mouth-pair` variant だけである。

- `single-image` variant に存在しない `open` 画像を推測、複製、加工して使用しない。
- `single-image` を発話中に表示する方法（静止表示など）は CV-05 の Remotion 実装で、explicit に選択された variant の renderType に従って決定する。存在しない口差分を生成・推測したり、別 variant を自動代替したりしない。
- P5-04 では、解決済み `mouth-pair` の発話区間中に `closed` / `open` を定周期で切り替える。
- セリフ開始時は閉じた状態から始め、終了時と無音区間は閉じた状態とする。
- 音量解析に基づく口パクへの変更は MVP 後の判断事項である。

### 17.10 表情

ここでいう表情は、台本が保持する論理表情である。物理バリアントや PNG のファイル名と直接同一視しない。

- セリフ単位で `neutral`、`smile`、`explain`、`caution` を指定する。
- 指定がない場合は論理表情として `neutral` とする。
- `caution` は注意事項、禁止事項、失敗時の対応を表す意味付けであり、物理 `pointing` などへの自動 mapping ではない。
- 論理表情から物理 variant を選ぶ規則は定義しない。セリフ単位の physical variant は `characterVariantId` として人間が明示選択し、セリフ途中の表情変更は別の将来拡張で扱う。`expression` の値、tag、label からの自動 mapping は行わない。

### 17.11 無言区間

**推奨案**

各セリフに次の値を持たせる。

```json
{
  "pauseBeforeMs": 0,
  "pauseAfterMs": 250
}
```

- 通常のセリフ間には短い `pauseAfterMs` を設定する。
- 操作結果を見せる場面では、ビジュアル割り当て側に明示的な duration または適用セリフ範囲を設定する。
- タイムライン内部ではミリ秒をフレームへ丸め、元の JSON では人間が扱いやすいミリ秒を保持する。

### 17.12 素材ライブラリとビジュアル表示

**推奨案**

#### 素材メタデータ

初期実装では、SQLite の素材レコードに少なくとも次を持たせる。

```text
assetId
kind: video | photo | document_scan
title
description
libraryMediaPath
thumbnailPaths[]
checksum
mimeType
width
height
durationMs
pageCount
tags[]
confidentiality
status: processing | active | inactive | error
createdAt
updatedAt
```

`durationMs` は動画、`pageCount` は帳票にだけ設定する。タグはタグマスターとの関連テーブルで管理し、正規名、分類軸、別名、利用状態を持たせる。素材の差し替えは同じファイルを上書きせず、新しいチェックサムを持つ版として登録する。

#### 台本から得る検索意図

AI の出力は次の形を基本とする。

```json
{
  "requiredTags": ["task:daily-inspection"],
  "optionalTags": ["object:control-panel", "action:check"],
  "excludedTags": ["status:before-repair"],
  "mediaKinds": ["video", "photo"],
  "freeTextQuery": "制御盤 日常点検",
  "reason": "点検対象と確認動作を実物で示すため"
}
```

タグは `分類軸:正規名` の形式で返させる。バックエンドはタグ辞書で正規化し、未知のタグを分離してから検索する。候補スコアの内訳はUIへ返し、人間が提案理由を検証できるようにする。ベクトル検索は初期実装に含めず、SQLite のタグ一致と全文検索から開始する。

#### Remotion 表示コンポーネント

初期実装では次の 3 コンポーネントだけを作る。

- `VideoVisual`: 再生区間、切り抜き、拡大率、位置、再生速度、ミュート、注釈
- `PhotoVisual`: 切り抜き、表示方法、拡大率、位置、注釈
- `DocumentVisual`: ページ、切り抜き、表示方法、拡大率、位置、注釈

素材の表示方法は `contain` と `cover` を基本とし、汎用的な自由配置や構造化スライド生成は作らない。

### 17.13 デザイントークン

**推奨案**

- フォント: Noto Sans JP
- 基本背景: 濃紺または低彩度のブルーグレー
- コンテンツカード: 白
- 本文色: 濃いグレー
- 強調色: 話者ごとに 1 色
- 注意色: オレンジ
- 警告色: 赤
- 字幕: 白文字、暗色の半透明背景または太い影
- 画面外周セーフエリア: 60 px
- 角丸: 16〜24 px
- 動き: フェードと小さな移動を中心とし、派手な演出は避ける

話者色は `character.metan` と `character.zundamon` のデザイントークンで管理し、VOICEVOX の各キャラクターを想起できる色へ置き換える。具体的な色値は、実際のキャラクター素材と職場で使用する資料の色、字幕のコントラストを確認して確定する。

### 17.14 本編動画とサムネイル

**推奨案**

本編動画:

- 解像度: 1920 × 1080
- アスペクト比: 16:9
- フレームレート: 30 fps
- コンテナ: MP4
- 動画コーデック: H.264
- ピクセルフォーマット: yuv420p
- 音声コーデック: AAC
- 音声サンプリングレート: 48 kHz
- 音声チャンネル: ステレオ

素材内の小さな文字や操作対象を読みやすくするため、元プロジェクトの 720p より 1080p を優先する。

サムネイル:

- 解像度: 1280 × 720
- 形式: PNG を基本とし、容量を小さくしたい場合は高品質 JPEG
- アスペクト比: 16:9
- タイトルと部門名または対象システム名は必須
- 補足、版数、背景画像、代表ビジュアル、キャラクター表示は任意
- 任意項目が未指定の場合も共通テンプレートの既定背景で出力可能

BGM と挿入プレースホルダー:

- BGM は MVP からセクション単位で設定する。各セクションは 0 曲または 1 曲とする。
- 曲ごとに音量、ループ、フェードイン、フェードアウトを設定する。
- セクション境界では曲を重ねず、前曲をフェードアウトしてから次曲を開始する。
- 自動ダッキング、音量キーフレーム、1 セクション内の複数曲は MVP に含めない。
- opening と ending は常に 2 秒の無音プレースホルダーを挿入する。
- eye catch はユーザーが指定したセクション境界へ 2 秒の無音プレースホルダーとして追加できる。
- プレースホルダーは Remotion の共通画面を描画し、本番用素材の生成と置換は MVP 後に実装する。

素材動画:

- 可能なら 1920 × 1080、30 fps で収録する。
- 収録時の拡大率と OS の表示倍率を統一する。
- 通知、個人情報、不要なウィンドウが映らない状態で収録する。

### 17.15 ログ

**推奨案**

- 素材メタデータとは論理的にテーブルを分離したうえで、修正イベント、AI レビュー結果、承認済みの正解例、タグ、生成ルール候補を、ワークスペース単位の SQLite に保存する。
- 個々のキー入力をすべて記録するのではなく、保存、レビュー結果の確定、承認、音声再生成など、意味のある操作をイベントとして記録する。
- 修正イベントには、対象プロジェクトと安定 ID を関連付け、修正前後、修正理由、生成元、タグ、使用したモデルやプロンプトの版など、再現と改善に必要な情報を保持する。
- 人力初稿については、承認済み構成案、完成稿、キャラクター設定の対応を正解例として記録する。
- AI レビューについては、指摘内容だけでなく、人間による採用・却下とその理由を記録する。
- ビジュアル提案については、AI が返した検索意図、バックエンドの上位候補、人間が採用・却下した素材と理由を記録する。
- 生成ルール候補には、根拠となった修正イベントとタグを関連付け、採用、保留、却下を区別できるようにする。
- AI 生成および動画生成 1 回ごとの実行情報は `runs/{runId}.json` へ分離する。
- AI の全プロンプト・全応答を常に保存するのではなく、再現と改善に必要な情報を保存する。
- SQLite は better-sqlite3、Drizzle ORM、Drizzle Kit を使用し、`src/db/schema.ts` を正本として生成 SQL を Git 管理し、起動時に migration を適用する。バックアップ周期を運用し、標準エクスポート形式には UTF-8 の JSON Lines（拡張子 `.jsonl`）を使用する。

### 17.16 現時点で判断を保留する項目

- 用途別に本採用する OpenRouter モデル。初期値は `google/gemma-4-31b-it`
- 四国めたんとずんだもんの具体的な VOICEVOX style ID
- キャラクターの最終透過 PNG とテーマ色の具体値
- 効果音を使用する場面と運用範囲
- MVP 後に使用する opening、ending、eye catch の本番素材と置換仕様
- 素材登録時に OCR または音声文字起こしを実行し、検索対象へ含めるか

## 18. 再現時の完成条件

本システムの初期版が完成したと判断する最小条件は、次の一連の処理が通ることである。

1. 現場動画、写真、帳票スキャンをメタデータとタグ付きで素材ライブラリへ登録し、サムネイル検索できる。
2. AI が台本区間へ検索意図を付け、バックエンドが素材DBから実在する候補を返す。
3. 人間が generic Asset Search の別画面または補助導線から素材を選び、1 セリフまたは連続セリフ範囲へ割り当てる。キャラクタービジュアルは別途、セリフカードの modal picker で明示選択する。
4. `project.json` で 2 キャラクターの `CharacterVisualSet` binding と待機用 variant を確認し、各セリフで physical variant を人間が選択したうえで、現場素材の generic assignment を必要に応じて JSON に記述する。
5. VOICEVOX でセリフごとの WAV 音声を生成する。
6. 音声長と明示的な無音時間から、セリフ、ビジュアル、背景のフレーム範囲を持つ `RenderManifest` を自動生成する。
7. 同じ `RenderManifest` を使用して WebUI でプレビューする。
8. Remotion へ explicit variant 参照と検証済み snapshot から解決済みの `RenderManifest` を props として渡し、字幕、論理表情、選択済み physical variant、口パク、キャラクター動作、背景、現場動画、写真、帳票スキャンを同期描画する。
9. 正本 JSON と `RenderManifest` のスキーマ、素材参照、チェックサム、タイムライン境界、字幕、レイアウトの検証を通す。
10. 1920 × 1080、30 fps の MP4 を出力する。
11. 共通テンプレートから 1280 × 720 のサムネイルを出力する。
12. 制作時の修正内容と生成結果をログとして保存する。
