# Sol–Luna Codex開発パイプライン運用忘備録

> **文書目的**  
> 新規プロジェクトの開始時に、ChatGPT、Codex、GitHubを組み合わせた開発体制を構築するための確認事項、役割分担、運用手順、テンプレートを一か所にまとめる。
>
> **基本方針**  
> 高コストなSolをCodex上で常用せず、Sol Chatを計画・レビュー・モデル選定へ集中させる。実装と修正はLuna Codexを基本とし、難易度に応じてTerra Codex、最終的にSol Codexへ昇格させる。
>
> **想定環境**  
> ChatGPT Plus、GitHub、Gitリポジトリ、Codex、Windowsを含むローカル開発環境。

---

## tl;dr

この開発体制では、Sol Chatが「何を、どのように、どのモデルで実装するか」を判断し、Luna Codexが実際のリポジトリを操作して実装、試験、修正、PR作成を担当する。

通常の流れは次のとおりである。

```text
RP作成
  ↓
Sol Chatによる計画・難易度判定
  ↓
Luna Codexによる調査・実装・検証
  ↓
Draft PR作成
  ↓
Sol Chatによる独立レビュー
  ↓
Luna Codexによる修正
  ↓
CIと人間による最終確認
  ↓
マージ
```

Lunaがタスクを完遂できない場合は、直ちにSol Codexへ切り替えるのではなく、原則として次の順序で昇格する。

```text
Luna Codex
  ↓
Terra Codex
  ↓
Sol Codex
```

Sol Chatは実環境を直接操作できない。そのため、Codex側のモデルにはコードだけでなく、実行コマンド、テスト結果、ログ、スクリーンショット、DB状態、未確認事項を含むEvidence Packetを作らせる。

このパイプラインを成立させる中心的な成果物は、次の四つである。

| 成果物 | 役割 |
|---|---|
| RP | 要求、制約、受入条件を定義する |
| Plan | Sol Chatが実装方針と検証方法を定義する |
| diff | 実際に行われた変更を示す |
| handoff | 実装結果、検証結果、残課題を次工程へ渡す |

---

# 1. このパイプラインの目的

このパイプラインの目的は、最も高性能なモデルをすべての工程で使用することではない。

目的は、各モデルを最も価値の高い工程へ割り当てることである。

Solは、要件の曖昧さを解消し、設計上の選択肢を比較し、難易度を判定し、実装結果を監査するために使う。大量のファイル編集、定型的な実装、テスト修正、レビュー指摘への対応は、原則としてLunaへ任せる。

これにより、次の状態を目指す。

| 目標 | 内容 |
|---|---|
| Sol Codex消費の削減 | Solを実装作業へ投入する頻度を最小化する |
| 実装速度の確保 | Lunaによって通常作業を高速に処理する |
| 品質の維持 | Sol Chat、Codex側Verifier、CI、人間の確認を重ねる |
| 再現性の向上 | 判断と証拠を会話ではなくGitHubへ残す |
| 属人性の削減 | RP、Plan、handoffの書式を標準化する |
| 自動化への準備 | 後からGitHub ActionsやCodex SDKへ拡張できる形にする |

---

# 2. 設計原則

## 2.1 Solを実装者ではなく判断者として使う

Sol Chatが担当するのは、次の判断である。

- 要求の解釈
- 変更範囲の決定
- アーキテクチャ上の判断
- 受入条件の定義
- テスト方針の決定
- 初期実装モデルの選定
- モデル昇格条件の設定
- PRの独立レビュー
- 修正完了の判定

Sol Chatは、原則として完成コードを大量に作成しない。実装用の断片が必要な場合でも、最終的なリポジトリ編集はCodex側へ任せる。

## 2.2 Lunaを実装者兼現地作業者として使う

Luna Codexは、単なるコード生成モデルではない。

Lunaには、次の仕事を担当させる。

- リポジトリの探索
- 関連ファイルの特定
- 現在のブランチとGit状態の確認
- 実装
- テスト
- lint、型検査、build
- 実行ログの収集
- diffの整理
- handoffの作成
- PRレビュー指摘への修正

## 2.3 Terraを中間エスカレーション先として使う

Lunaでは難しいが、Sol Codexを投入するほどではない作業をTerraへ渡す。

Terraは、主に次の用途で使う。

- 複数モジュールをまたぐ統合作業
- Lunaが調査したが原因を絞れない不具合
- 中規模なリファクタリング
- 既存アーキテクチャの読み解き
- Luna実装に対する独立検証
- 複数の実装案の比較
- テスト戦略の補強

## 2.4 Sol Codexは例外経路として使う

Sol Codexは、実環境の操作と高度な設計判断とを分離できない場合だけ使用する。

代表例は次のとおりである。

- 複雑な並行処理
- 原因が複数層にまたがる障害
- 破壊的なDBマイグレーション
- 認証、権限、セキュリティ
- 大規模なアーキテクチャ変更
- LunaとTerraがともに失敗した問題
- ローカル環境での試行錯誤が設計判断に直結する問題

## 2.5 会話を正式な状態源にしない

ChatGPTとCodexの会話は作業環境であるが、正式な記録ではない。

正式な状態は、次の場所へ残す。

```text
要求             → GitHub Issue / RP
計画             → Issue本文、コメント、docs/plans
実装             → Gitブランチ、commit
変更内容         → diff
検証結果         → PR本文、CI
レビュー結果     → PRレビュー
状態             → Issue、PR、ラベル
最終判断         → 人間によるマージ
```

---

# 3. 役割分担

