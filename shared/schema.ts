import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { z } from "zod";

// A "job" is one scoring batch
export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  roleId: text("role_id"), // user-set role ID (linked to roles table)
  roleName: text("role_name").notNull(),
  // JSON-encoded summary of context files used
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
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type Job = typeof jobs.$inferSelect;
export type InsertJob = typeof jobs.$inferInsert;

// A "role" is a user-defined posting/req. The user picks any short ID; files
// in Drive whose names start with that ID belong to this role.
export const roles = sqliteTable("roles", {
  roleId: text("role_id").primaryKey(), // user-chosen, e.g. "VECTOR" or "SS-001"
  roleName: text("role_name").notNull(), // display name
  // JSON: { fileId: category } — overrides for files whose auto-detection
  // failed or was wrong. Persists so the user only has to categorize a file
  // once per role.
  fileCategoryOverrides: text("file_category_overrides").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Role = typeof roles.$inferSelect;
export type InsertRole = typeof roles.$inferInsert;

// Per-role calibration feedback. One row per (role, candidate) thumb/note.
// Re-submitting feedback for the same candidate updates the existing row.
export const calibrationFeedback = sqliteTable("calibration_feedback", {
  id: text("id").primaryKey(),
  roleId: text("role_id").notNull(),
  candidateUrl: text("candidate_url").notNull(), // dedupe key within a role
  candidateName: text("candidate_name").notNull(),
  candidateSummary: text("candidate_summary").notNull(), // short snapshot for the prompt
  jobId: text("job_id"), // job this feedback came from (for traceability)
  aiScore: integer("ai_score").notNull(), // what the model gave
  aiReason: text("ai_reason").notNull(),
  thumb: text("thumb").notNull(), // 'up' | 'down'
  scoreOverride: integer("score_override"), // null = no override
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
  totalYoe: z.number().nullable().optional(), // computed years of experience
  // Which model produced this result. "sonnet" = first-pass default,
  // "opus" = a re-score of a borderline candidate.
  scoredBy: z.enum(["sonnet", "opus"]).optional(),
  // The pre-rescore score, kept for transparency so users can see what
  // changed. Only set on Opus-rescored rows.
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
