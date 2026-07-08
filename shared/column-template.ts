// Standard export column template. Edit this list to change every export's
// column order (CSV download + Google Sheet writeback). Anything labeled
// "Blank" exports as an empty cell. Anything matching "AI Score" / "AI Reasoning"
// (case/whitespace-insensitive) pulls from the scorer output. Everything else
// is fuzzy-matched against the input CSV's columns.

export const COLUMN_TEMPLATE: string[] = [
  "Blank",
  "Blank",
  "Blank",
  "Blank",
  "LinkedIn URL",
  "Full Name",
  "Blank",
  "Blank",
  "Blank",
  "Blank",
  "Blank",
  "Company1",
  "Title1",
  "YAC",
  "Company1 End Date",
  "Company2",
  "Company2 Title",
  "Candidate Location",
  "School1",
  "School1 Degree",
  "School1 Major",
  "School 1 End Date",
  "LinkedIn ID",
  "Blank",
  "Blank",
  "Blank",
  "Total YOE",
  "AI Score",
  "AI Reasoning",
];

// Special tokens (case-insensitive comparison)
export function isBlankHeader(h: string): boolean {
  return h.trim().toLowerCase() === "blank";
}

export function isScoreHeader(h: string): boolean {
  const s = h.trim().toLowerCase();
  return s === "ai score" || s === "score";
}

export function isReasonHeader(h: string): boolean {
  const s = h.trim().toLowerCase();
  return s === "ai reasoning" || s === "ai reason" || s === "reason" || s === "reasoning";
}

// Detect any "CompanyN Start Date" / "CompanyN End Date" template header so
// formatters and aliases can handle the whole family uniformly.
export function parseCompanyDateHeader(
  h: string,
): { index: number; kind: "start" | "end" } | null {
  const m = h.trim().toLowerCase().match(/^company\s*(\d+)\s*(start|end)\s*date$/);
  if (!m) return null;
  return { index: Number(m[1]), kind: m[2] as "start" | "end" };
}

export function isTotalYoeHeader(h: string): boolean {
  return h.trim().toLowerCase() === "total yoe";
}

// Per-column value formatters.
//
// CompanyN Start/End Date  -> MM/DD/YYYY
// School 1 End Date        -> YYYY
// LinkedIn ID              -> plain-text (leading apostrophe forces Sheets to
//                             treat as text; if blank, derive from URL slug).
// Total YOE                -> number rounded to two decimals (e.g. 7.25).
export function formatTemplateCell(
  templateHeader: string,
  value: string,
  rowFields: Record<string, string>,
): string {
  const h = templateHeader.trim().toLowerCase();

  // Any "CompanyN Start Date" / "CompanyN End Date" -> MM/DD/YYYY.
  if (parseCompanyDateHeader(templateHeader)) {
    return formatMMDDYYYY(value);
  }

  if (h === "school 1 end date" || h === "school1 end date") {
    return formatYYYY(value);
  }

  if (isTotalYoeHeader(templateHeader)) {
    // Years rounded to two decimals; blank stays blank.
    const s = (value || "").trim();
    if (!s) return "";
    const n = Number(s);
    return Number.isFinite(n) ? Math.max(0, n).toFixed(2) : s;
  }

  if (h === "linkedin id") {
    let id = (value || "").trim();
    if (!id) {
      // Fall back to deriving the slug from the LinkedIn URL.
      const urlKey = Object.keys(rowFields).find((k) =>
        /linked/i.test(k) && /url/i.test(k),
      );
      if (urlKey) id = extractLinkedInSlug(rowFields[urlKey] || "");
    }
    if (!id) return "";
    // Leading apostrophe -> Google Sheets imports as text.
    return id.startsWith("'") ? id : "'" + id;
  }

  return value;
}

function extractLinkedInSlug(url: string): string {
  if (!url) return "";
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? m[1] : "";
}