| 役割 | 主な担当 | してはいけないこと |
|---|---|---|
| 人間 | 要求の承認、権限管理、最終マージ、重大判断 | AIの自己申告だけで本番投入する |
| Sol Chat Planner | 計画、難易度判定、モデル選定 | 実環境を見たつもりになる |
| Luna Codex Worker | 調査、実装、試験、修正 | 不明点を推測で埋める |
| Terra Codex | 中難度実装、統合、独立検証 | 必要以上に変更範囲を広げる |
| Sol Codex | 最高難度の実装・デバッグ | 通常のCRUDや定型修正へ常用する |
| Sol Chat Reviewer | RP、diff、証拠の独立監査 | 実装者の説明を無条件で信用する |
| CI | 機械的な品質判定 | 手動確認が必要な領域まで保証したと扱う |
| GitHub | 状態、差分、証拠、レビューの正本 | チャットだけに情報を残す |

---

# 4. 全体フロー

## 4.1 標準フロー

```text
1. 人間がRPを作成する
2. Sol ChatがRPを分析する
3. 必要ならLunaまたはTerraへ調査だけを依頼する
4. Sol Chatが実装計画を確定する
5. Sol Chatが初期実装モデルを選ぶ
6. Luna Codexがworktreeで作業する
7. Lunaが検証スクリプトを実行する
8. LunaがDraft PRを作成する
9. Codex側Verifierが独立検証する
10. Sol Chat ReviewerがPRをレビューする
11. Lunaが指摘を修正する
12. CIを通す
13. 人間が最終確認する
14. 人間がマージする
```

## 4.2 調査を先行させるフロー

RPだけでは実装計画を作れない場合は、次の流れにする。

```text
RP
  ↓
Sol Chatによる調査指示
  ↓
LunaまたはTerraによる読み取り専用調査
  ↓
調査handoff
  ↓
Sol Chatによる計画確定
  ↓
実装
```

調査役には、原則としてコードを変更させない。

## 4.3 昇格フロー

```text
Lunaが停止条件を検出
  ↓
実装を止める
  ↓
原因、試行内容、未解決点をhandoffする
  ↓
Sol Chatが再評価
  ↓
TerraまたはSol Codexへ引き継ぐ
```

モデルは、同じ問題へ無制限に再試行させない。

---

# 5. 必要なリソース

## 5.1 アカウントとサービス

| リソース | 必須度 | 用途 |
|---|---:|---|
| ChatGPT Plus以上 | 必須 | Sol Chat、Codexの利用 |
| GitHubアカウント | 必須 | リポジトリ、Issue、PR、CI |
| GitHubリポジトリ | 必須 | コードと状態の正本 |
| ChatGPTのGitHub App | 推奨 | Sol Chatがコード、PR、文書を読む |
| GitHub Actions | 推奨 | CI |
| GitHub CLI | 推奨 | PR作成、確認の代替経路 |
| Codex Cloud | 任意 | クラウド上の並列作業 |
| OpenAI API | 初期段階では不要 | 将来の完全自動化 |

## 5.2 ローカルソフトウェア

| ソフトウェア | 用途 |
|---|---|
| Git | branch、commit、push、worktree |
| ChatGPTデスクトップアプリ | Codexのローカル作業 |
| GitHub CLI `gh` | PR作成と操作 |
| 使用言語の実行環境 | Python、Node.jsなど |
| テストツール | pytest、Vitest、Jestなど |
| lint・型検査 | Ruff、ESLint、mypy、TypeScriptなど |
| IDE | 人間による差分確認 |
| PowerShell | Windows環境の統一検証スクリプト |

ChatGPTデスクトップアプリでは、ChatGPTとCodexを選択でき、フォルダを開いて作業できる。Codexのworktree機能は、同じGitリポジトリ内で独立した作業を並行させるために利用できる。citeturn448904view2turn448904view3

---

# 6. Chat側の構成

## 6.1 ChatGPT Projectを二つ作る

同一プロジェクトについて、次の二つのChatGPT Projectを作成する。

```text
<プロジェクト名> - Planning
<プロジェクト名> - Review
```

PlanningとReviewを分離する理由は、レビュー担当が計画時の仮説や自己正当化を引き継ぐことを防ぐためである。

ChatGPT Projectでは、Project-only memoryを選択すると、そのProject内の会話は同じProject内の会話を参照できる一方、Project外の会話や保存済みメモリを参照しない。Project-only memoryは新規Project作成時に設定する。citeturn448904view0

## 6.2 Planning Project

### 目的

Planning Projectでは、Sol Chatが次を担当する。

- RPの整理
- 不明点の分類
- 調査タスクの作成
- 実装計画
- 受入条件
- モデル選定
- 昇格条件
- Luna向けプロンプトの作成

### 保存する資料

| 資料 | 内容 |
|---|---|
| プロジェクト概要 | システムの目的と利用者 |
| アーキテクチャ概要 | フロント、バックエンド、DB、外部連携 |
| `AGENTS.md` | Codexが守る共通規則 |
| RPテンプレート | 要求の入力書式 |
| モデル選定基準 | Luna、Terra、Solの使い分け |
| 用語集 | プロジェクト固有語 |
| 重要な設計判断 | 変更してはいけない前提 |
| 運用制約 | Windows、社内LAN、権限など |

### Planning Project用指示

```markdown
あなたは、このプロジェクトの計画担当兼モデルルーターである。

あなたの主な仕事は、要求を実装可能な計画へ変換し、その作業を担当するCodexモデルを選ぶことである。

原則として、実装コードを直接完成させない。
GitHub上のAGENTS.md、関連コード、既存Issue、関連PRを確認する。
GitHub上に存在しないローカル状態については、確認済みと仮定しない。

出力には次を含める。

1. 要求の要約
2. 非対象
3. 制約
4. 受入条件
5. 変更候補
6. 調査が必要な不確実性
7. 実装手順
8. 検証手順
9. 推奨モデル
10. 昇格条件
11. Lunaへ渡す実行指示

初期モデルは原則としてLunaを選ぶ。
複数の責任境界をまたぐ場合、または不確実性が高い場合はTerraを検討する。
実環境での探索と高度な設計判断とが不可分な場合だけSol Codexを選ぶ。

不明点が残る場合は、推測で計画を完成させず、Codex側の調査タスクを定義する。
```

