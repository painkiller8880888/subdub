# Remotion 社内マニュアル動画制作システム
# ChatGPT計画・レビュー／Codex実装向け 開発計画

文書版: 1.1
作成日: 2026-08-02  
更新日: 2026-08-15
基礎資料: [`implementation-spec.md`](./implementation-spec.md)<br>
対象: アプリ開発の初心者が、Web版ChatGPTと相談しながらCodexへ実装を依頼し、段階的にMVPを完成させるための計画

## 0. Issue #87 による計画の更新

この計画の旧 P2/P3/P5 文言より、Issue #97（CV-04）と [`implementation-spec.md`](./implementation-spec.md) の更新内容を優先する。台本・キャラクタービジュアル・音声は、`/projects/{projectId}/script` を中心とした一体型の制作範囲として扱う。現場素材用の generic Asset Search / `VisualAssignment` は backend とデータを維持するが、標準 `/script` の旧右ペインではなく、分離した補助導線で扱う。

- `outline` の承認済みかつ最新であることは、台本の初期化と現在の制作コンテキストの前提として残す。この文書の対象範囲では、構成案の承認が唯一の明示的な工程境界である。
- 台本承認とビジュアル承認は制作フローから削除する。script/visual の `approved`、`draft`、`needs_review` は互換性、レビュー結果、stale、再生成要否の表示に残せるが、候補表示、素材割り当て、音声操作、プレビュー、`RenderManifest`、レンダリングの前提には使わない。
- 台本・ビジュアル・音声の保存、自動保存、revision 競合拒否は維持する。変更によって依存生成物を stale と表示し、出力時は status ではなく、台本、音声、素材参照、assignment 範囲、checksum、Manifest の validation をゲートにする。
- この計画に旧来の「台本承認」「ビジュアル承認」「未承認なら次工程へ進めない」という表現が残っている場合は、構成案の承認を除き、Issue #87 の validation モデルへ読み替える。将来の Codex 依頼でこれらの承認 UI/API 前提を再導入しない。

### 0.1 Issue #97 / CV-04 による計画の更新

Issue #97 を現在仕様の正本とし、キャラクタービジュアルの標準経路を人間による explicit selection に変更する。`/projects/{projectId}/script` はセクションとセリフカード中心の 1 ペイン構成とし、右ペインの候補・AI候補・手順3-3素材検索・検索結果・素材制作/表示設定 UI は後続実装で除去する。

ただし、UI から外すことは機能の削除ではない。AI visual suggestion backend、現場動画・写真・帳票用 Asset Search、generic `VisualAssignment` / Asset Service と保存データは維持する。`CharacterVisualSet` の catalog 正本は workspace SQLite、project-specific な VOICEVOX ↔ visual / idle variant binding と line の `characterVariantId` は `project.json` の正本とする。

CV-04 は3文書の仕様更新だけで完了し、コード、schema、migration、API、React UI、compiler、Remotion は変更しない。CV-05 は後続 Issue #98 として、schema version bump / migration、project binding、1 ペイン ScriptPage、modal picker、CharacterAssetsPage、validation、explicit compiler / RenderManifest / Remotion 解決を実装する。

## tl;dr

この開発では、仕様書のPhase 0からPhase 6までをそのまま一括でCodexへ渡してはいけない。各Phaseを、1回の変更で目的と動作確認が明確になる小さな作業へ分割し、原則として「1作業＝1ブランチ＝1プルリクエスト」とする。

Web版ChatGPTは、次に実装する範囲を仕様書から切り出し、Codexへ渡す指示を作り、Codexが提出した差分とテスト結果をレビューする役割を担う。Codexは、指定された範囲だけを実装し、テストを追加し、実行結果と未解決事項を報告する。利用者は、画面や保存データが期待どおりに動くかを実際に確認し、次の作業へ進むかを決める。

開発の順序は次のとおりとする。

| Phase | 目的 | 利用者が確認できる到達点 |
|---|---|---|
| Phase 0 | 壊れにくい土台を作る | 空のプロジェクトを安全に保存でき、DBとテストが動く |
| Phase 1 | 企画と構成案を作れるようにする | 資料と企画条件を保存し、構成案を生成または手入力して編集・承認できる |
| Phase 2 | 人が台本を作り、社内用語を管理できるようにする | 2人会話の台本と読み方を登録し、依存状態を確認できる |
| Phase 3 | 動画・画像・帳票を登録して台本へ割り当てる | 素材を検索し、セリフ範囲へ表示設定を割り当てられる |
| Phase 4 | VOICEVOXで音声を作る | 各セリフの読み上げ音声を生成し、再生成状態を管理できる |
| Phase 5 | 動画としてプレビュー・出力する | 同じマニフェストからプレビュー、MP4、サムネイルを作れる |
| Phase 6 | 利用結果を記録して改善判断につなげる | AIや編集結果を検索・集計し、MVP後の改善材料を蓄積できる |

P2-01 の実装内容は過去の実装履歴として残す。キャラクタービジュアルの現在仕様は、その後続として CV-00〜CV-03 で動的 `CharacterVisualSet`、workspace SQLite、管理領域、`/character-visuals` を追加し、CV-04 で project-specific selection の仕様を確定し、CV-05 で実装する。これは Issue #87 の `/projects/{projectId}/script` 制作画面とは別のワークスペース共通ライブラリを基盤とし、CV-05 で制作画面の主要導線を更新する。

## 1. この計画の使い方

この計画は、完成日を予測する日程表ではない。次にCodexへ何を頼み、何を確認したらその作業を完了とみなせるかを決めるための実行手順書である。

各作業では、次の流れを繰り返す。

1. 利用者がWeb版ChatGPTへ、現在のPhase、直前の実装結果、仕様書、Codexの報告を渡す。
2. ChatGPTが、今回の実装範囲、対象外、受け入れ条件、必要なテストを整理する。
3. 整理した指示をCodexへ渡す。
4. Codexがコード、テスト、必要な設定ファイルを変更し、変更内容と実行結果を報告する。
5. ChatGPTが差分、テスト結果、仕様との一致、余計な変更の有無をレビューする。
6. 利用者が実際の画面またはファイルを確認する。
7. 問題がなければプルリクエストを取り込み、次の作業へ進む。

一つのPhaseを丸ごと一回で実装させるよりも、下記の「PR候補」ごとに分ける方が安全である。初心者にとって重要なのは、変更量を小さくし、何が壊れたのかを追いやすくすることである。

## 2. 役割分担

### 2.1 利用者

利用者は、業務上の正しさと実際の使いやすさを判断する。コードの細部を判断する必要はない。画面の言葉が分かるか、保存した内容が再表示されるか、誤った操作で以前のデータが消えないかを確認する。

### 2.2 Web版ChatGPT

ChatGPTは、仕様書を実装可能な小さな単位へ分ける。Codexの変更後は、仕様から外れた実装、テスト不足、エラー処理不足、後工程を壊す変更がないかを確認する。

### 2.3 Codex

Codexは、指定された作業範囲だけを実装する。仕様にない機能を「便利そうだから」という理由で追加しない。実装後は、変更ファイル、設計上の判断、実行したコマンド、テスト結果、残る問題を報告する。

## 3. 開発全体の基本ルール

### 3.1 一回の依頼を小さくする

一回のCodex依頼では、利用者が一文で目的を説明できる範囲に絞る。

良い例は「プロジェクトJSONを一時ファイル経由で安全に保存し、revision競合を検出できるようにする」である。悪い例は「Phase 0を全部実装する」である。

