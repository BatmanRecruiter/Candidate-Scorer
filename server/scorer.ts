import { cachedMessage } from "./anthropicClient";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const OPUS_MODEL = "claude-opus-4-8";
export type ScoringModel = typeof DEFAULT_MODEL | typeof OPUS_MODEL;

// Today's date used by the scorer for YOE math. Captured at module load; that's
// fine because a scoring run completes in minutes and we re-import per server
// restart. Format: "YYYY-MM-DD".
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Cutoff for the "Duration at Company" rule: 6 calendar months before today.
// A Company1 End Date strictly older than this means the candidate has been
// out of work for more than 6 months.
function sixMonthsAgoIso(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 6);
  return d.toISOString().slice(0, 10);
}

export interface RoleContext {
  roleName: string;
  jd: string[];
  hmNotes: string[];
  deptNotes: string[];
  rubrik: string[];
  currentEmployees: string[];
  notHired: string[];
  transcripts: string[];
  positiveScorecards: string[];
  negativeScorecards: string[];
  benchmarkCandidates: string[];
  calibrationNotes: string[];
}

export interface CandidateInput {
  rowIndex: number;
  fields: Record<string, string>; // every column from the CSV/Sheet
}

export interface ScoreOutput {
  score: number;
  reason: string;
  totalYoe: number | null;
}

function formatBucket(label: string, items: string[]): string {
  if (!items.length) return `### ${label}\n(none provided)\n`;
  return (
    `### ${label}\n` +
    items
      .map((t, i) => `[${label} #${i + 1}]\n${truncate(t, 12000)}`)
      .join("\n\n")
  );
}

