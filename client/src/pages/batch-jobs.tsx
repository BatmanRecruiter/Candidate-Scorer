import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Moon, Clock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";

interface BatchJobSummary {
  id: string;
  roleId?: string | null;
  roleName: string;
  anthropicBatchId: string;
  status: string;
  totalCandidates: number;
  uploadFilename?: string | null;
  submittedAt: number;
  createdAt: number;
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

export default function BatchJobs() {
  const [jobs, setJobs] = useState<BatchJobSummary[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch(`${(window as any).__API_BASE__ || ""}/api/batch-jobs`);
      if (!res.ok) return;
      const data = await res.json();
      setJobs(data.batchJobs || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Refresh every 30s if any jobs are still processing
    const interval = setInterval(() => {
      load();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <AppShell>
      <div className="flex items-center gap-3 mb-6">
        <Moon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Batch Results</h1>
      </div>

      {loading ? (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : jobs.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            <Moon className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>No overnight batch jobs yet.</p>
            <p className="text-sm mt-1">
              Submit a run with the{" "}
              <Link href="/new" className="text-primary hover:underline">
                Overnight Batch
              </Link>{" "}
              mode to see results here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/batch-jobs/${job.id}`}>
              <Card className="hover-elevate cursor-pointer">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{job.roleName}</div>
                      <div className="text-sm text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span>{job.uploadFilename || "uploaded CSV"}</span>
                        <span>·</span>
                        <span>{job.totalCandidates} candidates</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {new Date(job.submittedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1 opacity-60">
                        {job.anthropicBatchId}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <StatusBadge status={job.status} />
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
