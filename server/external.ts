import { spawn } from "node:child_process";
// pdf-parse v2 exposes a class-based API: new PDFParse({ data: buf }).getText()
const { PDFParse } = require("pdf-parse") as {
  PDFParse: new (opts: { data: Buffer }) => { getText: () => Promise<{ text: string }> };
};
import mammoth from "mammoth";
// word-extractor handles legacy binary .doc files (DOCX is mammoth's job).
const WordExtractor = require("word-extractor");

interface ExternalToolArgs {
  source_id: string;
  tool_name: string;
  arguments: Record<string, any>;
}

export function callTool(args: ExternalToolArgs): Promise<any> {
  return new Promise((resolve, reject) => {
    const proc = spawn("external-tool", ["call", JSON.stringify(args)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`external-tool failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e: any) {
        reject(new Error(`external-tool bad JSON: ${e.message}: ${stdout.slice(0, 200)}`));
      }
    });
    proc.on("error", (err) => reject(err));
  });
}

// ---------------------------------------------------------------------------
// Categories + natural-language synonym table
// ---------------------------------------------------------------------------
//
// Each role has a short user-chosen ID. Files for that role are named with the
// ID as a prefix, then natural-language category text, then any descriptor:
//
//   "VECTOR Job Description.pdf"
//   "VECTOR Intake Notes.docx"
//   "VECTOR Hired - Young Cai.pdf"
//   "SS-001 Scoring Rubric.docx"
//   "SS-001 Benchmark - Anthropic FDE.pdf"
//
// We detect the category by looking at the text AFTER the role ID prefix for
// any synonym we know about. Files whose category we can't determine are
// returned as "uncategorized" so the user can tag them in the UI before a run.

export const CATEGORIES = [
  "jd",
  "hm_notes",
  "rubrik",
  "hired",
  "not_hired",
  "transcripts",
  "scorecards",
  "incumbents",
  "benchmark_candidates",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Order matters: longer / more-specific phrases must be checked first so
// "interview scorecard" doesn't accidentally match the "scorecard" bucket only.
// Each entry: [synonym string, target category]. Synonyms are matched
// case-insensitively against the text after the role ID prefix.
const SYNONYMS: Array<[string, Category]> = [
  // benchmark_candidates
  ["benchmark candidate", "benchmark_candidates"],
  ["benchmark candidates", "benchmark_candidates"],
  ["benchmark", "benchmark_candidates"],
  ["aspirational", "benchmark_candidates"],
  ["target profile", "benchmark_candidates"],
  // hm_notes
  ["hiring manager notes", "hm_notes"],
  ["intake notes", "hm_notes"],
  ["kickoff notes", "hm_notes"],
  ["manager notes", "hm_notes"],
  ["hm notes", "hm_notes"],
  ["hm_notes", "hm_notes"],
  // jd
  ["job description", "jd"],
  ["job_description", "jd"],
  ["role description", "jd"],
  ["role overview", "jd"],
  ["jd", "jd"],
  // rubrik
  ["scoring rubrik", "rubrik"],
  ["scoring rubric", "rubrik"],
  ["scorecard rubric", "rubrik"],
  ["evaluation criteria", "rubrik"],
  ["rubrik", "rubrik"],
  ["rubric", "rubrik"],
  // scorecards (must come before hired/not_hired so "interview scorecard of
  // candidate we hired" routes to scorecards instead of hired)
  ["interview scorecard", "scorecards"],
  ["feedback form", "scorecards"],
  ["scorecards", "scorecards"],
  ["scorecard", "scorecards"],
  // transcripts (also before hired for the same reason)
  ["interview transcript", "transcripts"],
  ["call transcript", "transcripts"],
  ["recording transcript", "transcripts"],
  ["transcripts", "transcripts"],
  ["transcript", "transcripts"],
  // not_hired (must come before "hired" so "not hired" doesn't match "hired")
  ["not hired", "not_hired"],
  ["not_hired", "not_hired"],
  ["rejected", "not_hired"],
  ["passed on", "not_hired"],
  ["declined", "not_hired"],
  // hired
  ["offer accepted", "hired"],
  ["we hired", "hired"],
  ["hired", "hired"],
  ["hire", "hired"],
  // incumbents
  ["current employee", "incumbents"],
  ["current team", "incumbents"],
  ["team member", "incumbents"],
  ["on the team", "incumbents"],
  ["incumbent", "incumbents"],
];

// Detect a category by looking for any synonym anywhere in the post-prefix
// text. We replace separators (underscores, dashes, dots) with spaces so
// "Intake_Notes" and "Intake-Notes" both work.
function detectCategory(textAfterPrefix: string): Category | null {
  const normalized = textAfterPrefix
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "") // strip extension
    .replace(/[_\-.]+/g, " ") // unify separators
    .replace(/\s+/g, " ")
    .trim();
  for (const [phrase, cat] of SYNONYMS) {
    if (normalized.includes(phrase)) return cat;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Role ID matching against filenames
// ---------------------------------------------------------------------------

// A file "belongs" to a role if its name starts with the role ID followed by
// a word boundary (space, dash, underscore, or end-of-stem). Matching is
// case-insensitive. Examples for roleId="VECTOR":
//   "VECTOR Hired - Young Cai.pdf"  ✓
//   "vector_intake_notes.docx"      ✓
//   "Vector-JD.pdf"                 ✓
//   "VectorDB Notes.pdf"            ✗  (no separator after "Vector")
//
// We also tolerate leading whitespace.
export function matchesRoleId(fileName: string, roleId: string): boolean {
  if (!fileName || !roleId) return false;
  const stem = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const lowerStem = stem.toLowerCase().trim();
  const lowerId = roleId.toLowerCase().trim();
  if (!lowerStem.startsWith(lowerId)) return false;
  const after = lowerStem.slice(lowerId.length);
  if (after.length === 0) return true; // file named exactly the role ID
  return /^[\s\-_.]/.test(after);
}

// Strip the role ID (plus its trailing separator) from a filename so we can
// run synonym detection on just the descriptive remainder.
export function textAfterRoleId(fileName: string, roleId: string): string {
  const stem = fileName.replace(/\.[A-Za-z0-9]+$/, "");
  const lower = stem.toLowerCase();
  const idx = lower.indexOf(roleId.toLowerCase());
  if (idx !== 0) return stem;
  return stem.slice(roleId.length).replace(/^[\s\-_.]+/, "");
}

// ---------------------------------------------------------------------------
// Drive discovery
// ---------------------------------------------------------------------------

interface RawFile {
  file_id?: string;
  fileId?: string;
  id?: string;
  name?: string;
  fileName?: string;
  web_view_link?: string;
  webViewLink?: string;
  file_url?: string;
  mime_type?: string;
  mimeType?: string;
  size?: number;
  modified_time?: string;
  modifiedTime?: string;
  connector?: string;
  source?: string;
}

export interface DiscoveredFile {
  fileId: string;
  fileName: string;
  webViewLink?: string;
  fileUrl?: string;
  mimeType?: string;
  size?: number;
  modifiedTime?: string;
}

// Run one search batch and return raw files. The connector caps aggregate
// results across a batch, so callers prefer single-query calls when recall is
// critical (see discoverFilesForRole below).
async function runSearchBatch(queries: string[]): Promise<RawFile[]> {
  try {
    const res = await callTool({
      source_id: "files",
      tool_name: "search_files_v2",
      arguments: { queries, retrieval_mode: "SEARCH", context_budget: "LONG" },
    });
    return Array.isArray(res?.files) ? res.files : [];
  } catch (e) {
    console.error("search batch failed:", e);
    return [];
  }
}

function normalize(f: RawFile): DiscoveredFile | null {
  const id = f.file_id || f.fileId || f.id;
  const name = f.name || f.fileName;
  if (!id || !name) return null;
  return {
    fileId: String(id),
    fileName: name,
    webViewLink: f.web_view_link || f.webViewLink,
    fileUrl: f.file_url,
    mimeType: f.mime_type || f.mimeType,
    size: f.size,
    modifiedTime: f.modified_time || f.modifiedTime,
  };
}

// Search Drive for every file whose name starts with the given role ID. We
// run several phrasings to maximize recall, then filter locally using
// matchesRoleId so we never include false positives where the role ID
// happens to appear mid-name.
//
// To work around the connector's per-batch aggregate cap, we issue many
// single-query calls (one per category phrasing) and union the results.
export async function discoverFilesForRole(roleId: string): Promise<DiscoveredFile[]> {
  const id = roleId.trim();
  if (!id) return [];

  // Build queries that exercise every category phrasing alongside the role ID
  // so the relevance ranker has many chances to surface every file.
  const categoryQueries = [
    "job description",
    "intake notes",
    "hiring manager notes",
    "scoring rubric",
    "hired",
    "not hired",
    "transcript",
    "scorecard",
    "incumbent",
    "benchmark candidate",
    "resume",
    "linkedin",
    "pdf",
    "docx",
  ];

  // Single-query passes (most reliable for bypassing the cap)
  const singleBatches: Promise<RawFile[]>[] = [
    runSearchBatch([id]),
    ...categoryQueries.map((c) => runSearchBatch([`${id} ${c}`])),
  ];
  const results = await Promise.all(singleBatches);

  const seen = new Set<string>();
  const out: DiscoveredFile[] = [];
  for (const batch of results) {
    for (const raw of batch) {
      const norm = normalize(raw);
      if (!norm) continue;
      if (!matchesRoleId(norm.fileName, id)) continue;
      if (seen.has(norm.fileId)) continue;
      seen.add(norm.fileId);
      out.push(norm);
    }
  }
  return out;
}

// Refresh the signed S3 URL for each file by re-searching. URLs from the
// initial discovery may have expired by the time we want to download.
async function refreshFileUrls(
  roleId: string,
  files: DiscoveredFile[],
): Promise<Map<string, string>> {
  const urlByFileId = new Map<string, string>();
  if (!files.length) return urlByFileId;
  const fresh = await discoverFilesForRole(roleId);
  for (const f of fresh) {
    if (f.fileUrl) urlByFileId.set(f.fileId, f.fileUrl);
  }
  return urlByFileId;
}

// ---------------------------------------------------------------------------
// File-content extraction (PDF / DOCX / Google Doc)
// ---------------------------------------------------------------------------

export async function readFileContents(
  roleId: string,
  files: DiscoveredFile[],
): Promise<Map<string, string>> {
  const contentByFileId = new Map<string, string>();
  if (!files.length) return contentByFileId;

  const urls = await refreshFileUrls(roleId, files);

  const CONCURRENCY = 4;
  let cursor = 0;
  async function worker() {
    while (cursor < files.length) {
      const i = cursor++;
      const f = files[i];
      try {
        const text = await readOneFile(f, urls.get(f.fileId) || f.fileUrl);
        if (text && text.trim()) contentByFileId.set(f.fileId, text.trim());
      } catch (e) {
        console.error(`readFileContents failed for ${f.fileName}:`, e);
      }
    }
  }
  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker);
  await Promise.all(workers);
  return contentByFileId;
}

async function readOneFile(f: DiscoveredFile, fileUrl?: string): Promise<string> {
  const mime = (f.mimeType || "").toLowerCase();
  if (mime === "application/vnd.google-apps.document") {
    return await readGoogleDoc(f.fileId);
  }
  if (!fileUrl) {
    return await readGoogleDoc(f.fileId).catch(() => "");
  }
  const buf = await downloadBytes(fileUrl);
  if (mime.includes("pdf") || f.fileName.toLowerCase().endsWith(".pdf")) {
    return await parsePdf(buf);
  }
  if (
    mime.includes("officedocument.wordprocessingml") ||
    f.fileName.toLowerCase().endsWith(".docx")
  ) {
    return await parseDocx(buf);
  }
  if (mime === "application/msword" || f.fileName.toLowerCase().endsWith(".doc")) {
    return await parseLegacyDoc(buf);
  }
  return buf.toString("utf8").replace(/\u0000/g, "");
}

function downloadBytes(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          reject(new Error(`download failed ${r.status}`));
          return;
        }
        const ab = await r.arrayBuffer();
        resolve(Buffer.from(ab));
      })
      .catch(reject);
  });
}

async function parsePdf(buf: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: buf });
    const result = await parser.getText();
    return result?.text || "";
  } catch (e: any) {
    console.error("pdf parse failed:", e?.message);
    return "";
  }
}

async function parseDocx(buf: Buffer): Promise<string> {
  try {
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value || "";
  } catch (e: any) {
    console.error("docx parse failed:", e?.message);
    return "";
  }
}

// Legacy binary .doc (Word 97-2003) — mammoth only handles .docx, so we use
// word-extractor for the older format.
async function parseLegacyDoc(buf: Buffer): Promise<string> {
  try {
    const ext = new WordExtractor();
    const doc = await ext.extract(buf);
    return [doc.getBody(), doc.getFootnotes(), doc.getEndnotes()]
      .filter(Boolean)
      .join("\n\n")
      .trim();
  } catch (e: any) {
    console.error("doc parse failed:", e?.message);
    return "";
  }
}

async function readGoogleDoc(fileId: string): Promise<string> {
  const res = await callTool({
    source_id: "google_docs__pipedream",
    tool_name: "google_docs-get-document",
    arguments: { docId: fileId },
  });
  return extractAllText(res);
}

function extractAllText(node: any): string {
  const parts: string[] = [];
  function walk(n: any) {
    if (n == null) return;
    if (typeof n === "string") {
      if (n.length > 40) parts.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === "object") {
      for (const k of Object.keys(n)) {
        if (["file_id", "fileId", "id", "url", "file_url", "web_view_link", "mime_type"].includes(k)) continue;
        walk(n[k]);
      }
    }
  }
  walk(node);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const p of parts) {
    const key = p.slice(0, 200);
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(p);
  }
  return uniq.join("\n\n");
}

// ---------------------------------------------------------------------------
// High-level categorization + role preview
// ---------------------------------------------------------------------------

export interface CategorizedFile extends DiscoveredFile {
  category: Category | null; // null = uncategorized, needs user input
  autoDetected: boolean; // true when synonym table matched; false when user override
}

export function categorizeFiles(
  roleId: string,
  files: DiscoveredFile[],
  overrides: Record<string, Category> = {},
): CategorizedFile[] {
  return files.map((f) => {
    const override = overrides[f.fileId];
    if (override && (CATEGORIES as readonly string[]).includes(override)) {
      return { ...f, category: override, autoDetected: false };
    }
    const after = textAfterRoleId(f.fileName, roleId);
    const auto = detectCategory(after);
    return { ...f, category: auto, autoDetected: auto !== null };
  });
}

export interface CategoryHits {
  jd: string[];
  hm_notes: string[];
  rubrik: string[];
  hired: string[];
  not_hired: string[];
  transcripts: string[];
  scorecards: string[];
  incumbents: string[];
  benchmark_candidates: string[];
}

export function emptyHits(): CategoryHits {
  return {
    jd: [],
    hm_notes: [],
    rubrik: [],
    hired: [],
    not_hired: [],
    transcripts: [],
    scorecards: [],
    incumbents: [],
    benchmark_candidates: [],
  };
}

export interface FileLoadInfo extends CategorizedFile {
  textChars: number;
}

// Load every file for the given role, apply category overrides, read content,
// and return both the scoring buckets and a per-file diagnostic list.
//
// Files that are uncategorized (auto-detection failed and no override) are
// returned in `files` with category=null and DO NOT contribute to `hits`.
export async function loadRoleContext(
  roleId: string,
  overrides: Record<string, Category> = {},
): Promise<{ hits: CategoryHits; files: FileLoadInfo[] }> {
  const raw = await discoverFilesForRole(roleId);
  const categorized = categorizeFiles(roleId, raw, overrides);
  const contents = await readFileContents(roleId, raw);
  const hits = emptyHits();
  const files: FileLoadInfo[] = [];
  for (const f of categorized) {
    const text = (contents.get(f.fileId) || "").trim();
    files.push({ ...f, textChars: text.length });
    if (!text) continue;
    if (!f.category) continue; // uncategorized — skip
    hits[f.category].push(`[${f.fileName}]\n${text}`);
  }
  return { hits, files };
}

// ---------------------------------------------------------------------------
// Google Sheets passthrough (unchanged from prior version)
// ---------------------------------------------------------------------------

export async function listSpreadsheets(query?: string) {
  const res = await callTool({
    source_id: "google_sheets__pipedream",
    tool_name: "google_sheets-list-spreadsheets",
    arguments: { query: query || "", limit: 30 },
  });
  return res;
}

export async function getSpreadsheetInfo(spreadsheetId: string) {
  const res = await callTool({
    source_id: "google_sheets__pipedream",
    tool_name: "google_sheets-get-spreadsheet-info",
    arguments: { spreadsheetId },
  });
  return res;
}

export async function readSheetRows(
  spreadsheetId: string,
  sheetName: string,
): Promise<Record<string, string>[]> {
  const res = await callTool({
    source_id: "google_sheets__pipedream",
    tool_name: "google_sheets-read-rows",
    arguments: { spreadsheetId, sheetName, hasHeaders: true },
  });
  return unwrapRows(res);
}

function unwrapRows(res: any): Record<string, string>[] {
  if (Array.isArray(res)) return res.map((r) => coerceRowObject(r));
  if (res && Array.isArray(res.rows)) return res.rows.map(coerceRowObject);
  if (res && Array.isArray(res.data)) return res.data.map(coerceRowObject);
  if (res && typeof res === "object") {
    for (const v of Object.values(res)) {
      if (Array.isArray(v) && v.length && typeof v[0] === "object") {
        return (v as any[]).map(coerceRowObject);
      }
    }
  }
  return [];
}

function coerceRowObject(r: any): Record<string, string> {
  if (r && typeof r === "object" && !Array.isArray(r)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(r)) out[k] = v == null ? "" : String(v);
    return out;
  }
  return { value: String(r) };
}

export async function writeScoresToSheet(args: {
  spreadsheetId: string;
  sheetName: string;
  rows: Array<{ rowIndex: number; score: number; reason: string; totalYoe: number | null }>;
  existingHeaderCount: number;
}) {
  const { spreadsheetId, sheetName, rows, existingHeaderCount } = args;
  // Layout: Total YOE | AI Score | AI Reasoning (3 columns).
  const yoeColIndex = existingHeaderCount + 1;
  const scoreColIndex = existingHeaderCount + 2;
  const reasonColIndex = existingHeaderCount + 3;
  const yoeCol = columnLetter(yoeColIndex);
  const reasonCol = columnLetter(reasonColIndex);

  await callTool({
    source_id: "google_sheets__pipedream",
    tool_name: "google_sheets-update-rows",
    arguments: {
      sheetId: spreadsheetId,
      sheetName,
      range: `${yoeCol}1:${reasonCol}1`,
      rows: JSON.stringify([["Total YOE", "AI Score", "AI Reasoning"]]),
    },
  });

  if (!rows.length) return;
  const maxRow = Math.max(...rows.map((r) => r.rowIndex));
  const block: string[][] = [];
  for (let i = 1; i <= maxRow; i++) block.push(["", "", ""]);
  for (const r of rows) {
    const yoeCell =
      r.totalYoe == null || !Number.isFinite(r.totalYoe)
        ? ""
        : Math.max(0, r.totalYoe).toFixed(2);
    block[r.rowIndex - 1] = [yoeCell, String(r.score), r.reason];
  }
  const startSheetRow = 2;
  const endSheetRow = startSheetRow + block.length - 1;
  await callTool({
    source_id: "google_sheets__pipedream",
    tool_name: "google_sheets-update-rows",
    arguments: {
      sheetId: spreadsheetId,
      sheetName,
      range: `${yoeCol}${startSheetRow}:${reasonCol}${endSheetRow}`,
      rows: JSON.stringify(block),
    },
  });
}

function columnLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