## 6.3 Review Project

### 目的

Review Projectは、PRを独立して監査する。

Planning Projectの会話をそのまま移さず、レビューに必要な正本だけを渡す。

```text
RP
受入条件
AGENTS.md
対象PR
diff
Evidence Packet
CI結果
```

### Review Project用指示

```markdown
あなたは、このプロジェクトの独立PRレビュー担当である。

実装者、計画担当者、PR本文の説明を正しいと仮定しない。
RP、受入条件、AGENTS.md、現行コード、diff、検証証拠を独立して照合する。

次の順序で確認する。

1. 要求と実装との不一致
2. データ破壊、セキュリティ、権限上の問題
3. 回帰、境界条件、例外処理
4. 変更漏れ
5. テスト不足
6. 保守性
7. 不要な変更

指摘には重大度を付ける。

BLOCKER:
マージしてはいけない問題。

MAJOR:
修正が必要な仕様、回帰、設計上の問題。

MINOR:
修正が望ましいが、マージ判断を妨げない問題。

QUESTION:
証拠または説明が不足している部分。

問題が見つからない場合も、確認した受入条件、確認できなかった項目、残存リスクを明記する。
コードスタイルの好みだけを理由に変更を要求しない。
```

---

# 7. ChatGPTとGitHubとの接続

## 7.1 GitHub Appの役割

ChatGPTのGitHub Appは、Sol ChatがGitHub上のコード、README、文書などを検索し、分析するために使う。

接続は、ChatGPTの`Settings → Apps`からGitHubを選び、GitHub側でChatGPT Appを認可し、アクセス可能なリポジトリを指定する。利用できる画面は契約プランやChatGPTの利用モードによって異なる場合がある。citeturn448904view1

GitHub AppはChat側からの読み取り用途であり、コードやPRのpushには使わない。ChatGPTのGitHub Appからリポジトリへコードをpushすることはできず、編集とpushにはCodexを使用する。citeturn448904view1

## 7.2 接続手順

```text
1. ChatGPTのSettingsを開く
2. Appsを開く
3. GitHubを選ぶ
4. GitHubへログインする
5. ChatGPT Appを認可する
6. 対象リポジトリだけを許可する
7. 必要に応じて同期対象へ指定する
8. Planning Projectから読み取りテストを行う
9. Review ProjectからPR読み取りテストを行う
```

## 7.3 権限原則

Chat側には、必要最小限のリポジトリだけを許可する。

```text
Sol Chat:
読み取りのみ

Codex:
作業ブランチへのpushを許可

main:
直接pushを禁止

merge:
人間だけが実行
```

## 7.4 プラグインとApp

ChatGPTのAppは、外部サービスの検索、参照、操作などを提供する。プラグインは、AppとSkillを組み合わせたワークフロー単位として提供される場合がある。citeturn448904view5

このパイプラインの初期版では、GitHub App以外の独自プラグインは不要である。

---

# 8. Codex側の構成

## 8.1 基本はローカルCodex

次の処理は、ローカルCodexで行う。

- 実装
- ローカルテスト
- Windows固有処理
- 社内LANへの接続
- ローカルPostgreSQLとの接続
- Excel COM
- プリンター操作
- Windowsサービス
- GUIを含む実環境確認

## 8.2 worktreeを標準にする

Codexのworktreeは、同じリポジトリから独立した作業コピーを作り、複数タスクが互いに干渉しないようにする。Codexでは、worktreeと通常のLocal checkoutとの間をHandoffで移動できる。citeturn448904view3

標準タスクでは、次の順序を使う。

```text
1. mainを最新化する
2. CodexでWorktreeを選ぶ
3. mainを開始元にする
4. RPとPlanを渡す
5. Lunaに実装させる
6. 検証する
7. 必要ならLocalへHandoffする
8. branchをpushする
9. Draft PRを作る
```

## 8.3 LocalへHandoffする場面

次の場合は、worktreeからLocalへ移動する。

- 普段のIDEで詳細に確認したい
- 開発サーバーを通常環境で動かしたい
- GUI操作が必要
- Excel COMを実行したい
- プリンターを使いたい
- 社内DBへ接続したい
- ローカルだけの設定が必要

## 8.4 Codex Cloudの使い分け

Codex Cloudは、GitHubリポジトリと再現可能なクラウド環境を接続し、分離された環境で並列タスクを実行できる。結果のsummaryとdiffを確認し、準備ができたらPRを開ける。citeturn448904view4

Codex Cloudへ向く作業は次のとおりである。

| 向く作業 | 向かない作業 |
|---|---|
| 通常のPython実装 | Excel COM |
| Django、React実装 | 社内LAN接続 |
| 単体テスト | ローカルプリンター |
| 文書修正 | Windowsサービス |
| 依存関係更新 | 特殊な端末権限 |
| 複数案の並列試行 | ローカルDBの実データ確認 |

クラウド環境で再現できないものは、無理にクラウドへ持ち込まない。

---

# 9. CodexからPRを送る仕組み

## 9.1 標準手順

Codexで作業した結果は、作業ブランチへcommitし、GitHubへpushして、Draft PRとして提出する。

```text
main
  ↓
codex/<issue-number>-<short-description>
  ↓
commit
  ↓
push
  ↓
Draft PR
  ↓
レビュー
  ↓
修正
  ↓
Ready for review
  ↓
merge
```

## 9.2 ブランチ命名規則

```text
codex/123-add-inspection-export
codex/147-fix-print-permission
codex/201-refactor-event-queue
codex/245-update-manual-links
```

形式は次のとおりである。

```text
codex/<Issue番号>-<短い英語説明>
```

## 9.3 CodexへのPR作成指示