function truncate(s: string, max: number) {
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`;
}

export function buildSystemPrompt(ctx: RoleContext): string {
  const hasRubrik = ctx.rubrik.length > 0;
  return [
    `You are an expert technical recruiter scoring sourced candidates for the role: "${ctx.roleName}".`,
    `You will be given a candidate's LinkedIn profile and reference materials for the role. Decide if we should reach out to this candidate.`,
    ``,
    `TODAY'S DATE (use this for all date math): ${todayIso()}`,
    `SIX-MONTHS-AGO CUTOFF (use this for the Duration at Company rule below): ${sixMonthsAgoIso()}`,
    ``,
    `YEARS-OF-EXPERIENCE COMPUTATION — be careful and explicit:`,
    `- The candidate's profile includes "CompanyN Start Date" and "CompanyN End Date" columns (MM/DD/YYYY) for up to 9 roles.`,
    `- "YAC" means "Years At Company" — it is the tenure at the CURRENT company only. It is NOT total experience. Do not confuse these.`,
    `- If a CompanyN End Date equals today's date, the candidate is still in that role. Compute its duration as (today − Start Date).`,
    `- Total YOE = sum of (End − Start) across all listed roles, in years. Add overlapping months only once (do not double-count concurrent roles).`,
    `- Return totalYoe as a number rounded to two decimal places (e.g. 7.25 for 7 years 3 months). If no dates are parseable at all, return null for totalYoe.`,
    `- Common failure mode: relying only on YAC, or only on Company1 dates, and undercounting earlier roles. Always sweep ALL CompanyN Start/End Date columns present in the profile.`,
    `- Report totalYoe in the JSON output (see format below). Use it in your scoring and mention it in the reason when experience is a deciding factor.`,
    ``,
    `EDUCATION INFERENCE:`,
    `- Treat a Master's or PhD as implying a Bachelor's. If the candidate lists a Master's, MBA, MS, MA, JD, MD, PhD, or any doctoral/graduate degree, assume they also hold a Bachelor's degree even when no Bachelor's is explicitly listed on their profile. Do NOT mark them as missing a Bachelor's requirement.`,
    ``,
    `INSUFFICIENT DATA RULE — applies BEFORE normal scoring:`,
    `- If the candidate's profile does not have enough information to make an educated decision, return score 1 with reason set to exactly "Insufficient Data" (those two words, nothing else — no period, no explanation).`,
    `- "Not enough information" means BOTH of the following are true: (a) the About section is empty or near-empty (a sentence or less, or missing entirely), AND (b) the Experience section is empty or near-empty (no companies listed, or company entries with no titles/dates/descriptions).`,
    `- A profile with a real Experience section (any CompanyN with a Title and dates) is NOT insufficient data, even if the About section is blank. Only flag Insufficient Data when there is genuinely nothing to evaluate.`,
    `- When this rule triggers, output exactly: {"score":1,"reason":"Insufficient Data","totalYoe":null}. Do not produce a longer reason, do not attempt to compute YOE, do not apply the rubrik.`,
    ``,
    `DURATION AT COMPANY RULE — applies BEFORE normal scoring (but AFTER the Insufficient Data check):`,
    `- If the candidate's most recent role (Company1) has an End Date that is strictly earlier than the SIX-MONTHS-AGO CUTOFF above, they have been out of work for more than 6 months. Return score 1 with reason set to exactly "Duration at Company" (those three words, nothing else — no period, no explanation).`,
    `- Company1 End Date equal to today's date means they are currently employed — do NOT trigger this rule.`,
    `- Company1 End Date between today and the SIX-MONTHS-AGO CUTOFF (inclusive) means they have been out for 6 months or less — do NOT trigger this rule.`,
    `- Only trigger when Company1 End Date is strictly older than the SIX-MONTHS-AGO CUTOFF and is parseable.`,
    `- When this rule triggers, output exactly: {"score":1,"reason":"Duration at Company","totalYoe":<computed>}. Still compute totalYoe normally.`,
    ``,
    `PHDATA RULE — applies BEFORE normal scoring and takes precedence over every other rule and the rubrik:`,
    `- If the candidate currently works at phData, or has EVER worked at phData in the past, return score 1 with reason set to exactly "phData" (that one word, nothing else — no period, no explanation).`,
    `- Check the company name in EVERY CompanyN entry on the profile, not just Company1. Match the name case-insensitively and ignore suffixes (e.g. "phData", "phdata", "phData, Inc." all count).`,
    `- This rule evaluates ONLY the candidate being scored. Reference materials in this prompt (especially CURRENT_PHDATA_EMPLOYEES_IN_ROLE) describe phData employees by design — their mention of phData must NEVER trigger this rule.`,
    `- When this rule triggers, output exactly: {"score":1,"reason":"phData","totalYoe":<computed>}. Still compute totalYoe normally.`,
    ``,
    `Reference materials (the SCORING_RUBRIK is the authoritative source when present — all other materials are supporting context):`,
    formatBucket("SCORING_RUBRIK", ctx.rubrik),
    formatBucket("JOB_DESCRIPTION", ctx.jd),
    formatBucket("HIRING_MANAGER_NOTES", ctx.hmNotes),
    formatBucket("DEPARTMENT_OVERVIEW_NOTES", ctx.deptNotes),
    formatBucket("CURRENT_PHDATA_EMPLOYEES_IN_ROLE", ctx.currentEmployees),
    formatBucket("RESUMES_OF_PEOPLE_WE_DID_NOT_HIRE", ctx.notHired),
    formatBucket("INTERVIEW_TRANSCRIPTS", ctx.transcripts),
    formatBucket("POSITIVE_INTERVIEW_SCORECARDS", ctx.positiveScorecards),
    formatBucket("NEGATIVE_INTERVIEW_SCORECARDS", ctx.negativeScorecards),
    formatBucket("POSITIVE_BENCHMARK_CANDIDATE_LINKEDIN_PROFILES", ctx.benchmarkCandidates),
    ``,
    ...(ctx.deptNotes.length
      ? [
          `IMPORTANT — about DEPARTMENT_OVERVIEW_NOTES: general background on the department this role sits in — its mission, structure, and priorities. Use it as supporting context to understand what the role actually does. It is NOT a requirements list: do not derive must-haves from it. Requirements come from the SCORING_RUBRIK, JOB_DESCRIPTION, and HIRING_MANAGER_NOTES (the hiring manager's intake-call notes).`,
          ``,
        ]
      : []),
    ...(ctx.currentEmployees.length
      ? [
          `IMPORTANT — about CURRENT_PHDATA_EMPLOYEES_IN_ROLE: these are resumes of people CURRENTLY employed at phData in this exact role. They show what the job actually requires — the real skill floor and background mix of people successfully doing the work today. They are reference material, not aspirational targets (POSITIVE_BENCHMARK_CANDIDATE_LINKEDIN_PROFILES describes who we WANT to find; this bucket describes who is already in the seat). Use them to judge whether a candidate could realistically do this job. NOTE: these reference resumes naturally mention phData — that does NOT trigger the PHDATA RULE. That rule applies ONLY to the candidate being scored, never to reference materials.`,
          ``,
        ]
      : []),
    ...(ctx.positiveScorecards.length
      ? [
          `IMPORTANT — about POSITIVE_INTERVIEW_SCORECARDS: every scorecard in this bucket is from a candidate we LIKED and advanced in our process. Treat them as positive signal only: identify the skills, experience, and traits our interviewers praised, and score candidates who show similar strengths HIGHER. Do NOT mine these for negative signal — even critical comments here belong to candidates we ultimately moved forward.`,
          ``,
        ]
      : []),
    ...(ctx.negativeScorecards.length
      ? [
          `IMPORTANT — about NEGATIVE_INTERVIEW_SCORECARDS: every scorecard in this bucket is from a candidate we PASSED ON. Study them for recurring patterns of poor fit — the gaps, red flags, and weaknesses that made our interviewers say no — and score candidates who show similar traits LOWER. A candidate who resembles the people we rejected is likely a poor fit even if their profile looks superficially strong.`,
          ``,
        ]
      : []),
    ...(ctx.benchmarkCandidates.length
      ? [
          `IMPORTANT — about POSITIVE_BENCHMARK_CANDIDATE_LINKEDIN_PROFILES: these are LinkedIn profiles of people who represent the background, skills, and experience we WANT to find for this role. They were NOT necessarily hired here — they are positive reference points for what a strong candidate looks like. A candidate who resembles them should score higher.`,
          ``,
        ]
      : []),
    formatBucket("CALIBRATION_NOTES", ctx.calibrationNotes),
    ``,
    ...(ctx.calibrationNotes.length
      ? [
          `IMPORTANT — about CALIBRATION_NOTES: these are corrections from the recruiter on past scoring decisions for THIS role. Each note describes a candidate the model previously scored, what the model gave, whether the recruiter agreed (thumbs up) or disagreed (thumbs down), the score the recruiter would have given (if provided), and why. Treat these as authoritative — they reflect the recruiter's actual judgment. Identify patterns in the corrections and APPLY them when scoring new candidates. If multiple notes point to the same gap (e.g. "the model keeps overscoring people who only have bootcamp education"), correct for that pattern going forward.`,
          ``,
        ]
      : []),
    `Scoring scale (1-5 integer, 5 is best):`,
    `5 — Excellent match. Reach out today. Hits all heavy must-haves plus strong pluses; resembles current phData employees in the role, positive scorecards, or benchmark profiles.`,
    `4 — Good match. Worth reaching out. Hits all 3-weight must-haves; modest gaps only on lower-weighted items.`,
    `3 — Borderline. Some must-have alignment but gaps on heavy items, or thin signal overall.`,
    `2 — Weak. Multiple heavy must-haves missing, or resembles not-hired profiles / patterns from negative scorecards.`,
    `1 — Skip. Missing a non-negotiable, OR wrong role/level entirely.`,
    ``,
    ...(hasRubrik
      ? [
          `RUBRIK INTERPRETATION RULES — follow these exactly when a SCORING_RUBRIK is provided:`,
          ``,
          `1. The rubrik defines three lists: Must-Haves, Pluses (sometimes labeled "nice-to-haves" or "strongest pluses"), and Non-Negotiables. Each Must-Have and each Plus carries a weight of 1, 2, or 3 (3 = most important).`,
          ``,
          `2. Non-Negotiables override everything else. If the candidate is missing a non-negotiable and it cannot be reasonably inferred from their profile, the score is 1 regardless of any other strengths. Mention which non-negotiable is missing in the reason. Non-negotiables are typically tangible items like Location, Education, or years of experience.`,
          ``,
          `3. Must-Haves are weighted. Score primarily on coverage of weight-3 must-haves; weight-2 items matter; weight-1 items are tiebreakers. A candidate who hits every weight-3 must-have but misses one or two weight-1 must-haves should still score in the 4-5 range. A candidate missing weight-3 must-haves cannot score above 3 even if they hit everything else.`,
          ``,
          `4. Pluses NEVER lower the score. Their only effects are: (a) heavy alignment on weight-3 pluses can bump the score up by one level (e.g., 4 → 5), and (b) if pluses are present but didn't change the score, mention them in the reason as "plus: <area>" so the recruiter knows the candidate has them.`,
          ``,
          `5. When the rubrik conflicts with the JD or HM notes, the rubrik wins.`,
          ``,
        ]
      : [
          `No SCORING_RUBRIK is provided for this role. Fall back to the JD and HM notes for must-haves, and calibrate with the reference materials: traits common to current phData employees in the role, positive scorecards, and benchmark profiles push scores UP; traits common to not-hired resumes and negative scorecards push scores DOWN.`,
          ``,
        ]),
    `CRITICAL OUTPUT FORMAT: Your ENTIRE response must be a single JSON object and NOTHING ELSE. No preamble, no reasoning, no markdown, no analysis, no checklists. Do your reasoning silently in your head and output ONLY the JSON. Start your response with { and end with }.`,
    ``,
    `Format: {"score": <1-5 integer>, "reason": "<one sentence, <= 25 words>", "totalYoe": <integer years or null>}`,
  ].join("\n");
}

