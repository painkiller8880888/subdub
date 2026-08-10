import type {
  VoiceAdjustmentSnapshot,
  VoiceAdjustmentStatus
} from "../schema/api.js";
import type {
  VoicevoxAccentPhrase,
  VoicevoxAdjustmentFile,
  VoicevoxAudioQuery,
  VoicevoxMora
} from "../voicevox/schemas.js";

export const VOICE_ADJUSTMENT_SCALAR_KEYS = [
  "speedScale",
  "pitchScale",
  "intonationScale",
  "volumeScale",
  "prePhonemeLength",
  "postPhonemeLength"
] as const satisfies ReadonlyArray<
  | "speedScale"
  | "pitchScale"
  | "intonationScale"
  | "volumeScale"
  | "prePhonemeLength"
  | "postPhonemeLength"
>;

export type VoiceAdjustmentScalarKey =
  (typeof VOICE_ADJUSTMENT_SCALAR_KEYS)[number];

export type VoiceAdjustmentMoraKey =
  "pitch" | "consonant_length" | "vowel_length" | "is_devoiced";

export const VOICE_ADJUSTMENT_MORA_KEYS = [
  "pitch",
  "consonant_length",
  "vowel_length",
  "is_devoiced"
] as const satisfies ReadonlyArray<VoiceAdjustmentMoraKey>;

export type VoiceAdjustmentEditorState = {
  readonly baseQuery: VoicevoxAudioQuery;
  readonly savedQuery: VoicevoxAudioQuery;
  readonly query: VoicevoxAudioQuery;
  readonly savedAdjustment: VoicevoxAdjustmentFile | null;
  readonly status: VoiceAdjustmentStatus;
  readonly savedAdjustmentLoaded: boolean;
};

function cloneMora(mora: VoicevoxMora): VoicevoxMora {
  return { ...mora };
}

function cloneAccentPhrases(
  phrases: readonly VoicevoxAccentPhrase[]
): VoicevoxAccentPhrase[] {
  return phrases.map((phrase) => ({
    ...phrase,
    moras: phrase.moras.map(cloneMora),
    pause_mora: phrase.pause_mora === null ? null : cloneMora(phrase.pause_mora)
  }));
}

export function cloneVoicevoxQuery(
  query: VoicevoxAudioQuery
): VoicevoxAudioQuery {
  return {
    ...query,
    accent_phrases: cloneAccentPhrases(query.accent_phrases)
  };
}

export function applyAdjustmentToQuery(
  baseQuery: VoicevoxAudioQuery,
  adjustment: VoicevoxAdjustmentFile
): VoicevoxAudioQuery {
  const query = {
    ...cloneVoicevoxQuery(baseQuery),
    ...Object.fromEntries(
      Object.entries(adjustment.scalarOverrides).filter(
        ([, value]) => value !== undefined
      )
    )
  } as VoicevoxAudioQuery;
  if (adjustment.accentPhrases === null) {
    return query;
  }
  return {
    ...query,
    accent_phrases: cloneAccentPhrases(adjustment.accentPhrases)
  };
}

function equalValue(first: unknown, second: unknown): boolean {
  if (first === second) {
    return true;
  }
  if (first === null || second === null) {
    return false;
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    return (
      Array.isArray(first) &&
      Array.isArray(second) &&
      first.length === second.length &&
      first.every((value, index) => equalValue(value, second[index]))
    );
  }
  if (typeof first === "object" && typeof second === "object") {
    const firstRecord = first as Record<string, unknown>;
    const secondRecord = second as Record<string, unknown>;
    const firstKeys = Object.keys(firstRecord).sort();
    const secondKeys = Object.keys(secondRecord).sort();
    return (
      firstKeys.length === secondKeys.length &&
      firstKeys.every(
        (key, index) =>
          key === secondKeys[index] &&
          equalValue(firstRecord[key], secondRecord[key])
      )
    );
  }
  return false;
}