### 3.2 仕様変更と実装を分離する

実装中に仕様の不足や矛盾が見つかった場合は、Codexに推測で決めさせない。Codexには問題点と選択肢を報告させ、Web版ChatGPTと利用者が判断してから、仕様書または開発計画を更新する。

### 3.3 各PRにテストを含める

コードだけが動いているように見えても、後の変更で壊れる可能性がある。保存、ID、構成案の承認、status、ハッシュ、時間計算など、画面から見えにくい処理ほど自動テストを必須とする。

### 3.4 Phaseを飛ばさない

Phase 1以降の画面は、Phase 0の型、保存、DB、エラー形式に依存する。後から土台を直すと全画面へ修正が広がるため、Phase 0の完了条件を満たすまではPhase 1へ進まない。

### 3.5 外部サービスを通常テストで呼ばない

OpenRouterとVOICEVOXのテストにはfixtureまたはローカルstubを使う。通常のテスト実行で課金、ネットワーク依存、VOICEVOX起動必須の状態を作らない。

## 4. Codexへ渡す共通指示テンプレート

次の形式を基本にして、Web版ChatGPTと相談しながら内容を埋める。

```text
あなたはこのリポジトリの実装担当です。
implementation-spec.md と development-plan-chatgpt-codex.md を正本として扱ってください。Issue #87 の制作工程はこの計画の旧工程記述に優先します。

今回の目的:
[利用者から見て何ができるようになるかを一文で記載]

対象範囲:
[今回変更する機能、API、型、画面、保存処理を記載]

対象外:
[今回は実装しない関連機能を明記]

守る仕様:
[仕様書の節番号、データ型、エラー、保存規則、セキュリティ規則を記載]

実装条件:
- 既存のディレクトリ境界と依存方向を守る。
- 仕様にない機能や依存パッケージを追加しない。
- TypeScript strict modeで型エラーを残さない。
- 失敗時に既存データを壊さない。
- 変更に対応する単体テストまたは統合テストを追加する。
- テストで実際のOpenRouter課金や外部サービス依存を発生させない。

受け入れ条件:
[利用者または自動テストが確認できる結果を列挙]

実行して報告するコマンド:
- pnpm typecheck
- pnpm test
- [必要に応じてlint、build、E2E、短いrender]

作業後の報告形式:
1. 実装した内容
2. 主な変更ファイル
3. 実行したコマンドと結果
4. 受け入れ条件ごとの達成状況
5. 仕様上の不明点または未解決事項
6. 次の作業へ影響する注意点
```

## 5. ChatGPTへレビューを依頼する共通テンプレート

```text
以下のCodex実装を implementation-spec.md と
development-plan-chatgpt-codex.md に照らしてレビューしてください。

今回の作業ID:
[例: P0-03]

今回の目的:
[目的]

Codexの報告:
[Codexの最終報告を貼る]

差分またはPR:
[差分、PRリンク、変更ファイル一覧など]

特に確認してほしいこと:
- 指定範囲を満たしているか。
- 仕様にない機能を増やしていないか。
- 失敗時に既存データを壊さないか。
- テストが成功例だけでなく失敗例も扱っているか。
- 後工程で使う型やAPIを場当たり的に作っていないか。
- 初心者である私が手動確認すべき操作を平易に説明してほしい。

回答では、重大な問題、修正した方がよい問題、任意の改善を分け、
最後にマージ可否を示してください。
```

## 6. Phase 0: 基盤

### 6.1 目的

Phase 0では、画面を作る前に、アプリが扱うデータの形、保存方法、データベース、エラーの返し方を固定する。ここが不安定なまま画面を作ると、後のPhaseで保存形式が変わるたびに多くの画面を作り直すことになる。

利用者から見たPhase 0の完成状態は、見栄えのよい画面ではなく、「空のプロジェクトを作り、安全に保存し、再び読み込める」「不正なデータや同時更新があっても以前のファイルを壊さない」という状態である。

### 6.2 PR候補

#### P0-01 リポジトリの初期構成

目的は、仕様書で固定されたNode.js、pnpm、TypeScript、Vite、Fastify、Vitestなどを導入し、開発・型検査・テスト・ビルドの共通コマンドを用意することである。

Codexへは、仕様書4.4と5の構成に従って単一`package.json`のプロジェクトを作り、依存をexact versionで固定し、ViteとFastifyを別の責務として起動できるように依頼する。Reactの完成画面や業務機能は対象外とする。

検証では、`pnpm install`、型検査、空のテスト、Viteビルド、Fastifyのヘルスチェックが成功することを確認する。サーバーが`127.0.0.1`だけで待ち受けることも確認する。

完了条件は、新しい環境でREADMEの手順どおりにセットアップでき、最小画面と`/api/health`が表示できることである。

#### P0-02 共有Zodスキーマと初期データ

目的は、`VideoProject`と`RenderManifest`のデータ形式をTypeScript型とZodで一元管理することである。

Codexへは、仕様書7章と8章に沿ってstrict objectのスキーマを作り、未知のキー、重複ID、不正な数値、参照切れを拒否するように依頼する。初回はスキーマとfixtureだけに集中し、画面やファイル保存は実装しない。

検証では、正しいfixtureが通ることに加えて、未知のキー、負の時間、重複ID、不正な話者参照、危険なパスが失敗することを確認する。

完了条件は、UI、API、タイムライン処理が同じ型をimportでき、別々の似た型を作っていないことである。

#### P0-03 プロジェクトJSONの安全な保存

目的は、保存途中の停止や不正データによって、以前の`project.json`が壊れないようにすることである。

Codexへは、仕様書6.4に従い、読込、Zod検証、`expectedRevision`照合、revision更新、一時ファイルへの書込み、renameによる置換を実装するよう依頼する。ID生成はバックエンドで行い、OSの絶対パスを返さないようにする。

検証では、正常保存、再読込、revision競合、検証失敗、書込み失敗を試す。失敗後に元のファイル内容が変わっていないことを必ずテストする。

完了条件は、競合時に`409 PROJECT_REVISION_CONFLICT`相当の業務エラーを返し、暗黙の上書きをしないことである。

#### P0-04 SQLiteとマイグレーション

目的は、素材、用語、改善ログを将来追加できるDB基盤を作ることである。

Codexへは、`better-sqlite3`、Drizzle ORM、Drizzle Kitを使い、`src/db/schema.ts`と`src/db/migrations/`を用意するよう依頼する。起動時にmigrationを適用し、`foreign_keys`、WAL、`busy_timeout`を設定する。`drizzle-kit push`は使わない。

検証では、空DBへの初回適用、既存DBへの再適用、失敗時の挙動、transactionのロールバックを確認する。

完了条件は、アプリを二回起動してもmigrationが重複適用されず、DBの適用履歴が残ることである。

#### P0-05 共通エラーとAPI骨格

目的は、すべての画面が同じ形式で成功と失敗を扱えるようにすることである。

Codexへは、仕様書11.1の成功・失敗形式、request ID、業務エラーコード、Zodエラーのフィールドパス変換を実装するよう依頼する。スタックトレース、APIキー、絶対パス、入力資料本文をブラウザーへ返さない。

検証では、正常応答、入力不正、存在しないプロジェクト、revision競合、予期しない例外を試す。

完了条件は、どのAPIでもエラー形式が統一され、画面側がエラー種別を判断できることである。

#### P0-06 Phase 0統合スモークテスト