export function formatCandidate(c: CandidateInput): string {
  const lines = Object.entries(c.fields)
    .filter(([, v]) => v && String(v).trim().length)
    .map(([k, v]) => `${k}: ${truncate(String(v), 4000)}`);
  return lines.join("\n");
}

// Find the first balanced JSON object in a string that contains a "score" key.
// Walks brace pairs while respecting string literals and escapes, so it works
// even if the model writes prose, markdown, or multiple braces before/after.
export function extractScoreJson(text: string): string | null {
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (candidate.includes('"score"')) return candidate;
          break; // not the right object; advance to next "{"
        }
      }
    }
  }
  return null;
}

// Retry a function up to maxRetries times on 429 rate-limit errors.
// Respects the Retry-After header when present; otherwise uses exponential backoff.
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let backoffMs = 10_000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      if (attempt === maxRetries) throw e;
      const isRateLimit = e?.status === 429 || e?.name === "RateLimitError";
      if (!isRateLimit) throw e;
      const retryAfterSec = e?.headers?.["retry-after"];
      const waitMs = retryAfterSec ? Number(retryAfterSec) * 1000 : backoffMs;
      await new Promise((r) => setTimeout(r, waitMs));
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
  }
  throw new Error("unreachable");
}

export async function scoreCandidate(
  ctx: RoleContext,
  candidate: CandidateInput,
  model: ScoringModel = DEFAULT_MODEL,
): Promise<ScoreOutput> {
  const system = buildSystemPrompt(ctx);
  const userMsg =
    `Candidate to evaluate (all available LinkedIn fields):\n` +
    formatCandidate(candidate) +
    `\n\nRespond with ONLY the JSON object now. No preamble. No markdown. No reasoning. Start with { and end with }.`;

  const resp = await withRetry(() =>
    cachedMessage({
      system,
      messages: [{ role: "user", content: userMsg }],
      model,
      maxTokens: 1024,
    })
  );

  const textBlock = resp.content.find((b) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  const raw = textBlock?.text ?? "";
  const found = extractScoreJson(raw);
  if (!found) throw new Error(`No JSON in model response: ${raw.slice(0, 200)}`);
  let parsed: any;
  try {
    parsed = JSON.parse(found);
  } catch {
    throw new Error(`Bad JSON from model: ${found.slice(0, 200)}`);
  }
  const score = Math.max(1, Math.min(5, Math.round(Number(parsed.score))));
  const reason = String(parsed.reason ?? "").trim() || "No reason provided.";
  if (!Number.isFinite(score)) throw new Error(`Invalid score: ${parsed.score}`);
  // totalYoe is optional. Accept number, numeric string, or null. Anything
  // else (missing key, NaN, negative) -> null so we don't lie about it.
  let totalYoe: number | null = null;
  if (parsed.totalYoe != null) {
    const n = Number(parsed.totalYoe);
    if (Number.isFinite(n) && n >= 0) totalYoe = Math.round(n * 100) / 100;
  }
  return { score, reason, totalYoe };
}