export function isVoiceAdjustmentDirty(
  state: VoiceAdjustmentEditorState
): boolean {
  const savedQuery =
    state.status === "needs_review" && !state.savedAdjustmentLoaded
      ? state.baseQuery
      : state.savedQuery;
  return !equalValue(state.query, savedQuery);
}

export function createVoiceAdjustmentEditorState(
  snapshot: VoiceAdjustmentSnapshot,
  options: { readonly loadSaved?: boolean } = {}
): VoiceAdjustmentEditorState {
  const baseQuery = cloneVoicevoxQuery(snapshot.query);
  const loadSaved = options.loadSaved !== false;
  const savedQuery =
    snapshot.adjustment === null
      ? cloneVoicevoxQuery(baseQuery)
      : applyAdjustmentToQuery(baseQuery, snapshot.adjustment);
  return {
    baseQuery,
    savedQuery,
    query: loadSaved
      ? cloneVoicevoxQuery(savedQuery)
      : cloneVoicevoxQuery(baseQuery),
    savedAdjustment: snapshot.adjustment,
    status: snapshot.status,
    savedAdjustmentLoaded: loadSaved
  };
}

export function loadSavedVoiceAdjustment(
  state: VoiceAdjustmentEditorState
): VoiceAdjustmentEditorState {
  return {
    ...state,
    query: cloneVoicevoxQuery(state.savedQuery),
    savedAdjustmentLoaded: true
  };
}

export function discardSavedVoiceAdjustment(
  state: VoiceAdjustmentEditorState
): VoiceAdjustmentEditorState {
  const baseQuery = cloneVoicevoxQuery(state.baseQuery);
  return {
    ...state,
    baseQuery,
    savedQuery: cloneVoicevoxQuery(baseQuery),
    query: cloneVoicevoxQuery(baseQuery),
    savedAdjustment: null,
    status: "current",
    savedAdjustmentLoaded: true
  };
}

export function resetVoiceAdjustmentScalar(
  state: VoiceAdjustmentEditorState,
  key: VoiceAdjustmentScalarKey
): VoiceAdjustmentEditorState {
  return {
    ...state,
    query: { ...state.query, [key]: state.baseQuery[key] }
  };
}

export function updateVoiceAdjustmentScalar(
  state: VoiceAdjustmentEditorState,
  key: VoiceAdjustmentScalarKey,
  value: number
): VoiceAdjustmentEditorState {
  return { ...state, query: { ...state.query, [key]: value } };
}

export function updateVoiceAdjustmentAccent(
  state: VoiceAdjustmentEditorState,
  phraseIndex: number,
  accent: number
): VoiceAdjustmentEditorState {
  const phrases = cloneAccentPhrases(state.query.accent_phrases);
  const phrase = phrases[phraseIndex];
  if (phrase === undefined) {
    return state;
  }
  phrases[phraseIndex] = { ...phrase, accent };
  return { ...state, query: { ...state.query, accent_phrases: phrases } };
}

export function resetVoiceAdjustmentAccent(
  state: VoiceAdjustmentEditorState
): VoiceAdjustmentEditorState {
  const phrases = cloneAccentPhrases(state.query.accent_phrases);
  for (const [phraseIndex, phrase] of phrases.entries()) {
    const basePhrase = state.baseQuery.accent_phrases[phraseIndex];
    if (basePhrase !== undefined) {
      phrases[phraseIndex] = { ...phrase, accent: basePhrase.accent };
    }
  }
  return {
    ...state,
    query: {
      ...state.query,
      accent_phrases: phrases
    }
  };
}

