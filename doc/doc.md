# Remotion 社内マニュアル動画制作システム — カスタム仕様書

## 1. この文書の位置づけ

本書（`doc/doc.md`）は、Remotion を中核とする動画自動制作システムを、職場の社内マニュアル動画作成用にカスタマイズした要求・機能・ユーザー体験・製品仕様の正本である。

現在の正本は次の 2 文書に固定する。

- 本書（`doc/doc.md`）: 要求、目的、機能、ユーザー体験、制作フロー、利用者から見た挙動
- [`implementation-spec.md`](./implementation-spec.md): データモデル、API、保存、validation、アーキテクチャ、実装詳細

要求・目的・利用者から見た挙動は本書を優先し、実装の具体的詳細は `implementation-spec.md` を正本とする。実装詳細が要求と矛盾する場合は、実装仕様を更新して整合させる。`doc/legacy/` 配下は履歴資料であり、新規実装の仕様根拠または実装順序の根拠には使用しない。legacy 文書と現在の正本が矛盾する場合は、現在の正本を採用する。

本書は MVP 完了後の現行仕様を記述する。本文中の MVP は完了済みの現行ベースラインまたは、その範囲に対する将来拡張を指し、未実装の施工計画を意味しない。

### 1.1 Issue #87 による台本工程の更新

Issue #87 以降の台本工程は、台本・キャラクタービジュアル・音声を別々の承認工程として扱わず、`/projects/${projectId}/script` を中心とする一体型の台本画面で編集する。`project.json` は引き続き唯一の制作データの正本である。

Issue #89 以降、キャラクター素材を追加・更新する「キャラクタービジュアル」登録機能は、プロジェクト制作画面とは別のワークスペース共通ライブラリとして扱う。登録画面は `/character-visuals` に置き、プロジェクト固有の台本・ビジュアル割り当て・`project.json` へ登録一覧を埋め込まない。

- 構成案だけは、台本の初期化と現在の制作コンテキストの前提として、承認済みかつ元資料に対して最新であることを要求する。
- 台本承認とビジュアル承認は制作フローのゲートにしない。キャラクタービジュアルはセリフカードから人間が明示選択し、セリフごとに音声を生成・調整できるようにする。現場素材用の Asset Search / generic `VisualAssignment` は機能・データとして維持する。CV-04 / CV-05 が除去した legacy right pane UI は標準 `/script` に戻さず、必要な機能は別画面または補助導線で扱う。ただし、VP-03 の line-card media cue pane は現行標準 `/script` の責務である。
- `Script.status` と `VisualPlan.status` の `draft`、`needs_review`、`approved` は既存データとの互換性、stale 判定、レビュー結果の表示に残してよいが、人間の承認操作を次工程の前提にしない。
- プレビュー、`RenderManifest` 生成、MP4 レンダリングは、承認済みかどうかではなく、保存済みデータに対する validation が実行条件を満たす場合だけ実行する。台本、音声、素材参照、assignment 範囲、checksum、ハッシュ、Manifest の整合性エラーは validation の警告・エラーとして表示する。

- 対象は、業務手順、社内システムの操作方法、定型作業などを説明する日本語の社内マニュアル動画とする。
- IT 技術系の一般向け解説、ショート動画、多言語展開、外部公開を目的とした機能は対象外とする。
- 本システムは個人利用とし、第三者へ配布可能な製品形態にはしない。
- 動画および制作システムを社外へ公開する運用は想定しない。
- WebUI は企画、構成案、台本、編集、出力のワークフローに沿った画面構成とし、Markdown 入力、構成案の生成または手入力、人力台本編集、素材ライブラリ検索、ビジュアル割り当てを扱う。ワークスペース共通のキャラクタービジュアル登録・更新は、台本画面から分離したライブラリ画面で扱う。

### 1.2 Issue #97 によるキャラクタービジュアル選択の更新

Issue #97（CV-04）では、キャラクタービジュアルの選択を AI 候補・素材検索・右ペイン中心の導線から、人間が明示的に選択するセリフカード中心の導線へ変更した。この方針は CV-05（Issue #98）で実装済みである。`/projects/{projectId}/script` はセクションとセリフカードを中心とする 1 ペイン構成を標準とし、CV-05 が除去した legacy right pane にあった「現在の編集対象」「制作 ビジュアル候補」「AI によるビジュアル候補 UI」「手順3-3 素材検索」「素材検索結果」「素材制作・表示設定カード」は標準台本画面に置かない。

これは UI の主要導線を変更する仕様であり、機能・データの廃止を意味しない。AI visual suggestion の backend、現場動画・写真・帳票用 Asset Search、generic `VisualAssignment`、およびそれらのデータは維持する。これらは人間の選択を補助する副次機能または別ドメインの機能として扱い、キャラクタービジュアル選択の標準経路にはしない。

キャラクターごとの VOICEVOX 話者と `CharacterVisualSet` の binding、および各セリフの physical variant 参照は project-specific な制作データとして `project.json` に保存する。`CharacterVisualSet` と登録済み visual / variant / file metadata の正本は引き続き workspace SQLite とし、SQLite に project ID や `mentor` / `learner` の紐づけを追加しない。`visualId === characterId` という暗黙対応も採用しない。

CV-04 はこの責務分離を3文書で確定し、CV-05（Issue #98）で schema、migration、API、UI、compiler、Remotion への実装を完了した。現在の仕様は、この実装済みの責務分離を前提とする。

### 1.3 Issue #107 による編集フェーズの追加

Issue #107（ED-00）では、MVP 完了後のワークフローを `企画 → 構成案 → 台本 → 編集 → 出力 validation → RenderManifest → プレビュー / MP4` として定義する。`/projects/{projectId}/script` は台本画面として維持し、編集専用画面 `/projects/{projectId}/edit` を台本の後ろに追加する。

編集フェーズの正本は `VideoProject 1.2.0` の `edit: EditPlan` とする。登録済み Asset だけを選択し、intro / outro / cutin の動画要素とセクション BGM を編集する。既存の `AudioPlan.sectionBgms` と `InsertPlan` を拡張して新機能を載せず、後続の ED-01 で `EditPlan` への明示的な migration を実装する。

- intro / outro / cutin は `video` Asset の MP4、BGM は `bgm` Asset の MP3 だけを使用する。
- `/script` のセクション順は台本を正本とし、編集画面では変更しない。編集画面で drag & drop できるのは追加した動画要素カードだけとする。
- 編集素材は workspace SQLite に登録済みで、選択・差し替え時点で `active` な Asset の currentVersion から選ぶ。選択後は project snapshot 方式で `assetId`、`assetVersion`、`assetChecksum`、`projectMediaPath` を固定し、OS path や任意ファイルを直接指定しない。AssetVersion の `version` / `checksum` は snapshot では `assetVersion` / `assetChecksum` と記録する。
- すべての動画と BGM は `0 <= volume <= 1` を持つ。generic `VideoDisplay.muted` の `true → 0`、`false → 1` 変換は ED-01 の `1.1.0 → 1.2.0` schema migration の責務とし、ED-07 は変換後の `volume` を利用する側だけを扱う。
- 既存 `RenderManifest 2.2.0` の generic video display は `muted: boolean` の legacy schema として凍結し、`VideoProject 1.2.0` の `VideoDisplay` と runtime schema を共有しない。ED-01 は 1.2.0 project の `volume` を既存 2.2.0 compiler / render 経路へ渡す compatibility adapter も実装し、`0 → muted: true`、`1 → muted: false` と変換する。2.2.0 が表現できない 0 / 1 以外の値は丸めず、ED-08 の 2.3.0 経路が必要な validation error とする。
- 旧 BGM は ED-01 で `edit.sectionBgms` へ復元せず、sectionId・旧 path・旧 volume を `projects/{projectId}/logs/migration-log.jsonl` へ永続化する。再登録または再選択でのみ `EditPlan` へ設定する。

ED-00 は本書と `implementation-spec.md` だけを更新し、コード、schema、migration、API、UI、compiler、Remotion は変更しない。ED-01〜ED-09 の実装境界は 17.17 に履歴として定義する。ED-00 で定義した編集フェーズの実装基準は、当時の `VideoProject 1.2.0` / `RenderManifest 2.3.0` である。

Issue #129（ST-00）は当時の基準へ ScreenTemplate を追加する仕様改訂であり、`VideoProject 1.3.0` / `RenderManifest 2.4.0` への version bump は ST-03 / ST-06 の実装で行った。ED-01〜ED-09、ST-01〜ST-08 は履歴として保持し、現在の SW-00〜SW-03 の境界と混在させない。

### 1.4 Issue #129 / ST-00 による画面テンプレート方針の更新（履歴）

Issue #129（ST-00）から #145（ST-08）までの ScreenTemplate 方針は、固定配置、workspace SQLite の template catalog、geometry validation、preview / production の共通 resolver、canonical default reset を履歴として確定・実装した。これらの Issue で定義された当時の line-level override は、現在仕様では Issue #147 により廃止する。過去の Issue 本文、`doc/legacy/`、および 17.18 の実装境界は履歴として保持し、現在の正本文書の適用規則は次節と 5.1.2 以降を参照する。

### 1.5 Issue #147 / SW-00 による台本画面・section-only template・差分 preview の更新

Issue #147（SW-00）は docs-only の仕様改訂である。`doc/doc.md` と `implementation-spec.md` だけを更新し、コード、Zod schema、migration、API、React UI、compiler、Remotion、テストコードは変更しない。#148（SW-01）の migration 完了後に main が保持する project baseline は `VideoProject 1.4.0` であり、現行の解決済み manifest baseline は `RenderManifest 2.4.0` である。`RenderManifest 2.4.0` の line / visual 解決 shape は互換境界として維持し、SW-00 の当時の `1.3.0` input は legacy input として扱う。

SW-00 で定めた product target は section-only ScreenTemplate である。`VideoProject 1.3.0` の line override は #148 の `1.3.0 → 1.4.0` migration で削除し、現在は `ScriptSection.screenTemplateId` を唯一の正本としている。section の明示参照が missing / inactive でも別 template へ自動代替せず、section header から active template を選び直す修正対象として表示し、出力 validation では error とする。表示素材の pause / resume を含む新しい resolved render contract の version boundary は、SW-00 の `RenderManifest 2.5.0` target という記述を #151（VP-02）の定義へ引き継ぎ、`RenderManifest 2.4.0` の意味を変更しない。

SW-02 の `1.4.0` target `/projects/{projectId}/script` は、情報密度を上げた compact line card を標準とする。通常表示は本文 3 行と操作 1 行の計 4 行で構成する。1 行目は line ID、speaker selector、character physical variant、音声再生、音声再生成、音声調整を置く。2 行目は `subtitleText`、3 行目は読み上げ用の `spokenText` / よみがなを置き、両方とも通常時は compact な 1 行表示とする。4 行目は上へ移動、下へ移動、複製、削除を置く。本文の選択・編集時だけ入力領域を expand し、編集終了後は compact 表示へ戻す。音声調整の詳細は card 内へ常時展開せず modal / dialog に置く。

SW-03 の target preview では、line card の左側に全 line のフル 16:9 preview を常時表示しない。section の先頭 line、section 境界で template または background が変わる line、generic visual の persistent canvas state（show / hide / play / pause / resume / end など）が変化する line、表示設定がその境界から変化する line では full screen preview を表示する。それ以外の line は dialogue / subtitle 領域だけを確認できる compact preview とする。`subtitleText`、`spokenText` / よみがな、speaker、character physical variant、voice parameter、音声の current / stale state だけの変化は full preview の trigger にしない。

preview の表示モードは React component 内の前後比較へ閉じ込めず、`persistentScreenState(line N - 1) != persistentScreenState(line N)` を決定論的に評価する pure helper / read model として定義する。full preview と compact preview は同じ ScreenTemplate resolver / layout component の解決結果を使い、compact preview 専用の geometry や CSS 座標を再実装しない。generic `VisualAssignment` 自体は維持し、`VideoProject 1.4.0` では line template override 廃止を理由に section 内の template 境界で segment 化しない。表示素材の cue による state boundary は #151 の `PersistentScreenState` 解決へ統合する。

line-level の `persistentScreenState(line N)` は `line N` の `from` にある最初の presentation frame、つまり直前 line の AFTER と当該 line の BEFORE を含む、その boundary の全 event を適用した直後で sample する。line AFTER や line 中央 frame では sample しないため、source-end boundary が line N の途中にあっても line N の preview state は開始時の state のままとする。assignment が次の line まで続く場合は line N+1 の BEFORE sample が `ended` と last drawable source frame を初めて反映し、line N+1 を full-preview trigger とする。次の line がなく end AFTER で assignment が終了する場合、mid-line natural end は独立した line-level trigger にはしないが、frame-level render は ended segment を保持する。source-end boundary が line BEFORE と一致する場合は source-end → ended → cue validation 後の state をその line の sample とする。

SW-01〜SW-03 は #148〜#150 の実装境界として、`VideoProject 1.3.0 → 1.4.0` の line override removal、compact ScriptPage、section-only selector、change-only full preview を扱った。1.4.0 migration は section の `screenTemplateId` を authority として維持し、section の分割や多数決による template 変更を行わず、削除した override を migration log へ記録する。表示素材の pause / resume cue は #151（VP-00）で仕様を確定し、VP-01 / VP-02 で実装する。

### 1.6 Issue #151 / VP-00 による表示素材 cue の正本仕様

Issue #151（VP-00）は docs-only の仕様改訂である。更新対象は `doc/doc.md` と `implementation-spec.md` だけであり、コード、Zod schema、migration、API、React UI、compiler、Remotion、テストコードは変更しない。#148 完了後の基準は `VideoProject 1.4.0` / `RenderManifest 2.4.0` とし、2.4.0 の既存意味を変更せずに、次の表示素材仕様を後続実装の正本として追加する。

既存の generic `VisualAssignment`、Asset Search、asset snapshot、`startLineId` / `endLineId`、display 設定、compiler / Remotion の既存 pipeline は維持する。写真・帳票・動画を新しい media entity へ置き換えず、今回追加するのは video の line-boundary pause / resume cue だけとする。

```ts
type VisualPlaybackCue = {
  lineId: string;
  edge: "before" | "after";
  action: "pause" | "resume";
};

type VideoDisplayWithPlaybackCues = VideoDisplay & {
  kind: "video";
  playbackCues: VisualPlaybackCue[];
};
```

実装時の field 名は schema の既存命名に合わせて調整してよいが、cue の意味はこの shape へ固定する。cue は video display だけが持ち、photo / `document_scan` は持たない。

VP-02 の resolved video display は、`playbackState: "playing" | "paused" | "ended"` を discriminant とする。`playing` branch は既存の `sourceTrimBeforeFrame` / `sourceTrimAfterFrame` を持ち、`sourceTrimAfterFrame > sourceTrimBeforeFrame` の invariant を維持する。`paused` branch は一点の `sourceFrame` だけを持ち、source trim の before / after pair を出力しない。`ended` branch も一点の `sourceFrame` を持つが、`sourceEndFrame` は `sourceTrimAfterFrame` と同じ exclusive endpoint なので、最終描画可能 frame を表す `lastDrawableSourceFrame = sourceEndFrame - 1`（整数 frame 契約）を保持する。assignment の presentation duration が source duration を超えること自体は validation error にせず、playing source position が `sourceEndFrame` に到達または超過した最初の presentation frame boundary で、cue より先に implicit source-end → ended へ遷移し、`lastDrawableSourceFrame` を assignment の end AFTER まで保持する。ended state では pause / resume cue を無効とする。`RenderVisualV25` の video segment は start BEFORE から end AFTER までの visible interval だけを保存するため、video の `hidden` は segment state にせず、`static-visible` は photo / `document_scan` branch だけで使用する。ScriptPage / `PersistentScreenState` の lifecycle read model が `hidden` / `ended` / `static-visible` を扱うことは妨げない。

- `startLineId` / `endLineId` は同一 section 内の inclusive range とし、`startLineId` の line 開始境界 BEFORE で表示・video 再生を開始し、`endLineId` の line 終了境界 AFTER で表示・video を終了する。end line の発話と `pauseAfterMs` は表示区間に含める。
- cue の `lineId` は assignment range 内でなければならず、range 外は validation error とする。`pause` は playing state、`resume` は paused state でだけ有効とし、ended state ではどちらも無効とする。同じ line / edge の相反 cue を複数保存しない。
- cue の解決順は project array の偶然の順序に依存せず、line order と `edge`（BEFORE → line presentation → AFTER）の deterministic order で決める。同じ boundary に implicit event と cue がある場合、`startLineId` BEFORE は implicit play → cue、source end 到達 boundary は implicit source-end → ended → cue validation、`endLineId` AFTER は cue → implicit hide / end の順で適用する。これにより start BEFORE の `pause` は play 後の pause として有効になり、source end 到達後の pause / resume は invalid になり、state が一致しない cue や no-op / redundant cue は validation error になる。最初の play と最終の hide / end は cue として保存せず、それぞれ range の開始・終了から暗黙に導出する。
- 台本 card の既定操作は、再生開始 = selected line の BEFORE、再開 = selected line の BEFORE、一時停止 = selected line の BEFORE、終了 = selected line の AFTER とする。UI の再生開始（再起動）は `startLineId` を更新し、終了は `endLineId` を更新する。再開 / 一時停止は `VisualPlaybackCue` の resume / pause だけで表し、cue に play / end action は追加しない。line 内の任意 millisecond cue は対象外とする。
- paused presentation interval は pause 境界時点の source frame を保持し、source media time と video 内音声を進めない。line speech、BGM、sound effect など video 以外の audio layer は通常どおり進める。resume は同じ source position の次から再開し、`playbackRate` は playing interval のみへ適用する。
- video の source position は composition 経過時間ではなく、assignment 開始後の playing presentation frames の累積で決める。概念的には `sourcePosition = sourceStart + sum(playingPresentationFrames) * playbackRate` とし、paused frames を加算しない。`sourceEndFrame` は `sourceTrimAfterFrame` と同じ exclusive endpoint であり、assignment の表示時間が source duration を超える場合も表示区間自体は validation error にせず、source end 到達後は `ended` + `sourceFrame = lastDrawableSourceFrame`（整数 frame なら `sourceEndFrame - 1`）で最終描画 frame を保持する。ended の `sourceFrame` は `sourceFrame < sourceEndFrame` を満たし、playing / paused の fractional source position と exclusive endpoint を混同しない。既存 `startMs` / `endMs` の trim、fractional frame、end 到達時の generic behavior は変更しない。
- photo / `document_scan` は start BEFORE で static media を表示し、end AFTER で非表示にする。表示中は同じ page / crop / fit / position / annotation を保持する。スライド相当素材も既存 `photo` / `document_scan` で表現できる範囲を使い、dedicated slide kind は追加しない。
- generic visual の overlap / priority semantics は変更しない。cue を理由に compositing、z-order editor、複数 video の同時表示を追加しない。

