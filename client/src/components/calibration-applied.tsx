import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { ThumbsUp, MessageSquarePlus, ChevronRight } from "lucide-react";

export interface CalibrationAppliedSummary {
  count: number;
  totalChars: number;
  notes: string[];
  feedbackIds: string[];
}

export function CalibrationApplied({
  applied,
}: {
  applied?: CalibrationAppliedSummary | null;
}) {
  const [open, setOpen] = useState(false);
  if (!applied) return null;
  if (applied.count === 0) {
    return (
      <Card className="mb-6 border-dashed">
        <CardContent className="p-4 text-sm text-muted-foreground inline-flex items-center gap-2">
          <MessageSquarePlus className="h-4 w-4" />
          No calibration feedback was applied to this run. Leave thumbs / notes on candidates
          below and the next run for this role will use them.
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className="mb-6 border-emerald-600/50 bg-emerald-500/5 dark:bg-emerald-500/10">
      <CardContent className="p-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
          data-testid="button-toggle-calibration"
        >
          <div className="flex items-center gap-2">
            <ThumbsUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-sm font-medium">
              Calibration applied: {applied.count}{" "}
              {applied.count === 1 ? "note" : "notes"} from prior runs
            </span>
            <span className="text-xs text-muted-foreground">
              ({applied.totalChars.toLocaleString()} chars sent to the model)
            </span>
          </div>
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              open ? "rotate-90" : ""
            }`}
          />
        </button>
        {open && (
          <div className="mt-3 space-y-2">
            <div className="text-xs text-muted-foreground">
              These are the exact strings the scorer saw under the
              <code className="mx-1 bg-muted px-1 rounded">CALIBRATION_NOTES</code>
              bucket. If the score on a candidate matches the guidance below, the feedback is
              doing its job.
            </div>
            <ol className="space-y-2">
              {applied.notes.map((n, i) => (
                <li
                  key={i}
                  className="text-xs bg-background border border-border rounded p-2 whitespace-pre-wrap break-words font-mono"
                >
                  {n}
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