function formatMMDDYYYY(raw: string): string {
  if (!raw) return "";
  const d = parseDateLoose(raw);
  if (!d) return raw; // leave original if unparseable
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${mm}/${dd}/${yyyy}`;
}

function formatYYYY(raw: string): string {
  if (!raw) return "";
  const d = parseDateLoose(raw);
  if (!d) {
    // If it's already a bare 4-digit year, keep it.
    const m = raw.match(/\b(19|20)\d{2}\b/);
    return m ? m[0] : raw;
  }
  return String(d.getUTCFullYear());
}

// Parse the common shapes we see: ISO 8601, "2021-01-01", "Jan 2021",
// "01/2021", "2021". Returns null if we can't recognize it.
function parseDateLoose(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  // Bare YYYY
  if (/^\d{4}$/.test(s)) {
    const y = Number(s);
    return new Date(Date.UTC(y, 0, 1));
  }
  // YYYY-MM or YYYY/MM
  let m = s.match(/^(\d{4})[-/](\d{1,2})$/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  // MM/YYYY
  m = s.match(/^(\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[2]), Number(m[1]) - 1, 1));
  // Anything Date.parse understands (ISO 8601, RFC dates, etc.)
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t);
  return null;
}

// Normalize for fuzzy matching: lowercase, strip non-alphanumeric, collapse spaces.
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(s: string): string[] {
  return normalize(s).split(/\s+/).filter(Boolean);
}

// Common aliases for the recruiter's template headers. Each entry maps a
// template header (normalized) to a list of synonym phrases (also normalized).
// Input-CSV column names that match any synonym win. If none match, we fall
// back to token overlap.
const ALIASES: Record<string, string[]> = {
  "linkedin url": [
    "linkedin url",
    "candidate linkedin url",
    "linkedin profile url",
    "profile url",
    "li url",
    "url",
  ],
  "full name": ["full name", "candidate name", "name", "candidate"],
  "company1": ["company1", "company 1", "current company", "company", "employer", "current employer"],
  "title1": [
    "title1",
    "title 1",
    "company1 title",
    "company 1 title",
    "current title",
    "title",
    "current role",
    "role",
    "position",
  ],
  "yac": ["yac", "years at company", "tenure", "years at current company"],
  "company1 start date": ["company1 start date", "company 1 start date", "current start date", "start date 1", "company 1 start"],
  "company1 end date": ["company1 end date", "company 1 end date", "current end date", "end date", "company 1 end", "end date 1"],
  "company2": ["company2", "company 2", "previous company", "prior company"],
  "company2 title": ["company2 title", "company 2 title", "previous title", "prior title"],
  "company2 start date": ["company2 start date", "company 2 start date", "start date 2"],
  "company2 end date": ["company2 end date", "company 2 end date", "end date 2", "previous end date"],
  "company3": ["company3", "company 3"],
  "company3 title": ["company3 title", "company 3 title"],
  "company3 start date": ["company3 start date", "company 3 start date", "start date 3"],
  "company3 end date": ["company3 end date", "company 3 end date", "end date 3"],
  "company4": ["company4", "company 4"],
  "company4 title": ["company4 title", "company 4 title"],
  "company4 start date": ["company4 start date", "company 4 start date", "start date 4"],
  "company4 end date": ["company4 end date", "company 4 end date", "end date 4"],
  "candidate location": ["candidate location", "location", "city", "geo", "based in"],
  "school1": ["school1", "school 1", "school1 name", "school 1 name", "university", "school", "college", "alma mater"],
  "school1 degree": ["school1 degree", "school 1 degree", "degree 1", "degree"],
  "school1 major": [
    "school1 major",
    "school 1 major",
    "school1 field of study",
    "school 1 field of study",
    "field of study",
    "major 1",
    "major",
  ],
  "school 1 end date": [
    "school 1 end date",
    "school1 end date",
    "graduation date",
    "grad date",
    "graduation year",
    "grad year",
  ],
  "linkedin id": ["linkedin id", "li id", "linkedin handle", "profile id"],
};

// For each template header, find the best-matching column in the input CSV.
// Returns a map: templateIndex -> inputHeaderName | null.
export function mapTemplateToInputs(inputHeaders: string[]): Array<string | null> {
  const normalizedInputs = inputHeaders.map((h) => ({ raw: h, norm: normalize(h) }));
  const result: Array<string | null> = [];

  for (const tmpl of COLUMN_TEMPLATE) {
    if (
      isBlankHeader(tmpl) ||
      isScoreHeader(tmpl) ||
      isReasonHeader(tmpl) ||
      isTotalYoeHeader(tmpl)
    ) {
      result.push(null);
      continue;
    }
    const tNorm = normalize(tmpl);

    // 1. Exact normalized match
    let hit = normalizedInputs.find((c) => c.norm === tNorm);

    // 2. Alias match (exact only). Substring matching is intentionally
    // omitted because it caused over-grabbing (e.g. "School1" greedily
    // matching "School1 Degree").
    if (!hit) {
      const aliases = ALIASES[tNorm] || [tNorm];
      for (const a of aliases) {
        hit = normalizedInputs.find((c) => c.norm === a);
        if (hit) break;
      }
    }

    // 3. Token-overlap fallback. Require ALL template tokens to appear in the
    // candidate column (no missed tokens), so "School1 Major" doesn't match
    // bare "School1". Among full-coverage candidates, prefer the one with the
    // tightest token count (fewest extra tokens).
    if (!hit) {
      const tTokens = tokens(tmpl);
      if (tTokens.length > 0) {
        let best: { raw: string; norm: string; extra: number } | null = null;
        for (const c of normalizedInputs) {
          const cTokens = new Set(tokens(c.raw));
          const allMatched = tTokens.every((tk) => cTokens.has(tk));
          if (!allMatched) continue;
          const extra = cTokens.size - tTokens.length;
          if (!best || extra < best.extra) best = { ...c, extra };
        }
        if (best) hit = { raw: best.raw, norm: best.norm };
      }
    }

    result.push(hit ? hit.raw : null);
  }

  return result;
}
