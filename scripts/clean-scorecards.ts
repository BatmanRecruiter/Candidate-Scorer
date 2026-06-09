/**
 * Cleans interview scorecard text stored in the database.
 * Removes PDF artifacts, redacted noise, and AI-summarized interview transcripts.
 * Keeps: Key Take-Aways, competency comments, decisions, technical skills checklist, PC Q&As.
 */

import { neon } from "@neondatabase/serverless";

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) throw new Error("DATABASE_URL environment variable is not set");

const LOGISTICS_PATTERNS = [
  /^Do you need to give (two weeks'|notice)/i,
  /^How would you shut down your business/i,
  /^Is there anything that those other irons/i,
  /^Do you have a timeframe for making a change/i,
  /^What do you like to use for data visualization/i,
  /^In Sourcewhale\?/i,
];

const SKIP_QUESTION_PATTERNS = [
  /^Why phData/i,
  /^Why are you making a change\?/i,
  /^What do you like most about the opportunity here at phData/i,
];

function deduplicateBlocks(text: string): string {
  // Split into paragraphs (double newline separated)
  const paragraphs = text.split(/\n{2,}/);
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const para of paragraphs) {
    const key = para.trim();
    if (!key) continue;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(para);
    }
  }
  return deduped.join("\n\n");
}

// Interview Q patterns that should be dropped (recruiter/HM/executive interview questions)
const INTERVIEW_Q_PATTERNS = [
  /^Why are you making a change\?/i,
  /^Please describe your Machine Learning experience/i,
  /^What languages do you use to deploy/i,
  /^Have you built and managed machine learning pipelines/i,
  /^Tell me about your Gen AI exposure/i,
  /^Describe your experience working (for|in) a consulting/i,
  /^What is your role when working with client/i,
  /^When a customer is unclear with their requirements/i,
  /^Job Fit Check In:/i,
  /^Tell me about your team and\/or project leadership/i,
  /^What modern cloud platforms do you have experience/i,
  /^Describe a Machine Learning project you recently worked on/i,
  /^Talk through the technologies you used/i,
  /^Can you describe a project you've worked on where priorities/i,
  /^Reflect on a time when you had to quickly take on new responsibilities/i,
  /^Walk me through an example where you had to adjust your communication/i,
  /^Tell me about a time when you were not provided with adequate/i,
  /^What are your areas of expertise/i,
  /^What did you like the most about this individual/i,
  /^Tell me about a challenge you faced/i,
  /^Communication with non-technical stakeholders:/i,
];

// PC (project challenge) Q patterns - KEEP these
const PC_Q_PATTERNS = [
  /^Which position do you believe this candidate best aligns/i,
  /^Describe what you like about this individual/i,
  /^How well did this individual present/i,
  /^Thinking back on your projects here at phData/i,
  /^Would you hire this person/i,
];