```markdown
このタスクはDraft PRの作成まで担当してください。

次の制約を守ってください。

- mainへ直接pushしない
- mergeしない
- force pushしない
- 作業ブランチ名はcodex/<Issue番号>-<説明>とする
- 実装前にgit statusを確認する
- 変更後に指定された検証スクリプトを実行する
- PR本文には受入条件、検証結果、未確認事項、リスクを記載する
- 確認できなかった項目をPASSとして記載しない
- PRは最初にDraftとして作成する
```

## 9.4 GitHub CLIによるPR作成

アプリ内操作を使わない場合は、GitHub CLIを使用する。

```bash
git switch -c codex/123-add-inspection-export
git add .
git commit -m "Add inspection export"
git push -u origin codex/123-add-inspection-export

gh pr create \
  --draft \
  --base main \
  --head codex/123-add-inspection-export \
  --title "Add inspection export" \
  --body-file handoff.md
```

GitHub CLIでは、`gh pr create`によってタイトル、本文、base、head、reviewer、labelなどを指定してPRを作成できる。citeturn124840search8

## 9.5 Draft PRを使う理由

Draft PRは、作業結果を早い段階でGitHubへ固定するために使う。

Draft PRを作ることで、次の情報が一か所に集まる。

```text
RP
Plan
commit
diff
CI
handoff
レビュー
修正履歴
```

完成するまでローカル会話だけで作業を継続しない。

---

# 10. リポジトリ構成

推奨構成は次のとおりである。

```text
/
├─ AGENTS.md
├─ README.md
├─ .codex/
│  └─ README.md
├─ .github/
│  ├─ ISSUE_TEMPLATE/
│  │  └─ requirement-packet.yml
│  ├─ PULL_REQUEST_TEMPLATE.md
│  └─ workflows/
│     └─ ci.yml
├─ docs/
│  └─ ai/
│     ├─ workflow.md
│     ├─ architecture.md
│     ├─ review-rubric.md
│     ├─ escalation-matrix.md
│     └─ plans/
├─ scripts/
│  ├─ verify.ps1
│  └─ verify.sh
└─ src/
```

## 各ファイルの責任

| ファイル | 責任 |
|---|---|
| `AGENTS.md` | Codexが常に守る規則 |
| `README.md` | 人間向けの基本セットアップ |
| `.codex/` | Codex用の補助設定と説明 |
| `requirement-packet.yml` | RP用Issueフォーム |
| `PULL_REQUEST_TEMPLATE.md` | handoffとEvidence Packet |
| `ci.yml` | 自動検証 |
| `workflow.md` | このパイプラインの運用規則 |
| `architecture.md` | システム構成 |
| `review-rubric.md` | Solレビュー基準 |
| `escalation-matrix.md` | モデル昇格条件 |
| `docs/ai/plans/` | 長期タスクの計画 |
| `verify.ps1` | Windows向け統一検証 |
| `verify.sh` | Linux、クラウド向け統一検証 |

---

# 11. `AGENTS.md`のテンプレート

```markdown
# AGENTS.md

## Repository purpose

このリポジトリは、<システム概要>を管理する。

## Working rules

- mainへ直接commitまたはpushしない。
- すべての変更は作業ブランチとPRを経由する。
- 要求されていないリファクタリングを行わない。
- 外部依存関係を追加する場合は、理由と代替案をPRへ記載する。
- 既存の公開API、DBスキーマ、操作手順を無断で変更しない。
- 不確実な仕様を推測で実装しない。
- ローカル環境固有の結果を一般化しない。

## Required workflow

1. RPと受入条件を読む。
2. git statusを確認する。
3. 関連コードと既存テストを調査する。
4. 変更範囲を確認する。
5. 実装する。
6. テストを追加または更新する。
7. `scripts/verify.ps1`または`verify.sh`を実行する。
8. diffを確認する。
9. handoffを作成する。
10. Draft PRを作成する。

## Testing

Windows:

```powershell
.\scripts\verify.ps1
```

Linux / Cloud:

```bash
./scripts/verify.sh
```

## Stop conditions

次の場合は、推測で進めず作業を停止する。

- RPと現行コードが矛盾している。
- 変更対象が当初計画の2倍以上へ広がった。
- DBスキーマ変更が必要になった。
- 認証または権限設計へ影響する。
- 既存テストの失敗原因を特定できない。
- 本番または共有データを変更する必要がある。
- 必要な環境、secret、権限が存在しない。

停止時は、試行内容、確認済み事項、未解決点、推奨する次のモデルをhandoffする。

## Completion criteria

完了とは、コードを書いた状態ではない。

次をすべて満たした状態を完了とする。

- 受入条件との対応が記載されている。
- 必要なテストが実行されている。
- 実行結果が記録されている。
- 未確認事項が明示されている。
- 不要な変更が含まれていない。
- Draft PRが作成されている。
```

---

# 12. RPテンプレート

RPはRequirement Packetの略とする。

```markdown
# Requirement Packet

## 基本情報

- Issue:
- 作成者:
- 作成日:
- 優先度:
- 希望期限:

## 背景

この変更が必要になった理由を記載する。

## 目的

このタスクによって達成する結果を記載する。

## 現在の挙動

現時点で何が起きているかを記載する。

## 期待する挙動

変更後に何が起きるべきかを記載する。

## 非対象

このタスクでは変更しないものを記載する。

## 制約

- OS:
- ネットワーク:
- DB:
- 外部システム:
- 権限:
- 互換性:
- 追加依存関係:

## 受入条件

- AC-1:
- AC-2:
- AC-3:

## 再現手順

1.
2.
3.

## 関連情報

- 関連Issue:
- 関連PR:
- 関連ファイル:
- ログ:
- スクリーンショット:

## リスク

既知のリスク、壊してはいけない箇所を記載する。

## 未確定事項

判断が必要な点を記載する。
```

---

# 13. Sol Chatが作成するPlanのテンプレート