目的は、個別に作った土台が一緒に動くかを確認することである。

Codexへは、空のプロジェクトを生成し、保存し、再読込し、SQLite migrationを実行する統合テストを作るよう依頼する。`VideoProject`と`RenderManifest`の型共有も確認する。

検証では、仕様書22章のPhase 0完了条件を一項目ずつ対応付ける。

完了条件は、Phase 0の全テスト、型検査、lint、buildが成功し、Phase 1が土台の作り直しなしで開始できることである。

### 6.3 Phase 0のCodex指示例

```text
今回の作業IDはP0-03です。

目的:
projects/{projectId}/project.jsonを安全に保存し、同時更新による上書きを防ぐ
ProjectRepositoryを実装してください。

対象範囲:
- project.jsonの読込
- Zodによる構造・ドメイン検証
- expectedRevisionの照合
- revisionとupdatedAtの更新
- 同一ディレクトリの一時ファイルへの書込み
- renameによる原子的置換
- 業務エラーへの変換
- 単体・統合テスト

対象外:
- WebUI
- SQLite
- プロジェクト一覧API
- 自動保存UI
- バックアップUI

受け入れ条件:
1. 正しいプロジェクトを保存して再読込できる。
2. revision不一致では既存ファイルを変更せず競合エラーになる。
3. 不正データでは既存ファイルを変更しない。
4. 一時ファイルが同じディレクトリに作られる。
5. UTF-8、2スペース、末尾改行で保存される。
6. 絶対パスや管理ルート外のパスを外部へ返さない。
7. 成功例と失敗例のテストがある。
```

### 6.4 利用者が手動確認すること

Phase 0では画面がほとんどないため、Codexが用意した小さな確認用コマンドまたはAPIを使う。プロジェクトを一度作り、保存後にファイルを開いて、タイトルやrevisionが保存されていることを確認する。次に古いrevisionで保存を試し、元のファイルが変わらないことを確認する。ファイルを意図的に不正にした場合も、アプリが勝手に上書きしないことを確認する。

## 7. Phase 1: 企画と構成案

### 7.1 目的

Phase 1では、動画作成の元資料と企画条件を保存し、構成案を OpenRouter で生成するか人間が手入力し、人間が内容を修正して承認できるようにする。

このPhaseで大切なのは、AIが返した内容をそのまま正解として保存しないことである。AI出力はZodで検証し、未解決の質問が残っている場合や元資料が変更された場合は承認できないようにする。

### 7.2 PR候補

#### P1-01 プロジェクト一覧・作成・読込

プロジェクト一覧、新規作成、詳細読込のAPIと最小画面を実装する。プロジェクトIDはバックエンドで生成し、作成後に変更しない。作成直後の`project.json`がPhase 0のZodスキーマを通ることを検証する。

完了条件は、ブラウザーから新規プロジェクトを作り、一覧へ表示し、再起動後も開けることである。

#### P1-02 Markdownと企画条件の編集・自動保存

`source/source.md`と`ProjectBrief`の編集画面を実装する。Markdown保存とSHA-256更新を一つの操作として扱い、自動保存の「保存中」「保存済み」「失敗」「競合」を表示する。

検証では、資料変更後に`source.sha256`が変わること、保存失敗時に以前のMarkdownとJSONの対応が崩れないことを確認する。

完了条件は、入力した内容が再読込後も残り、保存競合を利用者へ明示できることである。

#### P1-03 OpenRouterモデル一覧とAI設定

OpenRouter adapter、モデル一覧API、`AiSettings`の読込と解決順序を実装する。APIキーは環境変数だけから読み、ブラウザーやログへ出さない。モデル一覧では入出力単価がともに0の`free`と、それ以外の`paid`を切り替えて表示できる。モデルが未選択または条件不適合の場合は、AI操作だけを無効にする。

検証では、fixtureを使ってモデル一覧、認証失敗、ZDR条件不一致、structured output非対応を試す。

完了条件は、AIが使えない場合でも企画編集などの非AI機能が使えることである。

#### P1-04 構成案生成

AI経路では、承認済みではない企画情報とMarkdownを資料として明確に区切ってOpenRouterへ渡し、strict JSON Schemaの構成案を受け取る。手入力経路ではAIを呼び出さずに構成案を開始できる。どちらも保存後は同じ編集・承認条件を使用し、AI経路だけは受信後にZodで再検証し、失敗時に既存構成案を変更しない。

検証では、成功、スキーマ違反、429、502、503、認証失敗、入力超過をstubで試す。AI実行ログにはモデル、選択元、応答時間、トークンなどを記録する。

完了条件は、正しい構成案だけが保存候補となり、不正な応答で既存データが消えないことである。

#### P1-05 構成案編集・要確認事項・承認

セクションの編集、並べ替え、`openQuestions`の解決、承認を実装する。`intro`、`main`、`outro`の順序、未解決質問、`sourceHash`一致を承認前に検証する。

検証では、元資料を変更した後に構成案がstaleとなり、再承認が必要になることを確認する。

完了条件は、未解決事項がなく、正しい順序で、最新資料に対応した構成案だけを承認できることである。

### 7.3 Phase 1のCodex指示例

```text
今回の作業IDはP1-05です。

目的:
AIまたは人が作成した構成案を編集し、機械検証を通った場合だけ
approvedへ変更できるようにしてください。

対象範囲:
- 構成案編集APIと画面
- セクションの並べ替え
- openQuestionsの解決入力
- 承認API
- sourceHashによるstale判定
- 承認条件の単体・統合テスト

承認時に検証する条件:
- introが先頭に1件
- outroが末尾に1件
- mainが1件以上
- orderが重複せず表示順と一致
- 未解決openQuestionsがない
- sourceHashが現在のsource.sha256と一致

対象外:
- 台本生成
- 台本編集
- 素材割り当て
- VOICEVOX
```

### 7.4 利用者が手動確認すること

資料と企画条件を保存し、モデル一覧で`free`と`paid`を切り替えて表示できることを確認する。AI経路では構成案を生成し、手入力経路では生成せずに導入・本編・まとめを入力する。どちらの経路でもセクションの名称を変更し、質問を未解決のまま承認しようとして拒否されることを確認する。質問を解決して承認した後、元のMarkdownを変更し、構成案が「古い内容に基づく」と表示されることを確認する。

## 8. Phase 2: 台本と用語

### 8.1 目的

Phase 2では、承認済み構成案を元に、人間が四国めたん役とずんだもん役の会話台本を作る。字幕として見せる文章と、VOICEVOXへ渡す文章を別々に保存する。また、社内用語や固有名詞の読みを一か所で管理する。

MVPではAIに台本初稿を書かせる機能は対象外である。AI関連の型に`script_generation`が存在しても、このPhaseで生成UIを追加しない。

### 8.2 PR候補

以下の P2-01〜P2-05 は、各作業時点の実装範囲と判断を記録した履歴である。ここにある「physical variant 選択を含めない」「mapping を後続設計へ分離する」という記述は、当時の作業境界を示すものであり、現在の標準経路を定義しない。現在仕様は CV-04、実装範囲は後続 CV-05 の記述を優先する。

#### P2-01 2キャラクター初期設定と素材確認

以下は P2-01 実装時点の作業内容と判断を記録した履歴であり、現在のキャラクタービジュアル登録の正本を定義する節ではない。現在仕様と後続作業は 8.5 に記載する。

