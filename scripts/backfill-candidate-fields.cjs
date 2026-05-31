// One-shot: re-derive candidateName/Url/Company/Title for every existing job's
// results from the per-row `fields` blob. Earlier runs persisted empty strings
// because the header aliases didn't match the real CSV headers.
//
// Usage: node scripts/backfill-candidate-fields.cjs
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.resolve(__dirname, "..", "data.db");
const db = new Database(dbPath);

function lookup(fields, candidates) {
  const keys = Object.keys(fields || {});
  const lcKeys = keys.map((k) => k.toLowerCase());
  for (const c of candidates) {
    const lc = c.toLowerCase();
    const i = lcKeys.findIndex((k) => k === lc);
    if (i !== -1 && fields[keys[i]]) return fields[keys[i]];
  }
  for (const c of candidates) {
    const lc = c.toLowerCase();
    const i = lcKeys.findIndex((k) => k.includes(lc));
    if (i !== -1 && fields[keys[i]]) return fields[keys[i]];
  }
  return "";
}

const NAME = ["Candidate Name", "Full Name", "Name", "Candidate", "candidate_name"];
const URL = ["Candidate LinkedIn URL", "LinkedIn URL", "LinkedIn", "Profile URL", "URL", "profile_url"];
const COMPANY = ["Company1", "Current Company", "Company", "company"];
const TITLE = ["Company1 Title", "Current Title", "Candidate Profile Headline", "Headline", "Title", "headline"];

const rows = db.prepare("SELECT id, results FROM jobs").all();
let updatedJobs = 0;
let updatedResults = 0;

for (const r of rows) {
  let parsed;
  try {
    parsed = JSON.parse(r.results || "[]");
  } catch {
    continue;
  }
  let touched = false;
  for (const res of parsed) {
    const f = res.fields || {};
    if (!res.candidateName) {
      const v = lookup(f, NAME);
      if (v) { res.candidateName = v; touched = true; updatedResults++; }
    }
    if (!res.candidateUrl) {
      const v = lookup(f, URL);
      if (v) { res.candidateUrl = v; touched = true; }
    }
    if (!res.candidateCompany) {
      const v = lookup(f, COMPANY);
      if (v) { res.candidateCompany = v; touched = true; }
    }
    if (!res.candidateTitle) {
      const v = lookup(f, TITLE);
      if (v) { res.candidateTitle = v; touched = true; }
    }
  }
  if (touched) {
    db.prepare("UPDATE jobs SET results = ? WHERE id = ?").run(JSON.stringify(parsed), r.id);
    updatedJobs++;
  }
}

console.log(`Backfilled ${updatedResults} result rows across ${updatedJobs} jobs.`);
