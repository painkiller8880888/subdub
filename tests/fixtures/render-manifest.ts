import {
  resolveScreenTemplateLayout,
  resolveVisualDisplay
} from "../../src/screen-layout-resolver.js";
import {
  screenTemplateContentHash,
  screenTemplateLegacyContentHash
} from "../../src/app/screen-templates/screen-template-hash.js";
import { createStandardScreenTemplate } from "../../src/app/screen-templates/screen-template-seed.js";
import type {
  RenderManifest,
  RenderManifestV24,
  RenderManifestV23,
  RenderVisualV23
} from "../../src/schema/index.js";

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

export const renderManifestFixtureV23 = {
  manifestVersion: "2.3.0",
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
        volume: 0
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
      loop: true
    },
    {
      id: "bgm-main",
      sectionId: "section-main",
      from: 210,
      durationInFrames: 95,
      src: "audio/bgm-main.ogg",
      volume: 0.2,
      loop: true
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
      role: "intro",
      from: 0,
      durationInFrames: 60,
      src: "media/application-demo.mp4",
      volume: 1
    },
    {
      id: "insert-eye-main",
      role: "cutin",
      from: 150,
      durationInFrames: 60,
      src: "media/application-demo.mp4",
      volume: 0.8
    },
    {
      id: "insert-ending",
      role: "outro",
      from: 420,
      durationInFrames: 60,
      src: "media/application-demo.mp4",
      volume: 1
    }
  ]
} satisfies RenderManifestV23;

const STANDARD_TEMPLATE = createStandardScreenTemplate(
  "2026-08-10T00:00:00.000Z"
);
const STANDARD_TEMPLATE_HASH = screenTemplateContentHash(STANDARD_TEMPLATE);
const STANDARD_TEMPLATE_LEGACY_HASH =
  screenTemplateLegacyContentHash(STANDARD_TEMPLATE);
const CHARACTER_IDS = {
  "speaker-1": "character-mentor",
  "speaker-2": "character-learner"
} as const;

function lineHasPriority(line: RenderManifestV23["lines"][number]): boolean {
  return renderManifestFixtureV23.visuals.some(
    (visual) =>
      visual.display.prioritizeVisual &&
      visual.from <= line.from &&
      line.from + line.durationInFrames <= visual.from + visual.durationInFrames
  );
}

function resolvedLayoutForLine(line: RenderManifestV23["lines"][number]) {
  return resolveScreenTemplateLayout(STANDARD_TEMPLATE, {
    characterIds: CHARACTER_IDS,
    prioritizeVisual: lineHasPriority(line)
  });
}

function resolvedLayoutV26ForLine(line: RenderManifestV23["lines"][number]) {
  return resolveScreenTemplateLayout(STANDARD_TEMPLATE, {
    characterIds: CHARACTER_IDS,
    prioritizeVisual: lineHasPriority(line),
    includeDialogueWindowStyle: true
  });
}

function sectionTitle(sectionId: string): string {
  return (
    {
      "section-intro": "導入",
      "section-main": "申請手順",
      "section-outro": "完了"
    }[sectionId] ?? sectionId
  );
}

function visualLineRange(visual: RenderVisualV23) {
  const visualEnd = visual.from + visual.durationInFrames;
  const lines = renderManifestFixtureV23.lines.filter((line) => {
    const lineEnd = line.from + line.durationInFrames;
    return line.from < visualEnd && lineEnd > visual.from;
  });
  const first = lines[0] ?? renderManifestFixtureV23.lines[0];
  const last = lines[lines.length - 1] ?? first;
  if (first === undefined || last === undefined) {
    throw new Error("render manifest fixture requires at least one line");
  }
  return { startLineId: first.id, endLineId: last.id };
}

function resolvedFixtureVisual(
  visual: RenderVisualV23
): RenderManifestV24["visuals"][number] {
  const lineRange = visualLineRange(visual);
  const firstLine = renderManifestFixtureV23.lines.find(
    (line) => line.id === lineRange.startLineId
  );
  const layout = resolvedLayoutForLine(
    firstLine ?? renderManifestFixtureV23.lines[0]!
  );
  return {
    id: visual.id,
    sourceAssignmentId: visual.id,
    segmentIndex: 0,
    segmentStartLineId: lineRange.startLineId,
    segmentEndLineId: lineRange.endLineId,
    screenTemplateId: STANDARD_TEMPLATE.templateId,
    templateRevision: STANDARD_TEMPLATE.revision,
    templateHash: STANDARD_TEMPLATE_LEGACY_HASH,
    from: visual.from,
    durationInFrames: visual.durationInFrames,
    src: visual.src,
    kind: visual.kind,
    display: resolveVisualDisplay(
      {
        ...visual.display,
        displayCoordinateSpace: "legacy-media-frame"
      } as Parameters<typeof resolveVisualDisplay>[0],
      layout,
      { fps: renderManifestFixtureV23.fps }
    )
  } as RenderManifestV24["visuals"][number];
}

const {
  lines: legacyLines,
  visuals: legacyVisuals,
  backgrounds: legacyBackgrounds,
  audioTracks: legacyAudioTracks,
  soundEffects: legacySoundEffects,
  inserts: legacyInserts,
  ...manifestHeader
} = renderManifestFixtureV23;