```markdown
# Implementation Plan

## 1. 要求の理解

RPを一文で要約する。

## 2. 非対象

今回変更しない範囲を記載する。

## 3. 現状認識

関連するコンポーネント、処理フロー、既存制約を記載する。

## 4. 不確実性

| ID | 不確実性 | 確認方法 | 担当 |
|---|---|---|---|
| U-1 |  |  | Luna Scout |
| U-2 |  |  | Terra Scout |

## 5. 変更候補

| ファイル・領域 | 予定変更 | 理由 |
|---|---|---|
|  |  |  |

## 6. 実装手順

### Phase 0: 調査

### Phase 1: 最小実装

### Phase 2: テスト

### Phase 3: 統合確認

## 7. 受入条件との対応

| 受入条件 | 実装 | 検証 |
|---|---|---|
| AC-1 |  |  |
| AC-2 |  |  |

## 8. 検証コマンド

```text
<commands>
```

## 9. 初期モデル

- Model:
- Reason:
- Reasoning level:

## 10. 昇格条件

- Luna → Terra:
- Terra → Sol Codex:

## 11. Codexへの指示

実装者へ渡す完全なプロンプトを記載する。
```

---

# 14. 調査handoffのテンプレート

```markdown
# Scout Handoff

## Repository state

- repository:
- base_commit:
- branch:
- git_status:
- uncommitted_changes:

## Relevant files

| File | Role | Notes |
|---|---|---|
|  |  |  |

## Entry points

処理の開始点と主要な呼び出し関係を記載する。

## Dependency versions

| Dependency | Version |
|---|---|
|  |  |

## Current commands

```text
setup:
test:
lint:
typecheck:
build:
run:
```

## Current failures

再現した失敗と実行コマンドを記載する。

## Runtime constraints

OS、権限、ネットワーク、DB、secretなどを記載する。

## Confirmed facts

確認できた事実だけを記載する。

## Unknowns

確認できなかった事項を記載する。

## Recommendation

実装範囲、推奨モデル、注意事項を記載する。
```

---

# 15. PR・handoff・Evidence Packetテンプレート

`.github/PULL_REQUEST_TEMPLATE.md`へ次を置く。

```markdown
## RP

Closes #

## 担当モデル

- Initial model:
- Final model:
- Escalation:
- Escalation reason:

## 変更目的

このPRが解決する問題を記載する。

## 変更内容

- 
- 
- 

## 非変更範囲

意図的に変更していないものを記載する。

## 受入条件

| ID | 状態 | 証拠 |
|---|---|---|
| AC-1 | PASS / FAIL / NOT VERIFIED |  |
| AC-2 | PASS / FAIL / NOT VERIFIED |  |

## 実行した検証

| Command | Exit code | Result |
|---|---:|---|
|  |  |  |

## Runtime evidence

### Logs

```text
必要なログを記載する。
```

### API responses

```text
必要な応答を記載する。
```

### Database state

実行前後の状態、件数、確認内容を記載する。

### Screenshots

必要なスクリーンショットを添付する。

## 未確認事項

| Item | Reason | Required environment |
|---|---|---|
|  |  |  |

## 既知のリスク

- 
- 

## 回帰可能性

影響する可能性がある機能を記載する。

## Solレビューで重点確認する点

- 
- 

## 実装者による自己レビュー

- [ ] 要求されていない変更を除外した
- [ ] diff全体を読み直した
- [ ] デバッグコードを除去した
- [ ] secretを含めていない
- [ ] テスト結果を実際に確認した
- [ ] 未確認事項をPASSとしていない
```

---

# 16. 検証スクリプト

## 16.1 Windows用PowerShell例

```powershell
$ErrorActionPreference = "Stop"

Write-Host "=== Backend tests ==="
python -m pytest
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "=== Python lint ==="
python -m ruff check .
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "=== Frontend lint ==="
npm --prefix frontend run lint
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "=== Frontend type check ==="
npm --prefix frontend run typecheck
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "=== Frontend build ==="
npm --prefix frontend run build
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Write-Host "=== Verification passed ==="
```

プロジェクトに存在しないコマンドは削除し、実際に使用しているコマンドへ合わせる。

## 16.2 検証原則

検証は、モデルが状況に応じて自由に選ぶだけでは不十分である。

最低限の検証コマンドをリポジトリへ固定し、Codex、CI、人間が同じ入口を使用する。

```text
ローカルCodex → verify.ps1
Codex Cloud   → verify.sh
GitHub CI     → 同等のコマンド
人間          → 必要に応じて同じスクリプト
```

---

# 17. モデル選定基準

## 17.1 Lunaへ渡す作業

次の条件を満たす場合は、原則としてLunaを選ぶ。

- 要求が明確
- 受入条件が明確
- 変更範囲が限定的
- 既存パターンを踏襲できる
- テスト方法が明確
- ファイル数が少ない
- 失敗しても容易に巻き戻せる
- セキュリティや権限へ大きく影響しない

代表例は次のとおりである。

```text
CRUD追加
フォーム修正
API Serializer追加
既存パターンに沿った画面追加
単体テスト追加
型エラー修正
lint修正
文書更新
限定的なリファクタリング
レビュー指摘への修正
```

## 17.2 Terraへ渡す作業

次の条件がある場合は、Terraを検討する。

- 複数モジュールをまたぐ
- フロント、API、DBなど複数層をまたぐ
- 既存設計を読み解く必要がある
- 実装候補が複数ある
- Lunaが一度失敗した
- Lunaの実装を独立して検証したい
- 中規模なリファクタリング
- 統合テストが必要

## 17.3 Sol Codexへ渡す作業

次の場合だけSol Codexを使う。

- LunaとTerraが原因を特定できない
- 設計判断とローカル実験を分離できない
- 認証、認可、セキュリティ
- データ破壊の可能性がある
- 複雑なマイグレーション
- 並行処理や競合状態
- 複数システムをまたぐ障害
- 大規模な責任境界変更
- 本番障害に近い重大問題

