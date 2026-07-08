import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  CheckCircle2,
  AlertCircle,
  Upload,
  Loader2,
  ArrowRight,
  RefreshCw,
  FolderOpen,
  FileText,
  Zap,
  Moon,
} from "lucide-react";

import { CATEGORIES, CATEGORY_LABEL, type Category } from "@shared/categories";

interface RoleSummary {
  roleId: string;
  roleName: string;
}

interface PreviewFile {
  fileId: string;
  fileName: string;
  category: Category | null;
  autoDetected: boolean;
}

export default function NewJob() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [roleId, setRoleId] = useState("");

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<PreviewFile[]>([]);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [batchMode, setBatchMode] = useState(false);

  async function loadRoles() {
    setRolesLoading(true);
    try {
      const res = await apiRequest("GET", "/api/roles");
      const data = await res.json();
      setRoles(data.roles || []);
    } catch (e: any) {
      toast({ title: "Couldn't list roles", description: e.message, variant: "destructive" });
    } finally {
      setRolesLoading(false);
    }
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function loadPreview(id: string) {
    if (!id) return;
    setPreviewLoading(true);
    setPreviewFiles([]);
    try {
      const res = await apiRequest("GET", `/api/roles/${encodeURIComponent(id)}/preview`);
      const data = await res.json();
      setPreviewFiles(data.files || []);
    } catch (e: any) {
      toast({ title: "Couldn't load files", description: e.message, variant: "destructive" });
    } finally {
      setPreviewLoading(false);
    }
  }

  function onRoleChange(id: string) {
    setRoleId(id);
    if (id) loadPreview(id);
    else setPreviewFiles([]);
  }

  async function setCategory(fileId: string, category: string) {
    if (!roleId) return;
    try {
      const res = await apiRequest("POST", `/api/roles/${encodeURIComponent(roleId)}/categorize`, {
        fileId,
        category,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || `Failed (${res.status})`);
      }
      setPreviewFiles((cur) =>
        cur.map((f) =>
          f.fileId === fileId
            ? {
                ...f,
                category: category === "auto" ? f.category : (category as Category),
                autoDetected: false,
              }
            : f,
        ),
      );
      if (category === "auto") loadPreview(roleId);
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    }
  }

  async function startRun() {
    if (!roleId) {
      toast({ title: "Pick a role first", variant: "destructive" });
      return;
    }
    if (uncategorized.length > 0) {
      toast({
        title: `${uncategorized.length} file(s) still need a category`,
        description: "Pick a category for each or set it to skip below.",
        variant: "destructive",
      });
      return;
    }
    if (!csvFile) {
      toast({ title: "Pick a CSV first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("roleId", roleId);
      form.append("csv", csvFile);
      if (batchMode) form.append("batchMode", "true");
      const res = await fetch(`${(window as any).__API_BASE__ || ""}/api/jobs`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || `Failed (${res.status})`);
      }
      const data = await res.json();
      if (batchMode) {
        navigate(`/batch-jobs/${data.batchJobId}`);
      } else {
        navigate(`/jobs/${data.jobId}`);
      }
    } catch (e: any) {
      toast({ title: "Couldn't start run", description: e.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const noRoles = !rolesLoading && roles.length === 0;
  const uncategorized = previewFiles.filter((f) => !f.category);
  const categorized = previewFiles.filter((f) => f.category);

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<
    Category,
    number
  >;
  for (const f of categorized) counts[f.category!]++;

  return (
    <AppShell>
      <h1 className="text-xl font-bold tracking-tight mb-6">New scoring run</h1>

      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-5">
            <div className="font-medium mb-3 flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-primary/15 text-primary inline-flex items-center justify-center text-xs font-bold">
                1
              </span>
              Role
            </div>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="role-select">Pick a role</Label>
                  <button
                    type="button"
                    onClick={loadRoles}
                    disabled={rolesLoading}
                    data-testid="button-refresh-roles"
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${rolesLoading ? "animate-spin" : ""}`} />
                    Refresh
                  </button>
                </div>
                <select
                  id="role-select"
                  data-testid="select-role"
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={roleId}
                  onChange={(e) => onRoleChange(e.target.value)}
                  disabled={rolesLoading || noRoles}
                >
                  <option value="">
                    {rolesLoading
                      ? "Loading roles…"
                      : noRoles
                        ? "No roles created yet"
                        : "— pick a role —"}
                  </option>
                  {roles.map((r) => (
                    <option key={r.roleId} value={r.roleId}>
                      {r.roleName} ({r.roleId})
                    </option>
                  ))}
                </select>
                {noRoles && (
                  <Link
                    href="/manage"
                    data-testid="link-manage-empty"
                    className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <FolderOpen className="h-4 w-4" /> Create a role in Manage roles
                  </Link>
                )}
              </div>

              {previewLoading && (
                <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading files…
                </div>
              )}

              {!previewLoading && roleId && previewFiles.length === 0 && (
                <div className="rounded-md border border-border p-3 bg-card/50 text-sm text-muted-foreground">
                  No files uploaded yet for{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{roleId}</code>. Go to
                  Manage Roles to upload context files for this role.
                </div>
              )}

              {!previewLoading && previewFiles.length > 0 && (
                <div className="rounded-md border border-border p-3 bg-card/50">
                  <div className="text-sm font-medium mb-2">Files detected</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    {CATEGORIES.map((c) => (
                      <CountRow key={c} label={CATEGORY_LABEL[c]} count={counts[c]} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="font-medium mb-3 flex items-center gap-2">
              <span className="h-6 w-6 rounded-full bg-primary/15 text-primary inline-flex items-center justify-center text-xs font-bold">
                2
              </span>
              Candidates
            </div>
            <div className="space-y-3">
              <Label htmlFor="csv">
                <Upload className="h-4 w-4 inline mr-1" />
                Upload candidate CSV
              </Label>
              <Input
                id="csv"
                data-testid="input-csv"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
              {csvFile && (
                <p className="text-xs text-muted-foreground">
                  {csvFile.name} — {(csvFile.size / 1024).toFixed(1)} KB
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Every column becomes part of the candidate's profile when scoring.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Pre-run review: uncategorized files */}
      {uncategorized.length > 0 && (
        <Card className="mt-6 border-amber-500/50 dark:border-amber-400/40">
          <CardContent className="p-5">
            <div className="font-medium mb-1 inline-flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-4 w-4" />
              {uncategorized.length} file{uncategorized.length === 1 ? "" : "s"} need
              {uncategorized.length === 1 ? "s" : ""} a category
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              We couldn't auto-detect a category from these filenames. Pick one for each — your
              choices are remembered for next time.
            </p>
            <ul className="space-y-2">
              {uncategorized.map((f) => (
                <FileRow key={f.fileId} file={f} setCategory={setCategory} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Categorized list */}
      {categorized.length > 0 && (
        <Card className="mt-6">
          <CardContent className="p-5">
            <div className="font-medium mb-3">Categorized files ({categorized.length})</div>
            <ul className="space-y-1.5">
              {categorized.map((f) => (
                <FileRow key={f.fileId} file={f} setCategory={setCategory} />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Processing mode toggle */}
      <Card className="mt-6">
        <CardContent className="p-5">
          <div className="font-medium mb-3 flex items-center gap-2">
            <span className="h-6 w-6 rounded-full bg-primary/15 text-primary inline-flex items-center justify-center text-xs font-bold">
              3
            </span>
            Processing mode
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setBatchMode(false)}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                !batchMode
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <Zap className={`h-5 w-5 mt-0.5 shrink-0 ${!batchMode ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium text-sm">Real-time</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Results in minutes. Standard API pricing.
                </div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setBatchMode(true)}
              className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                batchMode
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/40"
              }`}
            >
              <Moon className={`h-5 w-5 mt-0.5 shrink-0 ${batchMode ? "text-primary" : "text-muted-foreground"}`} />
              <div>
                <div className="font-medium text-sm">Overnight Batch</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Results within 24 hours. 50% cost savings.
                </div>
              </div>
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex justify-end">
        <Button
          size="lg"
          onClick={startRun}
          disabled={submitting || uncategorized.length > 0 || !roleId}
          data-testid="button-start-scoring"
          className="gap-2"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {batchMode ? "Submit overnight batch" : "Start scoring"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </AppShell>
  );
}

function CountRow({ label, count }: { label: string; count: number }) {
  const has = count > 0;
  return (
    <div className="flex items-center gap-2">
      {has ? (
        <CheckCircle2 className="h-4 w-4 text-primary" />
      ) : (
        <AlertCircle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={has ? "" : "text-muted-foreground"}>
        {label} <span className="text-muted-foreground">({count})</span>
      </span>
    </div>
  );
}

function FileRow({
  file,
  setCategory,
}: {
  file: PreviewFile;
  setCategory: (fileId: string, category: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 text-sm">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="truncate flex-1 min-w-0" data-testid={`link-file-${file.fileId}`}>
        {file.fileName}
      </span>
      <select
        data-testid={`select-cat-${file.fileId}`}
        className="h-8 px-2 rounded border border-input bg-background text-xs shrink-0"
        value={file.category ?? ""}
        onChange={(e) => setCategory(file.fileId, e.target.value || "auto")}
      >
        <option value="">— Needs a category —</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CATEGORY_LABEL[c]}
            {file.autoDetected && file.category === c ? " (auto)" : ""}
          </option>
        ))}
        <option value="auto">Reset to auto-detect</option>
      </select>
    </li>
  );
}
