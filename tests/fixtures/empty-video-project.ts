import type { VideoProject } from "../../src/schema/index.js";

const EMPTY_SHA256 = "0".repeat(64);

export type EmptyVideoProjectOptions = {
  projectId: string;
  createdAt: string;
  updatedAt?: string;
};

function makeCharacter(
  id: "character-mentor" | "character-learner",
  role: "mentor" | "learner",
  speakerName: "四国めたん" | "ずんだもん",
  themeColorToken: "character.metan" | "character.zundamon"
): VideoProject["characters"][number] {
  const assetPrefix = `characters/${id}`;
  return {
    id,
    name: id,
    role,
    personality: "",
    speakingStyle: "",
    voicevox: {
      speakerName,
      speakerUuid: null,
      styleName: "ノーマル"
    },
    themeColorToken,
    voice: {
      speedScale: 1,
      pitchScale: 0,
      intonationScale: 1,
      volumeScale: 1,
      prePhonemeLength: 0,
      postPhonemeLength: 0
    },
    lipSyncPeriodFrames: 1,
    visualAssets: {
      neutral: {
        closed: `${assetPrefix}/neutral-closed.png`,
        open: `${assetPrefix}/neutral-open.png`
      },
      smile: {
        closed: `${assetPrefix}/smile-closed.png`,
        open: `${assetPrefix}/smile-open.png`
      },
      explain: {
        closed: `${assetPrefix}/explain-closed.png`,
        open: `${assetPrefix}/explain-open.png`
      },
      caution: {
        closed: `${assetPrefix}/caution-closed.png`,
        open: `${assetPrefix}/caution-open.png`
      }
    }
  };
}

export function createEmptyVideoProject(
  options: EmptyVideoProjectOptions
): VideoProject {
  const updatedAt = options.updatedAt ?? options.createdAt;

  return {
    schemaVersion: "1.0.0",
    revision: 0,
    metadata: {
      id: options.projectId,
      title: "Untitled project",
      description: "",
      department: "General",
      manualVersion: "",
      createdAt: options.createdAt,
      updatedAt,
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
      id: "source-main",
      path: "source/source.md",
      sha256: EMPTY_SHA256
    },
    brief: {
      audience: "",
      postViewingGoal: "",
      prerequisites: [],
      targetDurationSec: 1,
      requiredItems: [],
      prohibitedItems: [],
      globalDirectives: []
    },
    aiSettings: {
      defaultModelId: null,
      taskModelOverrides: {},
      zdr: false,
      dataCollection: "deny",
      allowProviderFallbacks: true
    },
    characters: [
      makeCharacter(
        "character-mentor",
        "mentor",
        "四国めたん",
        "character.metan"
      ),
      makeCharacter(
        "character-learner",
        "learner",
        "ずんだもん",
        "character.zundamon"
      )
    ],
    outline: {
      status: "draft",
      sourceHash: EMPTY_SHA256,
      generationRunId: null,
      openQuestions: [],
      sections: []
    },
    script: {
      status: "draft",
      origin: "manual",
      outlineHash: EMPTY_SHA256,
      sections: []
    },
    visuals: {
      status: "draft",
      suggestionRunIds: [],
      assignments: []
    },
    audio: {
      sectionBgms: [],
      soundEffects: []
    },
    inserts: {
      opening: {
        id: "insert-opening",
        kind: "placeholder",
        durationMs: 2000,
        slot: "opening"
      },
      ending: {
        id: "insert-ending",
        kind: "placeholder",
        durationMs: 2000,
        slot: "ending"
      },
      eyeCatches: []
    },
    thumbnail: {
      backgroundImage: null,
      title: "Untitled project",
      subtitle: null,
      departmentOrSystem: "General",
      manualVersion: null,
      characterId: null,
      representativeVisualPath: null,
      layout: "standard"
    }
  };
}