後続 version boundary は明示的に分ける。VP-01 は `VideoProject 1.4.0 → 1.5.0` を導入し、既存 video assignment の `playbackCues` を `[]` として migration する。VP-02 は pause / resume と natural source end を解決済み render contract へ追加するため `RenderManifest 2.5.0` を導入し、`RenderManifest 2.4.0` の parser、cache、run log の意味を変更しない。2.5.0 では cue を resolved media state へ固定し、playing branch は source trim pair、paused / ended branch は一点の `sourceFrame` を持つ。preview と Remotion は同じ結果を使う。

現行 `/projects/{projectId}/script` では、VP-03（#154）が #149 の compact line card の右側へ media pane を実装済みであり、assignment / asset title / kind、lifecycle state（hidden / playing / paused / ended / static-visible）、表示・再生開始、一時停止、再開、終了、asset 選択・差し替え導線を表示する。これは UI の read model であり、V25 の serialized video segment state は playing / paused / ended に限定する。source end 到達後は lifecycle を `ended` として表示するが、source frame / time の詳細は表示せず、pause / resume 操作も提供しない。操作可否は resolved state から決め、不正な cue sequence をユーザーに作らせない。#150 の `PersistentScreenState` へは action 名を直接渡さず、cue と source-end を解決した media state を渡し、前 line と state が異なる場合だけ full preview trigger とする。

対象外は line 内任意 millisecond cue、waveform / NLE timeline、reverse playback、scrubbing keyframe、video transition、speed keyframe、automatic slide / AI slide generation、dedicated presentation parser である。Asset library CRUD UI は VP-03 の ScriptPage media pane（VP-00〜VP-02 の cue semantics を表示する UI）には含めず、次節の Issue #155（AL-00）で `/assets` のワークスペース管理画面として別に定義する。

### 1.6.1 Issue #171 による ScriptPage の右ペイン境界

本書で「右ペイン」と記述する場合、CV-05 が除去した旧 UI と、#154 で追加された現行 UI を混同しない。

- **Legacy CV-05 right pane（標準 ScriptPage から削除済み）**: 「現在の編集対象」「制作 ビジュアル候補」「AI によるビジュアル候補 UI」「手順3-3 素材検索」「素材検索結果」「素材制作・表示設定カード」からなる旧導線。これらは標準 `/projects/{projectId}/script` に復活させない。generic Asset Search、AI suggestion、`VisualAssignment` の backend・保存データを維持することや、別画面・補助導線を提供することは、この旧 pane の復活を意味しない。
- **VP-03 line-card media cue pane（現行標準 UI／実装済み）**: Issue #154 で追加された compact line card 右側の pane。current generic `VisualAssignment`、active な managed Asset の選択、video playback state、pause / resume / end cue 操作、asset replacement を扱う。Asset picker からの明示的な選択・差し替えは選択 `assetVersion` を含む mutation として扱い、同じ stable `assetId` でも選択 version の checksum / `projectMediaPath` を project snapshot へ反映する。cue 編集や表示変更だけで live Asset の current version へ自動 upgrade はしない。

`VP-00〜VP-02` は表示素材 cue、resolver、render contract の共有仕様を定義し、`VP-03` はそれを ScriptPage の line-card UI へ接続する実装境界である。VP-00〜VP-02 の後段説明にある「後続」「追加する」は、仕様作成時点の設計・実装境界を示す履歴であり、現行実装で VP-03 が存在しないという意味ではない。将来 target として読むべき記述は、target / 後続実装であることを明示した箇所に限る。

### 1.7 Issue #155 / AL-00 による素材ライブラリ管理の正本仕様

Issue #155（AL-00）は docs-only の仕様改訂である。更新対象は `doc/doc.md` と `implementation-spec.md` だけであり、コード、Zod schema、SQLite migration、API、React UI、worker、compiler、Remotion、テストコードはこの Issue では変更しない。現行実装に存在する `GET /api/assets`、`POST /api/assets`、`GET /api/assets/{assetId}`、managed media / thumbnail read は後続の管理機能からも利用する。

`/assets` は、閲覧専用画面から workspace 共通の Asset 管理画面へ拡張する。キャラクタービジュアルの `/character-visuals`、ScreenTemplate の `/screen-templates`、プロジェクト固有の `/projects/{projectId}/script` / `/edit` とは別の管理境界とする。通常の `/assets` では次の全 kind を同じ画面で扱う。

```text
video
bgm
photo
document_scan
sound_effect
```

kind ごとの既存の extension / MIME / 実ファイル形式 / upload limit / technical metadata validation は維持する。動画を台本へ割り当てる場合も、専用 uploader や別の動画ライブラリを作らず、この共通 Asset library の `video` を使用する。現行 `AssetsPage` が表示していない `bgm` と `sound_effect` も管理対象・表示対象に含める。

通常の「削除」は物理削除ではなく、UI 上の名称を「利用停止」とした soft delete とする。`active → inactive`、`inactive → active` の状態変更を行い、DB row、managed media、thumbnail、version history は通常 UI から削除しない。`inactive` Asset は新規の Asset picker / Asset Search candidate から除外する。ただし既存 project が `assetId`、`assetVersion`、`assetChecksum`、`projectMediaPath` を snapshot 済みの場合、その project の参照や出力を自動変更・破壊しない。physical purge、orphan file GC、storage cleanup は別の破壊的 maintenance 機能として将来検討し、AL-00 の UI には含めない。

metadata edit では同じ `assetId` のまま次を編集できる。

- `title`
- `description`
- `confidentiality`
- `department`
- `system`
- `tagIds`

`kind` は metadata edit で変更しない。checksum、size、duration、width、height、page count、declared / detected MIME、extension、thumbnail path など file-derived technical metadata は手入力で編集させず、登録・処理結果だけを表示する。kind を変えたい場合は別 Asset として登録する。tag dictionary 自体の CRUD は AL-00 の対象外とし、picker に必要な active dictionary の read endpoint が不足する場合だけ後続 backend Issue で最小限追加する。

Asset 本体には ScreenTemplate と同じ stale-write 防止の `revision` を持たせる。metadata update、利用停止、再有効化、successful version activation は `expectedRevision` を検証し、成功時だけ revision を増やす。古い revision の mutation は conflict として拒否し、別 tab の変更を silent last-write-wins で上書きしない。

「現在利用する version」は version number の最大値や row の偶然の並び順から推測しない。概念的には次の identity と status を持つ。

```ts
type Asset = {
  assetId: string;
  revision: number;
  currentVersion: number | null;
  kind: "video" | "bgm" | "photo" | "document_scan" | "sound_effect";
  // editable metadata and current Asset status
};

type AssetVersion = {
  assetId: string;
  version: number;
  status: "processing" | "ready" | "error";
  baseRevision: number;
  baseCurrentVersion: number | null;
  stagingPath: string | null;
  // managed file, checksum, thumbnail, and technical metadata
};
```

initial upload の処理中は `currentVersion = null` でもよい。v1 の検証・thumbnail・technical metadata 処理が成功した時だけ、同じ SQLite transaction で `currentVersion = 1` と Asset `active`、AssetVersion `ready` を確定する。既存 Asset の file replacement は同じ `assetId` の次 version を candidate として追加する。v2 が `processing` または `error` の間は current v1 と Asset 本体の `active` / `inactive` を維持し、検証済み metadata と managed file が揃った時だけ v2 の `ready` 化と `currentVersion = 2` への切替を同じ transaction で commit する。新規 candidate が ready だが non-current の状態を永続化せず、transaction rollback / process crash では candidate を `processing` のまま再び worker の対象にする。revision conflict は同じ transaction で candidate を `error` にし、旧 current version と history は保持する。inactive Asset の replacement が成功しても、利用停止状態を自動で active に戻さない。

非同期処理の work item は Asset 本体ではなく `AssetVersion.status = "processing"` の `(assetId, version)` として列挙する。initial upload では Asset 本体を `processing` としてよいが、これは初期登録中であることを表す状態に限定し、worker の探索条件にはしない。したがって Asset が `active` または `inactive` のままでも、その AssetVersion が `processing` の replacement candidate は worker の対象となる。worker / processing service は親 Asset の status だけを理由に candidate を `skipped` にせず、candidate 自身がまだ `processing` かを確認する。

`/replace` の受付 transaction では、request の `expectedRevision` が一致した時点の Asset `revision`、`currentVersion`、`StagedUploadRecord.fileRelativePath` を、それぞれ candidate の `baseRevision`、`baseCurrentVersion`、`stagingPath` へ保存する。directory locator の `stagingRelativePath` は使用せず、`stagingPath` は staged file の staging root 相対 locator（例: `staging/{uploadId}/upload.bin`）である。worker は再起動後も HTTP request のメモリ状態なしに staged file を解決する。処理済み metadata と managed file が揃った後、worker は finalization transaction 内で base 値を比較し、candidate を `ready`、current version 切替、revision increment、`stagingPath = null` を一度に commit する。照合に失敗した場合は同じ transaction で candidate を `error`（`REPLACEMENT_REVISION_CONFLICT`）にし、旧 current version と Asset status を維持する。candidate の自動再 activation は行わず、再試行は新しい `/replace` として新しい base 値を取得する。

activation transaction の rollback / commit 前の process crash では candidate は `processing` と persisted `stagingPath` のまま残り、worker が再列挙して retry する。staging file の物理削除は成功 commit 後にだけ行い、cleanup 失敗は orphan として診断する。replacement の次 version number の確保と AssetVersion insert は同一 write transaction で行う。`MAX(version) + 1` を transaction の外で計算してはならず、`(assetId, version)` の unique conflict が発生した場合は transaction 全体を再実行する。

後続実装の API boundary は次のとおりとする。

```text
POST /api/assets                         create / initial multipart upload
GET  /api/assets                         list / search / filter / paging
GET  /api/assets/{assetId}               detail / current version / history
PUT  /api/assets/{assetId}               metadata update (expectedRevision)
POST /api/assets/{assetId}/replace       new version multipart upload
POST /api/assets/{assetId}/deactivate    soft delete (expectedRevision)
POST /api/assets/{assetId}/activate      reactivate (expectedRevision)
```

通常管理 API として `DELETE /api/assets/{assetId}` は追加しない。replace は Asset kind を変更せず、検証・処理失敗時は candidate version の error と履歴を残し、current version を変更しない。Asset detail では current version と各 version の processing / ready / error、error detail を確認できるようにする。

後続の `/assets` UX は、素材追加、全 kind の一覧・keyword search・tag / kind / department / system / status filter・paging、detail / thumbnail / technical metadata 表示、metadata 編集、file 差し替え、利用停止、再有効化、initial processing/error、replacement processing/error の表示を提供する。replacement candidate の状態と Asset 本体の active / inactive を混同せず、処理中・失敗中も旧 current version を表示する。

library の更新は project snapshot の更新ではない。新しい project または Asset picker での再選択だけが、その時点の active current version を `assetVersion` として snapshot する。既存 project の `assetVersion`、`assetChecksum`、`projectMediaPath` は library の metadata edit、利用停止、version replacement で自動変更しない。この責務境界は generic `VisualAssignment` と EditPlan の双方に適用する。

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
- 画面構成の再利用可能な定義は `ScreenTemplate` とし、正本を workspace SQLite に置く。テンプレートの実在一覧を TypeScript の静的配列へ複製せず、`project.json` には catalog ではなく section の選択参照だけを保存する。
- ScreenTemplate は 1920 × 1080 の 16:9 canvas、正規化された `x` / `y` / `width` / `height`、rotation、dialogue window、section title、`speaker-1` / `speaker-2` の character visual、`primary` content slot を持つ。初期版の element type と cardinality は固定し、任意 component editor へ広げない。
- `screen-template-standard` は既存の固定配置を互換 seed として表し、section-title だけは画面上端の要件から追加する canonical geometry を含む stable ID であり、workspace SQLite へ idempotent に保存する。project は section ごとにこの ID または別の明示 template ID を参照し、mutable な workspace default だけに依存しない。
- 現行 `VideoProject 1.4.0` の project-specific な template selection は section の `screenTemplateId` だけを保存し、同じ section 内の全 line の template authority とする。`1.3.0` は line override を持つ legacy input として migration でだけ扱う。いずれの version でも missing / inactive な明示参照を別 template へ自動代替しない。
- 利用可能なキャラクタービジュアルの登録済み visual / variant / file metadata の正本は、ワークスペース共通 SQLite の `CharacterVisualSet` とする。`project.json` へ catalog 一覧や登録ファイルを埋め込まず、project-specific な選択参照だけを保存する。
- `CharacterVisualSet` の workspace SQLite は visual をプロジェクトや `mentor` / `learner` へ紐付けない。`visualId === characterId` を前提にせず、binding のない character は「未設定」として扱う。
- `characterVariantCatalog` という TypeScript 型または catalog snapshot は、SQLite のレコードを型付け・検証・コンパイラ入力へ渡すために残してよいが、実在する登録項目を二重管理する静的な正本にはしない。
- キャラクタービジュアルのファイル本体は `library/character-visuals/{visualId}/{variantId}/` 以下へ保存する。新規登録ファイルを `public/` へ直接保存せず、WebUI の画像表示は Fastify の管理された配信経路を使う。
- `RenderManifest` は、`project.json`、バックエンドが解決したキャラクタービジュアル情報、音声などから生成する特定レンダリング向けの解決済み派生データであり、制作データや素材カタログの正本にはしない。コンパイラと Remotion は SQLite を直接参照しない。
- 現行 `RenderManifest 2.4.0` は compile 時の template snapshot、revision / hash、resolved layout、geometry / transform、font size、`flipX`、content slot を保持し、現行 parser が検証する line / visual resolved shape を維持する。VP-02 の `RenderManifest 2.5.0` では section resolved layout を正本として、video の resolved pause / resume / natural source end state を追加する。video は `playing` branch の source trim pair、`paused` branch の source end 前の一点 `sourceFrame`、または `ended` branch の `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を持ち、`sourceEndFrame` は exclusive endpoint として別に扱う。2.4.0 の意味を変更せず、WebUI preview と Remotion は各 version の同じ resolved layout と resolved visual display を描画する。
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
- 現行 `VideoProject 1.4.0` の section ごとの `screenTemplateId`。`1.3.0` の nullable line-level `screenTemplateId` は migration input にだけ存在し、1.4.0 では保存しない。
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
│  ├─ screenTemplateId
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
│  └─ soundEffects
├─ edit
│  ├─ videoElements[]
│  └─ sectionBgms[]
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

`VideoProject 1.4.0` は人間と WebUI が編集する制作データの正本であり、音声長、開始フレーム、終了フレームなど、素材と設定から再計算できる値は含めない。構成案の承認は初期化と制作コンテキストの前提として残すが、台本・ビジュアル・音声の status はレビューと stale を表す互換状態である。編集フェーズの正本は `edit: EditPlan` とし、旧 `audio.sectionBgms` と `inserts` は legacy input として migration でだけ扱う。`characters[].visualAssets` は旧 `1.0.0` プロジェクトを読み込むための互換フィールドとして意図的に残すが、CV-05 で導入済みの `characterVisual` binding や物理素材の正本とは別物である。確認画面と素材検証はこの互換フィールドを物理素材の正本として使用しない。`VideoProject 1.3.0` は line-level ScreenTemplate override を持つ legacy input であり、#148 の migration で 1.4.0 の section-only shape へ変換する。

#### 5.1.1 ScreenTemplate の概念モデル

現行 main の `VideoProject 1.4.0` / `RenderManifest 2.4.0` は ScreenTemplate を使用する。ScreenTemplate の定義は workspace SQLite に保存し、次の TypeScript 型は DB レコードの検証済み view model として使用する。`VideoProject 1.2.0` / `RenderManifest 2.3.0` からの導入経緯と `1.3.0` line override は 17.18 と implementation-spec の 24 章に履歴として残す。

```ts
type ScreenTemplate = {
  templateId: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  canvasWidth: 1920;
  canvasHeight: 1080;
  revision: number;
  elements: ScreenTemplateElement[];
  createdAt: string;
  updatedAt: string;
};

type CanvasContainedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CharacterOverflowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ScreenTransform<TRect> = {
  rect: TRect;
  rotationDeg: number;
};

type ScreenTemplateElementBase<TRect> = {
  elementId: string;
  transform: ScreenTransform<TRect>;
};

type ScreenTemplateElement =
  | (ScreenTemplateElementBase<CanvasContainedRect> & {
      type: "dialogue-window";
      fontSize: number;
    })
  | (ScreenTemplateElementBase<CanvasContainedRect> & {
      type: "section-title";
      fontSize: number;
    })
  | (ScreenTemplateElementBase<CharacterOverflowRect> & {
      type: "character-visual";
      slot: "speaker-1" | "speaker-2";
      flipX: boolean;
    })
  | (ScreenTemplateElementBase<CanvasContainedRect> & {
      type: "content-slot";
      slot: "primary";
    });
