import type { VideoProject } from "../../src/schema/index.js";

const SOURCE_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VIDEO_CHECKSUM =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PHOTO_CHECKSUM =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DOCUMENT_CHECKSUM =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const AUDIO_CHECKSUM =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const videoProjectFixture = {
  schemaVersion: "1.1.0",
  revision: 0,
  metadata: {
    id: "manual-video-project",
    title: "申請手順の基本",
    description: "社内申請システムで申請を登録する手順を説明します。",
    department: "総務部",
    manualVersion: "2026.08",
    createdAt: "2026-08-02T12:00:00.000Z",
    updatedAt: "2026-08-02T12:00:00.000Z",
    outputSettings: {
      width: 1920,
      height: 1080,
      fps: 30,
      videoCodec: "h264",
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioSampleRate: 48000,
      audioChannels: 2
    }
  },
  source: {
    id: "source-manual",
    path: "source/source.md",
    sha256: SOURCE_HASH
  },
  brief: {
    audience: "新しく配属された社員",
    postViewingGoal: "申請を一人で登録できること",
    prerequisites: ["社内アカウントを取得していること"],
    targetDurationSec: 120,
    requiredItems: ["申請前の確認", "登録完了の確認"],
    prohibitedItems: ["実在する個人情報の表示"],
    globalDirectives: ["画面上のボタン名を字幕でも説明する"]
  },
  aiSettings: {
    defaultModelId: "google/gemma-4-31b-it",
    taskModelOverrides: {},
    zdr: true,
    dataCollection: "deny",
    allowProviderFallbacks: true
  },
  characters: [
    {
      id: "character-mentor",
      name: "四国めたん",
      role: "mentor",
      personality: "落ち着いて手順を案内する",
      speakingStyle: "丁寧で簡潔",
      voicevox: {
        speakerName: "四国めたん",
        speakerUuid: null,
        styleName: "ノーマル"
      },
      themeColorToken: "character.metan",
      voice: {
        speedScale: 1,
        pitchScale: 0,
        intonationScale: 1,
        volumeScale: 1,
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.1
      },
      lipSyncPeriodFrames: 3,
      characterVisual: {
        visualId: "character-mentor",
        idleVariantId: "character-mentor-stand-v1"
      },
      visualAssets: {
        neutral: {
          closed: "characters/character-mentor/neutral/closed.png",
          open: "characters/character-mentor/neutral/open.png"
        },
        smile: {
          closed: "characters/character-mentor/smile/closed.png",
          open: "characters/character-mentor/smile/open.png"
        },
        explain: {
          closed: "characters/character-mentor/explain/closed.png",
          open: "characters/character-mentor/explain/open.png"
        },
        caution: {
          closed: "characters/character-mentor/caution/closed.png",
          open: "characters/character-mentor/caution/open.png"
        }
      }
    },
    {
      id: "character-learner",
      name: "ずんだもん",
      role: "learner",
      personality: "疑問を素直に確認する",
      speakingStyle: "親しみやすく率直",
      voicevox: {
        speakerName: "ずんだもん",
        speakerUuid: null,
        styleName: "ノーマル"
      },
      themeColorToken: "character.zundamon",
      voice: {
        speedScale: 1.05,
        pitchScale: 0,
        intonationScale: 1,
        volumeScale: 1,
        prePhonemeLength: 0.1,
        postPhonemeLength: 0.1
      },
      lipSyncPeriodFrames: 3,
      characterVisual: {
        visualId: "character-learner",
        idleVariantId: "character-learner-stand-v1"
      },
      visualAssets: {
        neutral: {
          closed: "characters/character-learner/neutral/closed.png",
          open: "characters/character-learner/neutral/open.png"
        },
        smile: {
          closed: "characters/character-learner/smile/closed.png",
          open: "characters/character-learner/smile/open.png"
        },
        explain: {
          closed: "characters/character-learner/explain/closed.png",
          open: "characters/character-learner/explain/open.png"
        },
        caution: {
          closed: "characters/character-learner/caution/closed.png",
          open: "characters/character-learner/caution/open.png"
        }
      }
    }
  ],
  outline: {
    status: "approved",
    sourceHash: SOURCE_HASH,
    generationRunId: "outline-generation-run",
    openQuestions: [
      {
        id: "question-source",
        question: "申請前に確認する項目は何ですか。",
        resolution: "必須項目と添付資料を確認します。",
        status: "resolved"
      }
    ],
    sections: [
      {
        id: "outline-intro",
        order: 1,
        role: "intro",
        title: "はじめに",
        overview: "動画で扱う申請手順の全体像を紹介します。",
        keyPoints: ["対象となる申請", "動画の流れ"],
        targetDurationSec: 20,
        sourceRefs: [
          { sourceId: "source-manual", headingPath: ["概要"] }
        ],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["動画の目的"],
          prohibitedItems: [],
          scriptConstraints: ["最初に対象者を示す"]
        },
        lockedFields: ["role"]
      },
      {
        id: "outline-main",
        order: 2,
        role: "main",
        title: "申請を登録する",
        overview: "申請フォームを開いて内容を入力し、登録します。",
        keyPoints: ["フォームを開く", "内容を確認する", "登録を確定する"],
        targetDurationSec: 80,
        sourceRefs: [
          { sourceId: "source-manual", headingPath: ["操作手順", "登録"] }
        ],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["確認画面"],
          prohibitedItems: ["個人情報の実値"],
          scriptConstraints: ["一手順ずつ説明する"]
        },
        lockedFields: []
      },
      {
        id: "outline-outro",
        order: 3,
        role: "outro",
        title: "完了を確認する",
        overview: "登録結果を確認し、必要な次の行動を案内します。",
        keyPoints: ["完了表示", "問い合わせ先"],
        targetDurationSec: 20,
        sourceRefs: [
          { sourceId: "source-manual", headingPath: ["完了後"] }
        ],
        openQuestions: [],
        humanDirectives: {
          requiredItems: ["完了表示の確認"],
          prohibitedItems: [],
          scriptConstraints: []
        },
        lockedFields: []
      }
    ]
  },
  script: {
    status: "approved",
    origin: "manual",
    outlineHash: SOURCE_HASH,
    sections: [
      {
        id: "section-intro",
        outlineSectionId: "outline-intro",
        name: "はじめに",
        background: { kind: "solid", colorToken: "background" },
        lines: [
          {
            id: "intro-mentor-1",
            speakerId: "character-mentor",
            spokenText: "今回は社内申請システムで申請を登録する手順を説明します。",
            subtitleText: "社内申請の登録手順を説明します。",
            expression: "explain",
            characterVariantId: "character-mentor-speak-pointing-v1",
            pauseBeforeMs: 0,
            pauseAfterMs: 250,
            voiceOverrides: {},
            pronunciation: { mode: "dictionary", excludedTermIds: [] }
          },
          {
            id: "intro-learner-1",
            speakerId: "character-learner",
            spokenText: "まず、申請前に確認することから始めるのだ。",
            subtitleText: "まず、申請前の確認から始めます。",
            expression: "neutral",
            characterVariantId: "character-learner-speak-normal-v1",
            pauseBeforeMs: 100,
            pauseAfterMs: 250,
            voiceOverrides: { speedScale: 1.05 },
            pronunciation: { mode: "dictionary", excludedTermIds: [] }
          }
        ]
      },
      {
        id: "section-main",
        outlineSectionId: "outline-main",
        name: "申請を登録する",
        background: {
          kind: "image",
          src: "backgrounds/application-system.png",
          fit: "cover"
        },
        lines: [
          {
            id: "main-mentor-1",
            speakerId: "character-mentor",
            spokenText: "申請メニューから新規申請を選びます。",
            subtitleText: "申請メニューから「新規申請」を選びます。",
            expression: "explain",
            characterVariantId: "character-mentor-speak-pointing-v1",
            pauseBeforeMs: 0,
            pauseAfterMs: 250,
            voiceOverrides: {},
            pronunciation: { mode: "dictionary", excludedTermIds: [] }
          },
          {
            id: "main-learner-1",
            speakerId: "character-learner",
            spokenText: "入力した内容を確認してから登録するのだ。",
            subtitleText: "内容を確認してから登録します。",
            expression: "caution",
            characterVariantId: "character-learner-speak-pointing-v1",
            pauseBeforeMs: 0,
            pauseAfterMs: 250,
            voiceOverrides: {},
            pronunciation: { mode: "literal", excludedTermIds: [] }
          }
        ]
      },
      {
        id: "section-outro",
        outlineSectionId: "outline-outro",
        name: "完了を確認する",
        background: { kind: "solid", colorToken: "background" },
        lines: [
          {
            id: "outro-mentor-1",
            speakerId: "character-mentor",
            spokenText: "完了画面が表示されたら、登録は終了です。",
            subtitleText: "完了画面が表示されたら登録終了です。",
            expression: "smile",
            characterVariantId: "character-mentor-speak-normal-v1",
            pauseBeforeMs: 0,
            pauseAfterMs: 250,
            voiceOverrides: {},
            pronunciation: { mode: "dictionary", excludedTermIds: [] }
          }
        ]
      }
    ]
  },
  visuals: {
    status: "approved",
    suggestionRunIds: ["visual-search-run"],
    assignments: [
      {
        id: "visual-intro-video",
        startLineId: "intro-mentor-1",
        endLineId: "intro-learner-1",
        assetId: "asset-application-demo",
        assetChecksum: VIDEO_CHECKSUM,
        projectMediaPath: "media/application-demo.mp4",
        display: {
          kind: "video",
          fit: "cover",
          crop: { x: 0, y: 0, width: 1, height: 1 },
          scale: 1,
          position: { x: 0.5, y: 0.5 },
          prioritizeVisual: true,
          annotations: [
            {
              id: "annotation-intro-label",
              kind: "label",
              text: "申請システム",
              x: 0.1,
              y: 0.1,
              width: 0.3,
              height: 0.08,
              colorToken: "accent"
            }
          ],
          startMs: 0,
          endMs: 3000,
          playbackRate: 1,
          muted: true
        }
      },
      {
        id: "visual-main-photo",
        startLineId: "main-mentor-1",
        endLineId: "main-learner-1",
        assetId: "asset-application-form",
        assetChecksum: PHOTO_CHECKSUM,
        projectMediaPath: "media/application-form.png",
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
        startLineId: "outro-mentor-1",
        endLineId: "outro-mentor-1",
        assetId: "asset-completion-report",
        assetChecksum: DOCUMENT_CHECKSUM,
        projectMediaPath: "media/completion-report.pdf",
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
    ]
  },
  audio: {
    sectionBgms: [
      {
        id: "bgm-intro",
        sectionId: "section-intro",
        path: "audio/bgm-intro.ogg",
        volume: 0.25,
        loop: true,
        fadeInMs: 0,
        fadeOutMs: 300
      },
      {
        id: "bgm-main",
        sectionId: "section-main",
        path: "audio/bgm-main.ogg",
        volume: 0.2,
        loop: true,
        fadeInMs: 300,
        fadeOutMs: 300
      }
    ],
    soundEffects: [
      {
        id: "effect-confirm",
        soundEffectAssetId: "asset-confirm-sound",
        assetChecksum: AUDIO_CHECKSUM,
        projectMediaPath: "media/confirm.wav",
        category: "confirm",
        lineId: "main-learner-1",
        offsetMs: 100,
        volume: 0.2
      },
      {
        id: "effect-attention",
        soundEffectAssetId: "asset-attention-sound",
        assetChecksum: AUDIO_CHECKSUM,
        projectMediaPath: "media/attention.wav",
        category: "attention",
        lineId: "outro-mentor-1",
        offsetMs: 0,
        volume: 0.15
      }
    ]
  },
  inserts: {
    opening: {
      id: "insert-opening",
      kind: "placeholder",
      slot: "opening",
      durationMs: 2000
    },
    ending: {
      id: "insert-ending",
      kind: "placeholder",
      slot: "ending",
      durationMs: 2000
    },
    eyeCatches: [
      {
        id: "insert-eye-main",
        kind: "placeholder",
        slot: "eye_catch",
        beforeSectionId: "section-main",
        durationMs: 2000
      }
    ]
  },
  thumbnail: {
    backgroundImage: "thumbnail/application-system.png",
    title: "社内申請の登録手順",
    subtitle: "新規申請を迷わず登録する",
    departmentOrSystem: "社内申請システム",
    manualVersion: "2026.08",
    characterId: "character-mentor",
    representativeVisualPath: "media/application-form.png",
    layout: "standard"
  }
} satisfies VideoProject;
