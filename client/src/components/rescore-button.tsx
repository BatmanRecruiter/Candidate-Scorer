import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Sparkles, AlertTriangle } from "lucide-react";

// Scores the user is allowed to send to Opus. 1s and 5s are clear-cut, so we
// never rescore them — only these "borderline" tiers are worth the pricier pass.
const RESCORABLE_SCORES = [2, 3, 4] as const;

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
  onStarted,
}: {
  jobId: string;
  apiEndpoint: string;
  completedStatus: string;
  status: string;
  results: ResultRow[];
  rescoreStatus?: RescoreStatus | null;
  // Fired once the rescore POST succeeds, so the parent page can resume polling
  // (its poll loop has usually already stopped because the original run is done).
  onStarted?: () => void;
}) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [open, setOpen] = useState(false);
  // Which score tiers are ticked in the popup. Default to 3 and 4 (the old
  // behaviour); the user can add 2 or untick any of them per role/search.
  const [selected, setSelected] = useState<Record<number, boolean>>({ 3: true, 4: true });

  if (status !== completedStatus) return null;
  if (rescoreStatus?.status === "running") return null;

  // How many not-yet-Opus candidates sit at each rescorable score tier.
  const countByScore = (score: number) =>
    results.filter((r) => !r.error && r.score === score && r.scoredBy !== "opus").length;
  const counts: Record<number, number> = {};
  for (const s of RESCORABLE_SCORES) counts[s] = countByScore(s);

  const eligibleTotal = RESCORABLE_SCORES.reduce((sum, s) => sum + counts[s], 0);
  if (eligibleTotal === 0) return null;

  const chosenScores = RESCORABLE_SCORES.filter((s) => selected[s] && counts[s] > 0);
  const selectedCount = chosenScores.reduce((sum, s) => sum + counts[s], 0);

  async function start() {
    setSubmitting(true);
    try {
      await apiRequest("POST", apiEndpoint, { scores: chosenScores });
      setOpen(false);
      onStarted?.();
      toast({
        title: "Rescore started",
        description: `Re-scoring ${selectedCount} candidate${selectedCount === 1 ? "" : "s"} with Opus.`,
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
    <>
      <Button
        variant="outline"
        className="gap-2"
        onClick={() => setOpen(true)}
        data-testid="button-rescore-borderline"
        title={`Choose which scores to re-score with Opus (${eligibleTotal} eligible)`}
      >
        <Sparkles className="h-4 w-4" />
        Re-score with Opus
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Re-score with Opus</DialogTitle>
            <DialogDescription>
              Choose which scores to re-evaluate with Claude Opus — a higher-quality
              but more expensive model. 1s and 5s are skipped.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {RESCORABLE_SCORES.map((s) => {
              const count = counts[s];
              const disabled = count === 0;
              return (
                <label
                  key={s}
                  className={`flex items-center gap-3 rounded-md border p-3 text-sm ${
                    disabled ? "opacity-50" : "cursor-pointer hover:bg-muted/50"
                  }`}
                  data-testid={`rescore-option-${s}`}
                >
                  <Checkbox
                    checked={!!selected[s] && !disabled}
                    disabled={disabled}
                    onCheckedChange={(v) =>
                      setSelected((prev) => ({ ...prev, [s]: v === true }))
                    }
                  />
                  <span className="font-medium">Score {s}</span>
                  <span className="ml-auto text-muted-foreground">
                    {count} candidate{count === 1 ? "" : "s"}
                  </span>
                </label>
              );
            })}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button
              className="gap-2"
              onClick={start}
              disabled={submitting || selectedCount === 0}
              data-testid="button-rescore-confirm"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Re-score {selectedCount} candidate{selectedCount === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