---

# 18. 自動昇格条件

## LunaからTerraへ

次のいずれかに該当した場合は、Lunaに作業を続行させない。

```text
変更対象が当初予想の2倍以上になった
3つ以上の責任領域をまたぐ
RPと現行設計が矛盾する
既存テストが理由不明で失敗する
2回修正しても同じ受入条件を満たせない
実装方式が複数あり、局所判断で選択できない
大規模な既存コードの読み解きが必要
DBスキーマ変更が必要になった
```

## TerraからSol Codexへ

```text
Terraでも根本原因を特定できない
認証または権限設計が関係する
破壊的マイグレーションが必要
並行処理、ロック、競合が関係する
複数サービス間の不整合がある
本番固有の状態を再現しながら設計判断する必要がある
修正による影響範囲を限定できない
```

## 昇格時の必須handoff

```markdown
## Escalation Handoff

- Current model:
- Recommended next model:
- Original objective:
- Completed work:
- Commands executed:
- Observed results:
- Failed approaches:
- Confirmed facts:
- Remaining hypotheses:
- Modified files:
- Uncommitted changes:
- Risks:
- Exact reason for escalation:
```

---

# 19. Sol ChatがCodex上で動けないことによる問題と対策

## 19.1 リポジトリ状態とのずれ

### 問題

Sol Chatは、未コミット変更、ローカルDB、環境変数、実行中サービス、Windows権限などを直接確認できない。

### 対策

計画前にLunaまたはTerraへ調査タスクを渡し、base commit、branch、git status、依存関係、テスト結果、環境制約を報告させる。

## 19.2 仮説をその場で実験できない

### 問題

Sol Chatは、コード検索、テスト実行、最小試作を自分で行いながら計画を更新できない。

### 対策

Planへ調査Phaseと判断Gateを入れる。

```text
Phase 0: 仮説検証
Gate A: 結果Aなら方式A
Gate B: 結果Bなら方式B
その他: 実装せずhandoff
```

## 19.3 diffだけでは実行結果が分からない

### 問題

diffからは、Windows固有挙動、DB状態、印刷結果、GUI崩れなどを判断できない。

### 対策

PRへEvidence Packetを必須化する。

## 19.4 Lunaが自分の実装を自分で評価する

### 問題

実装時の誤解を検証時にも引き継ぐ可能性がある。

### 対策

別のLunaまたはTerraを読み取り専用Verifierとして使う。Verifierには修正させず、RPと受入条件から独立して検証させる。

## 19.5 handoffで判断理由が失われる

### 問題

採用しなかった案、変更禁止領域、一時的な仮説が要約から抜ける。

### 対策

要求、制約、受入条件、不確実性へIDを付ける。

```text
R-1: Requirement
C-1: Constraint
AC-1: Acceptance Criterion
U-1: Unknown
K-1: Known limitation
```

PRではIDごとの対応状態を記載する。

## 19.6 モデル難易度を誤判定する

### 問題

RPだけを見ると、実際のコード上の難易度が分からない。

### 対策

初期判定を暫定とし、Codex側へ停止条件と昇格条件を与える。

## 19.7 人間が単純なコピー係になる

### 問題

ChatとCodexとの間の転記が増える。

### 対策

GitHub IssueとPRを状態の正本にし、Solが介入する回数を原則として次の三回へ限定する。

```text
計画時
エスカレーション時
最終レビュー時
```

---

# 20. Codex側Verifier

## 20.1 目的

Verifierは、実装者の説明を信用せず、RPと受入条件から独立して検証する。

## 20.2 推奨モデル

通常は別Lunaでよい。

次の場合はTerraを使う。

- 複数層をまたぐ
- 実装者がLunaで何度も修正した
- 回帰範囲が広い
- 統合試験が必要
- Windows固有処理がある

## 20.3 Verifier用プロンプト

```markdown
このPRを独立して検証してください。

実装者の説明や自己評価を正しいと仮定しないでください。
RP、受入条件、AGENTS.md、diff、現行コードを確認してください。

コードは変更しないでください。

次を報告してください。

1. 受入条件ごとのPASS、FAIL、NOT VERIFIED
2. 仕様との不一致
3. 回帰可能性
4. 境界条件
5. テスト不足
6. 実装者が確認していない領域
7. Sol Chat Reviewerが重点確認すべき点
8. マージを止めるべき問題

可能な範囲でテストを実行し、コマンドとexit codeを記録してください。
```

---

# 21. GitHub CI

## 21.1 最低限のCI

CIでは、少なくとも次を実行する。

```text
バックエンドテスト
フロントエンドテスト
lint
型検査
build
マイグレーション整合性確認
```

## 21.2 CIの役割

CIは、SolやLunaから独立した判定器である。

ただし、CIが成功しても次の事項は保証されない。

```text
要件どおりである
UIが使いやすい
Windows COMが動く
印刷結果が正しい
権限設定が正しい
本番データで安全である
```

CIは必要条件であり、十分条件ではない。

---

# 22. ブランチ保護

`main`または主要ブランチには、次の保護を設定する。

```text
PRなしの変更を禁止
直接pushを禁止
CI成功を必須化
未解決レビューコメントがある場合のmergeを禁止
force pushを禁止
branch削除を制限
人間の承認を最低1件要求
可能なら最新commitへの承認を要求
```

GitHubのbranch protectionでは、PRレビュー、status check、会話解決などをmerge条件として設定できる。必須status checkを設定すると、そのcheckが成功するまでPRをmergeできない。citeturn124840search0turn124840search1turn124840search6

Codexには作業ブランチへのpushを許可しても、主要ブランチへ直接入れられない構造にする。

---

# 23. Windows・Excel COM・社内LAN固有の運用

## 23.1 ローカル確認が必要な項目

次の処理は、Codex CloudやGitHub CIだけでは検証できない可能性が高い。