```

`elements` は初期版では `dialogue-window` 1 件、`section-title` 1 件、`character-visual` 2 件、`content-slot` 1 件を必ず持つ。2 つの character element は `speaker-1` と `speaker-2` を重複なく持ち、content slot の slot は `primary` とする。固定要素の追加・削除や任意の HTML / React component は許可しない。

`dialogue-window`、`section-title`、`content-slot` の `CanvasContainedRect` は、`x`、`y`、`width`、`height` が 0..1 の有限な正規化値で、`width` と `height` は正、矩形と中心回転後の外接範囲が正規化 canvas の範囲内に収まるよう検証する。`character-visual` の `CharacterOverflowRect` は `x` / `y` を有限値（負値や 1 超を含む）、`width` / `height` を有限かつ正の値（1 超を含む）として許可する。character は rect または中心回転後の外接範囲が canvas と部分的に交差していれば valid であり、回転後の visual bounds が canvas と全く交差しない場合だけ validation error とする。`rotationDeg` は有限値、`fontSize` は有限かつ `> 0` として検証する。rotation は rect の中心を回転中心（pixel canvas 上の `transform-origin: 50% 50%`）とし、別の transform origin は保存しない。正規化 geometry は 1920 × 1080 へ解決してから WebUI と Remotion が共通利用し、最終的な character pixels は composition の canvas 境界で clip する。

element の責務は次のとおりである。

- `dialogue-window`: 移動、拡大・縮小、回転、font size を持つ。背景、文字色、font family、行間などの既存 token は維持する。
- `section-title`: 移動、拡大・縮小、回転、font size を持つ。現行 Remotion に対応 layer がないため、standard template の値は ST-01 が画面上端の要件から新規 canonical geometry として確定する。
- `character-visual`: 移動、拡大・縮小、回転、`flipX` を持つ。画面外への部分的な overflow を許可するが、完全に画面外へ消える配置は許可しない。物理 PNG、variant、CharacterVisualSet は参照せず、speaker slot だけを表す。resolver は `speaker-1` / `speaker-2` を project character の配列先頭2件へ対応付け、resolved layout へ `characterId` を固定する。
- `content-slot`: 移動、拡大・縮小、回転を持つ。generic `VisualAssignment` はこの outer slot 内へ表示し、素材側の crop / fit / scale / position は inner transform として適用する。

template の geometry を先に解決し、その後に generic assignment の inner transform を content slot 内へ適用する。`display.prioritizeVisual` は互換表示ポリシーとして最後に適用できるが、template の element geometry を上書きしたり、固定座標へ戻したりしてはならない。初期版では適用後の character の縮小結果だけを resolved layout として manifest へ固定し、非表示は対象外とする。

`screen-template-standard` は、既存 layer については現在の Remotion / CSS / layout constants を調査して得た標準見た目を表す stable ID である。section-title だけは現行コードに描画 layer がないため、doc.md の「画面上端」という要件から ST-01 が新規 canonical geometry を確定し、その rect / rotation / font size / 根拠を seed / migration と仕様へ記録する。この値は現行実値の抽出結果とは区別し、後から変更する場合は template revision / hash を更新する。workspace SQLite の seed / migration は idempotent に実行し、既存 project の移行時は各 section へこの ID を明示保存する。workspace に mutable な default template 設定を追加して、project の参照を省略する方式は採用しない。

#### 5.1.1.1 Issue #145 / ST-08 の geometry と default reset

ST-08 では、element type ごとの bounds policy を現在仕様として確定する。現行 SQLite の `REAL` columns は overflow を保持できるが、既存 `screen_template_elements_geometry_check` が全 element に canvas containment を要求するため、character-visual の保存にはこの constraint semantics を変更する database migration を ST-08 のスコープ内で追加する。

実装順は、最初に本書と `doc/implementation-spec.md` へ SQLite constraint semantics、migration の既存データ扱い、非 character 要素の互換制約、version 非変更を反映し、その後に SQLite schema / migration、Zod / domain、editor、compiler、preview / render の順で進める。新しい serialized field や project / manifest の version boundary は追加しない。

```text
dialogue-window  -> canvas-contained
section-title    -> canvas-contained
content-slot     -> canvas-contained
character-visual -> partial overflow allowed / fully off-canvas forbidden
```

`character-visual` の drag、resize、keyboard 移動、数値入力は canvas edge を理由に `x` / `y` / size を clamp しない。editor の interaction layer（selection outline、handles、pointer hit area）は canvas 外へ出た character を再調整できるよう render preview layer と分離し、render preview、line-card preview、Web preview、Remotion は 1920 × 1080 の composition 境界で同じ pixels を clip する。compiler、resolved layout、`RenderManifest 2.4.0` は valid な overflow geometry を 0..1 へ戻さず、`prioritizeVisual` 適用後も同じ座標系を保持する。

SQLite の `screen_template_elements_geometry_check` は、全 element に対して finite な x / y / width / height / rotation と正の width / height を残し、`character-visual` の branch だけは x / y の負値・1 超と width / height の 1 超を許可する。`dialogue-window`、`section-title`、`content-slot` の branch には従来の `x >= 0`、`y >= 0`、`x + width <= 1`、`y + height <= 1` を残す。回転後 AABB の交差判定と完全 off-canvas 判定は DB constraint ではなく application validation の責務とする。既存 rows は numeric values、order、config、metadata を変更せずに新 constraint へ移行し、migration の標準 backup / atomicity 手順を使用する。targeted test では既存 DB の migration、character overflow の保存・再読込、非 character overflow の拒否を検証する。

ScreenTemplate editor の template-level action に「デフォルトに戻す」を 1 つだけ置く。この操作は template を削除・再 seed せず、既存の revision-aware complete-template update を使って、dialogue-window、section-title、2 つの character-visual、primary content-slot の編集可能な rect、rotation、font size、`flipX` を canonical default へ一括復元する。template ID、name、description、status、createdAt、preview 素材・サンプル文字列などの一時 state は変更しない。default の唯一の参照元は `src/app/screen-templates/screen-template-seed.ts` の immutable な standard seed/default definition とし、mutable な SQLite の `screen-template-standard` row や UI の重複定数から読み取らない。revision、content hash、stale 判定、expectedRevision conflict は通常の update と同じ経路を通る。

ST-01 の `screen-template-standard` seed は次の値を canonical とする。`dialogue-window` は現行 `SubtitleLayer` の safe area（左右・上下 60px）を `x: 0.03125`、`y: 0.05555555555555555`、`width: 0.9375`、`height: 0.8888888888888888`、`rotationDeg: 0`、`fontSize: 38` として保存する。`content-slot` は現行 `MediaFrame` の 82% × 62% を `x: 0.09`、`y: 0.19`、`width: 0.82`、`height: 0.62`、`rotationDeg: 0` とする。`character-visual` は現行 `characterLayerStyle` の左右 4% inset、width 25%、height 48%、通常表示時の bottom 124px を使い、speaker-1 を `x: 0.04`、speaker-2 を `x: 0.71`、両方を `y: 0.4051851851851852`、`width: 0.25`、`height: 0.48`、`rotationDeg: 0`、`flipX: false` とする。

現行 composition に存在しない `section-title` は、上端に常時確保する新規 canonical top band として `x: 0.05`、`y: 0.03`、`width: 0.9`、`height: 0.1`、`rotationDeg: 0`、`fontSize: 48` とする。これは既存コードからの抽出値でも目測値でもなく、5% の左右 inset、3% の上 inset、10% の上端領域、既存字幕本文 38px より一段上の 48px という ST-01 の設計定数である。これらの seed 値は `src/app/screen-templates/screen-template-seed.ts` に記録し、SQLite に同じ ID が存在する場合は geometry、metadata、status を上書きしない。

既存 `VisualAssignment.display` は、ST-03 の `1.2.0 → 1.3.0` migration で導入した `displayCoordinateSpace: "legacy-media-frame" | "content-slot-relative"` を現行 `VideoProject 1.4.0` でも維持する。既存値は `legacy-media-frame` として扱い、legacy adapter は canvas-relative な `position`、82% × 62% の frame 全体へ適用する `scale`、`crop` / `fit` / annotation を変換せず、legacy mode では slot の再センタリング・clamp・追加 clipping を行わない。`content-slot-relative` への変換は人間の明示操作とし、推測変換や表現不能な overflow の隠蔽は行わない。

#### 5.1.2 section / line への適用

現行実装の `VideoProject 1.4.0` では、`script.sections[]` に `screenTemplateId: string` を保存し、section 内の全 line がそれを使う。`VideoProject 1.3.0` の `ScriptLine.screenTemplateId: string | null` は migration input にだけ存在する。新規 section は `screen-template-standard` または人間が選択した active template を持ち、新規 line は template field を持たない。

`1.3.0` compatibility input の当時の解決規則は次のとおりである。現行 `1.4.0` では line override を保存せず、section の `screenTemplateId` だけを使う。

```text
line.screenTemplateId ?? section.screenTemplateId
  → line に適用する ScreenTemplate
```

line または section から明示された template が missing / inactive の場合は、編集中に validation と修正導線を表示し、別 template へ自動代替しない。出力 validation では error とし、未解決の layout を持つ `RenderManifest 2.4.0` を生成しない。workspace SQLite には project / section / line の適用関係を保存せず、project JSON の section / line 参照を正本とする。

`VideoProject 1.3.0 → 1.4.0` migration は #148 で完了している。既存 line の nullable override field を削除する際も、section を分割したり、line override の多数決で section template を変更したりせず、section の `screenTemplateId` を authority として維持する。削除した override は `lineId`、old template ID、section template ID、`migrationId` を project migration log に記録する。VP-01 の `1.4.0 → 1.5.0` migration はこの section-only shape を保持したまま video `playbackCues` だけを追加する。

1.3.0 の line field を削除・置換する migration は #148 で project schema 1.4.0 へ反映したが、現行 compiler は `RenderManifest 2.4.0` を維持する。VP-02 で `RenderManifest 2.5.0` を導入する際に、2.4.0 cache / run log の意味を変えず、同一 section 内の line template 差分を理由に `VisualAssignment` を新たに segment 化せず、section 境界または #151 の persistent media state boundary を使う。

この migration の型境界でも `visuals` を旧 `VisualPlan` のまま継承しない。`VideoProjectV13.visuals` は `VisualPlanV13` とし、`VisualPlanV13.assignments` は `VisualAssignmentV13[]` とする。これにより既存 assignment へ付与する `legacy-media-frame` と、新規または明示変換済み assignment の `content-slot-relative` が、strict schema、migration、ST-05 resolver で同じ V13 契約として検証される。

CV-05 で実装した概念モデルでは、各 character が次の project-specific binding を持つ。選択の正本を `project.json` に置く責務は変更しない。

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

既存の 2 キャラクター、6 variant、10 PNG は DB へ idempotent に seed / migration 済みである。移行後のメタデータ正本は SQLite だけとし、実在する登録項目を TypeScript ソースへ二重管理しない。TypeScript には `CharacterVisualSet` の型、検証用の純粋な catalog snapshot 型、解決済み入力型だけを残してよい。

新規登録ファイルは `library/character-visuals/{visualId}/{variantId}/` 以下へ保存し、`public/` へ直接保存しない。画像表示は Fastify の管理された配信経路を使用する。

レンダリング前には、バックエンドが SQLite から現在の `CharacterVisualCatalogSnapshot` を取得して検証し、`project.json` に保存された visual binding と line の `characterVariantId` を照合したうえでタイムラインコンパイラへ渡す。コンパイラは明示参照と検証済み snapshot、音声などを入力として Remotion へ渡す派生データ `RenderManifest` を生成する。コンパイラと Remotion は SQLite を直接検索しない。expression、tag、label から物理 variant を自動解決・代替しない。

```text
RenderManifest（`2.3.0` 互換履歴）
├─ manifestVersion
├─ compilerInputHash
├─ characterCatalogVersion
├─ characterMappingVersion（互換メタデータ）
├─ characters[]
├─ characterVariants[]
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
│  ├─ expression（論理表情）
│  └─ characterVariantId（明示選択）
├─ visuals[]
│  ├─ id
│  ├─ from
│  ├─ durationInFrames
│  ├─ kind
│  ├─ src
│  └─ display
├─ inserts[]
│  ├─ role: intro | outro | cutin
│  ├─ from
│  ├─ durationInFrames
│  ├─ src
│  └─ volume
└─ backgrounds[]
   ├─ sectionId
   ├─ from
   ├─ durationInFrames
   └─ background
```

`RenderManifest` は生成キャッシュであり、制作データの正本にはしない。正本 JSON、参照素材、出力設定のいずれかが変わった場合は再生成する。

既存 `RenderManifest 2.2.0` の generic video は `muted` を持つ意味を維持する。`VideoProject 1.2.0` の `volume` をこの経路へ渡す場合は、ED-01で導入する adapter を通し、assignment の display をそのまま legacy manifest へ渡さない。ED-08で `RenderManifest 2.3.0` に移行した後は、generic video の任意 `volume` を現行 manifest と Remotion の正本経路へ流せる。ED-07 はその既存経路へ UI / API の保存導線を追加する後続 Issueであり、ED-08 前の2.2.0経路では 0 / 1 以外を保存可能なUIを公開しない。

現行のキャラクター素材解決では、次の情報を `RenderManifest 2.4.0` へ固定する。登録機能とレンダリング解決は分離し、コンパイラが検証済み snapshot から派生データを生成する。実動画挿入、BGM の最終セクション範囲、section 単位の ScreenTemplate resolved layout も同じ派生マニフェストへ解決する。`RenderManifest 2.3.0` は ST-06 以前の履歴・互換境界として扱う。

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

解決済み snapshot の版または更新時点、variant 単位の版管理、manifest の互換性は実装仕様に従って管理する。missing、inactive、cross-visual、ファイルスロット欠落時は validation error とし、自動代替しない。

#### 5.1.3 RenderManifest 2.4.0 / 2.5.0 の resolved layout と media state

現行実装の `RenderManifest 2.4.0` は、compile 時に検証した section template snapshot と、その snapshot から得た layout を `sectionLayouts[]` に固定する。同時に `lines[]` へ line ごとの `screenTemplateId`、`templateRevision`、`templateHash`、`resolvedLayout` を保存し、`visuals[]` の各 segment にも `screenTemplateId`、template revision / hash を保存する。これは現行 parser / cache / run log が検証する V24 serialized contract であり、`VideoProject 1.3.0` line override の legacy input を描画時に再解決しないための互換境界でもある。

`VideoProject 1.3.0 → 1.4.0` の line override removal は #148 で完了したが、現行 compiler / cache の manifest は `RenderManifest 2.4.0` のまま維持する。VP-02 で `RenderManifest 2.5.0` を導入する際に、section-only input と表示素材の resolved pause / resume / natural source end state を新しい serialized contract へ追加する。V25 の video display は `playing` branch の source trim pair、`paused` branch の source end 前の一点 `sourceFrame`、または `ended` branch の `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を discriminated union で表現し、`sourceEndFrame` は exclusive endpoint として別に扱う。paused / ended segment に trim pair を要求しない。`RenderManifest 2.4.0` は旧 input と共に compatibility boundary として保持し、2.4.0 cache を 2.5.0 として解釈し直したり、同じ `manifestVersion` のまま field の意味だけを変更したりしない。

generic visual は `RenderManifestV24` で `visuals` 自体を override し、`RenderVisualV24.display` に解決済みの `outerFrame`、content slot を表す `contentClip`、`fit`、`crop`、annotation を保存する。`outerFrame` は display の coordinate space を解決した後の canvas-relative geometry、`contentClip` は同じ primary content slot の geometry と clipping の適用状態である。`position` / `scale` と `displayCoordinateSpace` は raw 値として V24 display に残さず、Remotion はこの最終値だけを使って描画する。

1 つの `VisualAssignment` が複数 line または複数 section にまたがる場合、現行 `RenderVisualV24` の分割単位には section 境界、現行 compatibility shape が必要とする template 境界、または #151 の persistent media state boundary が含まれる。各 segment は `sourceAssignmentId`、決定論的な segment ID、segment 順序、開始・終了 line ID、対象 template の snapshot、`from` / `durationInFrames`、resolved display を持つ。VP-02 の `RenderVisualV25` では line template override を新しい分割理由にせず、section 境界、`PersistentScreenState` / cue boundary、または natural source end の source-end boundary を使う。source end 到達後の `ended` segment は `lastDrawableSourceFrame` を assignment の end AFTER まで保持する。segment ID と partition は各 manifest version の `compilerInputHash` に含める。

動画 segment の `startMs` / `endMs` は元の VisualAssignment の media range を provenance / compatibility data として各 segment へそのまま保持する。V24 と V25 の `playing` segment で Remotion が使用する authoritative source range は `sourceTrimBeforeFrame` / `sourceTrimAfterFrame` であり、`sourceTrimAfterFrame` は exclusive endpoint なので、その値自体を終端 frame として描画しない。fractional frame を保持して整数 millisecond への round-trip を行わない。V25 の `paused` segment と natural source end 後の `ended` segment は一点の `sourceFrame` を持ち、trim pair を出力しない。`sourceTrimAfterFrame > sourceTrimBeforeFrame` は V24 と V25 の `playing` branch にだけ適用する。assignment の presentation duration が source duration を超える場合も assignment 自体は invalid にせず、playing source position が `sourceEndFrame` に到達または超過した最初の presentation frame boundary で `playing` を `ended` へ遷移させる。例えば元の `startMs: 5000`、`playbackRate: 1`、assignment 開始から 2 秒後の template 切替なら、後続 `playing` segment の `startMs` は 5000 のまま、`sourceTrimBeforeFrame` は 7000ms 相当の source position から継続する。pause 直後の `paused` segment は同じ位置を `sourceFrame` として保持し、source end 後の `ended` segment は `lastDrawableSourceFrame`（整数 frame なら `sourceEndFrame - 1`）を end AFTER まで保持する。`from` / `durationInFrames` は intro / outro / cutin の shift 後の最終 timeline で確定する。

