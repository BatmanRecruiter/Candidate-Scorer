// shared/categories.ts
// ---------------------------------------------------------------------------
// Single source of truth for document-upload categories. Imported by BOTH the
// client (via the @shared/* alias) and the server, so the list can never drift
// out of sync across the app.
//
// A category is stored as a freeform text slug on role_files.category (null =
// uncategorized). When a slug is renamed, add the old → new mapping to
// LEGACY_CATEGORY_MAP so historical rows (and stored contextSummary JSON) keep
// resolving even before the data migration runs.
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  "jd",
  "hm_notes",
  "dept_notes",
  "rubrik",
  "current_employees",
  "not_hired",
  "transcripts",
  "positive_scorecards",
  "negative_scorecards",
  "benchmark_candidates",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  jd: "Job description",
  hm_notes: "HM notes (intake call)",
  dept_notes: "Department overview/notes",
  rubrik: "Scoring rubrik",
  current_employees: "Current phData employees in role",
  not_hired: "Not-hired resumes",
  transcripts: "Interview transcripts",
  positive_scorecards: "Positive scorecards",
  negative_scorecards: "Negative scorecards",
  benchmark_candidates: "Positive benchmark candidate LinkedIn profiles",
};

// Slugs that existed before the 2026-07 category overhaul, mapped to their new
// homes. Used to migrate DB rows forward and to keep un-migrated rows safe at
// runtime via normalizeCategory().
export const LEGACY_CATEGORY_MAP: Record<string, Category> = {
  scorecards: "positive_scorecards",
  hired: "current_employees",
  incumbents: "benchmark_candidates",
};

/**
 * Coerce any stored/legacy category string into a current Category, or null if
 * it is empty or unrecognized. Never throws — an unknown slug becomes null
 * (uncategorized) rather than a key that would blow up a Record lookup.
 */
export function normalizeCategory(raw: string | null | undefined): Category | null {
  if (!raw) return null;
  if ((CATEGORIES as readonly string[]).includes(raw)) return raw as Category;
  return LEGACY_CATEGORY_MAP[raw] ?? null;
}