`doc/assets` に用意された 2 人分のキャラクターデータを調査し、`character-mentor` と `character-learner` へ対応付ける。初期キャラクター設定、TypeScript で管理する `characterVariantCatalog`、専用 PNG 検証、読み取り専用の素材確認画面を実装する。カタログは `variantId`、`characterId`、`label`、`renderType`、`tags`、`files` を物理素材の正本として持ち、`renderType` は `single-image` と `mouth-pair` だけを固定する。

実在素材は各キャラクターについて、非会話状態の `single-image` 1 variant、通常会話の `mouth-pair` 1 variant、指差し状態の会話の `mouth-pair` 1 variant、合計 5 ファイルである。キャンバスは 600 × 1000 とし、2 キャラクターで 10 ファイルを検証する。

`ScriptLine.expression` の `neutral`、`smile`、`explain`、`caution` は台本上の論理表情であり、物理ポーズ、PNG、`variantId` ではない。P2-01 では論理表情から物理 variant への mapping を行わず、`VideoProject.schemaVersion` と既存 `Character.visualAssets` の `1.0.0` 互換構造も変更しない。

不足がある場合は推測で画像を作り直さず、不足ファイルと期待する命名を報告する。

完了条件は、2キャラクターの初期データが既存の `VideoProject` Zodスキーマを通り、永続スキーマを変更せず、画面で話者名とカタログに登録された実在素材バリアントを表示できることである。

#### P2-02 台本編集と一括貼付け

セクション、セリフカード、話者、`ScriptLine.expression` の論理表情、`spokenText`、`subtitleText`、前後の無音時間を編集できる画面を作る。話者付きテキストの一括貼付けを機械的にカードへ分割する。ここでの表情編集は論理表情の編集であり、物理 variant の選択や mapping を含めない。物理 variant 選択も必要と判断する場合は、既存計画へ暗黙に混ぜず、別の設計判断または後続タスクとして追加する。

検証では、IDの一意性、空セリフ、話者参照、並べ替え、複製、削除、自動保存競合を確認する。

完了条件は、2人の複数セリフを作り、再読込して同じ順序で表示できることである。

#### P2-03 固有名詞・社内用語CRUD

SQLiteへ用語テーブルを追加し、一覧、検索、登録、編集、利用停止、再有効化を実装する。読みは全角カタカナとして検証し、同一正規化表記の重複を防ぐ。

完了条件は、用語を登録し、停止し、再有効化でき、物理削除なしで履歴を保持できることである。

#### P2-04 読み上げ解決プレビュー

長い表記を優先し、priorityとterm IDで決定論的に用語を置換する。`literal`モードと除外用語を扱い、元の`spokenText`と`subtitleText`は変更しない。

検証では、表記が重なる用語、同じ優先度、除外、inactive、literalを試す。

完了条件は、同じ入力とDB状態から常に同じ`resolvedSpokenText`が表示されることである。

#### P2-05 台本中心の制作状態と依存アーティファクトのstale検知

台本承認を追加しない。構成案が承認済みかつ最新であること、台本の構造、話者、発話、`outlineHash`を検証する。台本が`draft`または`needs_review`でも、保存済みで対象セリフが有効なら、generic 現場素材の Asset Search / assignment backend と音声生成・調整を利用できる。generic 素材の UI は CV-04 後の標準 `/script` 右ペインを前提にせず、別画面または補助導線で扱う。キャラクタービジュアルの binding / physical variant 選択は、CV-04 で確定した `project.json` の explicit reference と CV-05 の card/modal UI で扱う。セリフ追加・削除・順序変更や発話変更では、依存するビジュアル範囲、音声、`RenderManifest`を stale または `needs_review` として表示する。

検証では、不正な台本だけが該当する保存・候補・音声操作で拒否されること、台本未承認でもビジュアル候補と音声操作が可能なこと、revision 競合と自動保存が維持されること、変更後に音声・素材・Manifest の stale/missing が検出されることを確認する。

完了条件は、台本を明示承認せずに各セリフカードからキャラクタービジュアルと音声を設定でき、generic 素材機能は分離した補助導線で利用でき、出力時 validation が不足データだけを機械的に拒否することである。

### 8.3 Phase 2のCodex指示例

```text
今回の作業IDはP2-04です。

目的:
登録済み社内用語をspokenTextへ一時適用し、
VOICEVOXへ渡すresolvedSpokenTextを決定論的に作ってください。

実装する規則:
1. spokenTextをUnicode NFCへ正規化する。
2. pronunciation.modeがliteralなら置換しない。
3. activeかつexcludedTermIdsに含まれない用語だけを使う。
4. surface文字数の長い順、priorityの高い順、termId昇順で処理する。
5. 重複しない最長一致でreading_katakanaへ置換する。
6. 元のspokenTextとsubtitleTextは変更しない。
7. 適用したtermId、surface、reading、updatedAtを返す。

対象範囲:
- 純粋関数
- 用語repositoryとのapplication service
- プレビューAPI
- 単体テスト
- 最小のWebUI表示

対象外:
- VOICEVOXへの接続
- WAV生成
- アクセント編集
```

### 8.4 利用者が手動確認すること

社内用語を一つ登録し、その表記を含むセリフを作る。字幕は元の表記のまま、読み上げプレビューだけがカタカナへ変わることを確認する。用語を利用停止すると再生成が必要な状態へ変わること、`literal`を選ぶと置換されないことも確認する。

### 8.5 P2-01後続: キャラクタービジュアル登録

P2-01 の記述は、当時の TypeScript 静的 `characterVariantCatalog` と読み取り専用確認画面を実装した履歴として変更しない。現在仕様では、実在する登録項目の正本を workspace SQLite の `CharacterVisualSet` へ移し、TypeScript の catalog は型または DB から生成した snapshot に限定する。

以下の CV-00〜CV-03 は、workspace 共通の登録・管理機能を段階的に追加した実装履歴と作業境界である。各節の「対象外」はその phase の境界として残すが、project-specific な human explicit selection に関する現在仕様は CV-04、実装は CV-05 が定義する。

登録時点で全表情・全ポーズの variant が揃っている必要はない。未登録 variant は set の部分状態として許可するが、永続化する variant は必須 slot が揃った完成状態に限る。`single-image` の作成は `single` 1 件、`mouth-pair` の作成は `closed` と `open` 各 1 件を同一リクエストで検証・登録し、必須 slot 欠落の variant を残さない。作成後の差し替えは既存 variant の 1 slot 単位で許可するが、必須 slot の削除は行わない。visual は `mentor` / `learner` や特定 project に固定せず、`ScriptLine.expression` と物理 variant の mapping は後続設計へ分離する。最初の完成 variant のキャンバスサイズを visual 単位の基準とし、既存 seed の 600 × 1000 px は全体固定値にしない。新規ファイルは `library/character-visuals/{visualId}/{variantId}/` に保存し、`public/` へ直接保存しない。

#### CV-00 仕様書改訂

3文書（`doc/doc.md`、`doc/implementation-spec.md`、この計画書）を、動的 `CharacterVisualSet` と workspace SQLite を正本とする現行仕様へ揃える。CV-00 ではコード、SQLite migration、登録 API、登録 UI を実装しない。

完了条件は、3文書で静的カタログと SQLite が同時にメタデータ正本として扱われず、一部 variant が未登録の set、永続化済み variant の必須 slot、expression 分離、role 非固定、visual 単位キャンバス、2 visual / 6 variant / 10 PNG の seed、`public/` 非保存、依存方向、CV-01〜CV-03 の境界が判断できることである。

