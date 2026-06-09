import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ThumbsUp, ThumbsDown, MessageSquarePlus, Loader2 } from "lucide-react";

export interface CalibrationFeedback {
  id: string;
  roleId: string;
  candidateUrl: string;
  candidateName: string;
  candidateSummary: string;
  jobId: string | null;
  aiScore: number;
  aiReason: string;
  thumb: "up" | "down";
  scoreOverride: number | null;
  note: string;
  createdAt: number;
  updatedAt: number;
}

export interface CandidateRowData {
  rowIndex: number;
  candidateName: string;
  candidateUrl: string;
  candidateCompany: string;
  candidateTitle: string;
  score: number;
  reason: string;
}

export function FeedbackButton({
  r,
  roleId,
  jobId,
  feedback,
  onChanged,
}: {
  r: CandidateRowData;
  roleId: string | null;
  jobId: string;
  feedback: CalibrationFeedback | null;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [thumb, setThumb] = useState<"up" | "down" | null>(feedback?.thumb || null);
  const [override, setOverride] = useState<string>(
    feedback?.scoreOverride != null ? String(feedback.scoreOverride) : "",
  );
  const [note, setNote] = useState(feedback?.note || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setThumb(feedback?.thumb || null);
    setOverride(feedback?.scoreOverride != null ? String(feedback.scoreOverride) : "");
    setNote(feedback?.note || "");
  }, [feedback?.id, feedback?.updatedAt]);

  const disabled = !roleId || !r.candidateUrl;

  async function save() {
    if (!roleId) {
      toast({
        title: "Role not attached to this run",
        description: "Older runs predate calibration. Run scoring again to enable feedback.",
        variant: "destructive",
      });
      return;
    }
    if (!thumb) {
      toast({ title: "Pick thumbs up or thumbs down first", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const summary = [r.candidateCompany, r.candidateTitle].filter(Boolean).join(" · ");
      const res = await apiRequest("POST", "/api/feedback", {
        roleId,
        candidateUrl: r.candidateUrl,
        candidateName: r.candidateName || "",
        candidateSummary: summary,
        jobId,
        aiScore: r.score,
        aiReason: r.reason || "",
        thumb,
        scoreOverride: override === "" ? null : Number(override),
        note,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).message || `Failed (${res.status})`);
      }
      toast({ title: "Feedback saved", description: "Future runs of this role will see it." });
      onChanged();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't save feedback", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!feedback?.id) return;
    setSaving(true);
    try {
      await apiRequest("DELETE", `/api/feedback/${feedback.id}`);
      toast({ title: "Feedback removed" });
      onChanged();
      setOpen(false);
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  const indicatorCls = feedback
    ? feedback.thumb === "up"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-destructive"
    : "text-muted-foreground";
  const Icon = feedback
    ? feedback.thumb === "up"
      ? ThumbsUp
      : ThumbsDown
    : MessageSquarePlus;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 w-7 p-0 ${indicatorCls}`}
          disabled={disabled}
          title={feedback ? "Edit your feedback" : "Give feedback to calibrate this role"}
          data-testid={`button-feedback-${r.rowIndex}`}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium">
              {r.candidateName || `Row ${r.rowIndex}`}
            </div>
            <div className="text-xs text-muted-foreground">
              AI scored <span className="font-medium">{r.score}</span>. Tell the model where it
              was off.
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={thumb === "up" ? "default" : "outline"}
              onClick={() => setThumb("up")}
              className="flex-1 gap-1.5"
              data-testid={`button-thumb-up-${r.rowIndex}`}
            >
              <ThumbsUp className="h-3.5 w-3.5" /> Good call
            </Button>
            <Button
              type="button"
              size="sm"
              variant={thumb === "down" ? "default" : "outline"}
              onClick={() => setThumb("down")}
              className="flex-1 gap-1.5"
              data-testid={`button-thumb-down-${r.rowIndex}`}
            >
              <ThumbsDown className="h-3.5 w-3.5" /> Off
            </Button>
          </div>

          <div>
            <Label className="text-xs" htmlFor={`override-${r.rowIndex}`}>
              Correct score (optional)
            </Label>
            <select
              id={`override-${r.rowIndex}`}
              data-testid={`select-override-${r.rowIndex}`}
              className="mt-1 h-8 w-full rounded border border-input bg-background px-2 text-sm"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
            >
              <option value="">— No override —</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
              <option value="4">4</option>
              <option value="5">5</option>
            </select>
          </div>

          <div>
            <Label className="text-xs" htmlFor={`note-${r.rowIndex}`}>
              Why? (optional)
            </Label>
            <Textarea
              id={`note-${r.rowIndex}`}
              data-testid={`textarea-note-${r.rowIndex}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Strong onsite customer-facing background — bump these higher."
              className="mt-1 min-h-[72px] text-sm"
            />
          </div>

          <div className="flex items-center justify-between gap-2">
            <div>
              {feedback && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={remove}
                  disabled={saving}
                  className="text-destructive hover:text-destructive"
                  data-testid={`button-remove-feedback-${r.rowIndex}`}
                >
                  Remove
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={save}
                disabled={saving || !thumb}
                data-testid={`button-save-feedback-${r.rowIndex}`}
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
