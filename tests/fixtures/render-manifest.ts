import type { RenderManifest } from "../../src/schema/index.js";

const SOURCE_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VIDEO_CHECKSUM =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PHOTO_CHECKSUM =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DOCUMENT_CHECKSUM =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

export const renderManifestFixture = {
  manifestVersion: "1.0.0",
  sourceProjectHash: SOURCE_HASH,
  sourceAssetChecksums: [
    { path: "media/application-demo.mp4", sha256: VIDEO_CHECKSUM },
    { path: "media/application-form.png", sha256: PHOTO_CHECKSUM },
    { path: "media/completion-report.pdf", sha256: DOCUMENT_CHECKSUM }
  ],
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 420,
  lines: [
    {
      id: "intro-mentor-1",
      sectionId: "section-intro",
      from: 60,
      durationInFrames: 45,
      speechFrom: 60,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-intro-mentor.wav",
      subtitleText: "社内申請の登録手順を説明します。",
      speakerId: "character-mentor",
      expression: "explain"
    },
    {
      id: "intro-learner-1",
      sectionId: "section-intro",
      from: 105,
      durationInFrames: 40,
      speechFrom: 108,
      speechDurationInFrames: 35,
      audioPath: "audio/speech-intro-learner.wav",
      subtitleText: "まず、申請前の確認から始めます。",
      speakerId: "character-learner",
      expression: "neutral"
    },
    {
      id: "main-mentor-1",
      sectionId: "section-main",
      from: 165,
      durationInFrames: 45,
      speechFrom: 165,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-main-mentor.wav",
      subtitleText: "申請メニューから「新規申請」を選びます。",
      speakerId: "character-mentor",
      expression: "explain"
    },
    {
      id: "main-learner-1",
      sectionId: "section-main",
      from: 210,
      durationInFrames: 50,
      speechFrom: 212,
      speechDurationInFrames: 42,
      audioPath: "audio/speech-main-learner.wav",
      subtitleText: "内容を確認してから登録します。",
      speakerId: "character-learner",
      expression: "caution"
    },
    {
      id: "outro-mentor-1",
      sectionId: "section-outro",
      from: 330,
      durationInFrames: 45,
      speechFrom: 330,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-outro-mentor.wav",
      subtitleText: "完了画面が表示されたら登録終了です。",
      speakerId: "character-mentor",
      expression: "smile"
    }
  ],
  visuals: [
    {
      id: "visual-intro-video",
      from: 60,
      durationInFrames: 85,
      kind: "video",
      src: "media/application-demo.mp4",
      display: {
        kind: "video",
        fit: "cover",
        crop: { x: 0, y: 0, width: 1, height: 1 },
        scale: 1,
        position: { x: 0.5, y: 0.5 },
        prioritizeVisual: true,
        annotations: [],
        startMs: 0,
        endMs: 3000,
        playbackRate: 1,
        muted: true
      }
    },
    {
      id: "visual-main-photo",
      from: 165,
      durationInFrames: 95,
      kind: "photo",
      src: "media/application-form.png",
      display: {
        kind: "photo",
        fit: "contain",
        crop: { x: 0, y: 0, width: 1, height: 1 },
        scale: 1,
        position: { x: 0.5, y: 0.5 },
        prioritizeVisual: false,
        annotations: []
      }
    },
    {
      id: "visual-outro-document",
      from: 330,
      durationInFrames: 45,
      kind: "document_scan",
      src: "media/completion-report.pdf",
      display: {
        kind: "document_scan",
        fit: "contain",
        crop: { x: 0, y: 0, width: 0.95, height: 0.95 },
        scale: 1,
        position: { x: 0.5, y: 0.5 },
        prioritizeVisual: true,
        annotations: [],
        page: 1
      }
    }
  ],
  backgrounds: [
    {
      sectionId: "section-intro",
      from: 60,
      durationInFrames: 85,
      background: { kind: "solid", colorToken: "background" }
    },
    {
      sectionId: "section-main",
      from: 165,
      durationInFrames: 95,
      background: {
        kind: "image",
        src: "backgrounds/application-system.png",
        fit: "cover"
      }
    },
    {
      sectionId: "section-outro",
      from: 330,
      durationInFrames: 45,
      background: { kind: "solid", colorToken: "background" }
    }
  ],
  audioTracks: [
    {
      id: "bgm-intro",
      sectionId: "section-intro",
      from: 60,
      durationInFrames: 85,
      src: "audio/bgm-intro.ogg",
      volume: 0.25,
      loop: true,
      fadeInFrames: 0,
      fadeOutFrames: 9
    },
    {
      id: "bgm-main",
      sectionId: "section-main",
      from: 165,
      durationInFrames: 95,
      src: "audio/bgm-main.ogg",
      volume: 0.2,
      loop: true,
      fadeInFrames: 9,
      fadeOutFrames: 9
    }
  ],
  soundEffects: [
    {
      id: "effect-confirm",
      lineId: "main-learner-1",
      category: "confirm",
      from: 215,
      durationInFrames: 12,
      src: "media/confirm.wav",
      volume: 0.2
    },
    {
      id: "effect-attention",
      lineId: "outro-mentor-1",
      category: "attention",
      from: 330,
      durationInFrames: 10,
      src: "media/attention.wav",
      volume: 0.15
    }
  ],
  inserts: [
    {
      id: "insert-opening",
      kind: "placeholder",
      slot: "opening",
      beforeSectionId: null,
      from: 0,
      durationInFrames: 60,
      label: "opening"
    },
    {
      id: "insert-eye-main",
      kind: "placeholder",
      slot: "eye_catch",
      beforeSectionId: "section-main",
      from: 150,
      durationInFrames: 15,
      label: "section-main"
    },
    {
      id: "insert-ending",
      kind: "placeholder",
      slot: "ending",
      beforeSectionId: null,
      from: 375,
      durationInFrames: 45,
      label: "ending"
    }
  ]
} satisfies RenderManifest;