#### CV-01 動的カタログ基盤

`CharacterVisualSet`、variant、file slot、checksum、canvas metadata、status、作成・更新日時を workspace SQLite へ保存する schema / migration と repository を実装する。P2-01 の既存 2 キャラクター、6 variant、10 PNG を idempotent に seed / migration し、移行後は DB を一覧・検証・配信のメタデータ正本にする。TypeScript の静的配列を実在項目の正本として残さない。

対象外:

- ファイルアップロード API
- `/character-visuals` 登録画面
- プロジェクトごとの visual 選択、expression mapping
- `RenderManifest` の character variant フィールド追加

#### CV-02 登録 API・ファイル管理

Fastify に `CharacterVisualSet` の一覧・詳細・作成・更新と variant file の登録・差し替え API を追加する。variant 作成は `single-image` の `single`、または `mouth-pair` の `closed` / `open` を一括で受け取り、全必須 slot を検証できた場合だけ永続化する。作成後の既存 variant は 1 slot 単位で差し替えできるが、必須 slot の削除 API は追加しない。ファイルは一時領域で受信し、許可形式、PNG 構造、slot、checksum、visual 単位のキャンバスをバックエンドで検証してから `library/character-visuals/{visualId}/{variantId}/` へ保存する。1つのアプリケーション操作として staged file、atomic rename、SQLite transaction、失敗時の compensating cleanup を組み合わせ、SQLite とファイルシステムを単一 transaction と誤認しない。WebUI に OS 絶対パスを返さず、画像は管理された配信経路で返す。既存の有効データを新規操作の失敗で壊さない。

対象外:

- `/character-visuals` の画面とサイドバー導線
- プロジェクトへの自動紐付け
- `mentor` / `learner` の役割付与
- `ScriptLine.expression` からの自動 mapping

#### CV-03 折りたたみサイドバー・登録 UI

サイドバーから `/character-visuals` を開けるようにし、workspace 共通の visual 一覧、作成、名称・説明編集、完全な variant の作成、既存 file slot の差し替え、status 表示を実装する。未登録 variant は未登録として表示し、variant 作成フォームでは `single-image` / `mouth-pair` の必須 slot を揃えるまで送信を完了できない。必須 slot 欠落や visual 基準キャンバス不一致はフォームの validation として表示するが、不完全な variant は永続化しない。既存の完成 variant は 1 slot 単位で差し替えでき、必須 slot の削除は行わない。プロジェクトの `/script` 画面は登録済み visual を参照するだけにし、登録画面と制作画面の正本を分ける。

対象外:

- プロジェクトごとの visual 選択 UI
- `neutral` / `smile` / `explain` / `caution` と物理 variant の mapping UI / 自動 mapping
- `RenderManifest` の型変更
- 口パク方式、VOICEVOX 話者設定の変更
- 現場動画・写真・帳票素材ライブラリとの統合

CV-03
  ↓
CV-04 仕様書改訂（文書のみ）
  ↓
CV-05 人間主導のキャラクタービジュアル選択実装

#### CV-04 仕様書改訂

Issue #97 に基づき、`doc/doc.md`、`doc/implementation-spec.md`、この計画書の現在仕様を揃える。人間による explicit character visual selection を標準経路とし、workspace SQLite と `project.json` の責務、`CharacterVisualBinding`、line の `characterVariantId`、1 ペインの `/projects/{projectId}/script`、セリフカード内の選択表示、speaker-bound active variant の modal picker、タグの sort 補助、`/projects/{projectId}/characters` の binding + catalog snapshot 表示、compiler / RenderManifest の explicit 解決、schema version bump / migration 要件を確定する。

CV-04 ではドキュメントだけを変更する。TypeScript / React / Fastify、Zod schema、SQLite schema、migration、API、ScriptPage、CharacterAssetsPage、compiler、RenderManifest、Remotion、fixture、tests は変更しない。AI visual suggestion backend、現場素材 Asset Search、generic `VisualAssignment` backend / data も削除しない。

完了条件は、3文書を横断して次を判断できることである。

- human explicit selection が通常経路であり、`expression`、tag、label、旧固定 mapping から physical variant を自動選択・代替しない。
- SQLite は `CharacterVisualSet` の visual / variant / file metadata の正本、`project.json` は project binding と line variant の正本である。
- `/script` は 1 ペインのセリフカード中心、picker は modal、タグは filter ではなく sort 補助、`/characters` は binding + SQLite snapshot の確認画面である。
- compiler / Remotion は explicit reference と validated snapshot を使い、SQLite を直接検索せず、missing / inactive / cross-visual を validation error とする。
- `schemaVersion: "1.0.0"` の意味を暗黙に変更せず、migration では tag / label 検索による推測をしない。

#### CV-05 人間主導のキャラクタービジュアル選択実装

CV-04 の後続、Issue #98 の実装作業である。schema version の明示的な bump、`1.0.0` からの migration、`project.json` の VOICEVOX ↔ `CharacterVisualSet` binding と idle variant、各 `ScriptLine.characterVariantId` の保存・validation、ScriptPage の 1 ペイン化、セリフカード統合、modal picker、タグ sort、CharacterAssetsPage の project binding + `CharacterVisualCatalogSnapshot` 表示、compiler / RenderManifest / Remotion の explicit variant 解決を実装する。

CV-05 の migration は SQLite の tag / label から visual / variant を推測しない。旧固定 mapping を既知の compatibility input として決定論的に利用できる場合だけ使い、解決できない参照は未設定として人間の確認を要求する。AI suggestion、Asset Search、generic `VisualAssignment` backend / data は維持し、キャラクタービジュアルの標準経路にはしない。

CV-04 と CV-05 は責務を混ぜない。CV-04 の完了は仕様確定で停止し、CV-05 で初めて実装・schema・migration・テスト・手動確認へ進む。

## 9. Phase 3: 素材とビジュアル

### 9.1 目的

Phase 3では、動画、写真、帳票スキャン、効果音を素材ライブラリへ安全に登録し、検索して、台本のセリフ範囲へ割り当てられるようにする。

重要なのは、利用者がアップロードした元ファイル名をそのまま保存パスへ使わないこと、素材のチェックサムを記録すること、プロジェクトへコピーする途中で失敗してもJSONとファイルの対応を壊さないことである。

### 9.2 PR候補

#### P3-01 素材DBとアップロード受付

素材、タグ、別名、関連テーブルを作り、許可したMIME typeと実ファイル形式を検証する。受信時は一時領域へ置き、ファイル名を安全な管理名へ変える。

完了条件は、動画、写真、帳票、効果音のfixtureを登録でき、不正形式を拒否できることである。

#### P3-02 メタデータ・チェックサム・サムネイル生成

SHA-256、サイズ、解像度、動画尺、帳票ページ数、音声尺などを取得し、サムネイルを生成する。処理中は`processing`、成功後に`active`、失敗時に`error`とする。

完了条件は、途中失敗した素材が検索候補へ出ず、理由を診断できることである。

#### P3-03 タグ検索と全文検索

タイトル、説明、部門、システム、タグ、別名をFTS5で検索できるようにする。inactiveまたはerror素材を通常検索から除外する。

完了条件は、完全一致だけでなく説明や別名から素材を見つけられることである。

#### P3-04 AIによる検索意図生成

利用者の自然文を、既存タグや検索条件へ変換する`visual_search_intent`を実装する。AIは素材そのものを自動決定せず、検索候補の絞り込みだけを行う。

