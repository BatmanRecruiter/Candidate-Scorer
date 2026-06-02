import { pgTable, text, integer, bigint, index, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod";

// Unix ms timestamps are 13 digits and exceed PostgreSQL INTEGER (32-bit).
// bigint { mode: "number" } stores as PG BIGINT but returns a JS number.

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id"),
    roleName: text("role_name").notNull(),
    contextSummary: text("context_summary").notNull(),
    status: text("status").notNull(),
    totalCandidates: integer("total_candidates").notNull(),
    completedCandidates: integer("completed_candidates").notNull(),
    failedCandidates: integer("failed_candidates").notNull(),
    results: text("results").notNull(),
    inputHeaders: text("input_headers"),
    sheetId: text("sheet_id"),
    sheetName: text("sheet_name"),
    uploadFilename: text("upload_filename"),
    error: text("error"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [index("idx_jobs_created_at").on(t.createdAt)],
);

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

export const roles = pgTable("roles", {
  roleId: text("role_id").primaryKey(),
  roleName: text("role_name").notNull(),
  fileCategoryOverrides: text("file_category_overrides").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

export const calibrationFeedback = pgTable(
  "calibration_feedback",
  {
    id: text("id").primaryKey(),
    roleId: text("role_id").notNull(),
    candidateUrl: text("candidate_url").notNull(),
    candidateName: text("candidate_name").notNull(),
    candidateSummary: text("candidate_summary").notNull(),
    jobId: text("job_id"),
    aiScore: integer("ai_score").notNull(),
    aiReason: text("ai_reason").notNull(),
    thumb: text("thumb").notNull(),
    scoreOverride: integer("score_override"),
    note: text("note").notNull().default(""),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => [
    index("idx_calibration_role").on(t.roleId),
    uniqueIndex("idx_calibration_role_candidate").on(t.roleId, t.candidateUrl),
  ],
);

export type CalibrationFeedback = typeof calibrationFeedback.$inferSelect;
export type InsertCalibrationFeedback = typeof calibrationFeedback.$inferInsert;

// API contract types ----------------------------------------------------

export const scoreResultSchema = z.object({
  rowIndex: z.number(),
  candidateName: z.string(),
  candidateUrl: z.string().optional().default(""),
  candidateCompany: z.string().optional().default(""),
  candidateTitle: z.string().optional().default(""),
  fields: z.record(z.string()).optional().default({}),
  score: z.number().min(1).max(5),
  reason: z.string(),
  totalYoe: z.number().nullable().optional(),
  scoredBy: z.enum(["sonnet", "opus"]).optional(),
  originalScore: z.number().min(1).max(5).optional(),
  error: z.string().optional(),
});
export type ScoreResult = z.infer<typeof scoreResultSchema>;

export const roleContextSummarySchema = z.object({
  jd: z.number(),
  hm_notes: z.number(),
  rubrik: z.number(),
  hired: z.number(),
  not_hired: z.number(),
  transcripts: z.number(),
  scorecards: z.number(),
  incumbents: z.number(),
  benchmark_candidates: z.number(),
  uncategorized: z.number(),
  totalChars: z.number(),
});
export type RoleContextSummary = z.infer<typeof roleContextSummarySchema>;
