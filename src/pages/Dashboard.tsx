import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Gauge,
  KeyRound,
  LogOut,
  Pin,
  PinOff,
  Plus,
  ScanSearch,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Navbar } from "@/components/site/Navbar";
import { Footer } from "@/components/site/Footer";
import { Disclaimer } from "@/components/Disclaimer";
import { VerdictBadge } from "@/components/VerdictBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { getDeviceId } from "@/lib/device";
import { formatBytes, formatDate, timeAgo } from "@/lib/format";

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

type ScanRow = {
  _id: Id<"scans">;
  type: "image" | "video";
  source: "upload" | "url" | "sample";
  fileName: string;
  verdict: "real" | "inconclusive" | "likely_ai" | "likely_deepfake" | "error" | null;
  confidence: number | null;
  score: number | null;
  isPublic: boolean;
  pinned: boolean;
  createdAt: number;
  expiresAt: number;
  fileSize: number | null;
} & Partial<{ deviceId: string }>;

/** The three outcomes plus the failure state. */
const VERDICT_META: Record<
  string,
  { label: string; short: string; color: string }
> = {
  real: {
    label: "Likely authentic",
    short: "Authentic",
    color: "var(--verdict-real)",
  },
  inconclusive: {
    label: "Inconclusive",
    short: "Inconclusive",
    color: "var(--verdict-uncertain)",
  },
  likely_ai: {
    label: "Likely AI-generated",
    short: "AI generated",
    color: "var(--verdict-fake)",
  },
  likely_deepfake: {
    label: "Likely deepfake",
    short: "Deepfake",
    color: "var(--verdict-fake)",
  },
  error: {
    label: "Analysis unavailable",
    short: "Unavailable",
    color: "var(--muted-foreground)",
  },
};

const PLAN_LIMITS: Record<string, number> = { free: 25, pro: 500, team: 2000 };

/**
 * Display verdict.
 *
 * `inconclusive` is a real engine outcome again, so it is shown as itself
 * rather than being resolved to the side of the stored score — a row the
 * engine could not settle must not read as a confident call in a list.
 *
 * The one case that still needs a fallback is a legacy row with a verdict of
 * null and no stored score: there is nothing to display and nothing to infer,
 * so it is shown as inconclusive rather than guessed at.
 */
function displayVerdict(
  verdict: ScanRow["verdict"],
): "real" | "inconclusive" | "likely_ai" | "likely_deepfake" | "error" {
  if (verdict != null) return verdict;
  return "inconclusive";
}

