# WebUI concept image prompt

Generation mode: built-in `image_gen`  
Use case: `ui-mockup`

```text
Asset type: high-fidelity desktop web application mockup for a local internal video-production tool

Create a polished, realistic desktop WebUI mockup for a Japanese internal manual video production system. Show the main script editing workspace where a user edits dialogue, previews the generated Remotion video, assigns registered workplace media, and checks VOICEVOX audio status.

Use a full 16:9 browser application viewport without browser chrome. Make it a practical, shippable enterprise productivity UI with a precise grid and crisp Japanese sans-serif typography. Use a dark navy left navigation rail, a cool blue-gray application background, white cards, a blue primary accent, teal success states, and restrained orange warnings. Avoid gradients and glassmorphism.

Lay out a roughly 220px left navigation rail, a large central workspace, and a roughly 340px right inspector. Put a 16:9 video preview at the top of the central workspace and a scrollable list of dialogue cards beneath it.

Required labels and content:
- Header: "経費精算マニュアル"
- Status: "保存済み"
- Left navigation: "プロジェクト", "企画", "構成案", "台本", "素材", "音声", "プレビュー", "出力"
- Progress steps: "企画", "構成案", "台本", "ビジュアル", "音声", "出力"; first three complete and ビジュアル active
- Preview: mock expense-entry application, two friendly guide characters, subtitle "領収書を確認して、申請内容を入力します。"
- Dialogue cards: speaker chips "A" and "B", fields "字幕" and "VOICEVOX 読み上げ", badges "生成済み" and "要再生成", assigned-media thumbnails
- Inspector tabs: "ビジュアル", "背景", "キャラクター"; ビジュアル selected
- Inspector fields: "適用範囲", "表示方法", "切り抜き"; toggle "ビジュアルを優先"
- Buttons: "素材を検索", "AIで候補を提案"
- Validation summary: "エラー 0件"

Keep spacing generous and hierarchy readable. Do not add analytics charts, brand logos, watermarks, English navigation, marketing-page elements, or a device frame. Avoid tiny illegible text. Render the specified Japanese labels as accurately as possible and do not repeat them unnecessarily.
```
