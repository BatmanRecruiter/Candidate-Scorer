import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight } from "lucide-react";

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
  const { data, isLoading } = useQuery<{ jobs: JobRow[] }>({
    queryKey: ["/api/jobs"],
    refetchInterval: 8000,
    // Keep the cached list around for instant subsequent visits
    // — the background refetch will update it within a couple seconds.
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    refetchOnMount: "always",
  });

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
