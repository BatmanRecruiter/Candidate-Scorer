import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
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

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

const sql = postgres(process.env.DATABASE_URL, {
  ssl: process.env.NODE_ENV === "production" ? "require" : undefined,
  max: 10,
});

export const db = drizzle(sql);

export type JobSummary = {
  id: string;
  roleName: string;
  status: string;
  totalCandidates: number;
  completedCandidates: number;
  failedCandidates: number;
  createdAt: number;
};

export interface IStorage {
  createJob(job: InsertJob): Promise<Job>;
  getJob(id: string): Promise<Job | undefined>;
  updateJob(id: string, patch: Partial<Job>): Promise<Job | undefined>;
  listJobs(limit?: number): Promise<Job[]>;
  listJobsSummary(limit?: number): Promise<JobSummary[]>;

  createRole(role: InsertRole): Promise<Role>;
  getRole(roleId: string): Promise<Role | undefined>;
  updateRole(roleId: string, patch: Partial<Role>): Promise<Role | undefined>;
  deleteRole(roleId: string): Promise<void>;
  listRoles(): Promise<Role[]>;

  upsertFeedback(fb: InsertCalibrationFeedback): Promise<CalibrationFeedback>;
  getFeedbackForRoleCandidate(
    roleId: string,
    candidateUrl: string,
  ): Promise<CalibrationFeedback | undefined>;
  listFeedbackForRole(roleId: string, limit?: number): Promise<CalibrationFeedback[]>;
  deleteFeedback(id: string): Promise<void>;
}

export const storage: IStorage = {
  async createJob(job: InsertJob) {
    const [row] = await db.insert(jobs).values(job).returning();
    return row;
  },
  async getJob(id: string) {
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return row;
  },
  async updateJob(id: string, patch: Partial<Job>) {
    const [row] = await db
      .update(jobs)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(jobs.id, id))
      .returning();
    return row;
  },
  async listJobs(limit = 25) {
    return db.select().from(jobs).orderBy(desc(jobs.createdAt)).limit(limit);
  },
  async listJobsSummary(limit = 50): Promise<JobSummary[]> {
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
      .limit(limit);
  },

  async createRole(role: InsertRole) {
    const [row] = await db.insert(roles).values(role).returning();
    return row;
  },
  async getRole(roleId: string) {
    const [row] = await db.select().from(roles).where(eq(roles.roleId, roleId)).limit(1);
    return row;
  },
  async updateRole(roleId: string, patch: Partial<Role>) {
    const [row] = await db
      .update(roles)
      .set(patch)
      .where(eq(roles.roleId, roleId))
      .returning();
    return row;
  },
  async deleteRole(roleId: string) {
    await db.delete(roles).where(eq(roles.roleId, roleId));
  },
  async listRoles() {
    return db.select().from(roles).orderBy(asc(roles.roleName));
  },

  async upsertFeedback(fb: InsertCalibrationFeedback) {
    const [existing] = await db
      .select()
      .from(calibrationFeedback)
      .where(
        and(
          eq(calibrationFeedback.roleId, fb.roleId),
          eq(calibrationFeedback.candidateUrl, fb.candidateUrl),
        ),
      )
      .limit(1);
    if (existing) {
      const [row] = await db
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
        .returning();
      return row;
    }
    const [row] = await db.insert(calibrationFeedback).values(fb).returning();
    return row;
  },
  async getFeedbackForRoleCandidate(roleId, candidateUrl) {
    const [row] = await db
      .select()
      .from(calibrationFeedback)
      .where(
        and(
          eq(calibrationFeedback.roleId, roleId),
          eq(calibrationFeedback.candidateUrl, candidateUrl),
        ),
      )
      .limit(1);
    return row;
  },
  async listFeedbackForRole(roleId, limit = 200) {
    return db
      .select()
      .from(calibrationFeedback)
      .where(eq(calibrationFeedback.roleId, roleId))
      .orderBy(desc(calibrationFeedback.updatedAt))
      .limit(limit);
  },
  async deleteFeedback(id: string) {
    await db.delete(calibrationFeedback).where(eq(calibrationFeedback.id, id));
  },
};
