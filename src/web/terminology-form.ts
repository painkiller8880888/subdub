import {
  terminologyCreateRequestSchema,
  terminologyUpdateRequestSchema,
  type TerminologyCreateRequest,
  type TerminologyUpdateRequest
} from "../schema/api.js";
import type { TerminologyTerm } from "../schema/terminology.js";

export type TerminologyFormState = {
  surface: string;
  readingKatakana: string;
  category: string;
  priority: string;
  notes: string;
};

export const emptyTerminologyForm: TerminologyFormState = {
  surface: "",
  readingKatakana: "",
  category: "",
  priority: "0",
  notes: ""
};

export function terminologyToForm(term: TerminologyTerm): TerminologyFormState {
  return {
    surface: term.surface,
    readingKatakana: term.readingKatakana,
    category: term.category,
    priority: String(term.priority),
    notes: term.notes
  };
}

function priorityValue(value: string): number {
  return Number(value);
}

export function terminologyFormToCreateInput(
  form: TerminologyFormState
): TerminologyCreateRequest {
  return terminologyCreateRequestSchema.parse({
    surface: form.surface,
    readingKatakana: form.readingKatakana,
    category: form.category,
    priority: priorityValue(form.priority),
    notes: form.notes
  });
}

export function terminologyFormToUpdateInput(
  form: TerminologyFormState
): TerminologyUpdateRequest {
  return terminologyUpdateRequestSchema.parse({
    surface: form.surface,
    readingKatakana: form.readingKatakana,
    category: form.category,
    priority: priorityValue(form.priority),
    notes: form.notes
  });
}
