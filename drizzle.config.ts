import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    // Falls back to a local placeholder so `db:generate` works offline.
    // Set DATABASE_URL before running `db:migrate` or `db:push`.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/candidate_scorer",
  },
});
