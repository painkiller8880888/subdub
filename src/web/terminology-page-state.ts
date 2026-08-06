import type { TerminologyListQuery } from "../schema/api.js";

export function hasTerminologyListFilters(
  filters: TerminologyListQuery
): boolean {
  return Object.values(filters).some(
    (value) => value !== undefined && value !== ""
  );
}
