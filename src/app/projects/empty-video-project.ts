import {
  videoProjectSchema,
  type VideoProject
} from "../../schema/index.js";
import { createStarterScriptSections } from "./starter-script-sections.js";

export type EmptyVideoProjectOptions = {
  projectId: string;
  title?: string;
  department?: string;
  manualVersion?: string;
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
    name: speakerName,
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
    lipSyncPeriodFrames: 4,
    characterVisual: {
      visualId: null,
      idleVariantId: null
    },
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
  const title = options.title ?? "Untitled project";
  const department = options.department ?? "General";
  const manualVersion = options.manualVersion ?? "";

  const project: VideoProject = {
    schemaVersion: "1.9.0",
    revision: 0,
    metadata: {
      id: options.projectId,
      title,
      description: "",
      department,
      manualVersion,
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
    aiSettings: {
      defaultModelId: "google/gemma-4-31b-it",
      taskModelOverrides: {},
      zdr: true,
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
    script: {
      sections: createStarterScriptSections(options.projectId)
    },
    visuals: {
      status: "draft",
      suggestionRunIds: [],
      assignments: []
    },
    overlays: {
      lineOverlays: []
    },
    audio: {
      soundEffects: []
    },
    edit: {
      videoElements: [],
      sectionBgms: []
    },
    thumbnail: {
      backgroundImage: null,
      title,
      subtitle: null,
      departmentOrSystem: department,
      manualVersion: manualVersion.length > 0 ? manualVersion : null,
      characterId: null,
      representativeVisualPath: null,
      layout: "standard"
    }
  };

  return videoProjectSchema.parse(project);
}
