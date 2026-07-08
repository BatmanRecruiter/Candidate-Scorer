/**
 * One-off data migration for the 2026-07 document-category overhaul.
 *
 * Renames legacy category slugs on existing role_files rows and rewrites the
 * stored context_summary JSON on jobs / batch_jobs so historical runs display
 * the new category names.
 *
 *   scorecards  -> positive_scorecards
 *   hired       -> current_employees
 *   incumbents  -> benchmark_candidates   (merged into the benchmark bucket)
 *
 * Idempotent: role_files UPDATEs only match legacy slugs, and each summary is
 * rewritten only when the transform actually changes it. Safe to run twice.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/migrate-categories.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/migrate-categories.ts
 *
 * Run AFTER (or together with) deploying the new code — never before. The
 * server's normalizeCategory() guard makes new-code/old-data safe, but
 * old-code/new-data is not.
 */

import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL environment variable is not set");

const DRY_RUN = process.argv.includes("--dry-run");

// Legacy slug -> new slug. Kept inline so the script has no app-code deps.
const SLUG_MAP: Record<string, string> = {
  scorecards: "positive_scorecards",
  hired: "current_employees",
  incumbents: "benchmark_candidates",
};

const sql = neon(DB_URL);

// ---------------------------------------------------------------------------
// context_summary JSON remapping
// ---------------------------------------------------------------------------

// Remap the count keys inside one flat counts object (the top-level summary, or
// its nested `registered` / `readable` maps). Only rewrites keys that are
// actually present, so running twice is a no-op.
function remapCounts(o: any): any {
  if (!o || typeof o !== "object" || Array.isArray(o)) return o;
  const out: any = { ...o };
  if ("scorecards" in out) {
    out.positive_scorecards = (out.positive_scorecards ?? 0) + (out.scorecards ?? 0);
    delete out.scorecards;
  }
  if ("hired" in out) {
    out.current_employees = (out.current_employees ?? 0) + (out.hired ?? 0);
    delete out.hired;
  }
  if ("incumbents" in out) {
    out.benchmark_candidates = (out.benchmark_candidates ?? 0) + (out.incumbents ?? 0);
    delete out.incumbents;
  }
  // Only seed the new buckets on objects that are clearly category-count maps
  // (never on things like calibrationApplied).
  const looksLikeCounts =
    "jd" in out || "benchmark_candidates" in out || "positive_scorecards" in out;
  if (looksLikeCounts) {
    if (!("negative_scorecards" in out)) out.negative_scorecards = 0;
    if (!("dept_notes" in out)) out.dept_notes = 0;
  }
  return out;
}

function migrateSummary(summary: any): any {
  const s = remapCounts(summary);
  if (s && s.registered) s.registered = remapCounts(s.registered);
  if (s && s.readable) s.readable = remapCounts(s.readable);
  return s;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

async function printCategoryCounts(label: string) {
  const rows = (await sql`
    SELECT category, COUNT(*)::int AS n
    FROM role_files
    GROUP BY category
    ORDER BY category
  `) as { category: string | null; n: number }[];
  console.log(`\n${label}:`);
  for (const r of rows) {
    console.log(`  ${r.category ?? "(uncategorized)"} : ${r.n}`);
  }
}

async function migrateRoleFiles() {
  console.log(`\n--- role_files.category ---`);
  for (const [from, to] of Object.entries(SLUG_MAP)) {
    if (DRY_RUN) {
      const rows = (await sql`
        SELECT COUNT(*)::int AS n FROM role_files WHERE category = ${from}
      `) as { n: number }[];
      console.log(`  [dry-run] ${from} -> ${to}: ${rows[0]?.n ?? 0} row(s) would change`);
    } else {
      const rows = (await sql`
        UPDATE role_files SET category = ${to} WHERE category = ${from} RETURNING id
      `) as { id: string }[];
      console.log(`  ${from} -> ${to}: ${rows.length} row(s) updated`);
    }
  }
}

async function migrateSummaries(table: "jobs" | "batch_jobs") {
  const rows =
    table === "jobs"
      ? ((await sql`SELECT id, context_summary FROM jobs`) as {
          id: string;
          context_summary: string;
        }[])
      : ((await sql`SELECT id, context_summary FROM batch_jobs`) as {
          id: string;
          context_summary: string;
        }[]);

  let changed = 0;
  let skipped = 0;
  for (const row of rows) {
    const original = row.context_summary || "";
    let parsed: any;
    try {
      parsed = JSON.parse(original);
    } catch {
      skipped++;
      continue;
    }
    const migrated = migrateSummary(parsed);
    const next = JSON.stringify(migrated);
    if (next === original) {
      skipped++;
      continue;
    }
    changed++;
    if (!DRY_RUN) {
      if (table === "jobs") {
        await sql`UPDATE jobs SET context_summary = ${next} WHERE id = ${row.id}`;
      } else {
        await sql`UPDATE batch_jobs SET context_summary = ${next} WHERE id = ${row.id}`;
      }
    }
  }
  const verb = DRY_RUN ? "would change" : "changed";
  console.log(`  ${table}: ${changed} ${verb}, ${skipped} unchanged`);
}

async function main() {
  console.log(DRY_RUN ? "=== DRY RUN (no writes) ===" : "=== MIGRATING ===");

  await printCategoryCounts("BEFORE — role_files by category");
  await migrateRoleFiles();

  console.log(`\n--- context_summary JSON (jobs + batch_jobs) ---`);
  await migrateSummaries("jobs");
  await migrateSummaries("batch_jobs");

  await printCategoryCounts("AFTER — role_files by category");
  console.log(
    DRY_RUN
      ? "\n✓ Dry run complete. Re-run without --dry-run to apply."
      : "\n✓ Migration complete. AFTER counts should show no scorecards/hired/incumbents rows.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