VP-01 / VP-02 の video source position は composition の経過時間から再計算しない。assignment 開始後の playing presentation frames だけを累積し、`sourcePosition = sourceStart + sum(playingPresentationFrames) * playbackRate` とする。`playing` segment はその累積から trim pair を解決し、`paused` segment は pause 境界の一点を `sourceFrame` として保持する。playing source position が `sourceEndFrame` に到達または超過した最初の presentation frame boundary は `source-end boundary` として segment を分け、その後は `ended` segment の `sourceFrame = lastDrawableSourceFrame`（整数 frame なら `sourceEndFrame - 1`）を保持する。`sourceEndFrame` は exclusive endpoint なので ended frame として再利用しない。paused presentation frames は source position へ加算せず、video audio state も保持する。resume 後は同じ source position から `playing` branch として継続し、photo / `document_scan` にはこの state machine を適用しない。

```text
RenderManifest 2.4.0
├─ manifestVersion: "2.4.0"
├─ compilerInputHash（project、template revision/hash、素材 snapshot を含む）
├─ sectionLayouts[]
│  ├─ sectionId
│  ├─ sectionTitle（ScriptSection.name の compile 済み値）
│  ├─ templateId
│  ├─ templateRevision
│  ├─ templateHash
│  └─ resolvedLayout
├─ lines[]
│  ├─ ...（RenderManifest 2.3.0-compatible resolved line）
│  ├─ screenTemplateId / templateRevision / templateHash
│  ├─ resolvedLayout（line ごとの V24 resolved layout）
│  └─ sectionId（所属 section）
├─ visuals[]
│  ├─ id（決定論的 segment ID）
│  ├─ sourceAssignmentId / segmentIndex
│  ├─ segmentStartLineId / segmentEndLineId
│  ├─ screenTemplateId / templateRevision / templateHash
│  ├─ from / durationInFrames
│  └─ display（V24 resolved: outerFrame / contentClip / fit / crop / annotations、video は startMs / endMs と sourceTrimBeforeFrame / sourceTrimAfterFrame）
└─ ...（2.3.0 の characters / backgrounds / audioTracks / inserts）
```

`sectionLayouts[].sectionTitle` は `ScriptSection.name` を compiler がそのまま固定した必須文字列である。現行 `RenderLineV24` は line-level の `resolvedLayout` を持ち、`RenderManifest 2.4.0` では line の template snapshot と整合する。VP-02 の `RenderLineV25` は `sectionId` から親 section layout を参照し、section-title element の geometry と文字列を重複保存しない。`speaker-1` / `speaker-2` はそれぞれ `project.characters[0]` / `[1]` に解決し、`characterId` を resolved layout へ固定する。generic visual の `display` は resolver が最終 geometry と media state へ解決し、version ごとの manifest shape として保存するため、Remotion は `position` / `scale` の座標系を再解釈しない。source-end boundary も resolver が確定する state boundary として manifest partition に含める。

template の revision / hash、section title、project の section selection、現行 1.4.0 の section-only template authority、ScreenTemplate の element geometry、speaker mapping、generic assignment の inner transform、VisualAssignment の section / line-template / cue segment partition（source assignment ID、segment line 境界、template ID / revision / hash、segment の `from` / `durationInFrames`）、resolved generic visual の `outerFrame` / `contentClip` / `fit` / `crop` / annotation、動画 segment の provenance `startMs` / `endMs` と version に応じた resolved video branch（V24 / V25 playing の source trim pair、V25 paused / ended の `sourceFrame`）、`displayCoordinateSpace`、`prioritizeVisual` の適用結果のいずれかが変わった場合は `compilerInputHash` を変え、旧 manifest を current とみなさない。`displayCoordinateSpace` は compiler input として legacy adapter の選択に使うが、V24 / V25 の resolved visual display へ raw 値を残して Remotion に再解釈させない。source-end boundary と ended state も partition / resolved source state として hash に含める。過去 revision の template を project.json に埋め込む snapshot history や rollback UI は今回対象外とする。

VP-02 の `RenderManifest 2.5.0` は、次の section-only shape と video playback state を持つ。

```text
RenderManifest 2.5.0
├─ sectionLayouts[]
│  ├─ sectionId / sectionTitle
│  ├─ templateId / templateRevision / templateHash
│  └─ resolvedLayout
├─ lines[]
│  ├─ ...（2.4.0-compatible line fields）
│  └─ sectionId（親 section layout への参照。line template field / resolvedLayout は持たない）
└─ visuals[]
   ├─ ...（2.4.0-compatible visual segment fields）
   └─ sectionId / templateRevision / templateHash（screenTemplateId の代わりに section を参照）
      └─ video: resolved playback cues / playing-paused-ended state / (playing trim pair | paused sourceFrame | ended lastDrawableSourceFrame)
```

`RenderManifest 2.4.0` と `2.5.0` は strict parser、cache、run log で別 version として扱う。2.4.0 cache の既存意味を変更せず、VP-02 の migration / compile が version boundary と source project hash を確認してから cue と source-end transition を含む新しい manifest を生成する。2.5.0 の video state は pause / ended 中に source time / video audio を進めず、photo / `document_scan` は static display のままにする。

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

1 つのビジュアルは 1 セリフまたは連続する複数セリフへ割り当てられる。割り当てには素材DB上の `assetId` だけでなく、選択時のチェックサムと、プロジェクトへ取り込んだ素材の相対パスを保存する。動画には使用開始・終了位置、切り抜き、拡大率、位置、再生速度、`0 <= volume <= 1` の音量、注釈を指定できる。写真と帳票スキャンにはページ、切り抜き範囲、表示方法、拡大率、位置、注釈を指定できる。表示範囲は `startLineId` / `endLineId` の同一 section 内 inclusive range で authority を持つ。video の途中 pause / resume は #151 の `VisualPlaybackCue` でだけ表現し、photo / `document_scan` に再生 cue を追加しない。

表示素材の line 境界、cue、paused interval、source-time accumulation の詳細は 1.6 と `implementation-spec.md` 7.8 / 8.1.3 を正本とする。既存 `VisualAssignment` の検索、asset snapshot、範囲、display transform を別 entity へ置換しない。

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

現行仕様では人間が初稿を作成し、AI は初稿生成ではなくレビュー補助に使用する。人間が作成した完成稿を正解例として蓄積し、15.2 の改善ループによって生成ルールとレビュー基準が十分に整った後に、AI による初稿生成を将来拡張として追加する。

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
7. SW-02 の 1.4.0 target では section header で section 全体の `screenTemplateId` を選択する。line card には template selector、inherit badge、「セクション設定に戻す」を置かず、section の template を全 line に適用する。適用後の preview は state change のある line では full screen、通常 line では dialogue / subtitle 領域だけの compact preview とする。1.3.0 の既存画面・データは SW-01 migration まで line override を保持する。

キャラクターの性格と口調は、レビュー基準として参照できる形で文書化する。

台本には初稿の生成元を保持し、少なくとも `manual`、将来追加する `ai`、外部から取り込む `imported` を区別できるようにする。初期値は `manual` とする。台本の `status` は少なくとも `draft`、`needs_review`、`approved` を区別するが、これは互換性、stale 判定、レビュー結果を示す状態であり、ビジュアル・音声・出力へ進むための承認ゲートではない。自動保存を継続し、不正な台本は保存時または実行時の validation で拒否する。

人力初稿では AI 初稿との差分が存在しないため、承認済みの構成案、完成した人力台本、使用したキャラクター設定を、将来の生成に使用する正解例として関連付けて残す。AI レビューの指摘は、採用または却下した結果と理由も記録する。

### 6.4 ビジュアル

構造化したスライドや図解を AI または自前スキルで生成する方式は採用しない。キャラクタービジュアルは、プロジェクトの character binding とセリフカード上の explicit variant selection を標準経路とする。現場動画、写真、帳票スキャンは別ドメインの素材ライブラリへ登録し、必要な場合だけ人間が検索・確認して generic `VisualAssignment` として割り当てる。AI suggestion、Asset Search、表示設定はその補助機能として残すが、キャラクタービジュアル選択の主導線にはしない。

以下の 6.4.1〜6.4.3 は、現場動画・写真・帳票スキャンを扱う generic Asset Search / `VisualAssignment` の機能・保存データ・API の仕様である。これらを維持することは、Issue #97 が除去対象とする `/projects/{projectId}/script` の legacy CV-05 right pane UI（候補、検索、検索結果、素材制作・表示設定カード）を標準画面に残す意味ではない。必要な UI は、キャラクタービジュアルの line picker とは分離した別画面または補助導線で扱う。この整理は、VP-03 の line-card media cue pane（現行標準 UI）を除外するものではない。

#### 6.4.0 キャラクタービジュアル登録（ワークスペース共通）

キャラクタービジュアル登録は、現場動画・写真・帳票スキャンの登録とは別のワークスペース共通ライブラリ機能である。サイドバーから `/character-visuals` を開き、`CharacterVisualSet` の作成、名称・説明の編集、完全な variant の作成、既存 variant の file slot 差し替え、利用状態の変更を行う。`/projects/{projectId}/script` は登録済みビジュアルを参照する台本画面であり、登録処理の正本や導線を兼ねない。

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

1. 人間が素材ライブラリ画面から動画、BGM、写真、帳票スキャン、効果音を登録する。専用の動画 uploader は作らず、全 kind を同じ workspace Asset library で扱う。
2. バックエンドがファイル種別、サイズ、解像度、動画尺、ページ数、チェックサムなどの技術情報を取得する。
3. バックエンドが一覧表示用サムネイルを生成する。動画は代表フレーム、複数ページ帳票はページごとのサムネイルを生成し、音声系は必要な technical metadata を返す。
4. 人間が title、description、confidentiality、department、system、tagIds を確認・編集する。kind、checksum、size、duration、解像度、page count、MIME など file-derived technical metadata は編集しない。
5. 素材を `active` にした時点で generic Asset Search の検索対象にする。通常の「削除」は `inactive` への利用停止とし、再有効化は `active` へ戻す。差し替えや利用停止は履歴を残し、inactive Asset を新規 picker / search candidate へ返さず、既存 project の snapshot を暗黙に変更しない。
6. 初期登録は v1 の検証・処理が成功してから current version を確定する。既存 Asset の差し替えは同じ `assetId` の新 version candidate として処理し、candidate の processing / error 中は旧 current version を維持する。candidate の technical metadata と thumbnail が揃った時だけ、candidate の `ready` 化と current version 切替を同じ transaction で commit する。

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
6. 素材を大きく見せたい generic assignment では、保存値 `display.prioritizeVisual: boolean` により ScreenTemplate 解決後の互換表示ポリシーを適用できる。初期版の有効区間では template の character element を縮小するだけで、非表示にはしない。この値は generic `VisualAssignment` の表示設定として維持するが、ScreenTemplate の outer geometry を上書きしたり、CV-04 後の標準 `/projects/{projectId}/script` に旧「キャラクターペイン」のトグルや素材制作・表示設定カードを置いたりすることは意味しない。編集 UI は別画面または補助導線で扱う。
7. 同じ台本範囲への割り当て変更、解除、前後の範囲への延長・短縮を行えるようにする。

#### 6.4.3.1 表示素材の line-boundary playback cue（VP-00）

`startLineId` の line 開始境界 BEFORE で assignment を表示し、video は `startMs` から implicit に再生する。`endLineId` の line 終了境界 AFTER で assignment を非表示にし、video を終了する。cue は video の途中 state だけを表し、initial play と final end を冗長に保存しない。

`VisualPlaybackCue` の `lineId` は assignment の同一 section 内 range に含める。`pause` は playing 中、`resume` は paused 中だけを有効とし、同じ line / edge の相反 cue を保存しない。project array の順序ではなく line order と BEFORE / AFTER の edge order で決定論的に解決する。標準操作は「再生開始 / 再開 = selected line BEFORE」「一時停止 = selected line BEFORE」「終了 = selected line AFTER」とし、line 内任意時刻は提供しない。

source position が `sourceEndFrame` に到達または超過した最初の presentation frame boundary は implicit source-end → ended を先に適用する。assignment の表示時間が source duration を超えても invalid にせず、ended 後の pause / resume は無効とする。

pause 中は pause 境界の source frame を保持し、source media time と video 内音声を進めない。line speech、BGM、sound effect 等の別 audio layer は進める。resume は同じ source position から継続し、`playbackRate` は playing interval の source-time accumulation にだけ適用する。photo / `document_scan` は cue を持たず、range 中は同じ static display を維持する。

#### 6.4.4 確認と validation

1. 各セリフカードには CharacterVisualSet から選択した variant の preview、label、renderType、または「未選択」を表示する。
2. character binding の visual、idle variant、line の `characterVariantId` が存在し、active で、speaker と同じ visual に属することを機械検証する。未選択は編集中に許可するが、出力前には validation error とする。
3. 現場素材については、未割り当ての区間、参照切れ、チェックサム不一致、動画区間外の指定、帳票ページ範囲外の指定を機械検証する。
4. 人間が台本内容と素材内容、表示区間、機密区分、キャラクターの選択内容が一致していることを確認する。
5. 確認結果は警告・エラーと `VisualPlan.status` へ反映する。人間の「ビジュアルを承認」操作や `approved` 状態を後続工程の開始条件にはしない。

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

#### 6.5.1 BGM の責務

BGM は音声生成の一部ではなく、次の 6.6 で定義する編集フェーズの素材である。`audio` には音声生成と効果音の正本を保持し、BGM の正本は `edit.sectionBgms` に置く。旧 `AudioPlan.sectionBgms` の直接 path、loop、fade 設定を現行仕様として拡張しない。

### 6.6 編集

編集画面は、台本が確定したセクション列へ登録済みの動画要素と BGM を追加・編集する独立フェーズである。未編集状態では `script.sections` から導出したセクションカードだけを表示し、編集後に動画要素カードと BGM の状態を表示する。

#### 動画要素

- `intro`: 最大 1 件。最初のセクションより前にだけ配置する。
- `outro`: 最大 1 件。最後のセクションより後にだけ配置する。
- `cutin`: 最初のセクションより後の `before_section` 境界へ 0 件以上配置する。同じ境界に複数置け、その境界内の順序を変更できる。最初のセクションの直前境界は許可しない。
- `cutin` をセクション内部の任意時刻へ配置する機能は持たない。
- セクションの並べ替えは台本の正本を変更するため編集画面では許可しない。drag & drop の対象は動画要素カードだけとし、セクションカードは対象外とする。
- 動画要素は `video` Asset のうち MP4 container、`video/mp4` MIME、`.mp4` 拡張子を満たす登録済み素材だけを使用する。拡張子だけで許可せず、登録時に MIME と実ファイル形式を検証する。
- 編集画面から OS path、任意ファイル、未登録素材を直接指定しない。Asset picker は選択・差し替え時点で `active` な対応 kind の候補だけを返す。
- Asset の currentVersion が示す AssetVersion の `version` / `checksum` は、`assetVersion` / `assetChecksum` として `assetId`、`projectMediaPath` とともに project snapshot へ固定する。snapshot 作成後の Asset の差し替えや利用停止で既存 project の参照を暗黙に変えない。
- snapshot 作成後は live な Asset `status` を既存 project の出力条件にしない。保存・出力時には project 内 `projectMediaPath` の存在、`assetChecksum` との一致、MP4 / MP3 の実ファイル形式を検証し、Asset Service の SQLite を再参照しない。
- 動画要素ごとに `0 <= volume <= 1` の音量を保存する。`volume: 0` は無音として扱い、`muted` を現行正本へ保存しない。

#### セクション BGM

- 各セクションは BGM を 0 件または 1 件だけ持つ。
- BGM は `bgm` Asset のうち MP3 container、`audio/mpeg` MIME、`.mp3` 拡張子を満たす登録済み素材だけを使用する。
- セクションカードから追加、差し替え、解除、単体試聴、音量調整を行う。BGM は対象セクションの全区間で固定 loop し、音源が長い場合はセクション終了で停止する。
- `0 <= volume <= 1` の音量を持つ。loop は編集可能な設定にせず、編集 BGM の固定挙動とする。
- intro / outro / cutin の再生中は前後セクションの BGM を再生しない。複数 BGM、開始オフセット、トリム、音量キーフレーム、自動ダッキング、曲同士のクロスフェードは対象外とする。
- 既存の `fadeInMs` / `fadeOutMs` は現行 `EditPlan` と `RenderManifest 2.4.0` から削除する。境界でフェード設定を編集できる仕様は追加しない。

#### 編集画面の保存と validation

編集結果は `VideoProject.edit` へ自動保存する。`videoElements` の stable ID、role、配置、同一境界内の順序、Asset snapshot、volume と、`sectionBgms` の section ID、Asset snapshot、volume を保存前に検証する。選択・差し替え時の `active` 条件、intro / outro の重複、role と配置の不一致、最初のセクション直前への cutin、project 内ファイルの存在・`assetChecksum` 不一致、MP4 / MP3 形式不一致、BGM の同一セクション重複はエラーとする。snapshot 作成後の live な Asset `status` の変更は既存 project の出力エラーにしない。

### 6.7 タイムライン

正本のプロジェクト JSON をそのまま描画コンポーネントで解釈せず、レンダリング前にタイムラインコンパイラで `RenderManifest` へ変換する。音声ファイルの長さを、動画編集における duration の基準とする。

