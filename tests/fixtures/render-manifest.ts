import type { RenderManifest } from "../../src/schema/index.js";

const SOURCE_HASH =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const VIDEO_CHECKSUM =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PHOTO_CHECKSUM =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const DOCUMENT_CHECKSUM =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const CHARACTER_CHECKSUM =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const COMPILER_INPUT_HASH =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

export const renderManifestFixture = {
  manifestVersion: "2.2.0",
  sourceProjectHash: SOURCE_HASH,
  compilerInputHash: COMPILER_INPUT_HASH,
  characterCatalogVersion: "1.0.0",
  characterMappingVersion: "1.0.0",
  characters: [
    {
      characterId: "character-mentor",
      visualId: "character-mentor",
      displayName: "四国めたん",
      themeColorToken: "character.metan",
      lipSyncPeriodFrames: 3,
      idleVariantId: "character-mentor-stand-v1"
    },
    {
      characterId: "character-learner",
      visualId: "character-learner",
      displayName: "ずんだもん",
      themeColorToken: "character.zundamon",
      lipSyncPeriodFrames: 3,
      idleVariantId: "character-learner-stand-v1"
    }
  ],
  characterVariants: [
    {
      variantId: "character-learner-stand-v1",
      visualId: "character-learner",
      renderType: "single-image",
      files: {
        single: {
          path: "shared-assets/characters/character-learner/stand/stand.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    },
    {
      variantId: "character-learner-speak-normal-v1",
      visualId: "character-learner",
      renderType: "mouth-pair",
      files: {
        closed: {
          path: "shared-assets/characters/character-learner/speak-normal/closed.png",
          sha256: CHARACTER_CHECKSUM
        },
        open: {
          path: "shared-assets/characters/character-learner/speak-normal/open.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    },
    {
      variantId: "character-learner-speak-pointing-v1",
      visualId: "character-learner",
      renderType: "mouth-pair",
      files: {
        closed: {
          path: "shared-assets/characters/character-learner/speak-pointing/closed.png",
          sha256: CHARACTER_CHECKSUM
        },
        open: {
          path: "shared-assets/characters/character-learner/speak-pointing/open.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    },
    {
      variantId: "character-mentor-speak-normal-v1",
      visualId: "character-mentor",
      renderType: "mouth-pair",
      files: {
        closed: {
          path: "shared-assets/characters/character-mentor/speak-normal/closed.png",
          sha256: CHARACTER_CHECKSUM
        },
        open: {
          path: "shared-assets/characters/character-mentor/speak-normal/open.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    },
    {
      variantId: "character-mentor-speak-pointing-v1",
      visualId: "character-mentor",
      renderType: "mouth-pair",
      files: {
        closed: {
          path: "shared-assets/characters/character-mentor/speak-pointing/closed.png",
          sha256: CHARACTER_CHECKSUM
        },
        open: {
          path: "shared-assets/characters/character-mentor/speak-pointing/open.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    },
    {
      variantId: "character-mentor-stand-v1",
      visualId: "character-mentor",
      renderType: "single-image",
      files: {
        single: {
          path: "shared-assets/characters/character-mentor/stand/stand.png",
          sha256: CHARACTER_CHECKSUM
        }
      }
    }
  ],
  sourceAssetChecksums: [
    { path: "media/application-demo.mp4", sha256: VIDEO_CHECKSUM },
    { path: "media/application-form.png", sha256: PHOTO_CHECKSUM },
    { path: "media/completion-report.pdf", sha256: DOCUMENT_CHECKSUM },
    {
      path: "shared-assets/characters/character-learner/speak-normal/closed.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-learner/speak-normal/open.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-learner/speak-pointing/closed.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-learner/speak-pointing/open.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-learner/stand/stand.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-mentor/speak-normal/closed.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-mentor/speak-normal/open.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-mentor/speak-pointing/closed.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-mentor/speak-pointing/open.png",
      sha256: CHARACTER_CHECKSUM
    },
    {
      path: "shared-assets/characters/character-mentor/stand/stand.png",
      sha256: CHARACTER_CHECKSUM
    }
  ],
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 480,
  lines: [
    {
      id: "intro-mentor-1",
      sectionId: "section-intro",
      from: 60,
      durationInFrames: 45,
      speechFrom: 0,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-intro-mentor.wav",
      subtitleText: "社内申請の登録手順を説明します。",
      speakerId: "character-mentor",
      expression: "explain",
      characterVariantId: "character-mentor-speak-pointing-v1"
    },
    {
      id: "intro-learner-1",
      sectionId: "section-intro",
      from: 105,
      durationInFrames: 40,
      speechFrom: 3,
      speechDurationInFrames: 35,
      audioPath: "audio/speech-intro-learner.wav",
      subtitleText: "まず、申請前の確認から始めます。",
      speakerId: "character-learner",
      expression: "neutral",
      characterVariantId: "character-learner-speak-normal-v1"
    },
    {
      id: "main-mentor-1",
      sectionId: "section-main",
      from: 210,
      durationInFrames: 45,
      speechFrom: 0,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-main-mentor.wav",
      subtitleText: "申請メニューから「新規申請」を選びます。",
      speakerId: "character-mentor",
      expression: "explain",
      characterVariantId: "character-mentor-speak-pointing-v1"
    },
    {
      id: "main-learner-1",
      sectionId: "section-main",
      from: 255,
      durationInFrames: 50,
      speechFrom: 2,
      speechDurationInFrames: 42,
      audioPath: "audio/speech-main-learner.wav",
      subtitleText:
        "申請内容を確認してから、必要な添付資料と入力値に誤りがないことを確認して登録します。\n不明点がある場合は、登録前に担当者へ確認してください。",
      speakerId: "character-learner",
      expression: "caution",
      characterVariantId: "character-learner-speak-pointing-v1"
    },
    {
      id: "outro-mentor-1",
      sectionId: "section-outro",
      from: 375,
      durationInFrames: 45,
      speechFrom: 0,
      speechDurationInFrames: 40,
      audioPath: "audio/speech-outro-mentor.wav",
      subtitleText: "完了画面が表示されたら登録終了です。",
      speakerId: "character-mentor",
      expression: "smile",
      characterVariantId: "character-mentor-speak-normal-v1"
    }
  ],
  visuals: [
    {
      id: "visual-intro-video",
      from: 60,
      durationInFrames: 85,
      src: "media/application-demo.mp4",
      kind: "video",
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
      from: 210,
      durationInFrames: 95,
      src: "media/application-form.png",
      kind: "photo",
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
      from: 375,
      durationInFrames: 45,
      src: "media/completion-report.pdf",
      kind: "document_scan",
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
      from: 210,
      durationInFrames: 95,
      background: {
        kind: "image",
        src: "backgrounds/application-system.png",
        fit: "cover"
      }
    },
    {
      sectionId: "section-outro",
      from: 375,
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
      from: 210,
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
      from: 260,
      durationInFrames: 12,
      src: "media/confirm.wav",
      volume: 0.2
    },
    {
      id: "effect-attention",
      lineId: "outro-mentor-1",
      category: "attention",
      from: 375,
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
      durationInFrames: 60,
      label: "section-main"
    },
    {
      id: "insert-ending",
      kind: "placeholder",
      slot: "ending",
      beforeSectionId: null,
      from: 420,
      durationInFrames: 60,
      label: "ending"
    }
  ]
} satisfies RenderManifest;
