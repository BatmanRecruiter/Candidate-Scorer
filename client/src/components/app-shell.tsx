import { Link, useLocation } from "wouter";
import { Sparkles, ListChecks, Plus, FolderCog } from "lucide-react";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [loc] = useLocation();
  const nav = [
    { href: "/new", label: "New Run", icon: Plus },
    { href: "/jobs", label: "Past Runs", icon: ListChecks },
    { href: "/manage", label: "Manage Roles", icon: FolderCog },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group" data-testid="link-home">
            <div className="h-7 w-7 rounded-md bg-primary text-primary-foreground flex items-center justify-center">
              <Sparkles className="h-4 w-4" />
            </div>
            <span className="font-semibold tracking-tight">Candidate Scorer</span>
          </Link>
          <nav className="flex items-center gap-1">
            {nav.map((n) => {
              const active = loc.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-testid={`link-${n.label.toLowerCase().replace(/\s+/g, "-")}`}
                  className={cn(
                    "h-9 px-3 inline-flex items-center gap-2 rounded-md text-sm hover-elevate",
                    active ? "bg-accent text-accent-foreground" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>
      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
      </main>
      <footer className="border-t border-border py-4 text-xs text-muted-foreground text-center">
        Scoring runs locally via Claude. Source data stays in your Drive and Sheets.
      </footer>
    </div>
  );
}