`RenderManifest` の生成は台本・ビジュアルの承認状態を確認する工程ではない。出力時の実行条件として、正本 JSON のスキーマ、構成案の承認済み・最新状態、台本の構造と `outlineHash`、音声の current 状態、素材参照・範囲・checksum、Manifest の整合性を検証する。`draft` や `needs_review` の status だけを理由に生成を拒否しない。

処理の責務は次のとおりとする。

1. Zod で正本 JSON を検証する。
2. 参照している音声とビジュアル素材の存在、チェックサム、有効範囲を検証する。キャラクタービジュアルについては、バックエンドが SQLite と管理領域から取得した snapshot、登録済みファイル、PNG 構造、透過情報、visual 基準キャンバスとの一致を専用検証で確認する。
3. `project.characters[].characterVisual.visualId`、`project.characters[].characterVisual.idleVariantId`、各 line の `characterVariantId` を、検証済み `CharacterVisualCatalogSnapshot` と照合する。`ScriptLine.expression`、tag、label から物理 variant を暗黙に自動変換・代替しない。コンパイラは SQLite を直接参照しない。
4. 各音声ファイルの再生時間を取得し、セリフ ID と対応付ける。
5. `pauseBeforeMs`、音声長、`pauseAfterMs` を fps に基づいてフレームへ変換する。
6. セリフを表示順に累積し、各セリフの `from`、`durationInFrames`、`speechFrom`、`speechDurationInFrames` を確定する。
7. `startLineId` と `endLineId` で指定されたビジュアル割り当てについて、現行 `VideoProject 1.4.0` / `RenderManifest 2.4.0` の既存 range・template・segment 契約を維持する。VP-01 / VP-02 では section 境界、#151 の persistent media state boundary、または source-end boundary で segment を分け、同一 section 内の line template 差分を新しい分割理由にしない。source-end boundary は presentation frame 単位なので line の途中にも置く。`sourceAssignmentId`、決定論的な segment ID、segment 順序、line 境界を記録し、最終 `from` / `durationInFrames` は timeline shift 後に確定する。
8. 各セクションの最初と最後のセリフから、背景の表示範囲を確定する。
9. 本編セクションの境界へ `edit.videoElements` の cutin を配置する。ただし最初のセクションの直前境界は validation error とし、同じ境界内の `order` を維持する。
10. 先頭へ `intro`、末尾へ `outro` を配置する。intro / outro / cutin の実素材、開始位置、再生尺、音量を `RenderVideoInsert` として解決する。
11. 動画要素の挿入によって後続の section / line / visual / background の frame range を shift する。
12. shift 後の section 範囲へ `edit.sectionBgms` を割り当てる。各 BGM はそのセクション全区間で loop し、intro / outro / cutin の区間では再生しない。編集 Asset は project snapshot と project 内ファイルだけから解決し、live な Asset `status` や SQLite を出力時に参照しない。
13. 効果音をセリフ基準の位置へ割り当てる。
14. section の ScreenTemplate と `ScriptSection.name` からの `sectionTitle`、`speaker-1` / `speaker-2` の character mapping、resolved geometry、transform、font size、`flipX`、content slot、segment ごとの generic visual の `outerFrame` / `contentClip` / `fit` / `crop` / annotation を共有 resolver で確定する。現行 `VideoProject 1.4.0` は section-only selection を入力とし、`RenderManifest 2.4.0` の既存 section / line / visual shape、visual、全体 duration を生成する。VP-02 は line-level template meaning を暗黙に書き換えず、`RenderManifest 2.5.0` へ resolved media state を追加する。動画 segment の provenance `startMs` / `endMs` は元 assignment range を保持し、`playing` branch は playing presentation frames だけを反映した `sourceTrimBeforeFrame` / `sourceTrimAfterFrame`、`paused` branch は source end 前の一点の `sourceFrame`、`ended` branch は `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を解決する。
15. `sourceProjectHash` と参照素材のチェックサムを記録し、入力が同一の場合だけ生成済みキャッシュを再利用する。

VP-01 / VP-02 の video playback は line-boundary cue を解決した media state を使う。initial play は `startLineId` BEFORE、final hide / end は `endLineId` AFTER から暗黙に導出する。source position が `sourceEndFrame` に到達または超過した最初の presentation frame boundary は source-end boundary として implicit source-end → ended を先に適用し、同じ boundary の cue はその後に validation する。その他の同じ boundary の event は start BEFORE で implicit play → cue、end AFTER で cue → implicit hide / end の順に適用する。ended state の pause / resume は無効とする。pause 中の presentation frames は source-time accumulation に加算しない。`playing` branch は trim pair、`paused` branch は一点の `sourceFrame`、`ended` branch は `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を playing frames と `playbackRate` から解決し、`sourceEndFrame` は exclusive endpoint として別に扱う。pause / ended 中も video frame を保持し video audio を停止する。speech、BGM、sound effect は別 layer として通常どおり進行する。

ミリ秒からフレームへの変換は、要素が途中で欠けないように次を基本とする。

```ts
const msToFrames = (ms: number, fps: number): number =>
  Math.ceil((ms / 1000) * fps);
```

フレーム範囲は半開区間として扱い、`from <= frame < from + durationInFrames` の場合だけ要素を有効とする。これにより、隣接する要素の境界フレームが重複しない。

セリフの `from` は無言区間を含むセリフ区間の開始位置、`speechFrom` はそのセリフ区間内で音声が始まる相対フレームとする。字幕を音声区間だけ表示するか、前後の無言を含むセリフ区間全体へ表示するかは字幕コンポーネントの共通設定で決定し、セリフごとに暗黙の挙動を変えない。

生成した `RenderManifest` は `projects/{projectId}/cache/render-manifest.json` へ保存できる。ただしこれは検査と再利用のための派生キャッシュであり、人間が直接編集しない。

### 6.8 Remotion 描画

