import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, desc, asc } from "drizzle-orm";
import {
  jobs,
  roles,
  calibrationFeedback,
  type Job,
  type InsertJob,
  type Role,
  type InsertRole,
  type CalibrationFeedback,
  type InsertCalibrationFeedback,
} from "@shared/schema";

export type JobSummary = {
  id: string;
  roleName: string;
  status: string;
  totalCandidates: number;
  completedCandidates: number;
  failedCandidates: number;
  createdAt: number;
};

const sqlite = new Database("./data.db");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    role_name TEXT NOT NULL,
    context_summary TEXT NOT NULL,
    status TEXT NOT NULL,
    total_candidates INTEGER NOT NULL,
    completed_candidates INTEGER NOT NULL,
    failed_candidates INTEGER NOT NULL,
    results TEXT NOT NULL,
    input_headers TEXT,
    sheet_id TEXT,
    sheet_name TEXT,
    upload_filename TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    role_id TEXT PRIMARY KEY,
    role_name TEXT NOT NULL,
    file_category_overrides TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS calibration_feedback (
    id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL,
    candidate_url TEXT NOT NULL,
    candidate_name TEXT NOT NULL,
    candidate_summary TEXT NOT NULL,
    job_id TEXT,
    ai_score INTEGER NOT NULL,
    ai_reason TEXT NOT NULL,
    thumb TEXT NOT NULL,
    score_override INTEGER,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_calibration_role ON calibration_feedback(role_id);`,
);
sqlite.exec(
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_calibration_role_candidate ON calibration_feedback(role_id, candidate_url);`,
);
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);`,
);

// Migrate older databases. SQLite throws if the column already exists;
// swallow that case.
for (const sql of [
  `ALTER TABLE jobs ADD COLUMN input_headers TEXT`,
  `ALTER TABLE jobs ADD COLUMN role_id TEXT`,
]) {
  try {
    sqlite.exec(sql);
  } catch (e: any) {
    if (!/duplicate column/i.test(String(e?.message))) throw e;
  }
}

export const db = drizzle(sqlite);

export interface IStorage {
  createJob(job: InsertJob): Job;
  getJob(id: string): Job | undefined;
  updateJob(id: string, patch: Partial<Job>): Job | undefined;
  listJobs(limit?: number): Job[];
  listJobsSummary(limit?: number): JobSummary[];

  createRole(role: InsertRole): Role;
  getRole(roleId: string): Role | undefined;
  updateRole(roleId: string, patch: Partial<Role>): Role | undefined;
  deleteRole(roleId: string): void;
  listRoles(): Role[];

  upsertFeedback(fb: InsertCalibrationFeedback): CalibrationFeedback;
  getFeedbackForRoleCandidate(
    roleId: string,
    candidateUrl: string,
  ): CalibrationFeedback | undefined;
  listFeedbackForRole(roleId: string, limit?: number): CalibrationFeedback[];
  deleteFeedback(id: string): void;
}

export const storage: IStorage = {
  createJob(job: InsertJob) {
    return db.insert(jobs).values(job).returning().get();
  },
  getJob(id: string) {
    return db.select().from(jobs).where(eq(jobs.id, id)).get();
  },
  updateJob(id: string, patch: Partial<Job>) {
    const next = { ...patch, updatedAt: Date.now() };
    return db.update(jobs).set(next).where(eq(jobs.id, id)).returning().get();
  },
  listJobs(limit = 25) {
    return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit).all();
  },
  listJobsSummary(limit = 50): JobSummary[] {
    // Lightweight projection for the Past Runs list. Avoids loading the
    // huge `results` JSON blob (can be megabytes per job).
    return db
      .select({
        id: jobs.id,
        roleName: jobs.roleName,
        status: jobs.status,
        totalCandidates: jobs.totalCandidates,
        completedCandidates: jobs.completedCandidates,
        failedCandidates: jobs.failedCandidates,
        createdAt: jobs.createdAt,
      })
      .from(jobs)
      .orderBy(desc(jobs.createdAt))
      .limit(limit)
      .all();
  },

  createRole(role: InsertRole) {
    return db.insert(roles).values(role).returning().get();
  },
  getRole(roleId: string) {
    return db.select().from(roles).where(eq(roles.roleId, roleId)).get();
  },
  updateRole(roleId: string, patch: Partial<Role>) {
    return db.update(roles).set(patch).where(eq(roles.roleId, roleId)).returning().get();
  },
  deleteRole(roleId: string) {
    db.delete(roles).where(eq(roles.roleId, roleId)).run();
  },
  listRoles() {
    return db.select().from(roles).orderBy(asc(roles.roleName)).all();
  },

  upsertFeedback(fb: InsertCalibrationFeedback) {
    const existing = db
      .select()
      .from(calibrationFeedback)
      .where(
        and(
          eq(calibrationFeedback.roleId, fb.roleId),
          eq(calibrationFeedback.candidateUrl, fb.candidateUrl),
        ),
      )
      .get();
    if (existing) {
      return db
        .update(calibrationFeedback)
        .set({
          candidateName: fb.candidateName,
          candidateSummary: fb.candidateSummary,
          jobId: fb.jobId ?? existing.jobId,
          aiScore: fb.aiScore,
          aiReason: fb.aiReason,
          thumb: fb.thumb,
          scoreOverride: fb.scoreOverride ?? null,
          note: fb.note ?? "",
          updatedAt: Date.now(),
        })
        .where(eq(calibrationFeedback.id, existing.id))
        .returning()
        .get();
    }
    return db.insert(calibrationFeedback).values(fb).returning().get();
  },
  getFeedbackForRoleCandidate(roleId, candidateUrl) {
    return db
      .select()
      .from(calibrationFeedback)
      .where(
        and(
          eq(calibrationFeedback.roleId, roleId),
          eq(calibrationFeedback.candidateUrl, candidateUrl),
        ),
      )
      .get();
  },
  listFeedbackForRole(roleId, limit = 200) {
    return db
      .select()
      .from(calibrationFeedback)
      .where(eq(calibrationFeedback.roleId, roleId))
      .orderBy(desc(calibrationFeedback.updatedAt))
      .limit(limit)
      .all();
  },
  deleteFeedback(id: string) {
    db.delete(calibrationFeedback).where(eq(calibrationFeedback.id, id)).run();
  },
};
