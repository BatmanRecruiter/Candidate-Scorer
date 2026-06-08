import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Trash2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface JobRow {
  id: string;
  roleName: string;
  status: string;
  total: number;
  completed: number;
  failed: number;
  createdAt: number;
}

export default function JobsList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ jobs: JobRow[] }>({
    queryKey: ["/api/jobs"],
    refetchInterval: 8000,
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
  });

  async function deleteRun(e: React.MouseEvent, job: JobRow) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete the run for "${job.roleName}" on ${new Date(job.createdAt).toLocaleString()}? This cannot be undone.`)) return;
    setDeletingId(job.id);
    try {
      const res = await apiRequest("DELETE", `/api/jobs/${job.id}`);
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      queryClient.setQueryData<{ jobs: JobRow[] }>(["/api/jobs"], (old) =>
        old ? { jobs: old.jobs.filter((j) => j.id !== job.id) } : old
      );
    } catch (e: any) {
      toast({ title: "Couldn't delete run", description: e.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <AppShell>
      <h1 className="text-xl font-bold tracking-tight mb-6">Past scoring runs</h1>
      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : !data?.jobs.length ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No runs yet.{" "}
            <Link href="/new" className="text-primary hover:underline">
              Start your first one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.jobs.map((j) => (
            <Link key={j.id} href={`/jobs/${j.id}`} data-testid={`link-job-${j.id}`}>
              <Card className="hover-elevate cursor-pointer">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{j.roleName}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(j.createdAt).toLocaleString()} · {j.total} candidates
                    </div>
                  </div>
                  <Badge variant={j.status === "completed" ? "default" : "outline"}>
                    {j.status}
                  </Badge>
                  <div className="text-sm text-muted-foreground">
                    {j.completed}/{j.total}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => deleteRun(e, j)}
                    disabled={deletingId === j.id}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                    title="Delete run"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