- Remotion には `RenderManifest` を通常の React props として渡す。
- Composition の `durationInFrames`、fps、幅、高さは `RenderManifest` から決定する。
- セリフ、ビジュアル、背景、音声などの各要素は、`from` と `durationInFrames` を用いて Remotion のタイムラインへ配置する。
- 動画の各フレームを React で描画する。
- Remotion から渡される現在フレーム番号を基準に、位置、透明度、表示内容、素材動画の再生位置などを計算する。
- 時間経過へ依存する通常の CSS アニメーションは基本的に使用しない。
- 背景、section title、字幕、キャラクター、ビジュアルをすべてフレーム番号と解決済み layout から決定し、再現可能な描画にする。section title の文字列は `RenderSectionLayout.sectionTitle` から取得し、generic visual は `RenderVisualV24.display.outerFrame`、`contentClip`、`fit`、`crop`、annotation を使う。VP-02 の video は resolved playback state を使い、`playing` interval では source trim pair、`paused` interval では一点の `sourceFrame`、`ended` interval では `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）と video audio 停止を保持する。`sourceEndFrame` は playing trim の exclusive endpoint として別に扱う。Remotion は raw `displayCoordinateSpace`、`position`、`scale` を再解釈しない。
- 音声解析、素材探索、ID 解決、タイムラインの累積計算は描画コンポーネント内で繰り返さず、タイムラインコンパイラで完了させる。
- WebUI の line-card preview と MP4 レンダリングには、同じ timeline compiler、ScreenTemplate geometry resolver、同じ layout component、各 project version に対応する resolved manifest（現行 `VideoProject 1.4.0` は `RenderManifest 2.4.0`、VP-02 後は `RenderManifest 2.5.0`）を使用する。VP-02 後は resolved media state、source trim pair、paused / ended の sourceFrame、source-end boundary も共有し、preview 専用の固定 CSS 座標や resolver を作らない。

### 6.9 キャラクター演出

以下の `RenderManifest.characters[]`、`RenderManifest.lines[].characterVariantId`、`RenderManifest.characterVariants[]` は、CV-05（Issue #98）から引き継ぐ explicit variant 解決を現行 `RenderManifest 2.4.0` へ含める。`RenderCharacterVariant` は physical visual の `(visualId, variantId)` を識別する。同じ physical variant を複数の project character が共有しても、特定話者の所有権で上書きしない。既存 `characterMappingVersion` は cache / run-log 互換のメタデータとして残すが、variant 選択には使用しない。

production compile は `POST /api/projects/{projectId}/manifest/compile` を標準経路とする。backend は SQLite の `CharacterVisualCatalogSnapshot` を `verifyFiles()` で検証し、file checksum を含む validated snapshot と asset metadata を compiler へ渡してから `RenderManifestStore` に保存する。compiler や Remotion が SQLite を直接検索したり、静的 legacy catalog を通常経路として渡したりしない。

- 2 人のキャラクターを使用し、どの位置・大きさ・回転で表示するかは解決済み ScreenTemplate の `speaker-1` / `speaker-2` element が決める。resolver は `speaker-1` → `project.characters[0]`、`speaker-2` → `project.characters[1]` を固定し、`mentor` / `learner` や表示名から推測しない。`screen-template-standard` は現行固定配置との見た目互換を提供する初期 template であり、すべての template を画面下部左右へ固定しない。
- section title は `RenderSectionLayout.sectionTitle` に固定された `ScriptSection.name` を section-title element の geometry へ描画する。template に文字列を保存せず、line に同じ title を重複保存しない。
- `RenderManifest.lines[].expression` は台本の論理表情であり、PNG、物理ポーズ、`variantId` を直接指定する値ではない。
- `RenderManifest.characters[].idleVariantId` と `RenderManifest.lines[].characterVariantId` は、`project.json` に人間が保存した明示参照から解決する。`neutral`、`smile`、`explain`、`caution`、tag、label から `stand`、`normal`、`pointing` などへ自動的に割り当てない。
- 発話中のキャラクターだけ、解決済み `mouth-pair` variant の `closed` / `open` を切り替える。
- `single-image` variant に存在しない `open` 画像を推測、複製、加工して口パクに使用しない。単一画像を発話中にどう表示するかは TBD とする。
- 発話中は小さく上下に動かし、話者を視覚的に明示する。
- キャラクターの話者、論理表情、口パク、発話中演出は、project.json の明示 binding / line variant 参照、検証済み snapshot、タイムラインから決定する。キャラクタービジュアル登録では物理 variant を追加・更新できるが、プロジェクトでの採用は登録画面で自動決定しない。ユーザーが Remotion 用の物理ファイルパスを直接編集する機能も持たない。
- ビジュアル素材を大きく表示する場面では、generic assignment の `display.prioritizeVisual` を互換ポリシーとして resolved template の character element へ適用し、初期版では縮小だけを行う。非表示は ST-00〜ST-07 の対象外であり、将来導入する場合は `visible` などを manifest に追加する。template geometry を無視して別の固定座標へ戻すことはできない。
- `RenderManifest.inserts[]` は `edit.videoElements` から解決した実動画の `role`、`from`、`durationInFrames`、`src`、`volume` を保持する。placeholder の共通画面を通常経路へ挿入しない。
- `RenderManifest.audioTracks[]` は shift 後の各セクション範囲、BGM の `src`、`volume`、固定 loop を保持する。現行マニフェストに `fadeInFrames` / `fadeOutFrames` を持たせない。
- 話者、論理表情、発話区間は `RenderManifest.lines[]` から取得し、物理素材のパスは解決済みのキャラクター素材情報から取得する。
- 口パクは、解決済み `mouth-pair` variant の発話区間内で相対フレームから計算し、設定された周期で `closed` と `open` を切り替える。無言区間と発話終了後は必ず `closed` とする。
- 上下動、拡大縮小、フェードなどは現在フレームから決定する純粋な計算とし、実時間に依存する状態を持たない。

ScreenTemplate をレイアウトの authority とする。ユーザーは template editor で dialogue window、section title、2 つの character slot、primary content slot の位置、拡大縮小、回転を編集し、dialogue / section title の font size と character の `flipX` も設定できる。geometry は element type ごとの正規化値で保存し、dialogue-window / section-title / content-slot は canvas-contained、character-visual は部分 overflow を許可して完全 off-canvas だけを拒否する。回転後の bounds 判定は editor / layout validation で行う。`VisualAssignment.display` の crop / fit / scale / position は content slot 内の inner transform とし、ScreenTemplate の outer geometry と混同しない。`prioritizeVisual` は template 解決後に適用する互換 policy であり、template の適用結果を無視しない。preview / production は composition 境界で同じ character pixels を clip し、valid geometry を clamp しない。template-level の「デフォルトに戻す」は canonical seed を使って全編集可能値を一括復元する唯一の reset 操作とし、複数の固定プリセットや個別 reset、各 assignment への固定座標追加は採用しない。

### 6.10 背景

- ビジュアル表示領域の外側には共通背景を使用する。
- 背景の動きは説明を妨げない控えめなものとする。
- 現場動画、写真、帳票の場面では、背景より素材の視認性を優先する。
- 背景はセクション単位で台本編集画面の背景ペインから選択し、プレビューを確認しながら変更できるようにする。
- 背景ペインの編集結果は `sections[].background` へ保存し、同じセクション内のセリフには共通設定として適用する。
- 背景状態は現在フレーム番号から計算し、再現可能にする。
- セクションごとの背景設定はタイムラインコンパイラが `RenderManifest.backgrounds[]` のフレーム範囲へ変換する。
- 背景コンポーネントは現在フレームに対応する背景定義を選び、同じフレームに複数の背景が競合しないようにする。

### 6.11 動画全体の構成

- タイトル
- この動画の目的
- 前提・準備
- 操作手順
- 確認方法
- 注意事項
- まとめ
- エンディング

編集後の動画は、台本のセクション列に対して、必要な intro、セクション境界の cutin、必要な outro を登録済み MP4 Asset から追加した構成とする。intro は最初のセクション前、outro は最後のセクション後、cutin は指定されたセクション境界にだけ置く。各要素の尺は選択した MP4 の実尺から決め、音量を適用する。未編集状態ではこれらを挿入せず、常設の無音 placeholder を正本や manifest に生成しない。一般向け動画の視聴維持を目的とした冒頭ダイジェストは必須としない。

### 6.12 レンダリング

1. 完成した JSON をシステムに読み込む。
2. 出力時 validation で正本 JSON、構成案の最新性、台本、編集要素、音声、素材参照、範囲、checksum、MP4 / MP3 の実ファイル形式を検証する。
3. タイムラインコンパイラで `RenderManifest` を生成し、生成結果を検証する。
4. `RenderManifest` を Remotion の props として渡し、プレビューで内容を確認する。
5. 同じ `RenderManifest` を使用して MP4 としてレンダリングする。
6. 修正が必要な場合は正本 JSON を直し、validation と `RenderManifest` を再実行してから再レンダリングする。

## 7. 独自 WebUI

WebUI は Vite + React SPA、React Router、TanStack Query で構築し、Fastify のローカル API と接続する。開発時は Vite から `/api` を Fastify へ proxy し、製品実行時は Fastify がビルド済み SPA と API を同一 origin で配信する。ワークスペース共通ライブラリには、現場素材画面とは別に `/character-visuals` のキャラクタービジュアル画面と `/screen-templates` の ScreenTemplate 画面を設ける。

JSON の通常編集は用途別フォームから行い、ファイルの直接編集を通常運用にしない。画面、保存、API、エラー処理の具体仕様は 17.4 および [`implementation-spec.md`](./implementation-spec.md) 14 章に記載する。

## 8. 自動検証

### 8.1 データ検証

- Zod で JSON のスキーマを検証する。
- 必須設定の欠落や設定ミスを、音声生成・レンダリング前に検出する。
- 参照している音声とプロジェクトへ取り込んだビジュアル素材が存在し、保存済みチェックサムと一致することを確認する。
- 動画の開始・終了位置、帳票のページ、画像・帳票の切り抜き範囲が素材の有効範囲内であることを確認する。
- セクション ID、セリフ ID、キャラクター ID の重複や不正参照を検出する。
- character の `visualId` と `idleVariantId` が同じ `CharacterVisualSet` 配下の active variant を参照することを検出する。未設定は編集中に許可するが、出力前 validation ではエラーとする。
- `ScreenTemplate` が workspace SQLite に存在し、active / inactive、revision、element cardinality、element type 別 geometry、rect center rotation、`fontSize > 0`、`flipX` を検証する。contained element は canvas 内、character は finite x / y と positive size、部分 overflow を許可し完全 off-canvas を拒否する。TypeScript の静的配列を実在テンプレートの一覧として使用しない。
- `screen-template-standard` が idempotent seed / migration で存在し、既存 project の section が stable ID を明示参照することを検証する。missing / inactive の明示参照は自動代替しない。
- 現行 `VideoProject 1.4.0` では section の `screenTemplateId` だけを全 line の template authority とし、line には template selector または template ID を保存しない。`1.3.0` の nullable line override は migration input にだけ存在する。
- VP-01 の video display は `playbackCues` の `lineId` が assignment の同一 section 内 `startLineId` / `endLineId` range に含まれ、`edge` が BEFORE / AFTER、`action` が pause / resume であることを検証する。range 外、playing 中でない pause、paused 中でない resume、ended 後の pause / resume、同じ line / edge の相反 cue、photo / `document_scan` の cue は error とし、initial play / final end を冗長 cue として要求しない。start BEFORE は implicit play 後、source-end boundary は implicit source-end → ended 後、end AFTER は cue 後に implicit end を適用し、state 不一致または no-op / redundant cue を拒否する。
- cue の解決順が line order + edge order で決定論的であり、source position が source end に到達する source-end boundary が cue より先に `ended` transition を適用し、paused / ended interval の presentation frames が source time へ加算されず、video audio だけが停止し、speech / BGM / sound effect が継続することを検証する。V25 の `playing` branch は strict trim pair、`paused` branch は source end 前の一点の `sourceFrame`、`ended` branch は `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を持ち、`sourceEndFrame` は exclusive endpoint として別に扱う。resume 後の source position と `playbackRate` が playing interval の累積だけから決まることを確認する。
- 編集の `videoElements` が role と配置規則に適合し、intro / outro が最大 1 件、cutin が最初のセクション直前に置かれず、各境界の `order` が一意であることを検出する。
- 編集の動画 Asset が MP4、BGM Asset が MP3 で、snapshot の `assetVersion`・`assetChecksum`・`projectMediaPath` が一致することを検出する。出力時に live な Asset `status` は検証しない。
- generic video、intro、outro、cutin、BGM の `volume` が 0〜1 であることを検出する。旧 generic `muted` は ED-01 migration で変換済みであることを検証する。
- 2.2.0 compatibility manifest へ出力する場合、generic video の `volume` が 0 または 1 で adapter を通ることを検出する。0 / 1 以外を `muted` へ丸めたり暗黙に変換したりせず、2.3.0 経路が必要なエラーとして返す。
- セクションごとの BGM が 0/1 件で、動画要素中に BGM を再生しない最終タイムラインを検証する。
- `ScriptLine.characterVariantId` が line の speaker に project 上で binding された visual 配下の active variant を参照することを検出する。missing、inactive、cross-visual は自動代替せずエラーとする。
- `ScriptLine.expression`、variant の tag、label を physical variant の解決入力として使用しない。
- `speaker-1` / `speaker-2` がそれぞれ `project.characters[0]` / `[1]` へ解決され、`characterId` が preview / manifest / Remotion で一致することを検証する。
- `ScriptSection.name` が `RenderSectionLayout.sectionTitle` へ固定され、section-title layer が line の section layout から同じ文字列を描画することを検証する。
- `RenderManifestV24.visuals[].display` が `outerFrame`、`contentClip`、`fit`、`crop`、annotation を持ち、raw `displayCoordinateSpace` / `position` / `scale` を Remotion が再解釈しないことを検証する。legacy mode は clipping を無効、content-slot-relative は clipping を有効にした最終値を保存する。VP-02 の V25 video display は resolved playback state、cue boundary、source-end boundary、playing branch の source trim pair、paused / ended branch の一点 `sourceFrame` を追加し、2.4.0 の意味を変更しない。
- 現行 `RenderManifest 2.4.0` では `VisualAssignment` が既存の section / template boundary と persistent state boundary で `RenderVisualV24` segment へ分割され、各 segment が `screenTemplateId`、template revision / hash、最終 frame range を保持することを検証する。VP-02 の `RenderManifest 2.5.0` では同一 section 内の line template 差分を分割理由にせず、section 境界、`VisualPlaybackCue` の state boundary、source-end boundary で `RenderVisualV25` segment を分ける。V25 の video display は `playing` branch なら strict source trim pair、`paused` branch なら source end 前の一点の `sourceFrame`、`ended` branch なら `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を持ち、`sourceEndFrame` は exclusive endpoint として別に扱い、video segment に `hidden` / `static-visible` を保存しないことを検証する。
- `prioritizeVisual` が初期版では character element の縮小だけを行い、非表示状態を resolved layout に要求しないことを検証する。
- ビジュアル割り当ての開始・終了セリフが存在し、同じセクション内で順序が逆転していないことを確認する。

### 8.2 レイアウト検証

- 字幕が画面外へはみ出していないかを検証する。
- dialogue-window / section-title / content-slot の rect が有限な 0..1 の正規化値で、矩形と回転後の外接範囲が canvas 内に収まっているかを検証する。character-visual は有限な x / y、正の size、回転後の外接範囲と canvas の交差を検証し、部分 overflow は許可する。
- composition 境界で character pixels を clip し、完全 off-canvas、重なり、表示不能な geometry は editor と出力 validation の両方で表示する。valid な character geometry を canvas 内へ clamp しない。
- template の outer geometry と generic `VisualAssignment.display` の inner transform を分け、素材の crop / fit / scale / position が content slot 外へはみ出さないかを検証する。
- VP-01 / VP-02 では、同じ `VisualAssignment` から生成した segment の半開 frame range が section 境界、cue boundary、または source-end boundary で隣接し、重複・欠落がないことを検証する。同一 section 内の line template 差分を新しい segment 境界にしない。現行 `VideoProject 1.4.0` / `RenderManifest 2.4.0` の既存 segmentation validation は保持し、V25 の `playing` video branch は paused frames を除く累積から正の source trim pair を解決し、`paused` branch は source end 前の同じ source position の一点を `sourceFrame` とし、`ended` branch は `lastDrawableSourceFrame`（整数 frame では `sourceEndFrame - 1`）を保持する。`sourceEndFrame` は exclusive endpoint として終端 frame に使わない。
- `1.3.0 → 1.4.0` migration が section の `screenTemplateId` を authority として維持し、line override を削除し、`lineId`、old template ID、section template ID、`migrationId` を migration log へ記録することを検証する。section の分割、template の多数決変更、missing / inactive template の自動代替を行わない。この project migration 自体では `RenderManifest 2.4.0` の意味を変更せず、表示素材の cue を解決する VP-02 が別の `RenderManifest 2.5.0` version boundary を検証する。
- line card preview と production render が同じ geometry resolver / layout component の出力を使うことを検証する。
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
- ScreenTemplate が dialogue window、section title、2 つの character visual、primary content slot の outer geometry を決める。`screen-template-standard` は従来の中央素材、下部左右のキャラクター、下部中央字幕、画面上端の section title と見た目互換な初期値を提供する。
- テンプレート editor では 16:9 canvas 内で各 element を移動、拡大縮小、回転できる。字幕は話者ごとの強調色を維持し、font size は template の element 設定で調整する。
- generic visual は content slot 内へアスペクト比を保って表示し、素材側の crop / fit / scale / position と注釈を inner transform として適用する。
- 素材は可能な限り大きく表示し、必要な場合だけ重要箇所へ短い注釈を重ねる。`prioritizeVisual` は template を無視せず、content slot 内の素材優先と character element の互換的な縮小へ限定する。非表示は将来の manifest 契約で別途扱う。
- 装飾的な動きより、操作対象と字幕の読みやすさを優先する。

推奨デザイントークンは 17.13 に記載する。

## 14. コスト・運用方針

- 本システムは単一ユーザーがローカル環境で使用する。
- 配布用パッケージ、マルチユーザー対応、認証・権限管理、外部公開機能は作らない。
- 完成映像を動画生成 AI で生成せず、映像生成単位の従量コストを発生させない。
- VOICEVOX ENGINE はローカルで実行する。
- OpenCode と OpenRouter を利用し、AI モデル呼び出し部分だけを外部サービスへ接続する。
- AI 呼び出しを用途別に識別し、現行仕様では共通モデルを使う。利用実績が蓄積した後、必要な用途だけモデルを分離してコストと品質を調整する。
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
- workspace SQLite を正本とする ScreenTemplate を作成・更新・利用停止でき、`screen-template-standard` を idempotent に seed できる。
- ScreenTemplate の 4 種類の固定 element（dialogue window、section title、2 character slots、primary content slot）について、移動、拡大縮小、回転、font size、`flipX` を編集・validation できる。
- 現行 `VideoProject 1.4.0` の section `screenTemplateId` だけを `project.json` へ保存し、section 内の全 line に適用できる。`1.3.0` の nullable line override は migration input にだけ残す。
- `/script` の line card を本文 3 行 + 操作 1 行の compact 表示とし、subtitle / 読み上げテキストを編集時だけ expand できる。音声調整の詳細は modal / dialog で編集できる。
- section の先頭、section / background の境界、または persistent canvas state が変化する line に full screen preview を表示し、それ以外は dialogue / subtitle の compact preview を表示できる。preview は shared resolver / layout component の表示領域だけを絞る。
- 現行 `RenderManifest 2.4.0` に section ごとの `sectionTitle`、resolved layout、template revision / hash、font size、`flipX`、content slot、現行 line / visual resolved fields、generic visual の `RenderVisualV24.display` を固定する。VP-02 の `RenderManifest 2.5.0` では line は parent section layout を参照し、video の resolved playback state と branch-specific source state（playing の trim pair / paused の source end 前の `sourceFrame` / ended の `lastDrawableSourceFrame`）を追加して、`sourceEndFrame` を exclusive endpoint として別に扱い、Remotion が SQLite や raw display coordinate space を直接参照せずに描画できる。
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
- generic Asset Search の別画面または補助導線から、人間が候補または手動検索結果を選び、1 セリフまたは連続セリフ範囲へ割り当てられる。これは CV-05 が除去した legacy `/projects/{projectId}/script` right pane を意味しない。VP-03 の line-card media cue pane は現行標準の別 UI として扱う。
- 動画の使用区間、画像・帳票のページまたは切り抜き、拡大、位置、注釈を指定できる。
- `VisualAssignment` の表示範囲を `startLineId` BEFORE / `endLineId` AFTER で解決し、video だけに line-boundary の pause / resume cue を保存・再生できる。pause 中は frame、source time、video 内音声を保持し、speech / BGM / sound effect は進める。photo / `document_scan` は static display のままとする。
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
- 同じ `ScreenTemplate` revision / hash、project selection、section title、speaker mapping、素材 snapshot から同一の resolved layout と preview frame を再生成できること。
- 正本 JSON と `RenderManifest` の責務を分離し、自動計算値を正本へ書き戻さないこと。
- 文字量が変わっても、既定範囲内でレイアウトが大きく崩れないこと。
- 字幕、音声、ビジュアル素材、キャラクター動作がフレーム単位で同期すること。
- 動画、写真、帳票内の文字や操作対象を視認できること。
- AI に素材や完成デザインを生成させず、タグ付けと候補理由の生成だけに限定すること。
- AI が返した存在しないタグや素材を自動割り当てせず、人間が素材内容を確認して確定すること。
- AI visual suggestion、Asset Search、generic `VisualAssignment` の backend / data を維持しつつ、キャラクタービジュアル選択の標準経路を人間の明示選択とすること。
- `expression`、tag、label、旧固定 mapping から physical variant を自動代替せず、missing / inactive / cross-visual を validation error とすること。
- ScreenTemplate の outer geometry、generic visual の inner transform、`prioritizeVisual` の適用順が明確で、template の解決結果を別の固定座標で上書きしないこと。
- shared ScreenTemplate resolver / layout component を line-card preview と Remotion が共通利用し、preview 側が別実装へ置き換えないこと。template editor の一時 preview 素材選択を `ScreenTemplate` 本体へ保存しないこと。
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
- CV-05 で導入済みの project-specific binding と line の explicit variant reference は、`schemaVersion: "1.0.0"` の意味を暗黙に変更せず、明示的な schema version bump と migration を経て保存する。migration は tag / label 検索による推測をせず、既知の旧固定 mapping を決定論的な compatibility input として使える場合だけ利用し、解決不能な値は未設定として人間の確認を要求する。
- ScreenTemplate は workspace SQLite の strict schema として管理し、contained element の有限な 0..1 geometry / canvas containment、character の有限 x / y・正の size・部分 overflow / 完全 off-canvas、rotation、element cardinality、`status`、`revision` を検証する。実在テンプレートを TypeScript 静的配列へ複製しない。
- `VideoProject 1.3.0 → 1.4.0` migration は #148 で完了し、section の `screenTemplateId` を authority として保持し、line の nullable override を削除した。section を分割せず、多数決で template を変更せず、削除した `lineId` / old template ID / section template ID / `migrationId` を migration log に記録する。template missing / inactive の参照を別 template へ推測変換しない。
- VP-01 の `VideoProject 1.4.0 → 1.5.0` migration は既存 video assignment の `playbackCues` を空配列として導入する。VP-02 の `RenderManifest 2.5.0` は 2.4.0 の line / visual meaning を変更せず、section layout、resolved media state、source-end boundary、playing branch の source trim pair、paused / ended branch の一点 `sourceFrame` を追加する。
- `persistentScreenState` の pure helper / read model は subtitle、spokenText、speaker、character variant、voice state を persistent canvas state として扱わず、これらだけの変更で full preview を表示しない。

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

現行のバージョン番号は `implementation-spec.md` 4.4 の表を採用する。互換性を確認して `pnpm-lock.yaml` へ固定し、自動でメジャーアップデートしない。

### 17.4 WebUI

**確定仕様**

WebUI は単一ユーザーがローカル環境で使用し、同じ `project.json` を制作データの正本として編集する。workspace 共通の `CharacterVisualSet` と配下の visual / variant / file metadata、Asset library の Asset / version、`ScreenTemplate` は SQLite から取得し、project-specific な character binding、line の `characterVariantId`、section の template selection、編集フェーズの `edit` だけを `project.json` に保存する。まず 6.1 の入力作成と 6.2 の構成案生成・レビューを行い、構成案の承認・最新性を確認した後、6.3 の `/script` を台本画面として使い、その後 6.6 の `/edit` で動画要素と BGM を編集する。Asset の登録・更新は `/assets`、キャラクタービジュアルの登録・更新は `/character-visuals`、ScreenTemplate の登録・編集は `/screen-templates` のワークスペース画面で行う。

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
- `/projects/{projectId}/edit` 編集画面（section card、動画要素、BGM、volume）
- `/assets` 素材の追加・一覧 / search / filter / paging・detail・metadata 編集・差し替え・利用停止・再有効化
- `/screen-templates` 一覧・作成・status / revision 表示
- `/screen-templates/{templateId}` の 16:9 canvas editor

セクションは折りたたみ可能なカードとして表示する。各カードでは `intro`、`main`、`outro`、タイトル、概要、キーポイント、目標尺、必須事項、禁止事項、台本制約、入力資料への参照、要確認事項を編集できるようにする。

AI が生成する内容と人間が入力する指示を視覚的にもデータ上も分離する。人間が入力した必須事項、禁止事項、台本制約は、明示的に削除しない限り AI の再生成で上書きしない。

編集内容はプロジェクトフォルダーへ自動保存する。構成案だけは、台本の初期化と制作コンテキストの前提として承認・最新性を確認する。台本、セリフカード上のキャラクタービジュアル、音声は同じ制作画面で編集し、generic 現場素材の検索・割り当ては分離した補助導線で扱う。承認操作を後工程の開始条件にしない。

`/screen-templates` は workspace SQLite に保存された active / inactive template の一覧を表示し、template の実在項目を TypeScript 静的配列から補わない。editor は `dialogue-window` 1 件、`section-title` 1 件、`speaker-1` / `speaker-2` の `character-visual` 2 件、`primary` の `content-slot` 1 件を編集対象として表示する。drag、resize、rotation、font size、`flipX`、数値入力、keyboard 操作を行い、contained element の canvas 外、character の完全 off-canvas、cardinality 違反を保存前に表示する。character の interaction overlay は render clipping layer と分離し、template-level の「デフォルトに戻す」は 1 個だけ置く。個別 reset は提供しない。

editor のサイドバーでは active な CharacterVisualSet / variant と必要な generic Asset を preview 素材として選択できる。preview 選択は一時 UI state として扱い、`ScreenTemplate` に `visualId`、`variantId`、`assetId` を保存しない。default reset は immutable seed を使い、preview 素材と sample text を保持する。production compile は template geometry と project の実際の line / background / assignment を別途解決する。

#### 台本編集画面

これは Issue #97（CV-04）後の `/projects/{projectId}/script` 台本画面の基本仕様である。画面はセクションとセリフカードを中心とする 1 ペイン構成とし、キャラクタービジュアルの選択を人間の明示操作で完結させる。プレビュー、背景、VOICEVOX 音声生成・調整などの補助機能を残す場合も、CV-05 が除去した legacy right pane を主導線にせず、各セリフカードとセクションの文脈へ統合する。VP-03 の line-card media cue pane はこの除去対象には含まれない。

現在の標準 `/projects/{projectId}/script` 画面には、CV-05 が除去した legacy right pane にあった次の UI を置かない。

- 現在の編集対象
- 制作 ビジュアル候補
- AI によるビジュアル候補 UI
- 手順3-3 素材検索
- 素材検索結果
- 素材制作・表示設定カード

この「置かない」は VP-03 の line-card media cue pane を除外する記述ではない。VP-03 は generic `VisualAssignment` の選択・再生状態・cue 操作・差し替えを line card の右側で扱う現行標準 UI である。

これは AI visual suggestion、現場素材用 Asset Search、generic `VisualAssignment` の backend、service、schema、ログ、データを削除する指定ではない。必要な機能は別画面または補助導線として維持し、キャラクタービジュアル選択の標準経路とは分離する。

各セリフカードは、通常表示時に本文量で高さが増えない compact な 4 行構成とする。本文の 3 行と操作 1 行を分け、入力領域は編集時だけ expand する。

```text
1 行目: セリフ ID | 話者 | character physical variant | 音声再生 | 音声再生成 | 音声調整
2 行目: subtitleText（セリフ表示）
3 行目: spokenText / よみがな（読み上げ用表示）
4 行目: 上へ移動 | 下へ移動 | 複製 | 削除
```

- 1 行目の variant は選択中 preview / label / renderType、または「未選択」を表示する。「ビジュアルを変更」は speaker に binding された visual の active variant だけを表示する modal picker を開く。
- 2・3 行目は通常時に compact な 1 行表示とし、選択・編集時だけ textarea 等の入力領域へ expand する。編集終了後は compact 表示へ戻す。
- 音声調整の詳細パラメータは card 内へ常時展開せず、modal / dialog の責務とする。
- 現場素材の generic assignment が存在する場合は参照表示だけを置き、character variant picker と混同しない。

読み上げテキストは、ひらがなだけでなくカタカナや読み方調整用の表記を入力する可能性があるため、UI 上では「よみがな」ではなく「VOICEVOX 読み上げ」と表記する。字幕プレビューには最終動画と同じ Remotion 字幕コンポーネントを使用し、改行、文字サイズ、はみ出しの判定を一致させる。

人間がセリフカードを 1 件ずつ追加できる操作に加え、話者付きテキストをまとめて貼り付け、セリフカードへ機械的に分割する一括入力を用意する。一括入力は AI 生成ではなく、入力テキストの構造化処理として扱う。

台本の編集内容は自動保存する。各セリフカードから `characterVariantId` の明示選択と VOICEVOX 音声生成・調整を直接操作できる。現場素材の検索・割り当て backend は維持するが、現在の標準制作画面には CV-05 の legacy right pane UI を置かない。VP-03 の line-card media cue pane は現行標準 UI として扱う。入力エラー、character binding の未設定・参照切れ・inactive・cross-visual、line variant の未選択・参照切れ、generic 素材参照切れ、音声 stale などは validation として表示し、台本承認操作を要求しない。

section header では section 全体の template だけを選択し、line card には template selector、inherit badge、「セクション設定に戻す」を置かない。inactive template は通常候補に出さないが、既存の明示参照が inactive / missing になった場合は自動置換せず、section header から修正する対象として表示する。section の先頭 line、section / background の境界、generic visual の persistent canvas state が変化する line では full screen preview を表示し、それ以外は dialogue / subtitle 領域だけの compact preview を表示する。大量の `@remotion/player` 起動は必須にせず、両方とも production render と同じ resolved layout の表示領域だけを使うことを必須とする。

#### 編集画面

`/projects/{projectId}/edit` は台本の後ろに置く独立した編集画面である。台本の `script.sections` を読み取り専用のセクションカードとして表示し、セクションの追加、削除、並べ替え、名前変更は行わない。未編集状態ではセクションカードだけを表示し、編集後はセクション間に動画要素カードと各セクションの BGM 状態を表示する。

- 最初のセクション前には `intro` を最大 1 件、最後のセクション後には `outro` を最大 1 件配置できる。
- 最初のセクションを除くセクション境界には `cutin` を 0 件以上配置できる。同じ境界に複数配置した場合は動画要素カード同士の drag & drop で順序だけを変更する。最初のセクション直前には配置できない。
- 動画要素カードの追加、登録済み MP4 Asset の選択・差し替え・削除、音量調整、並べ替えを行う。cutin をセクション内部の任意時刻へ置く操作は提供しない。
- セクションカードから登録済み MP3 の BGM を追加、差し替え、解除、単体試聴、音量調整する。BGM は 1 セクション 0/1 件で固定 loop とし、開始オフセット、トリム、フェード、ダッキングを編集しない。
- video / BGM picker は選択・差し替え時点で active な対応 kind の Asset の currentVersion だけを候補にし、任意ファイルや OS path を受け付けない。current AssetVersion の `version` / `checksum` は `assetVersion` / `assetChecksum` として `assetId`、`projectMediaPath` とともに project snapshot へ保存する。snapshot 作成後の live な status は出力条件にしない。
- 動画要素と BGM の volume は 0〜1 の範囲で保存する。旧 generic `muted` を表示・保存せず、`true` を 0、`false` を 1 へ変換する処理は ED-01 migration に限定する。

編集画面は台本のセクション列を正本として扱う。保存時には role、配置可能な境界、同一境界内の順序、選択時の Asset `active`、project 内ファイルの存在・形式・`assetChecksum`、volume、BGM の重複を検証し、エラー箇所をカードへ表示する。出力時は project snapshot だけを入力とし、live な Asset `status` を再確認しない。

#### キャラクタービジュアル画面

`/character-visuals` はワークスペース共通のキャラクタービジュアル一覧と登録画面である。サイドバーから常に開ける独立した画面とし、プロジェクト選択や `/projects/{projectId}/script` の状態に依存させない。一覧では `name`、`description`、`status`、登録済み variant 数、完成 variant 数、キャンバス基準サイズを表示する。

登録・編集画面では、`CharacterVisualSet` の基本情報、variant の `label`、`renderType`、`tags`、ファイル slot を編集する。全表情・全ポーズの一括登録は要求せず、未登録の variant は未登録として表示する。variant 作成フォームでは、`single-image` の `single`、`mouth-pair` の `closed` / `open` を揃えてから登録する。slot 欠落、形式不正、checksum 不一致、visual 基準キャンバスとの不一致は登録リクエストの validation として表示し、不完全な variant を永続化しない。既存の完成 variant は complete file set 単位で差し替えできるが、必須 slot の削除は行わない。`mentor` / `learner` の役割付与、プロジェクト選択、論理表情との mapping はこの画面に置かない。

WebUI は SQLite、キャラクターファイル、ローカルファイルシステムを直接操作しない。登録・更新は Fastify API に渡し、画像表示も管理された配信経路を使用する。

#### キャラクター素材確認画面

`/projects/{projectId}/characters` は、`project.json` の VOICEVOX 話者と `CharacterVisualSet` の project-specific binding、および workspace SQLite の現在の `CharacterVisualCatalogSnapshot` を組み合わせて表示する確認画面である。`visualId === characterId` を前提にせず、binding がない場合は「未設定」と表示する。snapshot に存在しない、inactive、別 visual の参照は別 variant へ置き換えず、validation error として表示する。

#### キャラクタービジュアル modal picker

セリフカードの「ビジュアルを変更」から開く modal picker は、対象 line の speaker に project 上で binding された一つの `CharacterVisualSet` の active variant だけを表示する。タグ未指定では active variant をすべて表示し、タグ指定時は一致数の多い variant を上位へ移動するだけで、一致しない variant も残す。同点では catalog snapshot の決定論的な元順序を維持する。各 variant は preview、label、renderType、tags、選択中状態を表示し、`mouth-pair` は `closed` / `open` の双方を確認できる。`single-image` に存在しない口差分を生成・推測しない。

#### 素材ライブラリ画面

素材ライブラリ画面 `/assets` では、動画、BGM、写真、帳票スキャン、効果音の登録、一覧・検索・filter・paging、detail、サムネイル確認、metadata 編集、file 差し替え、利用停止、再有効化を行う。ファイル名だけに依存せず、title、description、分類タグ、素材種別、department、system、confidentiality、Asset status、current version、version processing/error を表示する。`bgm` と `sound_effect` を動画・写真だけの画面として扱わない。

metadata 編集で更新できるのは title、description、confidentiality、department、system、tagIds とする。kind と、checksum、size、duration、width、height、page count、MIME、extension、thumbnail path など file-derived technical metadata は read-only とする。通常の「削除」ボタンは「利用停止」と表示し、DB row、managed media、thumbnail、version history を物理削除しない。inactive Asset は新規 candidate から除外するが、既存 project snapshot は変更しない。

file 差し替えは同じ `assetId` の次 version を作成する。candidate が processing / error の間は旧 current version の thumbnail と technical metadata を表示し、Asset 本体の active / inactive を維持する。検証済み metadata と managed file が揃った時だけ、candidate の `processing → ready` と current version 切替を同じ transaction で commit し、切替失敗時も旧 version を保持する。

#### ビジュアル選択 UI

キャラクタービジュアルの picker は「キャラクタービジュアル modal picker」の仕様に従い、現場素材用の検索 picker と統合しない。現場素材の Asset Search はキーワード、タグ、素材種別、部門、対象システム、利用状態を使う既存ドメインとして維持するが、CV-05 の legacy `/projects/{projectId}/script` right pane を標準導線にはしない。AI サジェストを実行した場合も候補と検索意図を表示するだけで、キャラクター variant や generic `VisualAssignment` を自動確定しない。VP-03 の line-card media cue pane は、これとは別の現行標準導線である。

#### バックエンド API

現行 API は少なくとも次の責務を持つ。

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
POST /api/assets/{assetId}/replace
POST /api/assets/{assetId}/deactivate
POST /api/assets/{assetId}/activate
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

`script/approve` と `visuals/approve` 相当の API が既存データ互換のため残る場合でも、通常の台本・編集画面、音声操作、Manifest 生成、プレビュー、レンダリングはそれらを呼び出さず、前提条件にも使用しない。

- `GET /api/models` は OpenRouter のモデル一覧を取得し、WebUI 用に必要な情報へ整形して返す。
- WebUI は入出力単価がともに `0` のモデルを `free`、それ以外を `paid` としてモデル一覧を絞り込める。
- 構成案生成 API は完了した JSON を一括で返す。現行仕様ではストリーミングを行わない。
- 受信した JSON は保存前に Zod で検証する。
- API エラー、JSON Schema 違反、入力超過、未解決の要確認事項を区別して表示する。
- OpenRouter API キーは環境変数 `OPENROUTER_API_KEY` からバックエンドだけが読み取り、レスポンス、ログ、ブラウザストレージへ出力しない。
- `GET /api/assets` はキーワード、タグ、素材種別、部門、対象システム、状態、ページングを受け取り、全 5 kind を対象にサムネイル情報、current version、technical metadata、processing/error 情報を含む検索結果を返す。通常の Asset Search / picker では `inactive` を候補から除外する。
- `PUT /api/assets/{assetId}` は title、description、confidentiality、department、system、tagIds だけを metadata として更新し、`kind` と file-derived technical metadata を受け付けない。`expectedRevision` を検証し、成功時に Asset revision を増やす。
- `POST /api/assets/{assetId}/replace` は同じ kind の multipart file と `expectedRevision` を受け、受付時点の Asset `revision` / `currentVersion` / staging locator を candidate の `baseRevision` / `baseCurrentVersion` / `stagingPath` として永続化する。`stagingPath` は `staging/{uploadId}/upload.bin` のような staging root 相対値とする。extension / MIME / 実ファイル形式、checksum、technical metadata、thumbnail 処理が成功するまで current version を変更せず、candidate は `processing` のまま保持する。candidate の `ready` 化、current version activation、revision increment は同じ SQLite transaction で行い、commit 前の crash では persisted staging locator 付きの processing candidate を worker が再取得する。
- `POST /api/assets/{assetId}/deactivate` と `POST /api/assets/{assetId}/activate` は Asset の status だけを `inactive` / `active` へ変更する soft delete / reactivate 操作であり、いずれも `expectedRevision` を検証する。`DELETE /api/assets/{assetId}` は通常 API に追加しない。
- `GET /api/assets/{assetId}` の detail は current version を最大 version row の暗黙値ではなく明示的な current identity として返し、各 version の status、error、checksum、managed file、thumbnail、technical metadata を確認できるようにする。
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
- ワークスペース共通の SQLite に、`ScreenTemplate` の `templateId`、name、description、status、1920 × 1080 canvas、revision、element 定義、created / updated timestamps を保存する。テンプレートの実在一覧と構造データはこの DB だけを正本とし、TypeScript の静的配列と二重管理しない。
- 素材ファイル本体とサムネイルは `library/` 配下へ保存し、SQLite にはバイナリ本体ではなく相対パス、技術情報、チェックサムを保持する。
- キャラクタービジュアルのファイル本体は `library/character-visuals/{visualId}/{variantId}/` に保存し、新規登録ファイルを `public/` へ直接保存しない。WebUI の画像表示は Fastify の管理された配信経路を使う。
- SQLite は素材の発見と改善分析には必要だが、確定済みプロジェクトのレンダリングには不要とする。generic `VisualAssignment` はプロジェクトの `media/visuals/` へコピーした素材の `assetId`、`assetChecksum`、`projectMediaPath` を固定し、ED-01 の編集 Asset は `assetVersion` / `assetChecksum` を含む専用 snapshot を固定する。
- `project.json` は引き続き動画制作データの正本であり、ワークスペース共通の `CharacterVisualSet` 一覧や登録ファイルを埋め込まない。プロジェクトで採用する visual と待機用 variant の binding、各 line の physical variant 参照、編集 Asset の snapshot だけを保存する。logical expression から physical variant への自動 mapping は定義しない。
- `project.json` には ScreenTemplate の catalog や preview 素材を埋め込まず、現行 1.4.0 では `script.sections[].screenTemplateId` だけを project-specific な選択参照として保存する。1.3.0 の line nullable field は migration input にだけ存在する。VP-01 の video display へ `playbackCues` を追加する場合も editor の実素材選択は一時 UI state とし、`visualId`、`variantId`、`assetId` を template 本体へ書き込まない。
- ED-01 以降は、編集フェーズの `edit.videoElements` と `edit.sectionBgms` に登録済み Asset の `assetId`、`assetVersion`、`assetChecksum`、`projectMediaPath`、配置、順序、volume を保存する。旧 BGM path や placeholder を current `edit` の正本として保存しない。
- 完成動画とサムネイルは `projects/{projectId}/output/` へ保存する。
- 生成途中の音声・プレビューは `cache/` と `audio/` へ分離する。
- プロジェクト JSON とプロンプトは Git で履歴管理する。
- SQLite ファイルはバイナリで差分確認に適さないため、Git 履歴の正本にはしない。素材メタデータ、タグ辞書、改善ログは、UTF-8 の JSON Lines（拡張子 `.jsonl`）へエクスポートできるようにする。
- 大容量の素材動画・写真・帳票、音声、完成 MP4 は原則として Git の対象外にする。

### 17.6 VOICEVOX

**推奨案**

- Windows の `start-app.bat` は、既存の `pnpm dev` 起動処理から VOICEVOX ENGINE のライフサイクルも管理する。
- `VOICEVOX_ENGINE_URL` が未設定、空文字、または既定値 `http://127.0.0.1:50021` の場合だけ、標準パス `%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe` を自動管理する。
- API の接続先は環境変数 `VOICEVOX_ENGINE_URL` で設定し、既定値を `http://127.0.0.1:50021` とする。
- 起動前に `/version` と `/speakers` の両方が VOICEVOX として妥当な HTTP 応答を返すか確認する。既存 ENGINE は再利用し、起動前から存在したプロセスを終了しない。
- 既定 URL に ENGINE がなく、標準パスに `run.exe` が存在する場合は、`--host 127.0.0.1 --port 50021 --use_gpu` でバックグラウンド起動し、readiness をポーリングする。GPU 起動が成立しない場合だけ、起動したプロセスを回収して `--no-use_gpu` を 1 回試す。
- GPU 起動後の再確認が `port-occupied` の場合は、所有する GPU ENGINE を終了してから 50021 を再確認する。`unreachable` なら CPU fallback、`port-occupied` なら外部サービスを終了せず CPU を起動しない、`ready` なら外部 VOICEVOX ENGINE を再利用する。
- `run.exe` は標準出力・標準エラーを捨て、Windows のコンソールウィンドウを表示しない。GPU/CPU の試行がともに失敗しても、Web/API は起動し、音声機能だけを利用不可とする。
- 50021 が別の HTTP サービスに使われている場合は、そのサービスを起動・終了せず、VOICEVOX を利用不可として Web/API の起動を継続する。
- `VOICEVOX_ENGINE_URL` に既定値以外が明示されている場合は外部管理とみなし、ローカル `run.exe` を起動・終了しない。
- `pnpm dev` が起動した ENGINE の PID だけを、Web/API の終了、`SIGINT`、`SIGTERM` 時に子孫プロセスを含めて終了する。ENGINE 単体の異常終了では Web/API を終了せず、自動再起動もしない。
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
- 現行状態では用途別上書きを空にし、すべての用途を `google/gemma-4-31b-it` へ解決する。用途別にプロンプト、structured output schema、評価指標は分離しておく。
- 選択したモデル ID は生成結果そのものではなく実行情報として記録し、構成案から `generationRunId` で参照する。
- 現行仕様では WebUI、OpenCode、レビュー、検索意図、レイアウトレビューの既定モデルを Gemma 4 31B Instruct、OpenRouter モデル ID を `google/gemma-4-31b-it` とする。
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
- 現行仕様では非ストリーミングで生成する。

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

