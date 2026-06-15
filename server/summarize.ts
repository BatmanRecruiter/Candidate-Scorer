// summarize.ts
// ---------------------------------------------------------------------------
// Distills large reference documents (interview transcripts, resumes,
// scorecards, etc.) into a compact, scoring-focused summary. The summary is
// computed ONCE per file and stored on role_files.summaryText, then reused in
// every scoring run in place of the full text — cutting the per-candidate
// token cost on every run (Sonnet and Opus alike) without re-summarizing.
//
// Non-destructive: the original contentText is always kept as a fallback.
// ---------------------------------------------------------------------------

import { cachedMessage } from "./anthropicClient";

// Cheap, fast model — summaries are one-shot per file and stored, so this cost
// is paid once, not per scoring run.
const SUMMARY_MODEL = "claude-haiku-4-5";

// Files whose extracted text exceeds this many characters get summarized.
// ~6000 chars ≈ ~1.5K tokens — below this the savings aren't worth the call.
export const SUMMARY_CHAR_THRESHOLD = 6000;

// Authoritative / directive material we NEVER summarize — losing a line from
// the rubric, the job description, or the hiring-manager notes could change a
// score. Everything else (transcripts, resumes, scorecards, incumbents,
// benchmarks) is fair game once it crosses the size threshold.
const NEVER_SUMMARIZE = new Set(["rubrik", "jd", "hm_notes"]);

/** Should this file be distilled before going into the scoring prompt? */
export function shouldSummarize(category: string | null, text: string): boolean {
  if (!category) return false;
  if (NEVER_SUMMARIZE.has(category)) return false;
  return (text || "").length > SUMMARY_CHAR_THRESHOLD;
}

const SUMMARY_SYSTEM = `You distill reference documents that a recruiter uses to decide whether to reach out to sourced candidates for a specific role. Your summary REPLACES the full document in a scoring prompt, so it must preserve every signal that could change a candidate's score while cutting everything that cannot.

KEEP (in priority order):
- Hard requirements and disqualifiers: required years of experience, specific skills/tools/technologies, degrees, certifications, clearances, location/visa constraints. Quote exact numbers and terms verbatim.
- What distinguishes strong candidates from weak ones for this role: the experience, accomplishments, or traits the team valued or rejected.
- Red flags and dealbreakers surfaced in the document.
- Calibration cues: concrete examples of what "good" versus "not good enough" looks like.

DROP:
- Greetings, scheduling, small talk, filler, and verbatim back-and-forth dialogue.
- Logistics, names, and personally identifying details that carry no scoring signal.
- Anything repeated elsewhere or not relevant to evaluating a candidate's fit.

RULES:
- Be faithful. Never invent requirements, numbers, or judgments the document does not support. If the document contains no scoring-relevant signal, respond with exactly: "No scoring-relevant signal."
- Preserve explicit thresholds and must-haves word-for-word (e.g., "8+ years", "AWS certification required").
- Write tight, scannable plain text grouped by signal (short headers or bullets). No preamble, no meta-commentary about the document or your process. Aim for under ~400 words unless the source is unusually rich.`;

/**
 * Produce a scoring-focused summary of one document. Throws on an empty
 * response so callers can fall back to keeping the original text.
 */
export async function summarizeForScoring(opts: {
  fileName: string;
  category: string;
  text: string;
}): Promise<string> {
  const { fileName, category, text } = opts;
  const resp = await cachedMessage({
    system: SUMMARY_SYSTEM,
    model: SUMMARY_MODEL,
    maxTokens: 1500,
    messages: [
      {
        role: "user",
        content:
          `Document category: ${category}\nFile name: ${fileName}\n\n` +
          `--- BEGIN DOCUMENT ---\n${text}\n--- END DOCUMENT ---\n\n` +
          `Produce the scoring-relevant summary now.`,
      },
    ],
  });

  const block = resp.content.find((b) => b.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  const summary = (block?.text ?? "").trim();
  if (!summary) throw new Error("model returned an empty summary");
  return summary;
}
