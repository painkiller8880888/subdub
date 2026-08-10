import { createHash } from "node:crypto";

import { voiceSchema, type Voice } from "../../schema/common.js";
import type { AppliedTerminology } from "../terminology/spoken-text-resolver.js";

export const VOICEVOX_QUERY_CACHE_KEY_VERSION = "voicevox-query-cache-v1";

export const VOICE_SETTING_KEYS = [
  "speedScale",
  "pitchScale",
  "intonationScale",
  "volumeScale",
  "prePhonemeLength",
  "postPhonemeLength"
] as const satisfies ReadonlyArray<keyof Voice>;

export type VoicevoxQueryCacheKeyInput = {
  readonly resolvedSpokenText: string;
  readonly speakerUuid: string;
  readonly styleName: string;
  readonly resolvedStyleId: number;
  readonly characterVoice: Voice;
  readonly voiceOverrides: Partial<Voice>;
  readonly appliedTerms: readonly Pick<
    AppliedTerminology,
    "termId" | "termUpdatedAt"
  >[];
  readonly voicevoxEngineVersion: string;
  /**
   * P4-05 の調整ファイルとの境界。調整の適用自体はまだ実装しないが、
   * fingerprint が変わったセリフだけを stale にできるよう key に含める。
   */
  readonly adjustmentChecksum?: string | null;
};

type CanonicalValue =
  | boolean
  | null
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue };

function canonicalJson(value: CanonicalValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const objectValue = value as {
      readonly [key: string]: CanonicalValue;
    };
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(objectValue[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function normalizeVoiceOverrides(voiceOverrides: Partial<Voice>): {
  readonly [key: string]: number | null;
} {
  return Object.fromEntries(
    VOICE_SETTING_KEYS.map((key) => [key, voiceOverrides[key] ?? null])
  );
}

function normalizeVoice(voice: Voice): Voice {
  return voiceSchema.parse(voice);
}

export function createVoicevoxQueryCacheKey(
  input: VoicevoxQueryCacheKeyInput
): string {
  const canonicalInput: CanonicalValue = {
    cacheKeyVersion: VOICEVOX_QUERY_CACHE_KEY_VERSION,
    resolvedSpokenText: input.resolvedSpokenText.normalize("NFC"),
    speakerUuid: input.speakerUuid,
    styleName: input.styleName,
    resolvedStyleId: input.resolvedStyleId,
    characterVoice: normalizeVoice(input.characterVoice),
    voiceOverrides: normalizeVoiceOverrides(input.voiceOverrides),
    appliedTerms: input.appliedTerms.map((term) => ({
      termId: term.termId,
      termUpdatedAt: term.termUpdatedAt
    })),
    voicevoxEngineVersion: input.voicevoxEngineVersion,
    adjustmentChecksum: input.adjustmentChecksum ?? null
  };

  return createHash("sha256")
    .update(canonicalJson(canonicalInput), "utf8")
    .digest("hex");
}
