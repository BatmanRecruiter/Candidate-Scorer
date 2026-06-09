import { useEffect, useMemo, useState } from "react";
import { useRoute, Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Moon,
  CheckCircle2,
  XCircle,
  Clock,
  ArrowLeft,
} from "lucide-react";

interface BatchJobDetail {
  id: string;
  roleId?: string | null;
  roleName: string;
  anthropicBatchId: string;
  status: string;
  totalCandidates: number;
  uploadFilename?: string | null;
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
    error?: string;
  }> | null;
  submittedAt: number;
  createdAt: number;
  updatedAt: number;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "ended")
    return <Badge className="bg-primary text-primary-foreground gap-1"><CheckCircle2 className="h-3 w-3" />Complete</Badge>;
  if (status === "canceled" || status === "expired" || status === "errored")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" />{status}</Badge>;
  return (
    <Badge variant="outline" className="gap-1">
      <Loader2 className="h-3 w-3 animate-spin" />
      Processing
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

export default function BatchJobView() {
  const [, params] = useRoute<{ id: string }>("/batch-jobs/:id");
  const jobId = params?.id;
  const [job, setJob] = useState<BatchJobDetail | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stop = false;

    async function poll() {
      try {
        const res = await fetch(`${(window as any).__API_BASE__ || ""}/api/batch-jobs/${jobId}`);
        if (!res.ok) return;
        const data = (await res.json()) as BatchJobDetail;
        if (!stop) setJob(data);
        const terminalStatuses = ["ended", "canceled", "expired", "errored"];
        if (!stop && !terminalStatuses.includes(data.status)) {
          setTimeout(poll, 15_000);
        }
      } catch {
        if (!stop) setTimeout(poll, 20_000);
      }
    }
    poll();
    return () => { stop = true; };
  }, [jobId]);

  const dist = useMemo(() => {
    const buckets: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    if (job?.results) {
      for (const r of job.results) {
        if (r.error) continue;
        if (r.score >= 1 && r.score <= 5) buckets[r.score]++;
      }
    }
    return [1, 2, 3, 4, 5].map((k) => ({ score: `${k}`, count: buckets[k] }));
  }, [job]);

  const top10 = useMemo(() => {
    if (!job?.results) return [];
    return [...job.results]
      .filter((r) => !r.error)
      .sort((a, b) => b.score - a.score || a.rowIndex - b.rowIndex)
      .slice(0, 10);
  }, [job]);

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
    return () => { cancelled = true; };
  }, [job?.roleId, feedbackVersion]);
  const bumpFeedback = () => setFeedbackVersion((v) => v + 1);

  if (!job) {
    return (
      <AppShell>
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading batch job…
        </div>
      </AppShell>
    );
  }

  const isProcessing = !["ended", "canceled", "expired", "errored"].includes(job.status);

  return (
    <AppShell>
      <div className="mb-4">
        <Link href="/batch-jobs" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Batch Results
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="text-sm text-muted-foreground flex items-center gap-1.5">
            <Moon className="h-3.5 w-3.5" /> Overnight batch
          </div>
          <h1 className="text-xl font-bold tracking-tight">{job.roleName}</h1>
          <div className="text-xs text-muted-foreground mt-1">
            {job.uploadFilename || "uploaded CSV"} · {job.totalCandidates} candidates
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          {job.status === "ended" && job.results && (
            <a href={`${(window as any).__API_BASE__ || ""}/api/batch-jobs/${job.id}/csv`}>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" /> CSV
              </Button>
            </a>
          )}
        </div>
      </div>

      {/* Batch ID + submission info */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs mb-1">Anthropic Batch ID</div>
              <code className="text-xs bg-muted px-2 py-1 rounded">{job.anthropicBatchId}</code>
            </div>
            <div>
              <div className="text-muted-foreground text-xs mb-1">Submitted</div>
              <div className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                {new Date(job.submittedAt).toLocaleString()}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pending state */}
      {isProcessing && (
        <Card className="mb-6 border-primary/30 bg-primary/5">
          <CardContent className="p-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-primary" />
            <div className="font-medium">Your batch is being processed</div>
            <div className="text-sm text-muted-foreground mt-1">
              Anthropic is scoring all {job.totalCandidates} candidates. Results will be ready
              within 24 hours. This page refreshes automatically every 15 seconds.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Canceled/expired state */}
      {(job.status === "canceled" || job.status === "expired") && (
        <Card className="mb-6 border-destructive/40">
          <CardContent className="p-5 text-sm">
            <div className="font-medium text-destructive mb-1 capitalize">Batch {job.status}</div>
            <div className="text-muted-foreground">
              {job.status === "expired"
                ? "This batch expired before results were retrieved (24-hour limit)."
                : "This batch was canceled."}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {job.status === "ended" && job.results && (
        <>
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
                        k !== "totalChars" &&
                        k !== "calibrationApplied" &&
                        k !== "registered" &&
                        k !== "readable" &&
                        (typeof v === "number" || typeof v === "string"),
                    )
                    .map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-muted-foreground capitalize">{k.replace(/_/g, " ")}</span>
                        <span className="font-medium">{String(v)}</span>
                      </div>
                    ))}
                  {typeof job.contextSummary?.totalChars === "number" && (
                    <div className="flex justify-between border-t border-border pt-1 mt-1">
                      <span className="text-muted-foreground">Total chars</span>
                      <span className="font-medium">{job.contextSummary.totalChars.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <CalibrationApplied applied={job.contextSummary?.calibrationApplied} />

          {top10.length > 0 && (
            <Card className="mb-6">
              <CardContent className="p-5">
                <div className="text-sm font-medium mb-3">Top 10 candidates</div>
                <div className="space-y-2">
                  {top10.map((r) => (
                    <div key={r.rowIndex} className="flex items-start gap-3 border border-border rounded-md p-3">
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
                          roleId={job.roleId || null}
                          jobId={job.id}
                          feedback={feedbackMap[r.candidateUrl] || null}
                          onChanged={bumpFeedback}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

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
        </>
      )}

      {/* Ended but results loading failed */}
      {job.status === "ended" && !job.results && !isProcessing && (
        <Card className="mb-6 border-amber-500/40">
          <CardContent className="p-5 text-sm">
            <div className="font-medium text-amber-700 dark:text-amber-400 mb-1">Results loading</div>
            <div className="text-muted-foreground">
              Batch complete. Fetching individual results from Anthropic — refresh in a moment.
            </div>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