検証では、AI失敗時にも通常のタグ・全文検索が使えることを確認する。

完了条件は、AIを使わなくても素材選択が可能であり、AI結果が検索条件として人間に見えることである。

#### P3-05 プロジェクトへの安全な取り込み

active素材をプロジェクトの一時パスへコピーし、コピー後にチェックサムを照合してから最終パスへ移動する。その後にrevision付きでassignmentを保存し、JSON保存失敗時は今回の未参照ファイルを取り除く。

完了条件は、成功時にJSONとファイルがそろい、失敗時に片方だけが残らないことである。

#### P3-06 表示設定・静的注釈・範囲検証

セリフ開始・終了範囲、contain/cover、crop、scale、position、動画の開始・終了、帳票ページ、静的なラベル・枠・矢印を編集する。

検証では、セリフ範囲、動画尺、帳票ページ、0から1の正規化座標、チェックサム、機密区分を確認する。

完了条件は、同じセクション内の正しいセリフ範囲へ素材を割り当て、`crop`、`scale`、`position`、prioritizeVisual、注釈を保存できることである。ビジュアル計画は `draft` や `needs_review` のままでも制作を継続でき、出力時 validation が参照切れ、範囲不正、checksum 不一致を検出する。

### 9.3 Phase 3のCodex指示例

```text
今回の作業IDはP3-05です。

目的:
素材ライブラリのactive素材をプロジェクトへコピーし、
VisualAssignmentの保存までを壊れにくい一連の処理にしてください。

必須手順:
1. 素材がactiveであることを確認する。
2. プロジェクト内の一時パスへコピーする。
3. コピー後のSHA-256をDBのchecksumと照合する。
4. 最終パスへ移動する。
5. expectedRevision付きでproject.jsonのassignmentを保存する。
6. JSON保存失敗時は今回作成した未参照ファイルを削除する。
7. 異常終了後の既存orphanを自動削除しない。

テスト:
- 正常取り込み
- コピー失敗
- checksum不一致
- revision競合
- project保存失敗時のロールバック
```

### 9.4 利用者が手動確認すること

写真、短い動画、帳票、効果音を一つずつ登録する。検索結果へ表示され、サムネイルや基本情報が正しいことを確認する。素材を台本のセリフ範囲へ割り当て、アプリ再起動後も設定が残ることを確認する。不正なページ番号や動画終了時間を入力すると保存前に警告されることも確認する。

## 10. Phase 4: 音声

### 10.1 目的

Phase 4では、VOICEVOX ENGINEから四国めたんとずんだもんの情報を読み込み、各話者の`ノーマル`スタイルを名前から解決し、セリフ単位でWAVを生成する。数値のstyle IDはコードや初期データへ埋め込まない。

生成済み音声は派生データであり、台本や用語が変わった場合には「再生成が必要」と表示する。以前成功したWAVは、新しい生成が成功するまで削除しない。

### 10.2 実装前の判断ゲート

改訂版仕様書には、MVP初期対象外として「VOICEVOXのイントネーション編集UI」が記載されている一方、Phase 4には「基本、アクセント、モーラ詳細の編集と試聴」が含まれている。この二つは同時には成立しない。

Phase 4開始前に、Web版ChatGPTと次のどちらかを選び、仕様書を更新する。

**案A: MVPへ編集UIを含める。**  
Phase 4で基本パラメーター、アクセント核、モーラ詳細の編集、調整JSON保存まで実装する。現在のPhase 4記述と7.9、12.2を優先する。

**案B: MVPでは編集UIを除外する。**  
Phase 4では未編集queryとキャラクター既定値によるWAV生成だけを実装する。`voice-adjustments`の読み書きと詳細編集画面はMVP後へ移す。

この計画のP4-05は案Aを選んだ場合だけ実施する。案Bの場合はP4-05を飛ばし、Phase 5へ進む。

### 10.3 PR候補

#### P4-01 VOICEVOX接続確認と標準スタイル解決

`VOICEVOX_ENGINE_URL`へ接続し、`/speakers`から話者名、UUID、stylesを取得する。四国めたんとずんだもんについて、名前が`ノーマル`のstyleを一意に解決する。

見つからない、複数ある、話者がいない場合は音声機能だけを無効にし、編集機能は使える状態を保つ。

完了条件は、実際のENGINEまたはfixtureで両話者のstyle IDを表示でき、ソースコードに数値IDが書かれていないことである。

#### P4-02 読み上げ文解決とaudio_queryキャッシュ

Phase 2の用語適用結果を使い、セリフごとに`audio_query`を取得して派生キャッシュへ保存する。cache keyには読み上げ文、style ID、音声設定、用語更新、ENGINE版を含める。

完了条件は、同じ条件ではキャッシュを再利用し、条件が変わると別のcache keyになることである。

#### P4-03 WAV生成とaudio index

`audio_query`を`/synthesis`へ送り、WAVを再エンコードせず保存する。成功後にだけ`audio-index.json`を更新する。

検証では、一部セリフの失敗、ENGINE停止、WAV保存失敗、index保存失敗を試し、以前の成功ファイルを壊さないことを確認する。

完了条件は、各セリフの音声、長さ、checksum、style ID、適用用語、ENGINE版がindexで追跡できることである。

#### P4-04 差分再生成と音声状態表示

台本、話者、音声設定、用語、ENGINE版、調整ファイルが変わったセリフだけを再生成対象にする。`最新`、`再生成が必要`、`生成中`、`失敗`を画面へ表示する。

完了条件は、一つのセリフを変更しても全セリフを無条件に作り直さないことである。

#### P4-05 音声調整UIと調整JSON（案Aのみ）

基本、アクセント、モーラ詳細の3段階を実装し、試聴中の変更は一時キャッシュへ置く。明示的な保存時だけ`voice-adjustments/{lineId}.json`を原子的に更新する。

`baseHash`不一致時には自動適用せず、破棄または再調整を人間に選ばせる。位置番号による自動マージを行わない。

完了条件は、保存、再読込、項目リセット、全体リセット、baseHash不一致時の適用拒否が動くことである。

### 10.4 Phase 4のCodex指示例

```text
今回の作業IDはP4-01です。

目的:
接続中のVOICEVOX ENGINEから話者情報を取得し、
四国めたんとずんだもんの標準スタイル「ノーマル」の数値IDを
実行時に解決してください。

対象範囲:
- GET /api/voicevox/status
- GET /api/voicevox/styles
- VOICEVOX adapter
- /speakers応答のZod検証
- 話者名、speaker UUID、style名による解決
- fixtureを使う単体・統合テスト
- 音声画面の接続状態表示

失敗条件:
- ENGINEへ接続できない
- 対象話者がない
- ノーマルがない
- ノーマルが複数あり一意に決まらない
- 応答形式が不正

失敗時の要件:
- 音声生成操作だけを無効にする。
- 台本編集や素材管理は無効にしない。
- 数値style IDを代替値としてハードコードしない。
```

### 10.5 利用者が手動確認すること

VOICEVOX ENGINEを起動した状態と停止した状態の両方を試す。起動中は四国めたんとずんだもんの「ノーマル」が選ばれ、停止中は音声生成だけが使えないことを確認する。一つのセリフを生成し、台本を変更すると「再生成が必要」と表示されること、再生成前のWAVが勝手に消えないことを確認する。

## 11. Phase 5: 動画

### 11.1 目的

