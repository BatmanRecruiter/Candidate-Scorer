import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";

export interface RescoreStatus {
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

interface ResultRow {
  score: number;
  error?: string;
  scoredBy?: string;
}

export function RescoreButton({
  jobId,
  apiEndpoint,
  completedStatus,
  status,
  results,
  rescoreStatus,
}: {
  jobId: string;
  apiEndpoint: string;
  completedStatus: string;
  status: string;
  results: ResultRow[];
  rescoreStatus?: RescoreStatus | null;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  if (status !== completedStatus) return null;
  if (rescoreStatus?.status === "running") return null;

  const borderlineCount = results.filter(
    (r) => !r.error && (r.score === 3 || r.score === 4) && r.scoredBy !== "opus",
  ).length;
  if (borderlineCount === 0) return null;

  async function start() {
    if (
      !confirm(
        `This will re-score ${borderlineCount} borderline candidate${borderlineCount === 1 ? "" : "s"} ` +
          `(score 3-4) using Claude Opus — a higher-quality but more expensive model. Continue?`,
      )
    )
      return;
    setSubmitting(true);
    try {
      await apiRequest("POST", apiEndpoint, undefined);
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
      title={`Re-score the ${borderlineCount} borderline candidate${borderlineCount === 1 ? "" : "s"} (3/4) with Opus`}
    >
      {submitting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="h-4 w-4" />
      )}
      Re-score borderline (Opus)
    </Button>
  );
}

export function RescoreStatusBanner({ status }: { status?: RescoreStatus | null }) {
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
              <div className="font-medium">Re-scoring with Opus</div>
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
                Re-scored {status.completed ?? 0} candidate
                {(status.completed ?? 0) === 1 ? "" : "s"}
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
