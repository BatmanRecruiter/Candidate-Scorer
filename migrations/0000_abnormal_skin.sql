CREATE TABLE "calibration_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"candidate_url" text NOT NULL,
	"candidate_name" text NOT NULL,
	"candidate_summary" text NOT NULL,
	"job_id" text,
	"ai_score" integer NOT NULL,
	"ai_reason" text NOT NULL,
	"thumb" text NOT NULL,
	"score_override" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text,
	"role_name" text NOT NULL,
	"context_summary" text NOT NULL,
	"status" text NOT NULL,
	"total_candidates" integer NOT NULL,
	"completed_candidates" integer NOT NULL,
	"failed_candidates" integer NOT NULL,
	"results" text NOT NULL,
	"input_headers" text,
	"upload_filename" text,
	"error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_files" (
	"id" text PRIMARY KEY NOT NULL,
	"role_id" text NOT NULL,
	"file_name" text NOT NULL,
	"category" text,
	"auto_detected" integer DEFAULT 1 NOT NULL,
	"content_text" text NOT NULL,
	"byte_size" integer NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"role_id" text PRIMARY KEY NOT NULL,
	"role_name" text NOT NULL,
	"file_category_overrides" text NOT NULL,
	"created_at" bigint NOT NULL
);
