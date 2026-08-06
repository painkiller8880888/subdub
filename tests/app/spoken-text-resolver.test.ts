import { describe, expect, it } from "vitest";

import {
  resolveSpokenText,
  type SpokenTextPronunciation
} from "../../src/app/terminology/spoken-text-resolver.js";
import type { TerminologyTerm } from "../../src/schema/terminology.js";

const updatedAt = "2026-08-06T00:00:00.000Z";
const dictionary: SpokenTextPronunciation = {
  mode: "dictionary",
  excludedTermIds: []
};

const baseTerm: TerminologyTerm = {
  termId: "term-base",
  surface: "A",
  normalizedSurface: "A",
  readingKatakana: "R",
  category: "other",
  priority: 0,
  notes: "",
  status: "active",
  createdAt: updatedAt,
  updatedAt
};

function term(overrides: Partial<TerminologyTerm>): TerminologyTerm {
  return { ...baseTerm, ...overrides };
}

function resolve(
  spokenText: string,
  terms: readonly TerminologyTerm[],
  pronunciation: SpokenTextPronunciation = dictionary
) {
  return resolveSpokenText({ spokenText, terms, pronunciation });
}

describe("resolveSpokenText", () => {
  it("preserves the text except for NFC normalization when there are no terms", () => {
    expect(resolve("e\u0301 \t!\n", [])).toEqual({
      resolvedSpokenText: "é \t!\n",
      appliedTerms: []
    });
  });

  it("does not apply active terms in literal mode", () => {
    expect(
      resolve("AB", [term({ surface: "AB", readingKatakana: "LONG" })], {
        mode: "literal",
        excludedTermIds: []
      })
    ).toMatchObject({ resolvedSpokenText: "AB", appliedTerms: [] });
  });

  it("prefers the longest overlapping surface", () => {
    expect(
      resolve("ABC", [
        term({ termId: "term-short", surface: "A", readingKatakana: "SHORT" }),
        term({ termId: "term-long", surface: "AB", readingKatakana: "LONG" })
      ])
    ).toMatchObject({ resolvedSpokenText: "LONGC" });
  });

  it("uses priority when candidates have the same surface length", () => {
    expect(
      resolve("A", [
        term({ termId: "term-low", readingKatakana: "LOW", priority: 1 }),
        term({ termId: "term-high", readingKatakana: "HIGH", priority: 2 })
      ])
    ).toMatchObject({ resolvedSpokenText: "HIGH" });
  });

  it("uses ascending termId when length and priority tie", () => {
    expect(
      resolve("A", [
        term({ termId: "term-z", readingKatakana: "Z", priority: 2 }),
        term({ termId: "term-a", readingKatakana: "A-READ", priority: 2 })
      ])
    ).toMatchObject({ resolvedSpokenText: "A-READ" });
  });

  it("ignores excluded, inactive, and unknown term IDs", () => {
    expect(
      resolve(
        "ABC",
        [
          term({
            termId: "term-excluded",
            surface: "AB",
            readingKatakana: "EXCLUDED"
          }),
          term({
            termId: "term-inactive",
            surface: "C",
            readingKatakana: "INACTIVE",
            status: "inactive"
          })
        ],
        {
          mode: "dictionary",
          excludedTermIds: ["term-excluded", "term-excluded", "missing-term"]
        }
      )
    ).toEqual({ resolvedSpokenText: "ABC", appliedTerms: [] });
  });

  it("records every repeated application in occurrence order", () => {
    const repeated = term({
      termId: "term-repeat",
      surface: "A",
      readingKatakana: "READ"
    });
    const result = resolve("A-A", [repeated]);

    expect(result.resolvedSpokenText).toBe("READ-READ");
    expect(result.appliedTerms).toEqual([
      {
        termId: "term-repeat",
        surface: "A",
        reading: "READ",
        termUpdatedAt: updatedAt
      },
      {
        termId: "term-repeat",
        surface: "A",
        reading: "READ",
        termUpdatedAt: updatedAt
      }
    ]);
  });

  it("does not recursively replace generated reading text", () => {
    expect(
      resolve("A", [
        term({ termId: "term-a", surface: "A", readingKatakana: "B" }),
        term({ termId: "term-b", surface: "B", readingKatakana: "C" })
      ])
    ).toMatchObject({ resolvedSpokenText: "B" });
  });

  it("preserves unmatched characters, spaces, punctuation, and line breaks", () => {
    expect(
      resolve(" A,\nB! ", [
        term({ termId: "term-b", surface: "B", readingKatakana: "READ" })
      ])
    ).toMatchObject({ resolvedSpokenText: " A,\nREAD! " });
  });

  it("matches NFC-equivalent surfaces and counts Unicode code points consistently", () => {
    expect(
      resolve("e\u0301😀", [
        term({
          termId: "term-composed",
          surface: "é😀",
          readingKatakana: "READ"
        })
      ])
    ).toMatchObject({ resolvedSpokenText: "READ" });
  });

  it("does not mutate the input text, terms, or excluded IDs", () => {
    const terms = [
      term({ termId: "term-a", surface: "A", readingKatakana: "READ" })
    ];
    const excludedTermIds = ["missing-term"];
    const termsSnapshot = structuredClone(terms);
    const excludedSnapshot = [...excludedTermIds];

    resolve("A", terms, { mode: "dictionary", excludedTermIds });

    expect(terms).toEqual(termsSnapshot);
    expect(excludedTermIds).toEqual(excludedSnapshot);
  });

  it("returns the same result regardless of candidate input order", () => {
    const candidates = [
      term({
        termId: "term-z",
        surface: "AB",
        readingKatakana: "Z",
        priority: 1
      }),
      term({
        termId: "term-a",
        surface: "A",
        readingKatakana: "A",
        priority: 99
      })
    ];

    expect(resolve("AB", candidates)).toEqual(
      resolve("AB", [...candidates].reverse())
    );
  });
});
