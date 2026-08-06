import type { TerminologyTerm } from "../../schema/terminology.js";

export type SpokenTextPronunciation = {
  readonly mode: "dictionary" | "literal";
  readonly excludedTermIds: readonly string[];
};

export type ResolveSpokenTextInput = {
  readonly spokenText: string;
  readonly pronunciation: SpokenTextPronunciation;
  readonly terms: readonly TerminologyTerm[];
};

export type AppliedTerminology = {
  readonly termId: string;
  readonly surface: string;
  readonly reading: string;
  readonly termUpdatedAt: string;
};

export type ResolvedSpokenText = {
  readonly resolvedSpokenText: string;
  readonly appliedTerms: readonly AppliedTerminology[];
};

type Candidate = {
  readonly term: TerminologyTerm;
  readonly surfaceChars: readonly string[];
};

function compareCandidates(left: Candidate, right: Candidate): number {
  if (left.surfaceChars.length !== right.surfaceChars.length) {
    return right.surfaceChars.length - left.surfaceChars.length;
  }

  if (left.term.priority !== right.term.priority) {
    return right.term.priority - left.term.priority;
  }

  if (left.term.termId < right.term.termId) {
    return -1;
  }
  if (left.term.termId > right.term.termId) {
    return 1;
  }
  return 0;
}

function matchesAt(
  inputChars: readonly string[],
  start: number,
  surfaceChars: readonly string[]
): boolean {
  if (start + surfaceChars.length > inputChars.length) {
    return false;
  }

  for (let offset = 0; offset < surfaceChars.length; offset += 1) {
    if (inputChars[start + offset] !== surfaceChars[offset]) {
      return false;
    }
  }

  return true;
}

function getCandidates(
  terms: readonly TerminologyTerm[],
  excludedTermIds: readonly string[]
): Candidate[] {
  const excluded = new Set(excludedTermIds);

  return terms
    .filter((term) => term.status === "active" && !excluded.has(term.termId))
    .map((term) => ({
      term,
      surfaceChars: Array.from(term.surface.normalize("NFC"))
    }))
    .filter((candidate) => candidate.surfaceChars.length > 0)
    .sort(compareCandidates);
}

export function resolveSpokenText(
  input: ResolveSpokenTextInput
): ResolvedSpokenText {
  const normalizedSpokenText = input.spokenText.normalize("NFC");
  if (input.pronunciation.mode === "literal") {
    return {
      resolvedSpokenText: normalizedSpokenText,
      appliedTerms: []
    };
  }

  const inputChars = Array.from(normalizedSpokenText);
  const candidates = getCandidates(
    input.terms,
    input.pronunciation.excludedTermIds
  );
  const resolvedParts: string[] = [];
  const appliedTerms: AppliedTerminology[] = [];

  for (let position = 0; position < inputChars.length;) {
    const candidate = candidates.find((value) =>
      matchesAt(inputChars, position, value.surfaceChars)
    );

    if (candidate === undefined) {
      resolvedParts.push(inputChars[position] ?? "");
      position += 1;
      continue;
    }

    resolvedParts.push(candidate.term.readingKatakana);
    appliedTerms.push({
      termId: candidate.term.termId,
      surface: candidate.term.surface,
      reading: candidate.term.readingKatakana,
      termUpdatedAt: candidate.term.updatedAt
    });
    position += candidate.surfaceChars.length;
  }

  return {
    resolvedSpokenText: resolvedParts.join(""),
    appliedTerms
  };
}