Phase 5では、validation 可能な `VideoProject` の台本、音声、ビジュアル、背景、BGM、効果音、挿入プレースホルダーを`RenderManifest`へまとめ、同じマニフェストからWebプレビュー、MP4、サムネイルを作る。台本・ビジュアルの `approved` status はコンパイル条件にしない。

このPhaseでは、見た目より先に時間計算の正しさを作る。画面上で自然に見えても、フレーム計算が不安定だと、プレビューとMP4で位置や音がずれるためである。

### 11.2 PR候補

#### P5-01 タイムラインの純粋計算

ミリ秒からフレームへの変換、セリフの累積、半開区間、セクション範囲、ビジュアル範囲を純粋関数として実装する。React、SQLite、ファイル探索へ依存させない。

完了条件は、同じ入力から常に同じ順序とフレーム値が得られ、境界値の単体テストがあることである。

#### P5-02 RenderManifestコンパイラ

検証済み `VideoProject`、audio index、素材メタデータ、`project.json` の `CharacterVisualBinding` / line `characterVariantId`、バックエンドが解決した `CharacterVisualCatalogSnapshot` を読み、`RenderManifest` を生成する。コンパイラは SQLite や `library/character-visuals/` を直接検索しない。構成案の承認・最新性、台本の構造、音声の current/missing/stale、generic ビジュアル assignment の範囲・参照・checksum、character binding / explicit variant の所属・status・slot、Manifest の整合性を validation する。台本・ビジュアルが `draft` または `needs_review` でも、内容と参照が有効ならコンパイルできる。`RenderLine.expression` は論理表情であり、physical variant は `project.characters[].characterVisual.idleVariantId` と `project.script.sections[].lines[].characterVariantId` から決定する。expression、tag、label、旧固定 mapping から自動選択・代替しない。解決済みの character ID、variant ID、renderType、ファイルパス、checksum、`mouth-pair` の `closed` / `open` を manifest へ固定する。具体的な保存フィールドと manifestVersion 互換性は CV-05 で既存 schema と整合させる。

binding / explicit reference の欠落、variant 欠落、missing / inactive / cross-visual、mouth slot 欠落、ファイルまたは checksum の不一致時は自動代替せず、複数のエラーを line ID、character ID、assignment ID へ関連付けて返す。Remotion や WebUI の描画処理から `CharacterVisualSet`、catalog snapshot、SQLite を直接検索しない。

完了条件は、入力ハッシュまたは素材checksumが変わると古いキャッシュを使わないことである。

#### P5-03 基本Remotion composition

背景、キャラクター、字幕、写真・動画・帳票を解決済みの `RenderManifest` だけから描画する。Remotion コンポーネントから `CharacterVisualSet`、catalog snapshot、SQLite、DB 検索、ファイル探索、音声長測定を行わない。

完了条件は、fixture manifestだけで代表フレームを描画できることである。

#### P5-04 キャラクター・字幕・定周期口パク

CV-05 で保存した `CharacterVisualBinding` と line の `characterVariantId` に従い、バックエンドから渡された validated `CharacterVisualCatalogSnapshot` を使って `RenderManifest` の `idleVariantId`、line `characterVariantId`、`characterVariants[]` を解決する。`RenderLine.expression` は論理表情として保持するだけで、physical variant の決定には使わない。解決済み `mouth-pair` variant の `closed` / `open` だけを `lipSyncPeriodFrames` で定周期切り替えする。`single-image` に存在しない口差分、missing / inactive / cross-visual 参照の代替を自動補完しない。Remotion は `CharacterVisualSet`、カタログ、SQLite を直接参照せず、manifest の解決済み情報だけを使用する。話者は色だけでなく名前と配置でも区別する。

検証では、画像切替時に位置が揺れないこと、字幕が画面外へ出ないことを確認する。

完了条件は、音量解析を使わずに、現在話しているキャラクターだけが定周期で口を開閉することである。

#### P5-05 BGM・効果音・挿入プレースホルダー

セクションごとの0件または1件のBGM、前後フェード、`confirm`、`attention`、`warning`の効果音、opening・ending・eye catchの2秒プレースホルダーを統合する。

効果音は一セリフへ複数設定でき、セリフ開始からの相対時間を使う。初期音量は0.2とし、3音以上が同時再生される場合は警告する。警告は保存禁止にしない。

完了条件は、BGMがプレースホルダー区間で鳴らず、効果音が指定位置で鳴り、警告条件を検出できることである。

#### P5-06 WebUIプレビュー

`@remotion/player`を埋め込み、現在の validation 済みマニフェストを表示する。構成案が未承認・stale、台本が不正、音声や素材が missing/stale、assignment/checksum が不整合の場合は、該当する実行操作を無効にし、理由と修正先を表示する。台本・ビジュアルの承認操作は要求しない。

完了条件は、プレビューがMP4と同じマニフェストを使い、独自の時間計算を画面側に持たないことである。

#### P5-07 非同期レンダリングジョブ

MP4とサムネイル生成を子プロセスまたはworkerへ渡し、APIは`202 Accepted`と`runId`を返す。状態APIでqueued、running、succeeded、failedを取得する。

完了条件は、長いレンダリング中もHTTPリクエストを保持し続けず、以前の成功出力を失敗時に壊さないことである。

#### P5-08 サムネイル

1280×720の`standard`レイアウトを実装する。タイトルと部門名または対象システム名を必須とし、背景、補足、版数、代表ビジュアル、キャラクターは任意にする。

完了条件は、任意項目をすべて空にしても既定背景で画像を生成できることである。

#### P5-09 代表フレーム比較とE2E

fixture projectを使い、プロジェクト作成から短いMP4とサムネイル生成までをE2Eで確認する。代表フレームは画像比較を行うが、環境差で不安定にならない許容差を設定する。

完了条件は、仕様書19.3の一連の操作が自動化され、同じfixtureから再現可能な出力を得られることである。

### 11.3 Phase 5のCodex指示例

```text
今回の作業IDはP5-02です。

目的:
検証済みVideoProjectとaudio-index、素材メタデータから、
決定論的なRenderManifestを生成してください。

処理順:
1. project schemaを検証する。
2. 出力条件と参照整合性を検証する。構成案の承認・最新性は確認するが、台本・ビジュアルの status `approved` は要求しない。
3. 全セリフに有効な音声indexがあるか確認する。
4. 無音時間と音声長をフレームへ変換する。
5. セリフ範囲を累積計算する。
6. visual assignmentをframe範囲へ解決する。
7. section backgroundを解決する。
8. opening、eye catch、endingと音声トラックを統合する。
9. durationInFramesを計算する。
10. hashとchecksumを付け、Zod検証する。
11. 一時ファイルからrender-manifest.jsonへ置換する。

キャラクター素材を扱う場合の追加条件:
- `RenderLine.expression` は論理表情として扱い、PNG や物理 variant と直接対応させない。
- `project.characters[].characterVisual.visualId`、`idleVariantId`、各 line の `characterVariantId` を、バックエンドが渡す validated `CharacterVisualCatalogSnapshot` と照合して `variantId` とファイルスロットを解決する。
- 解決済みのファイルパス、checksum、`mouth-pair` の `closed` / `open` を manifest に固定する。具体的なフィールドは TBD とする。
- explicit reference の欠落、missing / inactive / cross-visual、variant 欠落、mouth slot 欠落時は自動代替せずエラーにする。
- コンパイラと Remotion から `CharacterVisualSet`、カタログ、SQLite を直接検索しない。

重要条件:
- 時間範囲は半開区間を使う。
- msからframeはMath.ceil((ms / 1000) * fps)を使う。
- 同じ入力では配列順とJSONシリアライズ順を固定する。
- 失敗時は新しいmanifestを保存しない。
- 可能なエラーを一件だけでなくまとめて返す。
```

