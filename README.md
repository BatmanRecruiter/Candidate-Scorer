# Candidate Scorer

AI-powered candidate scoring for technical recruiting workflows.

Candidate Scorer reads a Google Sheet of LinkedIn-style candidate data, enriches each row with role-specific context pulled from a Google Drive folder (job description, hiring-manager notes, rubric, hired and not-hired examples, interview transcripts, scorecards, incumbent profiles, benchmark candidates), and scores every candidate 1–5 with a large language model. It includes a two-pass review pipeline where borderline scores are automatically re-evaluated by a stronger model, plus a per-role calibration layer that learns from recruiter feedback over time.

Built to replace the manual "open every LinkedIn profile, cross-reference the rubric, type a one-liner in column AI" workflow with something that scales to hundreds of candidates per role and stays auditable.

---

## What it does

- **Reads candidates from a Google Sheet.** Drop a sheet ID into the role config; the app pulls every row and treats it as a candidate.
- **Pulls per-role context from Google Drive.** Point a role at a Drive folder. The app categorizes every file by filename keyword into nine buckets — `jd`, `hm_notes`, `rubrik`, `hired`, `not_hired`, `transcripts`, `scorecards`, `incumbents`, `benchmark_candidates` — and assembles them into a single context object the scorer consumes.
- **Scores every candidate 1–5 against the rubric.** First pass uses `claude-sonnet-4-6` for cost and throughput. Output is structured: `{score, reason, totalYoe}`.
- **Two-pass review for borderline candidates.** A one-click "Re-score borderline (Opus)" button on completed runs re-runs every score of 2, 3, or 4 through `claude-opus-4-7`, stores the original Sonnet score so the diff is visible, and writes only the changed rows back to the Sheet.
- **Per-role calibration feedback.** Thumbs up/down, free-text notes, and manual score overrides on any candidate row are stored against the role and injected into the next run's prompt so the model learns the recruiter's taste over time.
- **Deterministic rules baked into the prompt:**
  - **Insufficient Data** — if both the About and Experience sections are near-empty, auto-score 1 with reason `"Insufficient Data"`.
  - **Duration at Company** — if the candidate's current company end date is more than six months before today, auto-score 1 with reason `"Duration at Company"`.
  - **Education inference** — a Master's or PhD implies a Bachelor's; never flag those candidates as missing a Bachelor's requirement.
  - **Total YOE** rounded to two decimals; **YAC** (Years At Company) is current-company-only and distinct from Total YOE.
- **Standardized export.** One CSV/Sheet column template across every role. Export is restricted to Company1 and Company2 candidates only.
- **Legacy file support.** Parses `.docx`, `.pdf`, native Google Docs, and legacy `.doc`.

---

## Architecture

```
client/        React + Vite frontend (job view, manage roles, calibration UI)
server/        Express server
  scorer.ts    LLM prompt construction + scoring pipeline (single + batch)
  routes.ts    REST endpoints (jobs, roles, calibration feedback, rescore)
  external.ts  Google Drive + Sheets fetchers via googleapis service account
  storage.ts   Async Drizzle/Postgres storage layer
  auth.ts      ADMIN_API_KEY bearer-token middleware
shared/        Zod schemas and export column template shared by client + server
migrations/    Drizzle-generated Postgres DDL migrations
```

---

## Stack

- **Backend:** Node.js, Express 5, TypeScript, Neon Postgres via `postgres.js` + Drizzle ORM
- **Frontend:** React 18, Vite, Tailwind CSS, shadcn/ui, wouter, TanStack Query
- **AI:** Anthropic Claude (`claude-sonnet-4-6` first pass, `claude-opus-4-7` rescore)
- **Google:** Drive v3 + Sheets v4 + Docs v1 via service account (`googleapis`)
- **Security:** `helmet` security headers, `ADMIN_API_KEY` bearer-token auth on all `/api/*` routes
- **Deployment:** Render Web Service + Neon Postgres

---

## Local development

### Prerequisites

- Node.js 20+
- A Postgres database (local or [Neon](https://neon.tech))
- Anthropic API key
- Google service account with Drive, Sheets, and Docs APIs enabled

### Setup

```bash
git clone https://github.com/BatmanRecruiter/Candidate-Scorer
cd Candidate-Scorer
npm ci
cp .env.example .env
# fill in .env — see Environment variables below
npm run db:migrate
npm run dev
```

The dev server starts on `http://localhost:5000` (or `PORT` from `.env`).

`ADMIN_API_KEY` is optional locally — if unset, auth is skipped entirely.

---

## Environment variables

See `.env.example` for the full annotated list. Required for production:

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon (or any Postgres) connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account `client_email` from JSON key |
| `GOOGLE_PRIVATE_KEY` | Service account `private_key` (literal `\n` sequences — the app converts them at runtime) |
| `ADMIN_API_KEY` | Bearer token required for all `/api/*` routes except `/api/health` |
| `NODE_ENV` | `production` on Render |
| `PORT` | HTTP port (Render sets this automatically) |

---

## Google service account setup

1. In Google Cloud Console, create a service account and download a JSON key.
2. Enable the **Drive API**, **Sheets API**, and **Docs API** for your project.
3. Share target Drive folders with the service account email (Viewer); share Sheets you write scores to (Editor).
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` to `client_email` and `GOOGLE_PRIVATE_KEY` to `private_key` from the JSON key.
5. **Never commit the JSON key file.** `.gitignore` blocks `*-service-account.json`, `service-account.json`, and `google-credentials.json`.

---

## Database migrations

Migrations live in `migrations/` and are managed by Drizzle Kit.

```bash
# Generate a new migration after editing shared/schema.ts
npm run db:generate

# Apply pending migrations to DATABASE_URL
npm run db:migrate
```

On Render the start command runs `npm run db:migrate && npm start` automatically on every deploy.

---

## Deploying to Render

1. Push the repo to GitHub.
2. Create a new **Web Service** in Render connected to the repo.
3. Render detects `render.yaml` and pre-fills the service config.
4. Set the secret env vars in the Render dashboard: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `ADMIN_API_KEY`.
5. Deploy. Build runs `npm ci && npm run build`; start runs `npm run db:migrate && npm start`.
6. Health check endpoint: `GET /api/health` (no auth required).

### Neon database setup

1. Create a project at [neon.tech](https://neon.tech).
2. Copy the pooled connection string from the Neon dashboard.
3. Set it as `DATABASE_URL` on Render (and locally in `.env`).

---

## Usage

1. Create a role — give it a name and a Google Drive folder ID.
2. The app categorizes every file in that folder into the nine context buckets by filename keyword.
3. Start a scoring job by pasting a Google Sheet ID with candidate rows (or upload a CSV).
4. The job runs first-pass Sonnet scoring, writes results back to the Sheet, and surfaces a candidate list in the UI.
5. Review the run. Drop thumbs up/down, notes, or score overrides on rows that look wrong — these become calibration feedback for the next run.
6. Click "Re-score borderline (Opus)" to re-run 2/3/4 candidates through Opus 4.7. Only changed rows are written back.

---

## Notes

- `rubrik` is the project's chosen spelling for the rubric category throughout the app — intentional, not a typo.
- The export drops Company3 and Company4 entirely.
- YAC (Years At Company) is current-company-only. Total YOE is everything.

---

## npm audit note

`googleapis@146` depends on `uuid@9` via `gaxios`, which has a known low-severity vulnerability. `npm audit fix` was not applied because the fix requires upgrading to `googleapis@173` (breaking major version). Monitor upstream for a patch release.

---

## License

MIT.