export function updateVoiceAdjustmentMora(
  state: VoiceAdjustmentEditorState,
  phraseIndex: number,
  moraIndex: number,
  key: VoiceAdjustmentMoraKey,
  value: number | boolean
): VoiceAdjustmentEditorState {
  const phrases = cloneAccentPhrases(state.query.accent_phrases);
  const phrase = phrases[phraseIndex];
  const mora = phrase?.moras[moraIndex];
  if (phrase === undefined || mora === undefined) {
    return state;
  }
  const moras = phrase.moras.map(cloneMora);
  moras[moraIndex] = { ...mora, [key]: value };
  phrases[phraseIndex] = { ...phrase, moras };
  return { ...state, query: { ...state.query, accent_phrases: phrases } };
}

export function resetVoiceAdjustmentMora(
  state: VoiceAdjustmentEditorState,
  phraseIndex: number,
  moraIndex: number,
  key: VoiceAdjustmentMoraKey
): VoiceAdjustmentEditorState {
  const phrases = cloneAccentPhrases(state.query.accent_phrases);
  const basePhrase = state.baseQuery.accent_phrases[phraseIndex];
  const phrase = phrases[phraseIndex];
  const baseMora = basePhrase?.moras[moraIndex];
  const mora = phrase?.moras[moraIndex];
  if (phrase === undefined || baseMora === undefined || mora === undefined) {
    return state;
  }
  const nextMora = { ...mora } as Record<string, unknown>;
  const baseValue = baseMora[key];
  if (baseValue === undefined) {
    delete nextMora[key];
  } else {
    nextMora[key] = baseValue;
  }
  const moras = phrase.moras.map(cloneMora);
  moras[moraIndex] = nextMora as VoicevoxMora;
  phrases[phraseIndex] = { ...phrase, moras };
  return { ...state, query: { ...state.query, accent_phrases: phrases } };
}

export function resetVoiceAdjustmentMoraItem(
  state: VoiceAdjustmentEditorState,
  phraseIndex: number,
  moraIndex: number
): VoiceAdjustmentEditorState {
  return VOICE_ADJUSTMENT_MORA_KEYS.reduce(
    (current, key) =>
      resetVoiceAdjustmentMora(current, phraseIndex, moraIndex, key),
    state
  );
}

export function resetVoiceAdjustmentMoraDetails(
  state: VoiceAdjustmentEditorState
): VoiceAdjustmentEditorState {
  let nextState = state;
  for (
    let phraseIndex = 0;
    phraseIndex < nextState.query.accent_phrases.length;
    phraseIndex += 1
  ) {
    const phrase = nextState.query.accent_phrases[phraseIndex];
    if (phrase === undefined) {
      continue;
    }
    for (let moraIndex = 0; moraIndex < phrase.moras.length; moraIndex += 1) {
      nextState = resetVoiceAdjustmentMoraItem(
        nextState,
        phraseIndex,
        moraIndex
      );
    }
  }
  return nextState;
}

export function resetVoiceAdjustmentEditing(
  state: VoiceAdjustmentEditorState
): VoiceAdjustmentEditorState {
  if (state.status === "needs_review" && !state.savedAdjustmentLoaded) {
    return { ...state, query: cloneVoicevoxQuery(state.baseQuery) };
  }
  return loadSavedVoiceAdjustment(state);
}

export function buildVoiceAdjustmentFile(
  state: VoiceAdjustmentEditorState,
  snapshot: VoiceAdjustmentSnapshot,
  editedAt: string
): VoicevoxAdjustmentFile {
  const scalarOverrides = Object.fromEntries(
    VOICE_ADJUSTMENT_SCALAR_KEYS.flatMap((key) =>
      state.query[key] === state.baseQuery[key] ? [] : [[key, state.query[key]]]
    )
  );
  const accentPhrases = equalValue(
    state.query.accent_phrases,
    state.baseQuery.accent_phrases
  )
    ? null
    : cloneAccentPhrases(state.query.accent_phrases);

  return {
    adjustmentVersion: "1.0.0",
    lineId: snapshot.lineId,
    base: { ...snapshot.currentBase },
    scalarOverrides,
    accentPhrases,
    editedAt
  } as VoicevoxAdjustmentFile;
}