### 11.4 利用者が手動確認すること

2人が数セリフを話す短いfixtureを使う。プレビューとMP4で、字幕、話者、音声、素材の切替時刻が同じことを確認する。openingとendingが各2秒で、eye catchを追加した場所だけ後続がずれることを確認する。BGMが本編だけで鳴り、効果音がセリフ開始から指定した時間で鳴ることも確認する。

## 12. Phase 6: 改善ログ

### 12.1 目的

Phase 6では、MVP後に機能改善を判断できるように、AI出力、人間の修正、採否、音声再生成、承認などの意味のある操作を記録する。

キー入力やクリックをすべて記録するのではなく、「AI案を採用した」「根拠のない内容を削除した」「用語変更により音声を再生成した」など、改善判断に使える出来事だけを保存する。

### 12.2 PR候補

#### P6-01 実行ログの統一

AI、音声、マニフェスト、レンダリングのrun JSONを統一する。開始・終了、状態、入力ハッシュ、モデルまたはENGINE、出力checksum、正規化エラーを記録する。

AI実行では、スキーマ検証結果、応答時間、入出力トークン、料金、画像入力・ツール利用の有無を記録する。

完了条件は、秘密情報や入力資料全文を保存せず、失敗した実行も追跡できることである。

#### P6-02 判断ログと正解例

SQLiteへ、生成候補の採否、人間の修正前後、修正理由、対象ID、モデル、プロンプト版を保存する。利用者が理由を入力しない場合でも、何を採用・却下したかを記録する。

完了条件は、用途別AIモデルを将来比較するための最低限のデータが残ることである。

#### P6-03 検索・集計

期間、task kind、モデル、成功・失敗、採否、エラーで検索できる画面を作る。最初は高度な分析画面を作らず、件数、検証通過率、平均応答時間、修正有無を確認できる程度にする。

完了条件は、Gemma 4 31Bを別モデルへ分けるべきかを判断する元データを確認できることである。

#### P6-04 エクスポート

改善ログを秘密情報を除いた形式でエクスポートする。MVP時点では仕様書が標準形式を確定していないため、実装前にJSON LinesまたはCSVのどちらを採用するかを判断する。

完了条件は、エクスポートしたデータにAPIキー、資料全文、絶対パスが含まれないことである。

### 12.3 Phase 6のCodex指示例

```text
今回の作業IDはP6-01です。

目的:
AI、VOICEVOX、manifest、renderの実行結果を、
共通のrun log形式で追跡できるようにしてください。

必須項目:
- runId
- kind
- projectIdとrevision
- startedAt、finishedAt
- queued/running/succeeded/failed
- inputHash
- 使用モデルまたはENGINEの識別情報
- privacy設定
- output pathとchecksum
- normalized error code

AI実行の追加項目:
- taskKind
- modelId
- modelSelectionSource
- schemaValidationResult
- responseTimeMs
- inputTokens、outputTokens、cost
- imageInputUsed、toolsUsed

保存禁止:
- APIキー
- 入力資料全文
- 秘密情報
- OS絶対パス
```

### 12.4 利用者が手動確認すること

AI構成案を一度採用し、一部を修正し、一度却下する。ログ画面で、それぞれが別の判断として表示されることを確認する。VOICEVOX生成とMP4生成を成功・失敗させ、runの状態とエラーが追跡できることを確認する。

## 13. Phaseごとの完了判定

各Phaseの最後に、Web版ChatGPTへ次の形式で判定を依頼する。

```text
Phase [番号] の完了判定をしてください。

基礎資料:
- implementation-spec.md
- development-plan-chatgpt-codex.md

完了したPR:
[一覧]

未完了または保留:
[一覧]

最新のテスト結果:
[貼付]

手動確認結果:
[利用者が確認した内容]

次の観点で判定してください。
1. このPhaseの利用者向け目的を満たしたか。
2. 仕様上の完了条件を満たしたか。
3. 後工程へ進むと修正範囲が大きくなる問題が残っていないか。
4. テストが不足していないか。
5. 次のPhaseへ進行可能、条件付き可能、進行不可のどれか。
```

Phase完了は「画面が一応動いた」ではなく、正常操作、失敗操作、再起動後の再読込、自動テストがそろった状態とする。

## 14. 初心者向けのレビュー観点

コードの書き方が分からなくても、次の質問はできる。

| 確認したいこと | ChatGPTやCodexへ聞く質問 |
|---|---|
| データが壊れないか | この処理が途中で失敗した場合、以前のファイルは残りますか |
| 勝手な上書きがないか | 古いrevisionから保存した場合、どのエラーになりますか |
| 仕様外の追加がないか | 今回の対象外なのに追加した機能や依存はありますか |
| テストが十分か | 正常例だけでなく、失敗例をどのテストで確認していますか |
| 外部サービスへ依存しないか | 通常のテストでOpenRouter課金やVOICEVOX起動が必要ですか |
| 秘密情報が漏れないか | APIキー、絶対パス、資料本文が画面やログへ出ませんか |
| 後工程と整合するか | この型やAPIは仕様書の後工程でもそのまま使えますか |
| 変更が大きすぎないか | このPRをさらに二つへ分けた方が安全ですか |
| 手動確認方法 | 私が画面で行う確認を、操作順に説明してください |

## 15. MVP完成前の最終確認

Phase 0からPhase 6まで完了した後、最終的なMVP確認用fixtureを一つ固定する。そのfixtureには、二人のキャラクター、複数セクション、複数セリフ、社内用語、写真、動画、帳票、BGM、効果音、opening、ending、eye catch、サムネイルを含める。

最終確認では、次の一連の操作を最初から行う。

1. 新規プロジェクトを作る。
2. Markdownと企画条件を保存する。
3. AI構成案を生成するか、手入力で構成案を作成し、人間が修正して承認する。
4. 人間が2人会話の台本を作り、用語を登録し、セリフカードからキャラクタービジュアルと音声を整える。generic 現場素材の検索・割り当ては分離した補助導線で扱う。
5. 素材を登録し、generic assignment として台本範囲へ割り当て、出力前 validation で検証する。
6. VOICEVOXで音声を生成する。
7. `RenderManifest`を作り、検証する。
8. Webプレビューを確認する。
9. 短いMP4とサムネイルを生成する。
10. AI、音声、レンダリングの実行ログを確認する。
11. アプリを終了して再起動し、データと出力が残っていることを確認する。

最終的なMVP完了条件は、上記操作が一つのfixtureで再現でき、途中の失敗が以前の正常データを壊さず、プレビューとMP4が同じマニフェストに基づいていることである。

## 16. 最初にCodexへ依頼する作業

最初の依頼はP0-01だけにする。P0-01でリポジトリの起動方法、テスト方法、ディレクトリ境界が固定されてから、P0-02のZodスキーマへ進む。

最初の依頼時には、[`implementation-spec.md`](./implementation-spec.md) とこの計画書を Codex が常に参照できる場所へ置く。Codex には、実装前に対象節を読み、Issue #87 の制作モデルと出力 validation に反する旧承認ゲートを再導入しないこと、実装後に参照した節番号を報告するよう求める。

P0-01を完了するまでは、プロジェクト画面、OpenRouter、VOICEVOX、Remotionの本格実装を始めない。
