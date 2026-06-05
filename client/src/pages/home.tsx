import { Link } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, Folder, BarChart3 } from "lucide-react";

export default function Home() {
  return (
    <AppShell>
      <section className="text-center max-w-3xl mx-auto py-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent text-xs font-medium mb-4">
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          Recruiting copilot
        </div>
        <h1 className="text-xl font-bold tracking-tight mb-3">
          Score sourced candidates against the people who actually got the job.
        </h1>
        <p className="text-muted-foreground mb-6">
          Upload a CSV of LinkedIn profiles and role context files — JD, hiring-manager notes, a
          weighted scoring rubrik, resumes of folks you hired and didn't hire, interview transcripts,
          scorecards, incumbent profiles — then rank each candidate 1 to 5 with a one-sentence
          reason.
        </p>
        <div className="flex items-center justify-center gap-3">
          <Link href="/new">
            <Button size="lg" data-testid="button-start-run" className="gap-2">
              Start a new run
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/jobs">
            <Button size="lg" variant="outline" data-testid="button-view-runs">
              View past runs
            </Button>
          </Link>
        </div>
      </section>

      <section className="grid md:grid-cols-3 gap-4 mt-8">
        <Card>
          <CardContent className="p-5">
            <Folder className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium mb-1">Upload role context</div>
            <div className="text-sm text-muted-foreground">
              Upload JDs, HM notes, a weighted scoring rubrik, hired/not-hired resumes, transcripts,
              scorecards, and incumbent profiles for each role.
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <FileText className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium mb-1">CSV input</div>
            <div className="text-sm text-muted-foreground">
              Upload a CSV of profile data — every column becomes context for scoring.
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <BarChart3 className="h-5 w-5 text-primary mb-3" />
            <div className="font-medium mb-1">Score + reason + CSV download</div>
            <div className="text-sm text-muted-foreground">
              Each candidate gets a 1-5 score and a one-sentence reason. Download results as a CSV
              or review them in the in-app dashboard.
            </div>
          </CardContent>
        </Card>
      </section>
    </AppShell>
  );
}
