// backfill-summaries.ts
// ---------------------------------------------------------------------------
// One-time backfill: summarize large reference files that were uploaded before
// auto-summarization existed. Safe to re-run — it only fills in summaries that
// are missing and never touches the original text.
//
// Run it with the database URL set (it is already set inside Render's Shell):
//   npm run backfill-summaries
// or directly:
//   npx tsx script/backfill-summaries.ts
// ---------------------------------------------------------------------------

import { storage } from "../server/storage";
import { shouldSummarize, summarizeForScoring } from "../server/summarize";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — run this from Render's Shell, or set it locally.");
    process.exit(1);
  }

  const roles = await storage.listRoles();
  let scanned = 0;
  let summarized = 0;
  let skipped = 0;
  let failed = 0;

  for (const role of roles) {
    const files = await storage.listRoleFiles(role.roleId);
    for (const f of files) {
      scanned++;
      if (f.summaryText) {
        skipped++;
        continue;
      }
      if (!shouldSummarize(f.category, f.contentText)) {
        skipped++;
        continue;
      }
      try {
        const summary = await summarizeForScoring({
          fileName: f.fileName,
          category: f.category!,
          text: f.contentText,
        });
        await storage.updateRoleFileSummary(f.id, summary);
        summarized++;
        console.log(
          `✓ ${role.roleName} / ${f.fileName}: ${f.contentText.length} → ${summary.length} chars`,
        );
      } catch (e) {
        failed++;
        console.error(`✗ ${role.roleName} / ${f.fileName}:`, e);
      }
    }
  }

  console.log(
    `\nDone. scanned=${scanned} summarized=${summarized} skipped=${skipped} failed=${failed}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
