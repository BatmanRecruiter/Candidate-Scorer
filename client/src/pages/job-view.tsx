import { useEffect, useMemo, useState } from "react";
import { useRoute } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { FeedbackButton, CalibrationFeedback } from "@/components/feedback-button";
import { CalibrationApplied } from "@/components/calibration-applied";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Loader2,
  Download,
  Star,
  ExternalLink,
  AlertTriangle,
  Sparkles,
} from "lucide-react";

interface JobData {
  id: string;
  roleId?: string | null;
  roleName: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  contextSummary: any;
  results: Array<{
    rowIndex: number;
    candidateName: string;
    candidateUrl: string;
    candidateCompany: string;
    candidateTitle: string;
    score: number;
    reason: string;
    totalYoe?: number | null;
    scoredBy?: "sonnet" | "opus";
    originalScore?: number;
    error?: string;
  }>;
  uploadFilename?: string | null;
  error?: string | null;
}

export default function JobView() {
  const [, params] = useRoute<{ id: string }>("/jobs/:id");
  const jobId = params?.id;
  const [job, setJob] = useState<JobData | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`${(window as any).__API_BASE__ || ""}/api/jobs/${jobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as JobData;
        if (!stop) setJob(data);
        const rescoreRunning =
          data.contextSummary?.rescoreStatus?.status === "running";
        if (
          !stop &&
          (data.status === "running" || data.status === "queued" || rescoreRunning)
        ) {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!stop) setTimeout(poll, 4000);
      }
    }
    poll();
    return () => {
      stop = true;
    };
  }, [jobId]);

  const dist = useMemo(() => {
    const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (job) {
      for (const r of job.results) {
        if (r.error) continue;
        if (r.score >= 1 && r.score <= 5) buckets[r.score]++;
      }
    }
    return [1, 2, 3, 4, 5].map((k) => ({ score: `${k}`, count: buckets[k] }));
  }, [job]);

  const top10 = useMemo(() => {
    if (!job) return [];
    return [...job.results]
      .filter((r) => !r.error)
      .sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex)
      .slice(0, 10);
  }, [job]);

  const lowGroup = useMemo(() => {
    if (!job) return [] as JobData["results"];
    return job.results.filter((r) => !r.error && r.score <= 2);
  }, [job]);

  // Map candidateUrl -> existing feedback row for this role, so we can show an
  // indicator on rows that already have feedback. Reloaded when the popover
  // saves or deletes.
  const [feedbackMap, setFeedbackMap] = useState<Record<string, CalibrationFeedback>>({});
  const [feedbackVersion, setFeedbackVersion] = useState(0);
  useEffect(() => {
    if (!job?.roleId) {
      setFeedbackMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest(
          "GET",
          `/api/roles/${encodeURIComponent(job.roleId as string)}/feedback`,
        );
        const data = await res.json();
        if (cancelled) return;
        const map: Record<string, CalibrationFeedback> = {};
        for (const f of (data.feedback || []) as CalibrationFeedback[]) {
          map[f.candidateUrl] = f;
        }
        setFeedbackMap(map);
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job?.roleId, feedbackVersion]);
  const bumpFeedback = () => setFeedbackVersion((v) => v + 1);

  if (!job) {
    return (
      <AppShell>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading job...
        </div>
      </AppShell>
    );
  }

  const pct = job.total === 0 ? 0 : Math.round((job.completed + job.failed) / job.total * 100);
  const running = job.status === "running" || job.status === "queued";

  return (
    <AppShell>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-sm text-muted-foreground">Scoring run</div>
          <h1 className="text-xl font-bold tracking-tight">{job.roleName}</h1>
          <div className="text-xs text-muted-foreground mt-1">
            Source: {job.uploadFilename || "uploaded CSV"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <RescoreButton job={job} />
          <a
            href={`${(window as any).__API_BASE__ || ""}/api/jobs/${job.id}/csv`}
            download
            data-testid="link-download-csv"
          >
            <Button variant="outline" className="gap-2">
              <Download className="h-4 w-4" /> CSV
            </Button>
          </a>
        </div>
      </div>

      {job.error && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <div>
              <div className="font-medium">{running ? "Warning" : "Job error"}</div>
              <div className="text-muted-foreground">{job.error}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium">Progress</div>
            <div className="text-sm text-muted-foreground">
              {job.completed + job.failed} / {job.total} ({pct}%) · {job.failed} failed
            </div>
          </div>
          <Progress value={pct} />
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-4 mb-6">
        <Card className="lg:col-span-2">
          <CardContent className="p-5">
            <div className="text-sm font-medium mb-3">Score distribution</div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dist}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="score" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm font-medium mb-3">Context used</div>
            <div className="grid grid-cols-1 gap-1 text-sm">
              {Object.entries(job.contextSummary || {})
                .filter(
                  ([k, v]) =>
                    // Hide meta fields and any non-primitive (e.g. `registered`,
                    // `readable`, `rescoreStatus`) so we only render the actual
                    // per-category counts.
                    k !== "totalChars" &&
                    k !== "calibrationApplied" &&
                    k !== "registered" &&
                    k !== "readable" &&
                    k !== "rescoreStatus" &&
                    (typeof v === "number" || typeof v === "string"),
                )
                .map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground capitalize">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ))}
              {typeof job.contextSummary?.totalChars === "number" && (
                <div className="flex justify-between border-t border-border pt-1 mt-1">
                  <span className="text-muted-foreground">Total chars</span>
                  <span className="font-medium">
                    {job.contextSummary.totalChars.toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <CalibrationApplied applied={job.contextSummary?.calibrationApplied} />
      <RescoreStatusBanner status={job.contextSummary?.rescoreStatus} />

      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="text-sm font-medium mb-3">Top 10 candidates</div>
          {top10.length === 0 ? (
            <div className="text-sm text-muted-foreground">No scores yet.</div>
          ) : (
            <div className="space-y-2">
              {top10.map((r) => (
                <CandidateRow
                  key={r.rowIndex}
                  r={r}
                  roleId={job.roleId || null}
                  jobId={job.id}
                  feedback={feedbackMap[r.candidateUrl] || null}
                  onChanged={bumpFeedback}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="text-sm font-medium mb-3">
            Likely skips ({lowGroup.length}) — common reasons
          </div>
          {lowGroup.length === 0 ? (
            <div className="text-sm text-muted-foreground">No 1s or 2s.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {lowGroup.slice(0, 8).map((r) => (
                <li key={r.rowIndex} className="flex items-baseline gap-2">
                  <Badge variant="outline" className="font-mono">
                    {r.score}
                  </Badge>
                  <span className="font-medium">{r.candidateName || `Row ${r.rowIndex}`}</span>
                  <span className="text-muted-foreground">— {r.reason}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-medium mb-3">All candidates</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b border-border">
                  <th className="py-2 pr-4">#</th>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Company / Title</th>
                  <th className="py-2 pr-4 text-center">Score</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-center">Feedback</th>
                </tr>
              </thead>
              <tbody>
                {[...job.results]
                  .sort((a, b) => (b.score || 0) - (a.score || 0))
                  .map((r) => (
                    <tr
                      key={r.rowIndex}
                      className="border-b border-border last:border-b-0 align-top"
                      data-testid={`row-candidate-${r.rowIndex}`}
                    >
                      <td className="py-2 pr-4 text-muted-foreground">{r.rowIndex}</td>
                      <td className="py-2 pr-4">
                        {r.candidateUrl ? (
                          <a
                            href={r.candidateUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 font-medium hover:underline"
                          >
                            {r.candidateName || "—"}
                            <ExternalLink className="h-3 w-3 opacity-50" />
                          </a>
                        ) : (
                          <span className="font-medium">{r.candidateName || "—"}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {r.candidateCompany}
                        {r.candidateCompany && r.candidateTitle ? " · " : ""}
                        {r.candidateTitle}
                      </td>
                      <td className="py-2 pr-4 text-center">
                        {r.error ? (
                          <Badge variant="destructive">err</Badge>
                        ) : (
                          <ScoreBadge score={r.score} />
                        )}
                      </td>
                      <td className="py-2 pr-4 max-w-md">
                        {r.error ? (
                          <span className="text-destructive">{r.error}</span>
                        ) : (
                          r.reason
                        )}
                      </td>
                      <td className="py-2 pr-4 text-center">
                        {r.error ? null : (
                          <FeedbackButton
                            r={r}
                            roleId={job.roleId || null}
                            jobId={job.id}
                            feedback={feedbackMap[r.candidateUrl] || null}
                            onChanged={bumpFeedback}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "completed") return <Badge className="bg-primary text-primary-foreground">Complete</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" /> Running
    </Badge>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const cls =
    score >= 5
      ? "bg-primary text-primary-foreground"
      : score >= 4
      ? "bg-primary/70 text-primary-foreground"
      : score >= 3
      ? "bg-secondary text-secondary-foreground"
      : "bg-destructive/15 text-destructive";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      <Star className="h-3 w-3" />
      {score}
    </span>
  );
}

function CandidateRow({
  r,
  roleId,
  jobId,
  feedback,
  onChanged,
}: {
  r: JobData["results"][0];
  roleId: string | null;
  jobId: string;
  feedback: CalibrationFeedback | null;
  onChanged: () => void;
}) {
  return (
    <div className="flex items-start gap-3 border border-border rounded-md p-3 hover-elevate">
      <ScoreBadge score={r.score} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">
          {r.candidateUrl ? (
            <a
              href={r.candidateUrl}
              target="_blank"
              rel="noreferrer"
              className="hover:underline inline-flex items-center gap-1"
            >
              {r.candidateName || `Row ${r.rowIndex}`}
              <ExternalLink className="h-3 w-3 opacity-50" />
            </a>
          ) : (
            r.candidateName || `Row ${r.rowIndex}`
          )}
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {r.candidateCompany}
          {r.candidateCompany && r.candidateTitle ? " · " : ""}
          {r.candidateTitle}
        </div>
        <div className="text-sm mt-1">{r.reason}</div>
      </div>
      <div className="shrink-0">
        <FeedbackButton
          r={r}
          roleId={roleId}
          jobId={jobId}
          feedback={feedback}
          onChanged={onChanged}
        />
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Two-pass rescore: button + status banner.
//
// Sonnet 4.6 is the first pass. Once a run is complete, the recruiter can
// click "Re-score borderline (Opus)" to send every score-2/3/4 row back
// through Opus 4.7 for a higher-quality second opinion. Obvious 1s and 5s
// are left alone to save cost. The button only appears when the job is
// completed AND there's at least one rescorable row.
// ---------------------------------------------------------------------------
function RescoreButton({ job }: { job: JobData }) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  if (job.status !== "completed") return null;
  const rescoreStatus = job.contextSummary?.rescoreStatus;
  if (rescoreStatus?.status === "running") return null;

  const borderlineCount = job.results.filter(
    (r) => !r.error && (r.score === 2 || r.score === 3 || r.score === 4) && r.scoredBy !== "opus",
  ).length;
  if (borderlineCount === 0) return null;

  async function start() {
    if (!confirm(
      `This will re-score ${borderlineCount} borderline candidate${borderlineCount === 1 ? "" : "s"} ` +
      `(score 2-4) using Claude Opus 4.7 — a higher-quality but more expensive model. ` +
      `Continue?`,
    )) return;
    setSubmitting(true);
    try {
      await apiRequest(
        "POST",
        `/api/jobs/${job.id}/rescore-borderline`,
        undefined,
      );
      toast({
        title: "Rescore started",
        description: `Re-scoring ${borderlineCount} candidate${borderlineCount === 1 ? "" : "s"} with Opus.`,
      });
    } catch (e: any) {
      toast({
        title: "Failed to start rescore",
        description: String(e?.message ?? e),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button
      variant="outline"
      className="gap-2"
      onClick={start}
      disabled={submitting}
      data-testid="button-rescore-borderline"
      title={`Re-score the ${borderlineCount} borderline candidate${borderlineCount === 1 ? "" : "s"} (2/3/4) with Opus 4.7`}
    >
      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
      Re-score borderline (Opus)
    </Button>
  );
}

interface RescoreStatus {
  status: "running" | "completed" | "failed";
  model?: string;
  total?: number;
  completed?: number;
  failed?: number;
  changedCount?: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

function RescoreStatusBanner({ status }: { status?: RescoreStatus | null }) {
  if (!status) return null;
  const isRunning = status.status === "running";
  const isFailed = status.status === "failed";
  const isDone = status.status === "completed";

  const tone = isFailed
    ? "border-destructive/40 bg-destructive/5"
    : isRunning
      ? "border-primary/40 bg-primary/5"
      : "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/20";

  return (
    <Card className={`mb-6 ${tone}`} data-testid="card-rescore-status">
      <CardContent className="p-4 flex items-start gap-3 text-sm">
        {isRunning ? (
          <Loader2 className="h-4 w-4 mt-0.5 animate-spin text-primary" />
        ) : isFailed ? (
          <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive" />
        ) : (
          <Sparkles className="h-4 w-4 mt-0.5 text-emerald-600" />
        )}
        <div className="flex-1">
          {isRunning && (
            <>
              <div className="font-medium">Re-scoring with Opus 4.7</div>
              <div className="text-muted-foreground">
                {status.completed ?? 0} / {status.total ?? 0} complete
                {status.failed ? ` · ${status.failed} failed` : ""}
                {(status.changedCount ?? 0) > 0
                  ? ` · ${status.changedCount} score${status.changedCount === 1 ? "" : "s"} changed so far`
                  : ""}
              </div>
            </>
          )}
          {isDone && (
            <>
              <div className="font-medium">Opus rescore complete</div>
              <div className="text-muted-foreground">
                Re-scored {status.completed ?? 0} candidate{(status.completed ?? 0) === 1 ? "" : "s"}
                {(status.changedCount ?? 0) > 0
                  ? ` · ${status.changedCount} score${status.changedCount === 1 ? "" : "s"} changed`
                  : " · no scores changed"}
                {status.failed ? ` · ${status.failed} failed` : ""}
              </div>
            </>
          )}
          {isFailed && (
            <>
              <div className="font-medium">Opus rescore failed</div>
              <div className="text-muted-foreground">{status.error || "Unknown error"}</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