```text
Excel COM
Word COM
PDF出力
プリンター
Windowsサービス
共有フォルダ
社内LAN
ローカルPostgreSQL
ドメインユーザー権限
対話セッション依存処理
```

## 23.2 Evidence Packetへ残す項目

```text
実行したWindowsユーザー
実行端末
OSバージョン
使用したExcelバージョン
サービス実行ユーザー
対象ファイル
フォルダ権限
COM起動結果
出力ファイルのパス
印刷キューの状態
DB接続先
実行日時
```

## 23.3 実環境確認の原則

ローカル固有の作業では、次を区別する。

```text
コード上確認済み
ローカル開発端末で確認済み
社内テスト環境で確認済み
本番相当環境で確認済み
未確認
```

「手元で動いた」を「本番で動く」と扱わない。

---

# 24. 状態管理

IssueまたはPRには、次の状態ラベルを設定する。

```text
READY_FOR_PLAN
PLANNING
NEEDS_SCOUT
READY_FOR_IMPLEMENTATION
IMPLEMENTING
NEEDS_ESCALATION
READY_FOR_LOCAL_REVIEW
READY_FOR_SOL_REVIEW
CHANGES_REQUESTED
READY_TO_MERGE
BLOCKED
MERGED
```

基本遷移は次のとおりである。

```text
READY_FOR_PLAN
  ↓
PLANNING
  ↓
READY_FOR_IMPLEMENTATION
  ↓
IMPLEMENTING
  ↓
READY_FOR_LOCAL_REVIEW
  ↓
READY_FOR_SOL_REVIEW
  ↓
CHANGES_REQUESTED または READY_TO_MERGE
  ↓
MERGED
```

エスカレーション時は、`NEEDS_ESCALATION`へ移す。

---

# 25. 日常運用手順

## 25.1 人間

```text
1. RP Issueを作る
2. Planning ProjectのSolへIssueを渡す
3. PlanをIssueへ保存する
4. CodexでLunaタスクを開始する
5. Draft PRが作成されたことを確認する
6. Verifierを実行する
7. Review ProjectのSolへPRを渡す
8. 指摘をLunaへ戻す
9. CIとEvidence Packetを確認する
10. マージする
```

## 25.2 Sol Chat Planner

```text
RPを読む
関連GitHub情報を読む
不確実性を列挙する
必要ならScoutを要求する
Planを作る
モデルを選ぶ
昇格条件を定義する
Codex向け指示を作る
```

## 25.3 Luna Worker

```text
Git状態を確認する
Planを読む
関連コードを調査する
必要最小限の変更を行う
テストを追加する
検証スクリプトを実行する
diffを確認する
Evidence Packetを作る
Draft PRを作る
```

## 25.4 Sol Chat Reviewer

```text
RPを読む
受入条件を読む
PRとdiffを読む
Evidence Packetを読む
現行コードと照合する
BLOCKER、MAJOR、MINOR、QUESTIONを出す
未確認事項を整理する
```

---

# 26. 失敗時の切り分け

## 計画が間違っていた

```text
実装を止める
Planを修正する
既存変更を保持するか破棄するか判断する
必要なら新しいworktreeを作る
```

## Lunaが変更範囲を広げすぎた

```text
不要な変更を分離する
PRを小さくする
必要ならcommitを分割する
Terraへ再評価を依頼する
```

## テストが通らない

```text
新規変更による失敗か確認する
mainでも失敗するか確認する
環境依存か確認する
再現コマンドをhandoffする
原因不明なら昇格する
```

## SolレビューとCodex結果が矛盾する

```text
事実確認が必要な点を抽出する
LunaまたはTerraへ限定的な検証を依頼する
ログと実行結果をSolへ戻す
議論ではなく証拠で解決する
```

## PRが大きすぎる

```text
機能変更
リファクタリング
テスト整備
文書更新
```

これらを可能な限り別PRへ分割する。

## Windows環境だけで失敗する

```text
実行ユーザー
環境変数
権限
パス
サービスセッション
COM登録
32bit / 64bit
ネットワークドライブ
```

この順序で確認する。

---

# 27. 導入ロードマップ

## Phase 1：半手動の最小構成

最初に導入する。

```text
Planning Project
Review Project
GitHub App
Codexローカル環境
AGENTS.md
RPテンプレート
PRテンプレート
verify.ps1
Draft PR運用
```

この段階では、人間がPlanをCodexへ渡し、PRをSol Reviewへ渡す。

## Phase 2：品質ゲート

次を追加する。

```text
GitHub Actions
branch protection
状態ラベル
Codex側Verifier
モデル昇格規則
```

## Phase 3：運用の省力化

次を追加する。

```text
Issueフォーム
PR自動ラベル
テンプレート検証
CI結果の集約
自動レビュートリガー
```

## Phase 4：高度な自動化

必要性が確認できてから導入する。

```text
Codex GitHub Action
独自Skill
独自Plugin
MCP
Codex SDK
タスクルーター
自動モデル選定
```

最初からPhase 4へ進めない。

運用上の欠陥が残った状態で自動化すると、欠陥まで高速に再現される。

---

# 28. 開始時チェックリスト

## ChatGPT

- [ ] Planning Projectを新規作成した
- [ ] Planning ProjectをProject-only memoryにした
- [ ] Review Projectを新規作成した
- [ ] Review ProjectをProject-only memoryにした
- [ ] Planning用指示を設定した
- [ ] Review用指示を設定した
- [ ] GitHub Appを接続した
- [ ] 対象リポジトリだけを許可した
- [ ] Sol Chatからコードを読めることを確認した
- [ ] Sol ChatからPRを読めることを確認した

## GitHub

- [ ] リポジトリを作成した
- [ ] mainを設定した
- [ ] branch protectionを設定した
- [ ] PR必須化を設定した
- [ ] CI必須化を設定した
- [ ] force pushを禁止した
- [ ] 人間の承認を要求した
- [ ] RP Issueフォームを追加した
- [ ] PRテンプレートを追加した
- [ ] 状態ラベルを作成した