// Lines that are pure noise (no signal)
const NOISE_LINES = [
  /^<PARSED TEXT FOR PAGE:/,
  /^<IMAGE FOR PAGE:/,
  /^-- \d+ of \d+ --$/,
  /^Powered by Greenhouse$/,
  /^Notes from interviewer:\s*$/,
  /^• Interviewer marked question at \[REDACTED/,
  /^Other topics covered:\s*$/,
  /^PII-scrubbed copy\./,
  /^MLSA - Hired Candidate .* - Interview Feedback/,
  /^\[REDACTED DATE\/TIME\]$/,
];

// Lines to always skip regardless of context
const ALWAYS_SKIP = [
  /^(Phone number|Email|Address|Social Media|Websites)\s+\[REDACTED/i,
  /^Source \[REDACTED/i,
  /^Recruiter \[REDACTED/i,
  /^Coordinator \[REDACTED/i,
  /^Sourcing Team \(/i,
  /^Tenth Revolution \(/i,
  /^Applied through/i,
  /^Aligns to Territory/i,
  /^Open to Travel/i,
  /^Authorized to Work/i,
  /^Fits our salary range/i,
  /^Motivated to work for phData/i,
  /^In Sourcewhale\?/i,
];

// Competency-only category names (no comment following) - deduplicate these by keeping just first occurrence
const COMPETENCY_HEADERS = new Set([
  "Adaptability; Ability to try new approaches, consistently",
  "Analysis Skills; Ability to problem solve and use critical",
  "Communication; The ability to convey ideas clearly, listen",
  "Consultative; Ability to guide discussions, ask questions",
  "Customer Focus; Ability to understand customers",
  "Initiative; Take accountability/ownership for tasks, projects, and professional growth demonstrating a",
  "Learning Agility; Proactive attitude & eagerness to",
]);

function cleanScorecard(raw: string): string {
  const lines = raw.split("\n");
  const result: string[] = [];
  let inAiSummary = false;
  let inContactBlock = true;
  let inInterviewQ = false;
  let inSalaryBlock = false;
  let prevBlank = false;
  let inPcSection = false;

  const isMeaningfulSectionStart = (t: string): boolean =>
    t.startsWith("Scorecards for") ||
    t.match(/^Do you have \d+\+ years/) != null ||
    t.match(/^Which tools do you use/) != null ||
    t.match(/^How did you hear/) != null ||
    t.match(/^Please share your LinkedIn/) != null ||
    t.match(/^What orchestration/) != null ||
    t.match(/^Which modern data platforms/) != null;

  const isAiSummaryExit = (t: string): boolean =>
    t.match(/^Question \d+/) != null ||
    t.startsWith("Key Take-Aways") ||
    t.match(/^Interviewed by/) != null ||
    t.startsWith("Competencies") ||
    t.match(/^Adaptability;/) != null ||
    t.match(/^Analysis Skills;/) != null ||
    t.match(/^Communication;/) != null ||
    t.match(/^Consultative;/) != null ||
    t.match(/^Customer Focus;/) != null ||
    t.match(/^Initiative;/) != null ||
    t.match(/^Learning Agility;/) != null ||
    t.match(/^Fit to Job/) != null ||
    t.match(/^Experiencing deploying/) != null ||
    t.match(/^Solid programming/) != null ||
    t.match(/^Previous experience/) != null ||
    t.match(/^Orchestration experience/) != null ||
    t.match(/^Cloud \(/) != null ||
    t.match(/^Contributed to Open Source/) != null ||
    t.match(/^Advanced degree/) != null;

  for (const rawLine of lines) {
    const t = rawLine.trim();

    // Skip contact block at top of document
    if (inContactBlock) {
      if (isMeaningfulSectionStart(t)) inContactBlock = false;
      else continue;
    }

    // Always-skip patterns
    if (ALWAYS_SKIP.some((p) => p.test(t))) continue;
    if (NOISE_LINES.some((p) => p.test(t))) continue;

    // Skip standalone numbers (page numbers)
    if (t.match(/^\d{1,2}$/) && parseInt(t) < 50) continue;
    // Skip pure "--" or pure redacted lines
    if (t === "--") continue;
    if (t.match(/^(\[REDACTED [A-Z/ ]+\](\s+--)?[\s]*)+$/)) continue;
    // Skip "Interviewer did not answer this question"
    if (t === "Interviewer did not answer this question") continue;

    // Detect PC reviewer section (questions are about candidate assessment, not interview Q&A)
    if (t.match(/^Question \d+/)) {
      // Look at the NEXT non-empty line to determine section type
      // We do this by checking what follows in the buffer, but since we process linearly,
      // we'll track via the last question header
      inPcSection = false; // reset; will be set below
    }

    // AI summary sections
    if (t.startsWith("AI summarized notes:")) {
      inAiSummary = true;
      continue;
    }
    if (inAiSummary) {
      if (isAiSummaryExit(t)) inAiSummary = false;
      else continue;
    }

    // Interview Q sections (drop)
    if (INTERVIEW_Q_PATTERNS.some((p) => p.test(t))) {
      inInterviewQ = true;
      continue;
    }
    if (inInterviewQ) {
      // Exit on next question, Key Take-Aways, or new interviewer section
      if (
        t.match(/^Question \d+/) ||
        t.startsWith("Key Take-Aways") ||
        t.match(/^Interviewed by/) ||
        t.startsWith("Competencies") ||
        t.match(/^Adaptability;/) ||
        t.match(/^Fit to Job/) ||
        t.match(/^Experiencing deploying/) ||
        PC_Q_PATTERNS.some((p) => p.test(t))
      ) {
        inInterviewQ = false;
        // fall through
      } else {
        continue;
      }
    }

    // PC assessment sections (keep the Q&A)
    if (PC_Q_PATTERNS.some((p) => p.test(t))) {
      inPcSection = true;
    }

    // Logistics / skip question patterns
    if (LOGISTICS_PATTERNS.some((p) => p.test(t))) continue;
    if (SKIP_QUESTION_PATTERNS.some((p) => p.test(t))) continue;

    // Salary details
    if (t.match(/^His range is/i) || t.match(/^Her range is/i) || t.match(/^\$\d/)) continue;
    // "Advanced degree" section
    if (t.match(/^Advanced degree or evidence/)) continue;

    // Collapse multiple blank lines
    if (!t) {
      if (prevBlank) continue;
      prevBlank = true;
    } else {
      prevBlank = false;
    }

    result.push(rawLine);
  }

  const joined = result.join("\n").trim();
  return deduplicateBlocks(joined);
}

async function main() {
  const sql = neon(DB_URL);
  const rows = await sql`
    SELECT id, file_name, content_text
    FROM role_files
    WHERE category = 'scorecards'
    ORDER BY file_name
  `;

  for (const row of rows) {
    const original = row.content_text as string;
    const cleaned = cleanScorecard(original);
    const originalChars = original.length;
    const cleanedChars = cleaned.length;
    const reduction = (((originalChars - cleanedChars) / originalChars) * 100).toFixed(1);

    console.log(`\n=== ${row.file_name} ===`);
    console.log(`  Before: ${originalChars.toLocaleString()} chars`);
    console.log(`  After:  ${cleanedChars.toLocaleString()} chars (${reduction}% reduction)`);
    console.log(`  --- Preview (first 500 chars) ---`);
    console.log(cleaned.slice(0, 500));
    console.log(`  ...`);

    await sql`
      UPDATE role_files
      SET content_text = ${cleaned}
      WHERE id = ${row.id}
    `;
    console.log(`  ✓ Updated in database`);
  }

  console.log("\n✓ All scorecards cleaned.");
}

main().catch(console.error);