export const renderManifestFixtureV24: RenderManifestV24 = {
  ...manifestHeader,
  manifestVersion: "2.4.0",
  sectionLayouts: [
    ...new Set(renderManifestFixtureV23.lines.map((line) => line.sectionId))
  ].map((sectionId) => ({
    sectionId,
    sectionTitle: sectionTitle(sectionId),
    templateId: STANDARD_TEMPLATE.templateId,
    templateRevision: STANDARD_TEMPLATE.revision,
    templateHash: STANDARD_TEMPLATE_LEGACY_HASH,
    resolvedLayout: resolveScreenTemplateLayout(STANDARD_TEMPLATE, {
      characterIds: CHARACTER_IDS
    })
  })),
  lines: legacyLines.map((line) => ({
    ...line,
    screenTemplateId: STANDARD_TEMPLATE.templateId,
    templateRevision: STANDARD_TEMPLATE.revision,
    templateHash: STANDARD_TEMPLATE_LEGACY_HASH,
    resolvedLayout: resolvedLayoutForLine(line)
  })),
  visuals: legacyVisuals.map(resolvedFixtureVisual),
  backgrounds: legacyBackgrounds,
  audioTracks: legacyAudioTracks,
  soundEffects: legacySoundEffects,
  inserts: legacyInserts
};

function toV25FixtureVisual(
  visual: RenderManifestV24["visuals"][number]
): RenderManifest["visuals"][number] {
  const sectionId = renderManifestFixtureV24.lines.find(
    (line) => line.id === visual.segmentStartLineId
  )?.sectionId;
  if (sectionId === undefined) {
    throw new Error(`fixture visual section is missing: ${visual.id}`);
  }
  if (visual.kind === "video") {
    return {
      id: visual.id,
      sourceAssignmentId: visual.sourceAssignmentId,
      segmentIndex: visual.segmentIndex,
      segmentStartLineId: visual.segmentStartLineId,
      segmentEndLineId: visual.segmentEndLineId,
      sectionId,
      templateRevision: visual.templateRevision,
      templateHash: visual.templateHash,
      from: visual.from,
      durationInFrames: visual.durationInFrames,
      src: visual.src,
      kind: visual.kind,
      display: {
        kind: visual.display.kind,
        outerFrame: visual.display.outerFrame,
        contentClip: visual.display.contentClip,
        fit: visual.display.fit,
        crop: visual.display.crop,
        annotations: visual.display.annotations,
        startMs: visual.display.startMs,
        endMs: visual.display.endMs,
        playbackRate: visual.display.playbackRate,
        volume: visual.display.volume,
        playbackCues: [],
        playbackState: "playing",
        sourceTrimBeforeFrame: visual.display.sourceTrimBeforeFrame,
        sourceTrimAfterFrame: visual.display.sourceTrimAfterFrame
      }
    };
  }
  return {
    id: visual.id,
    sourceAssignmentId: visual.sourceAssignmentId,
    segmentIndex: visual.segmentIndex,
    segmentStartLineId: visual.segmentStartLineId,
    segmentEndLineId: visual.segmentEndLineId,
    sectionId,
    templateRevision: visual.templateRevision,
    templateHash: visual.templateHash,
    from: visual.from,
    durationInFrames: visual.durationInFrames,
    src: visual.src,
    kind: visual.kind,
    display: visual.display
  } as RenderManifest["visuals"][number];
}

function toV25FixtureLine(
  line: RenderManifestV24["lines"][number]
): RenderManifest["lines"][number] {
  return {
    id: line.id,
    sectionId: line.sectionId,
    from: line.from,
    durationInFrames: line.durationInFrames,
    speechFrom: line.speechFrom,
    speechDurationInFrames: line.speechDurationInFrames,
    audioPath: line.audioPath,
    subtitleText: line.subtitleText,
    speakerId: line.speakerId,
    expression: line.expression,
    characterVariantId: line.characterVariantId
  };
}

export const renderManifestFixture: RenderManifest = {
  ...manifestHeader,
  manifestVersion: "2.8.0",
  characters: manifestHeader.characters.map((character) => ({
    ...character,
    glowColor: character.visualId === "character-mentor" ? "#e78ac3" : "#75c97a"
  })),
  sectionLayouts: renderManifestFixtureV24.sectionLayouts.map((layout) => ({
    ...layout,
    templateHash: STANDARD_TEMPLATE_HASH,
    resolvedLayout: resolveScreenTemplateLayout(STANDARD_TEMPLATE, {
      characterIds: CHARACTER_IDS,
      includeDialogueWindowStyle: true
    })
  })),
  layoutIntervals: renderManifestFixtureV24.lines.map((line) => ({
    sectionId: line.sectionId,
    from: line.from,
    durationInFrames: line.durationInFrames,
    resolvedLayout: resolvedLayoutV26ForLine(line)
  })),
  lines: renderManifestFixtureV24.lines.map(toV25FixtureLine),
  visuals: renderManifestFixtureV24.visuals.map((visual) => ({
    ...toV25FixtureVisual(visual),
    templateHash: STANDARD_TEMPLATE_HASH
  })),
  backgrounds: legacyBackgrounds,
  audioTracks: legacyAudioTracks,
  soundEffects: legacySoundEffects,
  inserts: legacyInserts.map((insert) => ({
    ...insert,
    startMs: null,
    playbackRate: 1,
    text: null
  }))
};