## Codex

- [ ] ローカルリポジトリを開ける
- [ ] GitHubへpushできる
- [ ] worktreeを作成できる
- [ ] Lunaを選択できる
- [ ] Terraへ切り替えられる
- [ ] Sol Codexへ切り替えられる
- [ ] HandoffでLocalへ移動できる
- [ ] テストコマンドを実行できる
- [ ] Draft PRを作成できる

## リポジトリ

- [ ] `AGENTS.md`がある
- [ ] `docs/ai/workflow.md`がある
- [ ] `docs/ai/architecture.md`がある
- [ ] `review-rubric.md`がある
- [ ] `escalation-matrix.md`がある
- [ ] `verify.ps1`が動く
- [ ] `verify.sh`が動く
- [ ] CIとローカル検証が一致している
- [ ] secretがリポジトリへ含まれていない

## 最初の試験運用

- [ ] 小さな変更を一つ選んだ
- [ ] RPを作った
- [ ] SolがPlanを作った
- [ ] Lunaが実装した
- [ ] Draft PRを作った
- [ ] Verifierを実行した
- [ ] Sol Reviewを実行した
- [ ] Lunaが修正した
- [ ] CIが成功した
- [ ] 人間がマージした
- [ ] 運用上の不足を記録した

---

# 29. 運用指標

このパイプラインが機能しているかを、次の指標で確認する。

| 指標 | 意味 |
|---|---|
| Luna完遂率 | Lunaだけで完了した割合 |
| Terra昇格率 | LunaからTerraへ上げた割合 |
| Sol Codex昇格率 | Sol Codexが必要になった割合 |
| Sol Review指摘率 | Solが有効な問題を見つけた割合 |
| CI失敗率 | PR作成後にCIで失敗した割合 |
| 再修正回数 | レビュー後の修正往復数 |
| PRサイズ | 変更行数、ファイル数 |
| NOT VERIFIED数 | 実環境確認できなかった項目 |
| 人間差戻し率 | AI工程通過後に人間が差し戻した割合 |
| マージ後不具合率 | マージ後に発生した回帰 |

目安として、Sol Codex昇格率が高すぎる場合は、Lunaの能力不足だけでなく、RP、Plan、検証環境、タスク分割を見直す。

---

# 30. 責任分界

## Sol Chatが保証するもの

```text
要求が整理されている
実装計画が論理的である
モデル選定に理由がある
レビュー観点が網羅されている
```

Sol Chatは、実環境で動くことを直接保証しない。

## Codex Workerが保証するもの

```text
指示された変更を実際に行った
指定コマンドを実際に実行した
結果を正確に報告した
未確認事項を明記した
```

Codex Workerは、要求解釈そのものの正しさを単独では保証しない。

## Verifierが保証するもの

```text
実装者から独立した観点で確認した
受入条件を検証した
証拠不足を指摘した
```

Verifierは、本番環境で確認していない事項を保証しない。

## CIが保証するもの

```text
定義された自動チェックを通過した
```

CIは、定義されていない要件を保証しない。

## 人間が保証するもの

```text
要求そのものが正しい
残存リスクを受け入れられる
本番へ入れてよい
マージしてよい
```

最終責任は人間が持つ。

---

# 31. 最終原則

このパイプラインでは、モデルの性能だけで品質を作らない。

品質は、次の組み合わせによって作る。

```text
明確なRP
＋
実行可能なPlan
＋
限定されたdiff
＋
再現可能なテスト
＋
Evidence Packet
＋
独立レビュー
＋
CI
＋
人間の最終判断
```

Sol Chatは頭脳であり、Codex側のモデルは現場の目と手である。

Lunaは通常作業を担当する。Terraは統合と中難度問題を担当する。Sol Codexは、実環境を直接操作しなければ解けない難題だけを担当する。

RP、Plan、diff、handoffをGitHubへ残すことで、ChatとCodexとの間にあるコンテキストの分断を補う。

この運用において重要なのは、Sol Codexを一度も使わないことではない。

**Sol Codexを使うべき問題と、使わなくてもよい問題とを正しく分離することが、最も重要である。**

---

# 付録A：最小運用セット

最初の試験運用では、次だけを準備すればよい。

```text
ChatGPT Planning Project
ChatGPT Review Project
GitHub App
Codexローカル環境
GitHubリポジトリ
AGENTS.md
RP Issue
PRテンプレート
verify.ps1
GitHub Actions
branch protection
```

独自Plugin、MCP、Codex SDK、専用オーケストレーターは不要である。

---

# 付録B：標準的な一回分の流れ

```text
人間:
Issue #123としてRPを作成する。

Sol Chat:
RPを分析し、Luna向けPlanを作成する。

Luna Codex:
codex/123-feature-name worktreeで実装する。
verify.ps1を実行する。
Draft PRを作成する。

Terra Verifier:
PRを読み取り専用で検証する。
Evidence Packetを補強する。

Sol Chat Reviewer:
RP、diff、証拠を比較する。
BLOCKER、MAJOR、MINOR、QUESTIONを出す。

Luna Codex:
レビュー指摘を修正する。
検証を再実行する。

CI:
自動チェックを実行する。

人間:
Evidence Packet、レビュー、CIを確認する。
問題がなければマージする。
```

---

# 付録C：運用開始後に更新する項目

この文書は固定規則ではなく、実運用に合わせて更新する。

特に、次を継続的に更新する。

```text
Lunaが失敗しやすいタスク
Terraへ上げるべき条件
Sol Codexが必要だった事例
見落とされたテスト
Windows固有の注意点
プロジェクト固有の禁止事項
有効だったレビュー観点
不要だった工程
```

更新内容は、原則として`AGENTS.md`、`workflow.md`、`escalation-matrix.md`、`review-rubric.md`へ反映する。