**現行初期設定と評価方針**

- プロジェクト作成時の初期値は `google/gemma-4-31b-it` とする。
- 用途別上書きの初期値は空とし、OpenCode を含むすべての用途を同じモデルで実行する。
- 実行ログには用途 ID、解決後のモデル ID、共通既定・用途別上書き・実行時上書きのどれから選択したかを記録する。
- 現行 MVP の品質、待ち時間、トークン使用量、人間による修正量を用途別に集計し、必要な用途だけモデル分離を再検討する。

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

このフィールドは CharacterVisualSet の正本ではない。既存の 4 キーへ同じ画像を重複割り当てたり、物理 variant を推測して保存したりしない。既存プロジェクトを読み込むための互換フィールドとして残すが、CV-05 で明示的な `schemaVersion` bump と migration により新しい binding / line reference の意味を導入済みである。`1.0.0` のまま新しい意味を保存することはしない。

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

解決不能、variant 欠落、mouth slot 欠落時は自動代替せずエラーにする。CV-04 で確定した仕様は CV-05 で schema / migration / project binding / line picker / CharacterAssetsPage / compiler / Remotion へ実装済みである。旧固定 mapping が migration の compatibility input として使えるのは、既知対応を決定論的に確定できる場合だけであり、SQLite の tag や label の検索による推測は行わない。解決できないデータは未設定として人間の確認を要求する。

CV-00〜CV-03 は、キャラクタービジュアルの登録・管理をワークスペース共通資産として追加した履歴である。CV-04 で project-specific な明示選択の仕様を確定し、CV-05 で実装済みである。現場動画・写真・帳票素材ライブラリ、AI visual suggestion、generic `VisualAssignment` の backend は別ドメインとして維持する。

### 17.9 口パク

口パクの対象は、`closed` と `open` を持つ `mouth-pair` variant だけである。

- `single-image` variant に存在しない `open` 画像を推測、複製、加工して使用しない。
- `single-image` を発話中に表示する方法（静止表示など）は CV-05 で実装した Remotion の処理により、explicit に選択された variant の renderType に従って決定する。存在しない口差分を生成・推測したり、別 variant を自動代替したりしない。
- P5-04 では、解決済み `mouth-pair` の発話区間中に `closed` / `open` を定周期で切り替える。
- セリフ開始時は閉じた状態から始め、終了時と無音区間は閉じた状態とする。
- 音量解析に基づく口パクへの変更は将来の判断事項である。

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

