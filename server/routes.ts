import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import multer from "multer";
import { parse as parseCsv } from "csv-parse/sync";
import {
  COLUMN_TEMPLATE,
  isBlankHeader,
  isScoreHeader,
  isReasonHeader,
  isTotalYoeHeader,
  mapTemplateToInputs,
  formatTemplateCell,
} from "@shared/column-template";
import { nanoid } from "nanoid";
import { storage } from "./storage";
import { scoreCandidate, OPUS_MODEL, type RoleContext, type CandidateInput } from "./scorer";
import {
  loadRoleContext,
  extractTextFromBuffer,
  detectCategory,
  CATEGORIES,
  type Category,
  type CategoryHits,
  type FileLoadInfo,
} from "./external";
import type { ScoreResult } from "@shared/schema";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const SCORE_CONCURRENCY = 2;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, i: number) => Promise<R>,
  onItemDone?: (result: R | null, error: Error | null, i: number) => void | Promise<void>,
) {
  const results: (R | null)[] = new Array(items.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        const r = await fn(items[i], i);
        results[i] = r;
        await onItemDone?.(r, null, i);
      } catch (e: any) {
        await onItemDone?.(null, e, i);
      }
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;
}


export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  // -------------------------------------------------------------------------
  // Roles CRUD
  // -------------------------------------------------------------------------
  app.get("/api/roles", async (_req, res) => {
    const rows = await storage.listRoles();
    res.json({
      roles: rows.map((r) => ({
        roleId: r.roleId,
        roleName: r.roleName,
        createdAt: r.createdAt,
      })),
    });
  });

  app.post("/api/roles", async (req: Request, res: Response) => {
    try {
      const roleId = String(req.body.roleId || "").trim();
      const roleName = String(req.body.roleName || "").trim();
      if (!roleId) return res.status(400).json({ message: "roleId required" });
      if (!roleName) return res.status(400).json({ message: "roleName required" });
      // Validate role ID: anything goes as long as it doesn't contain reserved
      // separator characters that would confuse parsing.
      if (!/^[A-Za-z0-9_\-]+$/.test(roleId)) {
        return res.status(400).json({
          message: "roleId can only contain letters, numbers, hyphens, and underscores",
        });
      }
      const existing = await storage.getRole(roleId);
      if (existing) {
        return res.status(409).json({ message: `Role ID "${roleId}" already exists` });
      }
      const created = await storage.createRole({
        roleId,
        roleName,
        fileCategoryOverrides: "{}",
        createdAt: Date.now(),
      });
      res.json({ role: created });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/roles/:id", async (req, res) => {
    const role = await storage.getRole(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    res.json({
      role: {
        roleId: role.roleId,
        roleName: role.roleName,
        createdAt: role.createdAt,
      },
    });
  });

  app.patch("/api/roles/:id", async (req, res) => {
    const role = await storage.getRole(req.params.id);
    if (!role) return res.status(404).json({ message: "Role not found" });
    const patch: any = {};
    if (req.body.roleName) patch.roleName = String(req.body.roleName);
    const updated = await storage.updateRole(req.params.id, patch);
    res.json({ role: updated });
  });

  app.delete("/api/roles/:id", async (req, res) => {
    await storage.deleteRole(req.params.id);
    res.json({ ok: true });
  });

  // Update the category for a single uploaded file.
  app.post("/api/roles/:id/categorize", async (req: Request, res: Response) => {
    const fileId = String(req.body.fileId || "").trim();
    const category = String(req.body.category || "").trim();
    if (!fileId) return res.status(400).json({ message: "fileId required" });

    const newCategory =
      category === "" || category === "auto"
        ? null
        : (CATEGORIES as readonly string[]).includes(category)
        ? (category as Category)
        : null;

    if (
      category !== "" &&
      category !== "auto" &&
      !(CATEGORIES as readonly string[]).includes(category)
    ) {
      return res.status(400).json({ message: `Invalid category "${category}"` });
    }

    const updated = await storage.updateRoleFileCategory(fileId, newCategory, newCategory === null);
    res.json({ file: updated });
  });

  // List uploaded files for a role (replaces Drive preview).
  app.get("/api/roles/:id/preview", async (req: Request, res: Response) => {
    try {
      const role = await storage.getRole(String(req.params.id));
      if (!role) return res.status(404).json({ message: "Role not found" });
      const files = await storage.listRoleFiles(role.roleId);
      res.json({
        roleId: role.roleId,
        roleName: role.roleName,
        files: files.map((f) => ({
          fileId: f.id,
          fileName: f.fileName,
          category: f.category ?? null,
          autoDetected: f.autoDetected === 1,
          byteSize: f.byteSize,
          createdAt: f.createdAt,
        })),
        categories: CATEGORIES,
      });
    } catch (e: any) {
      console.error("role preview failed", e);
      res.status(500).json({ message: e.message || "Failed to load files" });
    }
  });

  // Upload a file for a role. Extracts text server-side and stores in Neon.
  app.post(
    "/api/roles/:id/files",
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const role = await storage.getRole(String(req.params.id));
        if (!role) return res.status(404).json({ message: "Role not found" });
        if (!req.file) return res.status(400).json({ message: "No file provided" });

        const { originalname, buffer, size } = req.file;
        const contentText = await extractTextFromBuffer(buffer, originalname);
        const category = detectCategory(originalname);

        const file = await storage.createRoleFile({
          id: nanoid(10),
          roleId: role.roleId,
          fileName: originalname,
          category: category,
          autoDetected: 1,
          contentText,
          byteSize: size,
          createdAt: Date.now(),
        });

        res.json({
          file: {
            fileId: file.id,
            fileName: file.fileName,
            category: file.category ?? null,
            autoDetected: file.autoDetected === 1,
            byteSize: file.byteSize,
            createdAt: file.createdAt,
          },
        });
      } catch (e: any) {
        console.error("file upload failed", e);
        res.status(500).json({ message: e.message || "Upload failed" });
      }
    },
  );

  // Delete an uploaded file.
  app.delete("/api/roles/:id/files/:fileId", async (req: Request, res: Response) => {
    try {
      await storage.deleteRoleFile(String(req.params.fileId));
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Context summary for a role (used by the new-job page before a run).
  app.post("/api/roles/:id/context", async (req: Request, res: Response) => {
    try {
      const role = await storage.getRole(String(req.params.id));
      if (!role) return res.status(404).json({ message: "Role not found" });
      const { hits, files } = await loadRoleContext(role.roleId);
      const summary = buildSummary(files, hits);
      res.json({ summary, hits, files });
    } catch (e: any) {
      console.error("context preview failed", e);
      res.status(500).json({ message: e.message || "Failed to load context" });
    }
  });

  // -------------------------------------------------------------------------
  // Start a scoring job
  // -------------------------------------------------------------------------
  app.post("/api/jobs", upload.single("csv"), async (req: Request, res: Response) => {
    try {
      const roleIdRaw = String(req.body.roleId || "").trim();
      if (!roleIdRaw) return res.status(400).json({ message: "roleId required" });
      const role = await storage.getRole(roleIdRaw);
      if (!role) return res.status(400).json({ message: `Role "${roleIdRaw}" not found` });

      if (!req.file) {
        return res.status(400).json({ message: "A CSV file is required" });
      }

      let candidateRows: Record<string, string>[] = [];
      let headerCount = 0;
      let headers: string[] = [];

      const text = req.file.buffer.toString("utf8");
      const rows = parseCsv(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
      candidateRows = rows;
      headers = rows.length ? Object.keys(rows[0]) : [];
      headerCount = headers.length;

      if (!candidateRows.length) {
        return res.status(400).json({ message: "No candidate rows found in input" });
      }
      if (candidateRows.length > 500) {
        return res.status(400).json({ message: "Batch size exceeds 500" });
      }

      // Create the job placeholder immediately and respond so the UI can navigate
      // to the run page right away. Loading Drive context can take 30+ seconds for
      // roles with many files, and we don't want the browser to hang on the POST.
      const jobId = nanoid(10);
      const now = Date.now();
      const placeholderSummary = { status: "loading_context" };
      await storage.createJob({
        id: jobId,
        roleId: role.roleId,
        roleName: role.roleName,
        contextSummary: JSON.stringify(placeholderSummary),
        status: "running",
        totalCandidates: candidateRows.length,
        completedCandidates: 0,
        failedCandidates: 0,
        results: JSON.stringify([]),
        inputHeaders: JSON.stringify(headers),
        uploadFilename: req.file.originalname,
        error: null,
        createdAt: now,
        updatedAt: now,
      });

      // Respond immediately so the client can navigate.
      res.json({ jobId });

      // Now do the slow work in the background: load role context, snapshot
      // calibration, and run the scoring loop.
      (async () => {
        try {
          const { hits, files } = await loadRoleContext(role.roleId);
          const baseSummary = buildSummary(files, hits);

          const calibrationRows = await storage.listFeedbackForRole(role.roleId, 50);
          const calibrationNotes = await buildCalibrationNotes(role.roleId);
          const calibrationApplied = {
            count: calibrationNotes.length,
            totalChars: calibrationNotes.reduce((n, s) => n + s.length, 0),
            notes: calibrationNotes,
            feedbackIds: calibrationRows.slice(0, calibrationNotes.length).map((r) => r.id),
          };
          const contextSummary = { ...baseSummary, calibrationApplied };
          await storage.updateJob(jobId, { contextSummary: JSON.stringify(contextSummary) });

          await runScoringJob({
            jobId,
            roleId: role.roleId,
            roleName: role.roleName,
            hits,
            candidateRows,
            headerCount,
          });
        } catch (e: any) {
          console.error(`Job ${jobId} crashed:`, e);
          await storage.updateJob(jobId, { status: "failed", error: String(e?.message ?? e) });
        }
      })();

      return;
    } catch (e: any) {
      console.error("Start job failed", e);
      return res.status(500).json({ message: e.message || "Failed to start job" });
    }
  });

  // -------------------------------------------------------------------------
  // Poll job
  app.get("/api/jobs/:id", async (req, res) => {
    const job = await storage.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    return res.json({
      id: job.id,
      roleId: job.roleId,
      roleName: job.roleName,
      status: job.status,
      total: job.totalCandidates,
      completed: job.completedCandidates,
      failed: job.failedCandidates,
      contextSummary: JSON.parse(job.contextSummary),
      results: JSON.parse(job.results) as ScoreResult[],
      uploadFilename: job.uploadFilename,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  });

  // -------------------------------------------------------------------------
  // Two-pass scoring: re-score borderline candidates (score 2/3/4) with Opus.
  // Cheap candidates (1s and 5s) stay on the Sonnet pass. The button on the
  // run page triggers this. Responds immediately with the count being rescored
  // and runs in the background; the run page polls /api/jobs/:id to see
  // updated rows and the rescoreStatus field on contextSummary.
  // -------------------------------------------------------------------------
  app.post("/api/jobs/:id/rescore-borderline", async (req, res) => {
    const job = await storage.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    if (job.status !== "completed") {
      return res.status(400).json({ message: "Job must be completed before rescoring" });
    }
    let summary: any = {};
    try { summary = JSON.parse(job.contextSummary || "{}"); } catch {}
    if (summary.rescoreStatus && summary.rescoreStatus.status === "running") {
      return res.status(409).json({ message: "A rescore is already in progress for this job" });
    }

    const allResults: ScoreResult[] = JSON.parse(job.results);
    // Borderline = score 2, 3, or 4 that wasn't already rescored by Opus.
    const borderline = allResults.filter(
      (r) => !r.error && (r.score === 2 || r.score === 3 || r.score === 4) && r.scoredBy !== "opus",
    );

    if (!borderline.length) {
      return res.json({ jobId: job.id, rescoreCount: 0, message: "No borderline candidates to rescore." });
    }

    summary.rescoreStatus = {
      status: "running",
      model: "opus",
      total: borderline.length,
      completed: 0,
      failed: 0,
      changedCount: 0,
      startedAt: Date.now(),
    };
    await storage.updateJob(job.id, { contextSummary: JSON.stringify(summary) });

    res.json({ jobId: job.id, rescoreCount: borderline.length });

    (async () => {
      try {
        // Rebuild role context from the role's current Drive files. This means
        // a rescore picks up any file additions/edits since the original run.
        const role = await storage.getRole(job.roleId!);
        if (!role) throw new Error("role not found for job");
        const { hits } = await loadRoleContext(role.roleId);
        const ctx: RoleContext = {
          roleName: job.roleName,
          jd: hits.jd,
          hmNotes: hits.hm_notes,
          rubrik: hits.rubrik,
          hired: hits.hired,
          notHired: hits.not_hired,
          transcripts: hits.transcripts,
          scorecards: hits.scorecards,
          incumbents: hits.incumbents,
          benchmarkCandidates: hits.benchmark_candidates,
          calibrationNotes: await buildCalibrationNotes(role.roleId),
        };

        // Index results by rowIndex for in-place updates.
        const byRow = new Map<number, ScoreResult>();
        for (const r of allResults) byRow.set(r.rowIndex, r);

        let completed = 0;
        let failed = 0;
        let changedCount = 0;

        const persist = async () => {
          summary.rescoreStatus = {
            ...summary.rescoreStatus,
            completed,
            failed,
            changedCount,
          };
          await storage.updateJob(job.id, {
            contextSummary: JSON.stringify(summary),
            results: JSON.stringify(Array.from(byRow.values())),
          });
        };

        await runWithConcurrency(
          borderline,
          SCORE_CONCURRENCY,
          async (r) => {
            const candidate: CandidateInput = { rowIndex: r.rowIndex, fields: r.fields || {} };
            try {
              const out = await scoreCandidate(ctx, candidate, OPUS_MODEL);
              const prev = byRow.get(r.rowIndex)!;
              const originalScore = prev.score;
              const updated: ScoreResult = {
                ...prev,
                score: out.score,
                reason: out.reason,
                totalYoe: out.totalYoe ?? prev.totalYoe ?? null,
                scoredBy: "opus",
                originalScore,
              };
              byRow.set(r.rowIndex, updated);
              if (out.score !== originalScore) changedCount++;
              completed++;
            } catch (e) {
              failed++;
              console.error(`Opus rescore failed for row ${r.rowIndex}:`, e);
            }
          },
          persist,
        );

        summary.rescoreStatus = {
          ...summary.rescoreStatus,
          status: "completed",
          completed,
          failed,
          changedCount,
          finishedAt: Date.now(),
        };
        await storage.updateJob(job.id, {
          contextSummary: JSON.stringify(summary),
          results: JSON.stringify(Array.from(byRow.values())),
        });
      } catch (e: any) {
        console.error(`Rescore job ${job.id} crashed:`, e);
        try {
          summary.rescoreStatus = {
            ...(summary.rescoreStatus || {}),
            status: "failed",
            error: String(e?.message ?? e),
            finishedAt: Date.now(),
          };
          await storage.updateJob(job.id, { contextSummary: JSON.stringify(summary) });
        } catch {}
      }
    })();
  });

  app.get("/api/jobs", async (_req, res) => {
    // Use the lightweight projection — Past Runs only needs 7 small fields,
    // not the full results JSON blob (which can be megabytes per job).
    const jobs = (await storage.listJobsSummary()).map((j) => ({
      id: j.id,
      roleName: j.roleName,
      status: j.status,
      total: j.totalCandidates,
      completed: j.completedCandidates,
      failed: j.failedCandidates,
      createdAt: j.createdAt,
    }));
    res.json({ jobs });
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    const job = await storage.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: "Job not found" });
    await storage.deleteJob(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/jobs/:id/csv", async (req, res) => {
    const job = await storage.getJob(req.params.id);
    if (!job) return res.status(404).send("Not found");
    const results: ScoreResult[] = JSON.parse(job.results);
    const sorted = results.slice().sort((a, b) => a.rowIndex - b.rowIndex);

    const originalHeaders: string[] = job.inputHeaders
      ? safeJsonArray(job.inputHeaders)
      : [];
    const seen = new Set<string>(originalHeaders.map((h) => h.toLowerCase()));

    for (const r of sorted) {
      for (const k of Object.keys(r.fields || {})) {
        if (!seen.has(k.toLowerCase())) {
          originalHeaders.push(k);
          seen.add(k.toLowerCase());
        }
      }
    }

    // Map the standard template to this run's input columns once.
    const templateMap = mapTemplateToInputs(originalHeaders);

    // Header row: "Blank" cells export as empty strings.
    const headerRow = COLUMN_TEMPLATE.map((h) => (isBlankHeader(h) ? "" : h));
    const lines = [headerRow.map(csvCell).join(",")];

    for (const r of sorted) {
      const fields = r.fields || {};
      const row = COLUMN_TEMPLATE.map((tmpl, i) => {
        if (isBlankHeader(tmpl)) return "";
        if (isScoreHeader(tmpl)) return r.error ? "" : r.score ?? "";
        if (isReasonHeader(tmpl)) return r.error ? r.error : r.reason ?? "";
        if (isTotalYoeHeader(tmpl)) {
          if (r.error || r.totalYoe == null) return "";
          return formatTemplateCell(tmpl, String(r.totalYoe), fields);
        }
        const inputCol = templateMap[i];
        let raw: string = "";
        if (inputCol) {
          const exact = fields[inputCol];
          if (exact != null) {
            raw = String(exact);
          } else {
            const key = Object.keys(fields).find(
              (k) => k.toLowerCase() === inputCol.toLowerCase(),
            );
            raw = key ? String(fields[key] ?? "") : "";
          }
        }
        return formatTemplateCell(tmpl, raw, fields);
      });
      lines.push(row.map(csvCell).join(","));
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${job.roleName.replace(/[^a-z0-9_-]+/gi, "_")}-scores.csv"`,
    );
    res.send(lines.join("\n"));
  });

  // -------------------------------------------------------------------------
  // Calibration feedback
  // -------------------------------------------------------------------------

  // POST per-candidate feedback. Body: { roleId, candidateUrl, candidateName,
  // candidateSummary, jobId?, aiScore, aiReason, thumb: 'up'|'down',
  // scoreOverride?: 1-5|null, note?: string }. Re-submitting for the same
  // (roleId, candidateUrl) updates the existing row.
  app.post("/api/feedback", async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const roleId = String(body.roleId || "").trim();
      const candidateUrl = String(body.candidateUrl || "").trim();
      const thumb = body.thumb === "down" ? "down" : body.thumb === "up" ? "up" : null;
      if (!roleId || !candidateUrl || !thumb) {
        return res.status(400).json({ message: "roleId, candidateUrl, thumb required" });
      }
      const role = await storage.getRole(roleId);
      if (!role) return res.status(404).json({ message: `Role "${roleId}" not found` });

      let scoreOverride: number | null = null;
      if (body.scoreOverride != null && body.scoreOverride !== "") {
        const n = Math.round(Number(body.scoreOverride));
        if (Number.isFinite(n) && n >= 1 && n <= 5) scoreOverride = n;
      }

      const row = await storage.upsertFeedback({
        id: nanoid(10),
        roleId,
        candidateUrl,
        candidateName: String(body.candidateName || "").slice(0, 200),
        candidateSummary: String(body.candidateSummary || "").slice(0, 1500),
        jobId: body.jobId ? String(body.jobId) : null,
        aiScore: Math.max(1, Math.min(5, Math.round(Number(body.aiScore ?? 3)))),
        aiReason: String(body.aiReason || "").slice(0, 600),
        thumb,
        scoreOverride,
        note: String(body.note || "").slice(0, 1000),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return res.json({ feedback: row });
    } catch (e: any) {
      return res.status(500).json({ message: e.message || "Failed to save feedback" });
    }
  });

  // List feedback for a role.
  app.get("/api/roles/:id/feedback", async (req, res) => {
    const roleId = req.params.id;
    const role = await storage.getRole(roleId);
    if (!role) return res.status(404).json({ message: "Role not found" });
    return res.json({ feedback: await storage.listFeedbackForRole(roleId) });
  });

  // Get the existing feedback (if any) for a single candidate within a role.
  app.get("/api/roles/:id/feedback/lookup", async (req, res) => {
    const roleId = req.params.id;
    const url = String(req.query.candidateUrl || "").trim();
    if (!url) return res.json({ feedback: null });
    const fb = await storage.getFeedbackForRoleCandidate(roleId, url);
    return res.json({ feedback: fb || null });
  });

  app.delete("/api/feedback/:id", async (req, res) => {
    await storage.deleteFeedback(req.params.id);
    return res.json({ ok: true });
  });

  return httpServer;
}

// Build the CALIBRATION_NOTES bucket for the system prompt. Each feedback row
// becomes one short, structured paragraph the model can pattern-match on.
// Capped to ~50 notes and ~30k chars so the prompt stays reasonable.
async function buildCalibrationNotes(roleId: string): Promise<string[]> {
  if (!roleId) return [];
  const rows = await storage.listFeedbackForRole(roleId, 50);
  if (!rows.length) return [];
  const out: string[] = [];
  let totalChars = 0;
  for (const r of rows) {
    const verdict =
      r.thumb === "up"
        ? `Recruiter agreed with the score of ${r.aiScore}.`
        : r.scoreOverride != null
        ? `Recruiter disagreed. Correct score: ${r.scoreOverride} (model gave ${r.aiScore}).`
        : `Recruiter disagreed with the score of ${r.aiScore}.`;
    const lines = [
      `Candidate: ${r.candidateName || r.candidateUrl}`,
      r.candidateSummary ? `Snapshot: ${r.candidateSummary}` : "",
      `Model's reason: ${r.aiReason}`,
      verdict,
      r.note ? `Recruiter note: ${r.note}` : "",
    ].filter(Boolean);
    const block = lines.join("\n");
    if (totalChars + block.length > 30000) break;
    out.push(block);
    totalChars += block.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZERO_COUNTS: Record<Category | "uncategorized", number> = {
  jd: 0,
  hm_notes: 0,
  rubrik: 0,
  hired: 0,
  not_hired: 0,
  transcripts: 0,
  scorecards: 0,
  incumbents: 0,
  benchmark_candidates: 0,
  uncategorized: 0,
};

function buildSummary(files: FileLoadInfo[], hits: CategoryHits) {
  const registered = { ...ZERO_COUNTS };
  const readable = { ...ZERO_COUNTS };
  for (const f of files) {
    const key: Category | "uncategorized" = f.category ?? "uncategorized";
    registered[key]++;
    if (f.textChars > 0) readable[key]++;
  }
  const totalChars = Object.values(hits).reduce(
    (acc, arr) => acc + (arr as string[]).reduce((a, s) => a + s.length, 0),
    0,
  );
  return {
    jd: registered.jd,
    hm_notes: registered.hm_notes,
    rubrik: registered.rubrik,
    hired: registered.hired,
    not_hired: registered.not_hired,
    transcripts: registered.transcripts,
    scorecards: registered.scorecards,
    incumbents: registered.incumbents,
    benchmark_candidates: registered.benchmark_candidates,
    uncategorized: registered.uncategorized,
    totalChars,
    registered,
    readable,
  };
}

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function csvCell(v: any): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---------------------------------------------------------------------------
// Background scoring runner
// ---------------------------------------------------------------------------

async function runScoringJob(args: {
  jobId: string;
  roleId: string;
  roleName: string;
  hits: CategoryHits;
  candidateRows: Record<string, string>[];
  headerCount: number;
}) {
  const { jobId, roleId, roleName, hits, candidateRows } = args;
  const ctx: RoleContext = {
    roleName,
    jd: hits.jd,
    hmNotes: hits.hm_notes,
    rubrik: hits.rubrik,
    hired: hits.hired,
    notHired: hits.not_hired,
    transcripts: hits.transcripts,
    scorecards: hits.scorecards,
    incumbents: hits.incumbents,
    benchmarkCandidates: hits.benchmark_candidates,
    calibrationNotes: await buildCalibrationNotes(roleId),
  };

  const results: ScoreResult[] = [];
  let completed = 0;
  let failed = 0;

  // Resolve a logical field (name/url/company/title) from a row of arbitrary
  // headers. Tries each candidate in order: first exact case-insensitive match,
  // then substring contains. Returns the first non-empty value found.
  const fieldKey = (row: Record<string, string>, candidates: string[]) => {
    const keys = Object.keys(row);
    const lcKeys = keys.map((k) => k.toLowerCase());
    for (const c of candidates) {
      const lc = c.toLowerCase();
      const exactIdx = lcKeys.findIndex((k) => k === lc);
      if (exactIdx !== -1 && row[keys[exactIdx]]) return row[keys[exactIdx]];
    }
    for (const c of candidates) {
      const lc = c.toLowerCase();
      const subIdx = lcKeys.findIndex((k) => k.includes(lc));
      if (subIdx !== -1 && row[keys[subIdx]]) return row[keys[subIdx]];
    }
    return "";
  };

  await runWithConcurrency(
    candidateRows,
    SCORE_CONCURRENCY,
    async (row, i) => {
      const candidate: CandidateInput = { rowIndex: i + 1, fields: row };
      const name = fieldKey(row, [
        "Candidate Name",
        "Full Name",
        "Name",
        "Candidate",
        "candidate_name",
      ]);
      const url = fieldKey(row, [
        "Candidate LinkedIn URL",
        "LinkedIn URL",
        "LinkedIn",
        "Profile URL",
        "URL",
        "profile_url",
      ]);
      const company = fieldKey(row, [
        "Company1",
        "Current Company",
        "Company",
        "company",
      ]);
      const title = fieldKey(row, [
        "Company1 Title",
        "Current Title",
        "Candidate Profile Headline",
        "Headline",
        "Title",
        "headline",
      ]);
      try {
        const out = await scoreCandidate(ctx, candidate);
        const r: ScoreResult = {
          rowIndex: i + 1,
          candidateName: name,
          candidateUrl: url,
          candidateCompany: company,
          candidateTitle: title,
          fields: row,
          score: out.score,
          reason: out.reason,
          totalYoe: out.totalYoe,
          scoredBy: "sonnet",
        };
        results.push(r);
        completed++;
        return r;
      } catch (e: any) {
        const r: ScoreResult = {
          rowIndex: i + 1,
          candidateName: name,
          candidateUrl: url,
          candidateCompany: company,
          candidateTitle: title,
          fields: row,
          score: 0 as any,
          reason: "",
          error: String(e?.message ?? e).slice(0, 300),
        };
        results.push(r);
        failed++;
        return r;
      }
    },
    async () => {
      await storage.updateJob(jobId, {
        completedCandidates: completed,
        failedCandidates: failed,
        results: JSON.stringify(results),
      });
    },
  );

  await storage.updateJob(jobId, {
    status: "completed",
    completedCandidates: completed,
    failedCandidates: failed,
    results: JSON.stringify(results),
  });
}