function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
  tone?: string;
}) {
  return (
    <Card className="paper-grain border-border/70 shadow-none">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {label}
          </p>
          <span
            className="flex size-7 items-center justify-center rounded-md"
            style={{ color: tone ?? "var(--primary)" }}
          >
            {icon}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const deviceId = useMemo(() => getDeviceId(), []);

  const scans = useQuery(api.scans.listMine, { limit: 500 });
  const quota = useQuery(api.scans.quota, { deviceId });
  const profile = useQuery(api.account.profile);
  const keys = useQuery(api.apiKeys.list);

  const removeMany = useMutation(api.scans.removeMany);
  const remove = useMutation(api.scans.remove);
  const setVisibility = useMutation(api.scans.setVisibility);
  const setPinned = useMutation(api.scans.setPinned);
  const updateProfile = useMutation(api.account.updateProfile);
  const setPlan = useMutation(api.account.setPlan);
  const exportData = useMutation(api.account.exportData);
  const deleteAccount = useMutation(api.account.deleteAccount);
  const createKey = useMutation(api.apiKeys.create);
  const revokeKey = useMutation(api.apiKeys.revoke);

  const rows = useMemo(() => (scans ?? []) as unknown as ScanRow[], [scans]);

  /* ---- history filters ---- */
  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "confidence" | "name">(
    "newest",
  );
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const PER_PAGE = 8;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = rows.filter((r) => {
      if (q && !r.fileName.toLowerCase().includes(q)) return false;
      if (verdictFilter !== "all" && displayVerdict(r.verdict) !== verdictFilter)
        return false;
      if (typeFilter !== "all" && r.type !== typeFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      switch (sort) {
        case "oldest":
          return a.createdAt - b.createdAt;
        case "confidence":
          return (b.confidence ?? -1) - (a.confidence ?? -1);
        case "name":
          return a.fileName.localeCompare(b.fileName);
        default:
          return b.createdAt - a.createdAt;
      }
    });
    return list;
  }, [rows, search, verdictFilter, typeFilter, sort]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice(
    (safePage - 1) * PER_PAGE,
    safePage * PER_PAGE,
  );

  /* ---- overview stats ---- */
  const stats = useMemo(() => {
    const count = (v: string) =>
      rows.filter((r) => displayVerdict(r.verdict) === v).length;
    const flagged = count("likely_ai") + count("likely_deepfake");
    const real = count("real");
    const withConf = rows.filter((r) => r.confidence != null);
    const avg = withConf.length
      ? Math.round(
          withConf.reduce((s, r) => s + (r.confidence ?? 0), 0) / withConf.length,
        )
      : 0;
    return { total: rows.length, flagged, real, inconclusive: count("inconclusive"), avg };
  }, [rows]);

  /* "now" is captured once per mount so the 14-day chart is stable across
     re-renders instead of recomputing a moving window on every render. */
  const [now] = useState(() => Date.now());

  const byDay = useMemo(() => {
    const DAY = 86_400_000;
    const out: Array<{ day: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * DAY);
      const dayStart = new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
      ).getTime();
      const label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      out.push({
        day: label,
        count: rows.filter(
          (r) => r.createdAt >= dayStart && r.createdAt < dayStart + DAY,
        ).length,
      });
    }
    return out;
  }, [rows, now]);

  const mix = useMemo(() => {
    const order = ["real", "inconclusive", "likely_ai", "likely_deepfake", "error"];
    return order
      .map((v) => ({
        name: VERDICT_META[v].short,
        value: rows.filter((r) => displayVerdict(r.verdict) === v).length,
        color: VERDICT_META[v].color,
      }))
      .filter((d) => d.value > 0);
  }, [rows]);

  /* ---- tab state (supports /dashboard?tab=account deep link) ---- */
  const activeTab = params.get("tab") ?? "overview";
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set("tab", value);
    setParams(next, { replace: true });
  };

  /* ---- account state ---- */
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const plan = profile?.plan ?? "free";

  /* ---- api key state ---- */
  const [keyName, setKeyName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /* ---- actions ---- */
  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const ids = pageRows.map((r) => r._id as string);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = [...selected] as Id<"scans">[];
    if (!ids.length) return;
    try {
      await removeMany({ ids });
      toast.success(`${ids.length} scan${ids.length > 1 ? "s" : ""} deleted.`);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete scans.");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await remove({ id: id as Id<"scans"> });
      toast.success("Scan deleted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete scan.");
    }
  };

  const handleVisibility = async (row: ScanRow) => {
    try {
      await setVisibility({ id: row._id, isPublic: !row.isPublic });
      toast.success(
        row.isPublic
          ? "Result is private again."
          : "Result is public — anyone with the link can view it.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update visibility.");
    }
  };

  const handlePin = async (row: ScanRow) => {
    try {
      await setPinned({ id: row._id, pinned: !row.pinned });
      toast.success(
        row.pinned
          ? "Unpinned — media will expire after 24 h."
          : "Pinned — stored media will be kept past 24 h.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update pin.");
    }
  };

  const handleSaveProfile = async () => {
    if (nameDraft === null) return;
    try {
      await updateProfile({ name: nameDraft });
      toast.success("Profile updated.");
      setNameDraft(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile.");
    }
  };

  const handleExport = async () => {
    try {
      const json = await exportData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `truthlens-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Data export downloaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await deleteAccount();
      toast.success("Account deleted.");
      await signOut();
      navigate("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete account.");
    }
  };

  const handleCreateKey = async () => {
    try {
      const { secret } = await createKey({ name: keyName || "Untitled key" });
      setNewSecret(secret);
      setKeyName("");
      setCopied(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create key.");
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await revokeKey({ id: id as Id<"apiKeys"> });
      toast.success("Key revoked.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not revoke key.");
    }
  };

  const copySecret = async () => {
    if (!newSecret) return;
    try {
      await navigator.clipboard.writeText(newSecret);
      setCopied(true);
    } catch {
      toast.error("Copy failed — select the key and copy it manually.");
    }
  };

  const usedPct = quota
    ? Math.min(100, Math.round((quota.used / Math.max(1, quota.limit)) * 100))
    : 0;

  const chartTooltip = {
    contentStyle: {
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "8px",
      fontSize: "12px",
      color: "var(--foreground)",
    },
    labelStyle: { color: "var(--muted-foreground)" },
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar variant="app" />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {/* Header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              Archive desk
            </p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome{user?.name ? `, ${user.name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every scan you run, with its evidence and confidence.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              className="gap-2 cursor-pointer"
              onClick={() => navigate("/analyze")}
            >
              <ScanSearch className="size-4" />
              New scan
            </Button>
            <Button
              type="button"
              variant="outline"
              className="gap-2 cursor-pointer"
              onClick={handleSignOut}
            >
              <LogOut className="size-4" />
              Sign out
            </Button>
          </div>
        </header>

        <Tabs
          value={activeTab}
          onValueChange={setTab}
          className="mt-8 w-full"
        >
          <TabsList className="h-auto w-full flex-col gap-1 sm:h-auto sm:w-auto sm:flex-row">
            <TabsTrigger value="overview" className="gap-2 cursor-pointer">
              <ScanSearch className="size-4" /> Overview
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2 cursor-pointer">
              <Download className="size-4" /> History
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2 cursor-pointer">
              <UserRound className="size-4" /> Account
            </TabsTrigger>
            <TabsTrigger value="api" className="gap-2 cursor-pointer">
              <KeyRound className="size-4" /> API keys
            </TabsTrigger>
          </TabsList>

          {/* ---------------------------------------------------------- */}
          {/* OVERVIEW                                                    */}
          {/* ---------------------------------------------------------- */}
          <TabsContent value="overview" className="mt-6 space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Scans total"
                value={String(stats.total)}
                hint="All time on this account"
                icon={<ScanSearch className="size-4" />}
              />
              <StatCard
                label="Flagged as fake"
                value={String(stats.flagged)}
                hint="AI-generated or deepfake"
                icon={<AlertTriangle className="size-4" />}
                tone="var(--verdict-fake)"
              />
              <StatCard
                label="Judged real"
                value={String(stats.real)}
                hint="Passed every check"
                icon={<CheckCircle2 className="size-4" />}
                tone="var(--verdict-real)"
              />
              <StatCard
                label="Avg confidence"
                value={`${stats.avg}%`}
                hint="Across stored results"
                icon={<Gauge className="size-4" />}
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card className="paper-grain border-border/70 shadow-none lg:col-span-3">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-lg">
                    Scan activity
                  </CardTitle>
                  <CardDescription>
                    Scans completed over the last 14 days.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[230px] pt-2">
                  {rows.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      No scans yet — run your first one.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={byDay}
                        margin={{ top: 6, right: 8, bottom: 0, left: -18 }}
                      >
                        <CartesianGrid
                          stroke="var(--border)"
                          strokeDasharray="3 4"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="day"
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          axisLine={{ stroke: "var(--border)" }}
                          tickLine={false}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          allowDecimals={false}
                          tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip {...chartTooltip} cursor={{ stroke: "var(--primary)" }} />
                        <Line
                          type="monotone"
                          dataKey="count"
                          name="Scans"
                          stroke="var(--primary)"
                          strokeWidth={2}
                          dot={{ r: 2.5, fill: "var(--primary)" }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>

              <Card className="paper-grain border-border/70 shadow-none lg:col-span-2">
                <CardHeader className="pb-2">
                  <CardTitle className="font-display text-lg">
                    Verdict mix
                  </CardTitle>
                  <CardDescription>
                    How your results were called.
                  </CardDescription>
                </CardHeader>
                <CardContent className="h-[230px] pt-2">
                  {mix.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Nothing to chart yet.
                    </div>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={mix}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={78}
                          paddingAngle={2}
                          stroke="var(--card)"
                        >
                          {mix.map((entry) => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip {...chartTooltip} />
                        <Legend
                          wrapperStyle={{ fontSize: "11px", color: "var(--muted-foreground)" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-lg">
                  Today&apos;s usage
                </CardTitle>
                <CardDescription>
                  {quota
                    ? `${quota.used} of ${quota.limit} scans used on the ${quota.plan} plan — resets at midnight.`
                    : "Loading quota…"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Progress value={usedPct} className="h-2" />
                <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  {usedPct}% used
                  {quota && quota.used >= quota.limit
                    ? " · limit reached — upgrade or come back tomorrow"
                    : ""}
                </p>
                {quota && quota.used >= quota.limit ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="cursor-pointer gap-2"
                    onClick={() => setTab("account")}
                  >
                    Change plan
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            <Disclaimer />
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          {/* HISTORY                                                     */}
          {/* ---------------------------------------------------------- */}
          <TabsContent value="history" className="mt-6 space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by file name…"
                  className="pl-9"
                  aria-label="Search scans"
                />
              </div>
              <Select
                value={verdictFilter}
                onValueChange={(v) => {
                  setVerdictFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-44" aria-label="Filter by verdict">
                  <SelectValue placeholder="Verdict" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All verdicts</SelectItem>
                  <SelectItem value="real">Real</SelectItem>
                  <SelectItem value="inconclusive">Inconclusive</SelectItem>
                  <SelectItem value="likely_ai">Likely AI</SelectItem>
                  <SelectItem value="likely_deepfake">Likely deepfake</SelectItem>
                  <SelectItem value="error">Failed</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-36" aria-label="Filter by type">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="image">Images</SelectItem>
                  <SelectItem value="video">Videos</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sort}
                onValueChange={(v) =>
                  setSort(v as "newest" | "oldest" | "confidence" | "name")
                }
              >
                <SelectTrigger className="w-full sm:w-40" aria-label="Sort scans">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest first</SelectItem>
                  <SelectItem value="oldest">Oldest first</SelectItem>
                  <SelectItem value="confidence">Confidence ↓</SelectItem>
                  <SelectItem value="name">File name A–Z</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {selected.size > 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/50 px-4 py-2">
                <p className="text-sm">
                  {selected.size} selected
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="cursor-pointer"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        className="cursor-pointer gap-2"
                      >
                        <Trash2 className="size-4" /> Delete selected
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete {selected.size} scan
                          {selected.size > 1 ? "s" : ""}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the stored previews, heatmaps and full
                          results. It cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel className="cursor-pointer">
                          Cancel
                        </AlertDialogCancel>
                        <AlertDialogAction
                          className="cursor-pointer"
                          onClick={handleBulkDelete}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            ) : null}

            <Card className="paper-grain border-border/70 shadow-none">
              <CardContent className="p-0">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
                    <ScanSearch className="size-8 text-muted-foreground" />
                    <p className="text-sm font-medium">
                      {rows.length === 0
                        ? "You have not run a scan yet."
                        : "No scans match these filters."}
                    </p>
                    {rows.length === 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        className="cursor-pointer gap-2"
                        onClick={() => navigate("/analyze")}
                      >
                        <ScanSearch className="size-4" /> Run your first scan
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="cursor-pointer"
                        onClick={() => {
                          setSearch("");
                          setVerdictFilter("all");
                          setTypeFilter("all");
                        }}
                      >
                        Clear filters
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">
                            <Checkbox
                              checked={
                                pageRows.length > 0 &&
                                pageRows.every((r) => selected.has(r._id as string))
                              }
                              onCheckedChange={toggleAllOnPage}
                              aria-label="Select all on this page"
                            />
                          </TableHead>
                          <TableHead>File</TableHead>
                          <TableHead>Verdict</TableHead>
                          <TableHead className="text-right">Confidence</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Run</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageRows.map((row) => (
                          <TableRow key={row._id}>
                            <TableCell>
                              <Checkbox
                                checked={selected.has(row._id as string)}
                                onCheckedChange={() => toggleRow(row._id as string)}
                                aria-label={`Select ${row.fileName}`}
                              />
                            </TableCell>
                            <TableCell className="max-w-[220px]">
                              <span className="block truncate font-medium">
                                {row.fileName}
                              </span>
                              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                                {row.source === "url"
                                  ? "from link"
                                  : row.source === "sample"
                                    ? "sample"
                                    : row.fileSize
                                      ? formatBytes(row.fileSize)
                                      : "upload"}
                                {row.isPublic ? " · public" : ""}
                              </span>
                            </TableCell>
                            <TableCell>
                              <VerdictBadge verdict={displayVerdict(row.verdict)} />
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {row.confidence != null
                                ? `${Math.round(row.confidence * 100)}%`
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-mono text-[10px] uppercase">
                                {row.type}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {timeAgo(row.createdAt)}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 cursor-pointer"
                                  title={row.pinned ? "Unpin (allow media expiry)" : "Pin (keep media past 24 h)"}
                                  onClick={() => handlePin(row)}
                                >
                                  {row.pinned ? (
                                    <Pin className="size-4 text-primary" />
                                  ) : (
                                    <PinOff className="size-4" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 cursor-pointer"
                                  title={row.isPublic ? "Make private" : "Make public"}
                                  onClick={() => handleVisibility(row)}
                                >
                                  {row.isPublic ? (
                                    <ExternalLink className="size-4" />
                                  ) : (
                                    <UserRound className="size-4" />
                                  )}
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  className="size-8 cursor-pointer"
                                  title="Open result"
                                  asChild
                                >
                                  <Link to={`/results/${row._id}`}>
                                    <Search className="size-4" />
                                  </Link>
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button
                                      type="button"
                                      size="icon"
                                      variant="ghost"
                                      className="size-8 cursor-pointer text-destructive"
                                      title="Delete scan"
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>
                                        Delete “{row.fileName}”?
                                      </AlertDialogTitle>
                                      <AlertDialogDescription>
                                        The stored preview and evidence for this
                                        scan will be removed. This cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel className="cursor-pointer">
                                        Cancel
                                      </AlertDialogCancel>
                                      <AlertDialogAction
                                        className="cursor-pointer"
                                        onClick={() => handleDelete(row._id as string)}
                                      >
                                        Delete
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            {filtered.length > PER_PAGE ? (
              <div className="flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                  Page {safePage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="cursor-pointer"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="cursor-pointer"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          {/* ACCOUNT                                                     */}
          {/* ---------------------------------------------------------- */}
          <TabsContent value="account" className="mt-6 space-y-6">
            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">Profile</CardTitle>
                <CardDescription>
                  {profile?.email || user?.email || "Signed in"}
                  {profile?.role === "admin" ? " · admin" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="profile-name">Display name</Label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      id="profile-name"
                      value={nameDraft ?? profile?.name ?? ""}
                      onChange={(e) => setNameDraft(e.target.value)}
                      placeholder="Your name"
                    />
                    <Button
                      type="button"
                      className="cursor-pointer sm:w-32"
                      disabled={nameDraft === null}
                      onClick={handleSaveProfile}
                    >
                      Save
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Member since {profile ? formatDate(profile.createdAt) : "—"}
                </p>
              </CardContent>
            </Card>

            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">Plan</CardTitle>
                <CardDescription>
                  Test mode — switching is instant and no card is charged.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-3">
                {(["free", "pro", "team"] as const).map((p) => (
                  <div
                    key={p}
                    className={`rounded-lg border p-4 transition-colors ${
                      plan === p
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-display text-base font-semibold capitalize">
                        {p}
                      </p>
                      {plan === p ? (
                        <Badge className="font-mono text-[10px] uppercase">Current</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 font-mono text-sm text-muted-foreground">
                      {PLAN_LIMITS[p]}/day
                    </p>
                    <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                      {p === "free" ? (
                        <>
                          <li>· Images and videos</li>
                          <li>· 25 scans per day</li>
                          <li>· Results kept 24 h</li>
                        </>
                      ) : p === "pro" ? (
                        <>
                          <li>· 500 scans per day</li>
                          <li>· Priority queue</li>
                          <li>· API access</li>
                        </>
                      ) : (
                        <>
                          <li>· 2,000 scans per day</li>
                          <li>· Team usage</li>
                          <li>· API access</li>
                        </>
                      )}
                    </ul>
                    <Button
                      type="button"
                      size="sm"
                      variant={plan === p ? "outline" : "default"}
                      className="mt-4 w-full cursor-pointer"
                      disabled={plan === p}
                      onClick={async () => {
                        try {
                          await setPlan({ plan: p });
                          toast.success(`Switched to the ${p} plan.`);
                        } catch (err) {
                          toast.error(
                            err instanceof Error ? err.message : "Could not change plan.",
                          );
                        }
                      }}
                    >
                      {plan === p ? "Active" : `Switch to ${p}`}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">Your data</CardTitle>
                <CardDescription>
                  Download everything this account has stored, or delete it
                  permanently.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="cursor-pointer gap-2"
                  onClick={handleExport}
                >
                  <Download className="size-4" /> Export my data (JSON)
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="destructive"
                      className="cursor-pointer gap-2"
                    >
                      <Trash2 className="size-4" /> Delete account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete your account?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Every scan, stored preview, feedback entry and API key
                        belonging to this account will be permanently removed.
                        This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel className="cursor-pointer">
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        className="cursor-pointer"
                        onClick={handleDeleteAccount}
                      >
                        Delete everything
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------------------------------------------------- */}
          {/* API KEYS                                                    */}
          {/* ---------------------------------------------------------- */}
          <TabsContent value="api" className="mt-6 space-y-6">
            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">Create a key</CardTitle>
                <CardDescription>
                  Keys authenticate REST calls to the scan API. The secret is
                  shown once, right after creation.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Key name — e.g. newsroom-bot"
                  aria-label="API key name"
                />
                <Button
                  type="button"
                  className="cursor-pointer gap-2 sm:w-40"
                  onClick={handleCreateKey}
                  disabled={keys !== undefined && keys.length >= 20}
                >
                  <Plus className="size-4" /> Create key
                </Button>
              </CardContent>
            </Card>

            <Card className="paper-grain border-border/70 shadow-none">
              <CardHeader>
                <CardTitle className="font-display text-lg">Active keys</CardTitle>
                <CardDescription>
                  Rate limit: 30 requests per minute per key.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                {!keys ? null : keys.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
                    <KeyRound className="size-8 text-muted-foreground" />
                    <p className="text-sm">No API keys yet.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Key</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Last used</TableHead>
                          <TableHead className="text-right">Requests</TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {keys.map((k) => (
                          <TableRow key={k._id}>
                            <TableCell className="font-medium">{k.name}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {k.prefix}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {formatDate(k.createdAt)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {k.lastUsedAt ? timeAgo(k.lastUsedAt) : "never"}
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums">
                              {k.requestCount}
                            </TableCell>
                            <TableCell className="text-right">
                              {k.revokedAt ? (
                                <Badge
                                  variant="outline"
                                  className="font-mono text-[10px] uppercase text-muted-foreground"
                                >
                                  Revoked
                                </Badge>
                              ) : (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="cursor-pointer text-destructive"
                                  onClick={() => handleRevokeKey(k._id as string)}
                                >
                                  Revoke
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>

      {/* One-time secret dialog */}
      <AlertDialog open={newSecret !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <KeyRound className="size-5 text-primary" /> Copy your API key now
            </AlertDialogTitle>
            <AlertDialogDescription>
              This secret is displayed only once. Store it somewhere safe — if
              you lose it, revoke the key and create a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/60 p-3">
            <code className="flex-1 font-mono text-xs break-all">
              {newSecret ?? ""}
            </code>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0 cursor-pointer"
              onClick={copySecret}
              title="Copy key"
            >
              {copied ? (
                <CheckCircle2 className="size-4 text-primary" />
              ) : (
                <Copy className="size-4" />
              )}
            </Button>
          </div>
          <AlertDialogFooter>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={() => setNewSecret(null)}
            >
              I have saved it
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Footer />
    </div>
  );
}
