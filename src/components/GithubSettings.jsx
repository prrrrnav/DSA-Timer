import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  GitFork,
  Save,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  ExternalLink,
  Unlink2,
  Link2,
  RefreshCw,
  Clock,
  XCircle,
  Loader2,
  History,
} from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return "Never";
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function GithubSettings() {
  const [token, setToken] = useState("");
  const [repo, setRepo] = useState("");
  const [saved, setSaved] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState("");

  // ─── Sync status state ──────────────────────────────────────────────────────
  const [syncStatus, setSyncStatus] = useState(null);      // "success" | "error" | null
  const [syncTime, setSyncTime] = useState(null);
  const [syncProblem, setSyncProblem] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncFeedback, setSyncFeedback] = useState(null);   // { type, message }
  const [syncHistory, setSyncHistory] = useState([]);

  // ─── Load saved values on mount ─────────────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      if (typeof chrome === "undefined" || !chrome.storage) return;
      const data = await chrome.storage.local.get([
        "ghToken", "ghRepo", "ghTokenDraft", "ghRepoDraft",
        "lastSyncStatus", "lastSyncTime", "lastSyncProblem", "lastSyncError",
        "syncHistory",
      ]);
      // Credentials
      if (data.ghToken) {
        setToken(data.ghToken);
        setIsConnected(true);
      } else if (data.ghTokenDraft) {
        setToken(data.ghTokenDraft);
      }
      if (data.ghRepo) {
        setRepo(data.ghRepo);
      } else if (data.ghRepoDraft) {
        setRepo(data.ghRepoDraft);
      }
      // Sync status
      setSyncStatus(data.lastSyncStatus || null);
      setSyncTime(data.lastSyncTime || null);
      setSyncProblem(data.lastSyncProblem || null);
      setSyncError(data.lastSyncError || null);
      setSyncHistory(data.syncHistory || []);
    };
    load();
  }, []);

  // ─── Listen for storage changes to update sync status in real-time ──────────
  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage) return;

    const listener = (changes, area) => {
      if (area !== "local") return;
      if (changes.lastSyncStatus) setSyncStatus(changes.lastSyncStatus.newValue);
      if (changes.lastSyncTime) setSyncTime(changes.lastSyncTime.newValue);
      if (changes.lastSyncProblem) setSyncProblem(changes.lastSyncProblem.newValue);
      if (changes.lastSyncError) setSyncError(changes.lastSyncError.newValue);
      if (changes.syncHistory) setSyncHistory(changes.syncHistory.newValue || []);
    };

    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  // ─── Persist draft values as the user types ─────────────────────────────────
  const updateToken = (value) => {
    setToken(value);
    setError("");
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ ghTokenDraft: value });
    }
  };

  const updateRepo = (value) => {
    setRepo(value);
    setError("");
    if (typeof chrome !== "undefined" && chrome.storage) {
      chrome.storage.local.set({ ghRepoDraft: value });
    }
  };

  const validateAndSave = async () => {
    setError("");
    setSaved(false);

    if (!token.trim() || !repo.trim()) {
      setError("Both fields are required.");
      return;
    }

    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo.trim())) {
      setError('Repo format must be "username/repo-name".');
      return;
    }

    setValidating(true);

    try {
      const res = await fetch(`https://api.github.com/repos/${repo.trim()}`, {
        headers: {
          Authorization: `Bearer ${token.trim()}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (res.status === 401) {
        setError("Invalid token — check your Personal Access Token.");
        setValidating(false);
        return;
      }
      if (res.status === 404) {
        setError("Repository not found — check the name or token permissions.");
        setValidating(false);
        return;
      }
      if (!res.ok) {
        setError(`GitHub API error (HTTP ${res.status}).`);
        setValidating(false);
        return;
      }

      if (typeof chrome !== "undefined" && chrome.storage) {
        await chrome.storage.local.set({
          ghToken: token.trim(),
          ghRepo: repo.trim(),
        });
        await chrome.storage.local.remove(["ghTokenDraft", "ghRepoDraft"]);
      }

      setIsConnected(true);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError("Network error — could not reach GitHub.");
    } finally {
      setValidating(false);
    }
  };

  const disconnect = async () => {
    if (typeof chrome !== "undefined" && chrome.storage) {
      await chrome.storage.local.remove(["ghToken", "ghRepo", "ghTokenDraft", "ghRepoDraft"]);
    }
    setToken("");
    setRepo("");
    setIsConnected(false);
    setSaved(false);
    setError("");
  };

  // ─── Manual Sync ────────────────────────────────────────────────────────────
  const triggerManualSync = useCallback(async () => {
    if (typeof chrome === "undefined" || !chrome.runtime) return;

    setSyncing(true);
    setSyncFeedback(null);

    try {
      const response = await chrome.runtime.sendMessage({ type: "MANUAL_SYNC" });

      if (response?.success === false) {
        const msg = response.message || response.reason || "Sync failed.";
        setSyncFeedback({ type: "error", message: msg });
      } else {
        setSyncFeedback({ type: "success", message: `Syncing "${response?.title || "solution"}" to GitHub...` });
      }
    } catch (err) {
      setSyncFeedback({ type: "error", message: err.message || "Could not trigger sync." });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncFeedback(null), 5000);
    }
  }, []);

  return (
    <div className="flex flex-col gap-3">
      {/* ── Header Card ── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <Card className="relative overflow-hidden rounded-2xl ring-0 border border-border">
          <CardContent className="pt-5 pb-4 px-5 flex flex-col items-center gap-3">
            {/* Status */}
            <div className="flex items-center gap-2">
              <GitFork className="w-5 h-5 text-foreground" />
              <Badge variant={isConnected ? "default" : "outline"}>
                {isConnected ? (
                  <span className="flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    Connected
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Unlink2 className="w-3 h-3" />
                    Not Connected
                  </span>
                )}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              Auto-sync your accepted LeetCode solutions to GitHub.
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── Last Sync Status Card ── */}
      {isConnected && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: "easeOut" }}
        >
          <Card className="rounded-2xl ring-0 border border-border">
            <CardContent className="pt-4 pb-4 px-4 flex flex-col gap-3">
              {/* Status header + manual sync */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5" />
                  Sync Status
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px] px-2.5 gap-1.5"
                  onClick={triggerManualSync}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  {syncing ? "Syncing..." : "Sync Now"}
                </Button>
              </div>

              {/* Current sync status display */}
              {syncStatus ? (
                <div
                  className={`flex items-start gap-2.5 p-3 rounded-xl text-xs ${
                    syncStatus === "success"
                      ? "bg-emerald-500/10 border border-emerald-500/20"
                      : "bg-destructive/10 border border-destructive/20"
                  }`}
                >
                  {syncStatus === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  )}
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span
                      className={`font-medium ${
                        syncStatus === "success" ? "text-emerald-400" : "text-destructive"
                      }`}
                    >
                      {syncStatus === "success" ? "Synced Successfully" : "Sync Failed"}
                    </span>
                    {syncProblem && (
                      <span className="text-muted-foreground truncate">
                        {syncProblem}
                      </span>
                    )}
                    {syncStatus === "error" && syncError && (
                      <span className="text-destructive/80 text-[11px]">
                        {syncError}
                      </span>
                    )}
                    {syncTime && (
                      <span className="text-muted-foreground/60 text-[10px] flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(syncTime)}
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 p-3 rounded-xl text-xs text-muted-foreground bg-muted/30 border border-border">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  No syncs yet. Solve a problem on LeetCode to trigger auto-sync, or click "Sync Now" while on a problem page.
                </div>
              )}

              {/* Manual sync feedback toast */}
              <AnimatePresence>
                {syncFeedback && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div
                      className={`flex items-start gap-2 p-2.5 text-xs font-medium rounded-lg ${
                        syncFeedback.type === "success"
                          ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
                          : "text-destructive bg-destructive/10 border border-destructive/20"
                      }`}
                    >
                      {syncFeedback.type === "success" ? (
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      )}
                      <p>{syncFeedback.message}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Recent sync history */}
              {syncHistory.length > 1 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                    Recent
                  </p>
                  <div className="flex flex-col gap-1 max-h-[100px] overflow-y-auto pr-1 custom-scrollbar">
                    {syncHistory.slice(1, 6).map((entry, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-[11px] text-muted-foreground py-1 px-2 rounded-lg bg-muted/20"
                      >
                        {entry.status === "success" ? (
                          <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="w-2.5 h-2.5 text-destructive shrink-0" />
                        )}
                        <span className="truncate flex-1">
                          {entry.problem || "Unknown"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/50 shrink-0">
                          {timeAgo(entry.time)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {/* ── Settings Form ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: "easeOut" }}
      >
        <Card className="rounded-2xl ring-0 border border-border">
          <CardContent className="pt-4 pb-4 px-4 flex flex-col gap-3">
            {/* Repository */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Repository
              </label>
              <Input
                type="text"
                placeholder="username/leetcode-solutions"
                value={repo}
                onChange={(e) => updateRepo(e.target.value)}
                className="h-9 text-sm rounded-lg"
              />
              <p className="text-[11px] text-muted-foreground">
                Verify your repo exists, then generate a token below.
              </p>
            </div>

            {/* Token */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Personal Access Token
              </label>
              <div className="relative">
                <Input
                  type={showToken ? "text" : "password"}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  value={token}
                  onChange={(e) => updateToken(e.target.value)}
                  className="h-9 text-sm rounded-lg pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showToken ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <a
                href="https://github.com/settings/tokens/new?scopes=repo&description=DSA+Timebox+Pro"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors w-fit"
              >
                Generate a token with <code className="text-[10px] bg-muted px-1 py-0.5 rounded">repo</code> scope
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-start gap-2 p-2.5 text-xs font-medium text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>{error}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Success */}
            <AnimatePresence>
              {saved && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="flex items-center gap-2 p-2.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <p>Connected & saved successfully!</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Buttons */}
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={validateAndSave}
                disabled={validating || !token.trim() || !repo.trim()}
              >
                {validating ? (
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Validating...
                  </span>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    Save & Connect
                  </>
                )}
              </Button>

              {isConnected && (
                <Button variant="outline" onClick={disconnect} className="px-3">
                  <Unlink2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* ── How It Works ── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
      >
        <Card className="rounded-2xl ring-0 border border-border">
          <CardContent className="pt-3 pb-3 px-4">
            <p className="text-[11px] font-medium text-muted-foreground mb-2">How it works</p>
            <div className="flex flex-col gap-1.5">
              {[
                "Solve a problem on LeetCode",
                'Get "Accepted" on submission',
                "Code auto-syncs to your GitHub repo",
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center justify-center w-4 h-4 rounded-full bg-muted text-[10px] font-bold text-foreground shrink-0">
                    {i + 1}
                  </span>
                  {step}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
