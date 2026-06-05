import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Loader2,
  RefreshCw,
  Copy,
  Check,
  Plus,
  Trash2,
  FileText,
  Upload,
  ChevronRight,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  ExternalLink,
} from "lucide-react";

const CATEGORIES = [
  "jd",
  "hm_notes",
  "rubrik",
  "hired",
  "not_hired",
  "transcripts",
  "scorecards",
  "incumbents",
  "benchmark_candidates",
] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_LABEL: Record<Category, string> = {
  jd: "Job description",
  hm_notes: "HM notes",
  rubrik: "Scoring rubrik",
  hired: "Hired resumes",
  not_hired: "Not-hired resumes",
  transcripts: "Interview transcripts",
  scorecards: "Scorecards",
  incumbents: "Incumbent profiles",
  benchmark_candidates: "Benchmark candidates",
};

interface RoleSummary {
  roleId: string;
  roleName: string;
  createdAt: number;
}

interface RoleFile {
  fileId: string;
  fileName: string;
  category: Category | null;
  autoDetected: boolean;
  byteSize: number;
  createdAt: number;
}

interface PreviewResp {
  roleId: string;
  roleName: string;
  files: RoleFile[];
}

export default function ManageRoles() {
  const { toast } = useToast();

  const [roles, setRoles] = useState<RoleSummary[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [newRoleId, setNewRoleId] = useState("");
  const [newRoleName, setNewRoleName] = useState("");
  const [creating, setCreating] = useState(false);

  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  async function loadRoles() {
    setRolesLoading(true);
    try {
      const res = await apiRequest("GET", "/api/roles");
      const data = await res.json();
      setRoles(data.roles || []);
    } catch (e: any) {
      toast({ title: "Couldn't load roles", description: e.message, variant: "destructive" });
    } finally {
      setRolesLoading(false);
    }
  }

  useEffect(() => {
    loadRoles();
  }, []);

  async function createRole(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoleId.trim() || !newRoleName.trim()) {
      toast({ title: "Both ID and name required", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await apiRequest("POST", "/api/roles", {
        roleId: newRoleId.trim(),
        roleName: newRoleName.trim(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || `Failed (${res.status})`);
      }
      setNewRoleId("");
      setNewRoleName("");
      await loadRoles();
      toast({ title: "Role created" });
    } catch (e: any) {
      toast({ title: "Couldn't create role", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function deleteRole(roleId: string) {
    if (!confirm(`Delete role "${roleId}" and all its uploaded files?`)) return;
    try {
      await apiRequest("DELETE", `/api/roles/${encodeURIComponent(roleId)}`);
      if (selectedRoleId === roleId) setSelectedRoleId(null);
      await loadRoles();
    } catch (e: any) {
      toast({ title: "Couldn't delete role", description: e.message, variant: "destructive" });
    }
  }

  return (
    <AppShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Manage roles</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Create a role, then upload context files (JD, rubric, transcripts, etc.). The scorer
            reads these files at run time to evaluate candidates.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={loadRoles}
          disabled={rolesLoading}
          data-testid="button-refresh-roles"
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${rolesLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Create new role */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="font-medium mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add a role
          </div>
          <form onSubmit={createRole} className="space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-[160px,1fr,auto] gap-3 items-end">
              <div className="flex flex-col">
                <Label htmlFor="new-role-id" className="text-xs mb-1">
                  Role ID
                </Label>
                <Input
                  id="new-role-id"
                  data-testid="input-new-role-id"
                  value={newRoleId}
                  onChange={(e) => setNewRoleId(e.target.value)}
                  placeholder="e.g. VECTOR or SS-001"
                />
              </div>
              <div className="flex flex-col">
                <Label htmlFor="new-role-name" className="text-xs mb-1">
                  Display name
                </Label>
                <Input
                  id="new-role-name"
                  data-testid="input-new-role-name"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  placeholder="e.g. Forward Deploy Engineer — Vector team"
                />
              </div>
              <Button type="submit" disabled={creating} data-testid="button-create-role" className="gap-2">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Create role
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Role ID is short — letters, numbers, dash, underscore.
            </p>
          </form>
        </CardContent>
      </Card>

      {/* Existing roles */}
      <Card className="mb-6">
        <CardContent className="p-5">
          <div className="font-medium mb-3">Your roles</div>
          {rolesLoading && roles.length === 0 && (
            <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}
          {!rolesLoading && roles.length === 0 && (
            <div className="text-sm text-muted-foreground">
              No roles yet. Create one above to get started.
            </div>
          )}
          {roles.length > 0 && (
            <div className="space-y-2">
              {roles.map((r) => (
                <RoleRow
                  key={r.roleId}
                  role={r}
                  expanded={selectedRoleId === r.roleId}
                  onToggle={() =>
                    setSelectedRoleId(selectedRoleId === r.roleId ? null : r.roleId)
                  }
                  onDelete={() => deleteRole(r.roleId)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function RoleRow({
  role,
  expanded,
  onToggle,
  onDelete,
}: {
  role: RoleSummary;
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(role.roleId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="rounded-md border border-border bg-card/50">
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex-1 flex items-center gap-2 text-left min-w-0"
          data-testid={`button-toggle-role-${role.roleId}`}
        >
          <ChevronRight
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              expanded ? "rotate-90" : ""
            }`}
          />
          <code className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">{role.roleId}</code>
          <span className="text-sm font-medium truncate">{role.roleName}</span>
        </button>
        <Button
          size="sm"
          variant="outline"
          onClick={copyId}
          data-testid={`button-copy-id-${role.roleId}`}
          className="gap-1.5 h-7"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy ID"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onDelete}
          data-testid={`button-delete-role-${role.roleId}`}
          className="h-7 px-2 text-destructive hover:text-destructive"
          title="Delete role"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded && <RoleDetail roleId={role.roleId} />}
    </div>
  );
}

function RoleDetail({ roleId }: { roleId: string }) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [data, setData] = useState<PreviewResp | null>(null);
  const [dragOver, setDragOver] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/roles/${encodeURIComponent(roleId)}/preview`);
      const d = await res.json();
      setData(d);
    } catch (e: any) {
      toast({ title: "Couldn't load files", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [roleId]);

  async function uploadFiles(fileList: FileList) {
    const files = Array.from(fileList);
    if (!files.length) return;
    setUploading(true);
    let failed = 0;
    for (const file of files) {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/roles/${encodeURIComponent(roleId)}/files`, {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.message || `Failed (${res.status})`);
        }
      } catch (e: any) {
        failed++;
        console.error("upload failed", file.name, e);
      }
    }
    setUploading(false);
    if (failed > 0) {
      toast({
        title: `${failed} file${failed > 1 ? "s" : ""} failed to upload`,
        variant: "destructive",
      });
    }
    await load();
  }

  async function deleteFile(fileId: string, fileName: string) {
    if (!confirm(`Remove "${fileName}" from this role?`)) return;
    try {
      const res = await apiRequest(
        "DELETE",
        `/api/roles/${encodeURIComponent(roleId)}/files/${encodeURIComponent(fileId)}`,
      );
      if (!res.ok) throw new Error("Delete failed");
      setData((cur) =>
        cur ? { ...cur, files: cur.files.filter((f) => f.fileId !== fileId) } : cur,
      );
    } catch (e: any) {
      toast({ title: "Couldn't remove file", description: e.message, variant: "destructive" });
    }
  }

  async function setCategory(fileId: string, category: string) {
    try {
      const res = await apiRequest("POST", `/api/roles/${encodeURIComponent(roleId)}/categorize`, {
        fileId,
        category,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.message || `Failed (${res.status})`);
      }
      setData((cur) =>
        cur
          ? {
              ...cur,
              files: cur.files.map((f) =>
                f.fileId === fileId
                  ? {
                      ...f,
                      category: category === "auto" ? null : (category as Category),
                      autoDetected: false,
                    }
                  : f,
              ),
            }
          : cur,
      );
    } catch (e: any) {
      toast({ title: "Couldn't save category", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="border-t border-border p-3 space-y-3">
      {/* Upload zone */}
      <div
        className={`border-2 border-dashed rounded-md p-4 text-center transition-colors cursor-pointer ${
          dragOver
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        }`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md"
          className="hidden"
          onChange={(e) => e.target.files && uploadFiles(e.target.files)}
        />
        {uploading ? (
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
          </div>
        ) : (
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 text-sm font-medium">
              <Upload className="h-4 w-4" /> Upload context files
            </div>
            <p className="text-xs text-muted-foreground">
              PDF, DOCX, DOC, TXT · drag & drop or click · multiple files OK
            </p>
            <p className="text-xs text-muted-foreground">
              Category is auto-detected from the filename (e.g. "Job Description.pdf" → JD)
            </p>
          </div>
        )}
      </div>

      {/* File list */}
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-muted-foreground">
          Uploaded files {data ? `(${data.files.length})` : ""}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
          className="h-7 gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && !data && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {data && data.files.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No files yet. Upload context files above — the scorer will use them to evaluate
          candidates for this role.
        </div>
      )}

      {data && data.files.length > 0 && (
        <FileList
          files={data.files}
          setCategory={setCategory}
          onDelete={deleteFile}
        />
      )}

      <CalibrationNotes roleId={roleId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calibration notes
// ---------------------------------------------------------------------------

interface CalibrationFeedback {
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

function CalibrationNotes({ roleId }: { roleId: string }) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<CalibrationFeedback[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/roles/${encodeURIComponent(roleId)}/feedback`);
      const data = await res.json();
      setRows((data.feedback || []) as CalibrationFeedback[]);
    } catch (e: any) {
      toast({
        title: "Couldn't load calibration notes",
        description: e.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [roleId]);

  async function remove(id: string) {
    if (!confirm("Remove this calibration note? Future runs will no longer see it.")) return;
    try {
      await apiRequest("DELETE", `/api/feedback/${id}`);
      setRows((cur) => cur.filter((r) => r.id !== id));
    } catch (e: any) {
      toast({ title: "Couldn't remove", description: e.message, variant: "destructive" });
    }
  }

  return (
    <div className="border-t border-border pt-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" /> Calibration notes ({rows.length})
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={load}
          disabled={loading}
          className="h-7 gap-1.5"
          data-testid={`button-refresh-calibration-${roleId}`}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && rows.length === 0 && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="text-xs text-muted-foreground">
          No feedback yet. After a scoring run, use the feedback button on each candidate to teach
          the model what "good" looks like for this role.
        </div>
      )}

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((f) => (
              <CalibrationRow key={f.id} f={f} onRemove={() => remove(f.id)} />
            ))}
        </ul>
      )}
    </div>
  );
}

function CalibrationRow({ f, onRemove }: { f: CalibrationFeedback; onRemove: () => void }) {
  const verdictCls =
    f.thumb === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive";
  const VerdictIcon = f.thumb === "up" ? ThumbsUp : ThumbsDown;

  return (
    <li className="rounded-md border border-border bg-background p-2.5 text-xs">
      <div className="flex items-start gap-2">
        <VerdictIcon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${verdictCls}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {f.candidateUrl ? (
              <a
                href={f.candidateUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium hover:underline inline-flex items-center gap-1"
              >
                {f.candidateName || f.candidateUrl}
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            ) : (
              <span className="font-medium">{f.candidateName || "—"}</span>
            )}
            <span className="text-muted-foreground">
              AI: <span className="font-mono">{f.aiScore}</span>
            </span>
            {f.scoreOverride != null && (
              <span className="text-muted-foreground">
                → Correct: <span className="font-mono font-semibold">{f.scoreOverride}</span>
              </span>
            )}
          </div>
          {f.candidateSummary && (
            <div className="text-muted-foreground mt-0.5 truncate">{f.candidateSummary}</div>
          )}
          {f.note && <div className="mt-1 whitespace-pre-wrap break-words">{f.note}</div>}
          <div className="text-muted-foreground mt-1 text-[10px]">
            Updated {new Date(f.updatedAt).toLocaleString()}
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
          title="Remove"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

function FileList({
  files,
  setCategory,
  onDelete,
}: {
  files: RoleFile[];
  setCategory: (fileId: string, category: string) => void;
  onDelete: (fileId: string, fileName: string) => void;
}) {
  const uncategorized = files.filter((f) => !f.category);
  const categorized = files.filter((f) => f.category);

  return (
    <div className="space-y-3">
      {uncategorized.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-400 mb-1.5">
            Needs a category ({uncategorized.length})
          </div>
          <ul className="space-y-1.5">
            {uncategorized.map((f) => (
              <FileRow key={f.fileId} file={f} setCategory={setCategory} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}
      {categorized.length > 0 && (
        <div>
          <div className="text-xs font-semibold mb-1.5">Categorized ({categorized.length})</div>
          <ul className="space-y-1.5">
            {categorized.map((f) => (
              <FileRow key={f.fileId} file={f} setCategory={setCategory} onDelete={onDelete} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  setCategory,
  onDelete,
}: {
  file: RoleFile;
  setCategory: (fileId: string, category: string) => void;
  onDelete: (fileId: string, fileName: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <span className="truncate flex-1 min-w-0" title={file.fileName}>
        {file.fileName}
      </span>
      <span className="text-muted-foreground shrink-0">
        {(file.byteSize / 1024).toFixed(0)} KB
      </span>
      <select
        className="h-7 px-2 rounded border border-input bg-background text-xs shrink-0"
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
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onDelete(file.fileId, file.fileName)}
        className="h-6 w-6 p-0 text-destructive hover:text-destructive shrink-0"
        title="Remove file"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}