AL-00 で確定する workspace Asset 本体は少なくとも次の概念フィールドを持つ。`revision` は stale write 検出用、`currentVersion` は現在利用する version の明示 identity であり、最大 version number や row の並び順から推測しない。

```text
assetId
revision
currentVersion: number | null
kind: video | photo | document_scan | sound_effect | bgm
title
description
tags[]
confidentiality
department
system
status: processing | active | inactive | error
createdAt
updatedAt
```

Asset version は別の version identity として少なくとも次を持つ。

```text
assetId
version
status: processing | ready | error
baseRevision
baseCurrentVersion: number | null
stagingPath: string | null
libraryMediaPath
thumbnailPaths[]
checksum
mimeType
sizeBytes
width
height
durationMs
pageCount
errorCode / errorMessage
createdAt / updatedAt
```

`durationMs` は動画、BGM、効果音に、`pageCount` は帳票に設定する。タグはタグマスターとの関連テーブルで管理し、正規名、分類軸、別名、利用状態を持たせる。Asset metadata で編集できるのは title、description、confidentiality、department、system、tagIds であり、kind と version の file-derived fields は編集できない。素材の差し替えは同じファイルを上書きせず、新しい version と checksum を持つ candidate として登録する。

Asset 本体の status と version candidate の status は分離する。初期登録では Asset が `processing`、currentVersion が null の状態を許可し、v1 の `ready` 化、currentVersion 設定、Asset `active` 化を同じ SQLite transaction で commit する。active / inactive Asset の replacement candidate が `processing` または `error` になっても Asset の status と旧 currentVersion を維持し、candidate は checksum、technical metadata、thumbnail、managed file が揃うまで `processing` のままとする。`expectedRevision`、`baseRevision`、`baseCurrentVersion` を検証する同じ transaction でだけ candidate を `ready` にして currentVersion を切り替え、`stagingPath` を null にする。ready だが non-current の新規 candidate は永続化せず、rollback / crash では `processing` と staging locator を残して worker が再開する。通常 UI は version row、managed media、thumbnail、history を物理削除しない。

非同期 worker の work item は Asset 本体の status ではなく `AssetVersion.status = processing` の `(assetId, version)` を基準に列挙する。initial upload の Asset `status = processing` は queue の正本ではなく、親 Asset が `active` / `inactive` の replacement candidate も処理する。worker は request の in-memory state に依存せず、AssetVersion に保存した `baseRevision` / `baseCurrentVersion` / `stagingPath` を読み、ready 化と current 切替を同じ finalization transaction で行う。revision conflict は旧 currentVersion と Asset status を維持したまま candidate を `error`（`REPLACEMENT_REVISION_CONFLICT`）にし、自動再 activation は行わない。次 version の確保と AssetVersion insert は同じ write transaction で行い、unique conflict 時は transaction 全体を retry する。

編集フェーズで使用する形式は次のとおり固定する。

| Asset kind | 拡張子 | MIME | 実ファイル検証 |
|---|---|---|---|
| `video`（intro / outro / cutin） | `.mp4` | `video/mp4` | MP4 container |
| `bgm` | `.mp3` | `audio/mpeg` | MP3 |

拡張子だけで登録可否を判断せず、MIME と実ファイル形式を検証する。`bgm` は編集画面の BGM picker だけで扱い、generic `VisualAssignment` の候補へ混在させない。

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

タグは `分類軸:正規名` の形式で返させる。バックエンドはタグ辞書で正規化し、未知のタグを分離してから検索する。候補スコアの内訳はUIへ返し、人間が提案理由を検証できるようにする。ベクトル検索は現在対象外とし、SQLite のタグ一致と全文検索を使用する。

#### Remotion 表示コンポーネント

現行仕様では次の 3 コンポーネントを使用する。

- `VideoVisual`: 再生区間、切り抜き、拡大率、位置、再生速度、音量（`0 <= volume <= 1`）、注釈
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

BGM と動画要素:

- BGM は `edit.sectionBgms` でセクション単位に設定し、各セクションは 0 曲または 1 曲とする。
- BGM は登録済みの MP3 Asset だけを使用し、音量を 0〜1 で設定する。対象セクションの全区間で固定 loop し、セクション終了で停止する。
- intro / outro / cutin は登録済みの MP4 Asset だけを使用し、各動画要素に音量を 0〜1 で設定する。
- 動画要素の再生中は前後セクションの BGM を再生しない。開始オフセット、トリム、フェード、音量キーフレーム、自動ダッキング、クロスフェードは対象外とする。
- 未編集状態では動画要素を挿入せず、常設の無音 placeholder を正本や `RenderManifest` に生成しない。

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
- 編集で選択する具体的な intro、outro、cutin、BGM Asset の登録内容と運用上の命名
- 素材登録時に OCR または音声文字起こしを実行し、検索対象へ含めるか

### 17.17 編集フェーズの後続実装境界

Issue #107（ED-00）は仕様書だけを更新する。以下は後続 Issue で実装する責務の境界であり、作業順序と依存関係は GitHub Issue で管理する。

| Issue | 実装責務 |
|---|---|
| ED-01 | `VideoProject 1.2.0`、`EditPlan`、`videoElements`、`sectionBgms` の型・Zod schema・migration。旧 placeholder は空状態へ移行し、旧 generic `VideoDisplay.muted` を `volume` へ変換する。`RenderManifest 2.2.0` の `muted` legacy schema を project schema から分離し、`volume` の 0 / 1 を既存 2.2.0 compiler / render 経路へ渡す adapter まで実装する。旧 BGM path は架空 Asset に変換せず migration log へ記録する。 |
| ED-02 | Asset DB の `bgm` kind と MP4 / MP3 の拡張子・MIME・実ファイル形式 validation。 |
| ED-03 | 編集 Asset の active 候補取得、project 管理領域への安全な取り込み、asset snapshot 保存 API。 |
| ED-04 | workflow の「制作」表示を「台本」へ変更し、`/projects/{projectId}/edit` の画面骨格と section card を追加。 |
| ED-05 | video element card、MP4 picker、BGM picker、追加・差し替え・削除・解除、volume UI と保存 validation。 |
| ED-06 | section card を固定したまま、video element card だけを同一境界内で drag & drop する処理。 |
| ED-07 | **ED-08 完了後に実装する。** ED-01 で変換済みの generic `VisualAssignment` の `VideoDisplay.volume` を UI、API、compiler、Remotion 側の project 表現で扱い、任意の 0〜1 を保存できるようにする。schema / migration の `muted → volume` 変換と 2.2.0 legacy adapter は担当しない。通常の preview / MP4 は ED-08 の 2.3.0 経路で任意 volume をレンダリングできる状態を前提とする。 |
| ED-08 | **ED-07 より先に実装する。** `VideoProject 1.2.0` の generic `VideoDisplay.volume` を UI が未提供でも compiler input として受け取り、`RenderManifest 2.3.0` の generic video display へ移行する。2.2.0 legacy adapter を置き換え、実動画 `RenderVideoInsert`、cutin / intro / outro の shift、section BGM の最終範囲解決も担当する。 |
| ED-09 | Remotion、プレビュー、MP4、編集画面を含む E2E と実素材検証。 |

実装順序は `ED-01〜ED-06 → ED-08 → ED-07 → ED-09` とする。ED-08 の受け入れ条件には、UIから任意 volume を保存しなくても、fixture または手動作成した `VideoProject 1.2.0` の `volume: 0.25` を `RenderManifest 2.3.0` へ解決できることを含める。これにより ED-07 完了時点で UI / API が保存できる値が通常の preview / MP4 でレンダリング不能になる中間状態を作らない。

ED-01〜ED-09 では、今回確定した配置規則、登録済み Asset 限定、project snapshot、volume、固定 loop、動画要素中の BGM 停止を拡張して自由編集機能へ広げない。

### 17.18 ST-00〜ST-08 の画面テンプレート実装境界（履歴）

Issue #129（ST-00）は本書と `implementation-spec.md` の改訂だけを行い、コード、schema、migration、API、UI、compiler、Remotion、テストコードを変更しない。現行 main の `VideoProject 1.2.0` / `RenderManifest 2.3.0` を基準に、ScreenTemplate の実装は次の Issue へ分割する。

| Issue | 実装責務 |
|---|---|
| ST-01 | workspace SQLite の ScreenTemplate entity、repository、strict validation、`screen-template-standard` の idempotent catalog / seed / migration。既存 layer の standard geometry は現行 Remotion / CSS / layout constants から調査し、現行 composition にない section-title は画面上端の要件から新規 canonical geometry として確定し、数値・根拠・参照元を記録する。 |
| ST-02 | ScreenTemplate CRUD API、status transition、revision / expected revision、element cardinality と normalized geometry の validation。 |
| ST-03 | `VideoProject 1.3.0`、section の `screenTemplateId`、line の nullable override、`1.2.0 → 1.3.0` migration。既存 project の各 section に `screen-template-standard` を明示保存し、既存 VisualAssignment を `legacy-media-frame` として扱う coordinate-space migration を行う。 |
| ST-04 | `/screen-templates`、`/screen-templates/{templateId}`、canvas editor、drag / resize / rotation / numeric input / keyboard、font size、`flipX`、実素材 preview の一時 state。 |
| ST-05 | pure な ScreenTemplate geometry resolver と preview / production 共通 layout component の確定、ScriptPage の section / line assignment UI、inactive / missing validation、line card 左側の resolved screen preview。 |
| ST-06 | ST-05 の resolver / layout component の出力を `RenderManifest 2.4.0` の `sectionTitle`、segment 化済み `RenderVisualV24[]`、resolved layout / revision / hash へ固定し、`prioritizeVisual` の縮小結果と共に Remotion へ統合する。VisualAssignment が line template override を跨ぐ場合の segment partition と動画の authoritative source trim range 継続も担当する。ST-05 と別の preview 専用 resolver は作らない。 |
| ST-07 | layout validation、rotation / overflow / overlap の検証、line-card preview と production render の parity、ScreenTemplate / assignment / migration の E2E。 |

実装順序は `ST-01 → ST-02 → ST-03 → ST-04 → ST-05 → ST-06 → ST-07 → ST-08` とする。この表は #129〜#145 で確定した履歴であり、line-level override を含む当時の設計を現在仕様へ戻すものではない。共有 template の更新は revision / hash を次回 compile input へ反映し、既存 project の明示参照を自動差し替えしない。

### 17.19 SW-00〜SW-03 の台本画面・差分 preview 実装境界

Issue #147（SW-00）は `doc/doc.md` と `implementation-spec.md` だけを更新する docs-only の仕様改訂である。コード、schema、migration、API、React UI、compiler、Remotion、テストコードは後続 Issue で実装する。#148〜#150 の実装後は `VideoProject 1.4.0` / `RenderManifest 2.4.0` を現行 baseline とし、section-only ScreenTemplate、compact line card、persistent canvas state に基づく preview mode は現行責務として扱う。pause / resume cue と 2.5.0 render contract は #151 の VP-01 / VP-02 で定義する。

| Issue | 実装責務 |
|---|---|
| SW-00 | 現在の正本文書を更新する。`VideoProject 1.3.0` の line-level fields と `VideoProject 1.4.0` の section-only contract を compatibility / current baseline として明記する。 |
| SW-01 | `VideoProject 1.3.0 → 1.4.0`、line override の削除、section authority の維持、section 分割・多数決変更なし、`lineId` / old template ID / section template ID / `migrationId` の migration log 記録。`RenderManifest 2.4.0` の意味は変更しない。 |
| SW-02 | 4 行 compact line card（本文 3 行 + 操作 1 行）、subtitle / 読み上げの edit-time expand、section header だけの template selector、voice adjustment modal / dialog。 |
| SW-03 | `persistentScreenState` の pure helper / read model、section 先頭・section / background 境界・persistent visual state change だけの full preview、通常 line の dialogue / subtitle-only compact preview、shared resolver / layout component の利用。 |

実装順序は `SW-01 → SW-02 → SW-03` とする。generic `VisualAssignment`、Asset Search、AI suggestion は削除せず、表示素材の show / hide / play / pause / resume / end は #151（VP-00）の cue model と VP-01 / VP-02 で統合する。SW-00〜SW-03 では、subtitle、spokenText、speaker、character variant、voice parameter、音声 current / stale state だけの変化を full preview trigger にしない。

### 17.20 VP-00〜VP-02 の表示素材 playback 実装境界

Issue #151（VP-00）は `doc/doc.md` と本書だけを更新する docs-only Issue である。既存 generic `VisualAssignment` / Asset pipeline を維持し、`VideoProject 1.4.0` / `RenderManifest 2.4.0` の意味をこの Issue の作業で変更しない。

| Issue | 実装責務 |
|---|---|
| VP-00 | `VisualAssignment` の asset snapshot / `startLineId` / `endLineId` authority、BEFORE / AFTER timing、video-only `VisualPlaybackCue`、cue validation、pause 中の frame / source time / video audio、playing-frame source accumulation、photo / document static semantics、ScriptPage media pane、`PersistentScreenState` integration、対象外を正本文書へ定義する。 |
| VP-01 | `VideoProject 1.4.0 → 1.5.0` migration。既存 video display へ `playbackCues: []` を追加し、写真・帳票へ cue を追加しない。cue range、state transition、deterministic order、implicit initial play / final end を保存時・出力前に検証する。 |
| VP-02 | pause / resume と natural source end を解決済み render contract へ追加する `RenderManifest 2.5.0` boundary。2.4.0 parser / cache / run log の意味を変更せず、resolved media state、cue boundary、source-end boundary、playing branch の source trim pair、paused / ended branch の一点 `sourceFrame` を WebUI preview と Remotion で共有する。 |

`VP-01 → VP-02` は cue / render contract の基盤を導入する順序である。ScriptPage の media pane は VP-03（#154）で compact line card の右側へ実装済みであり、current state から操作可否を決める。full preview の判定は action 名の比較ではなく、cue 解決後の `PersistentScreenState` が前 line と異なるかで決める。line 内任意 millisecond cue、waveform / NLE timeline、reverse、scrubbing、transition、speed keyframe、automatic slide generation、dedicated presentation parser は VP-00〜VP-02 の対象外とする。Asset library の管理 CRUD は ScriptPage の media pane に混在させず、AL-00 の `/assets` 境界で扱う。

VP-03 は #154 の ScriptPage UI 実装境界であり、現行 baseline に含まれる。ここでいう media pane は VP-00〜VP-02 の cue semantics を line card へ表示する pane であり、CV-05 が除去した legacy right pane（候補、検索、検索結果、素材制作・表示設定カード）とは別物である。VP-00〜VP-02 の「後続」「追加する」という記述は仕様作成時点の履歴・設計境界として残し、VP-03 の実装済み状態と矛盾しないように読む。

### 17.21 AL-00 の素材ライブラリ管理実装境界

Issue #155（AL-00）は `doc/doc.md` と本書だけを更新する docs-only の仕様改訂である。`/assets` の管理 UI は、既存 generic `VisualAssignment` の picker / media pane、`/character-visuals`、`/screen-templates` と責務を分離した workspace Asset library として後続 Issue で実装する。コード、schema、migration、API、React UI、worker は AL-00 の作業では変更しない。

| 領域 | AL-00 で確定する後続実装の責務 |
|---|---|
| 対象 | `video`、`bgm`、`photo`、`document_scan`、`sound_effect` を同じ `/assets` で管理する。 |
| metadata | title、description、confidentiality、department、system、tagIds を編集し、kind と file-derived technical metadata は編集しない。 |
| status | 通常の削除は `inactive` 化。再有効化を提供し、inactive は新規 candidate から除外する。物理 purge / orphan GC は対象外。 |
| concurrency | Asset `revision` と `expectedRevision` で metadata、status、current version activation の stale write を拒否する。replacement candidate には受付時点の `baseRevision`、`baseCurrentVersion`、`stagingPath` を永続化し、worker は finalization transaction 内で現在値と照合する。revision conflict は同じ transaction で candidate を `error`（`REPLACEMENT_REVISION_CONFLICT`）として旧 current version を維持し、自動再 activation は行わない。 |
| version | Asset に explicit `currentVersion` を持たせ、version status (`processing` / `ready` / `error`) と error history を保持する。最大 version number を current とみなさない。 |
| worker queue | work item は `AssetVersion.status = processing` の `(assetId, version)` を基準に列挙する。initial upload の `Asset.status = processing` は queue の正本ではなく、`active` / `inactive` Asset の replacement candidate も同じ worker で処理する。processing service は親 Asset status だけを理由に candidate を `skipped` にしない。`stagingPath` は `staging/{uploadId}/upload.bin` のような staging root 相対 locator として永続化する。 |
| replacement | 同じ `assetId` に次 version candidate を作り、検証・thumbnail・technical metadata・managed file が揃った candidate の `processing → ready` と current 切替を同じ SQLite transaction で commit する。ready だが non-current の新規 candidate を永続化せず、rollback / crash では processing と stagingPath を残して再列挙する。次 version の確保と AssetVersion insert も同一 transaction で行い、unique conflict 時は transaction 全体を retry する。失敗時と切替 transaction failure 時は旧 current version を維持する。 |
| snapshot | library の metadata / status / version 更新で既存 project の Asset snapshot を自動更新しない。再選択時だけ current active version を snapshot する。 |

後続実装では initial upload、metadata update、replace、activate / deactivate、一覧検索、detail、paging、processing/error 表示を API と `/assets` UI へ接続する。`DELETE /api/assets/{assetId}`、Asset kind 変更、version rollback UI、immutable version diff viewer、tag dictionary CRUD、bulk upload、folder import、cloud storage は AL-00 の対象外とする。

## 18. MVP 完了確認と再現条件

MVP の対象実装が完了したことを確認する最小条件は、次の一連の処理が通ることである。これは完了確認と再現性の基準であり、現在の未実装作業一覧ではない。

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
