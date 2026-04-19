chrome.runtime.onInstalled.addListener(() => {
  // DSA timer defaults
  chrome.storage.local.set({
    dsa_isRunning: false, dsa_currentPhaseId: -1, dsa_endTime: 0
  });
  // Pomodoro timer defaults
  chrome.storage.local.set({
    pomo_isRunning: false, pomo_mode: "work", pomo_endTime: 0, pomo_completedPomodoros: 0
  });
  // Sync status defaults
  chrome.storage.local.set({
    lastSyncStatus: null,  // "success" | "error" | null
    lastSyncTime: null,
    lastSyncProblem: null,
    lastSyncError: null,
    syncHistory: [],
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "dsaPhaseTimer") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      title: "⏳ DSA Phase Complete!",
      message: "Time is up! Open the extension to start the next phase.",
      priority: 2,
      requireInteraction: true
    });
    chrome.storage.local.set({ dsa_isRunning: false, dsa_endTime: 0 });
  }

  if (alarm.name === "pomoTimer") {
    chrome.storage.local.get(["pomo_mode", "pomo_completedPomodoros"], (data) => {
      const mode = data.pomo_mode || "work";
      const count = data.pomo_completedPomodoros || 0;
      const isWork = mode === "work";

      chrome.notifications.create({
        type: "basic",
        iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
        title: isWork ? "🍅 Pomodoro Complete!" : "☕ Break Over!",
        message: isWork ? "Great work! Time for a break." : "Break is over. Ready to focus?",
        priority: 2,
        requireInteraction: true
      });

      if (isWork) {
        const newCount = count + 1;
        const nextMode = newCount % 4 === 0 ? "longBreak" : "shortBreak";
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0,
          pomo_mode: nextMode, pomo_completedPomodoros: newCount
        });
      } else {
        chrome.storage.local.set({
          pomo_isRunning: false, pomo_endTime: 0, pomo_mode: "work"
        });
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// LeetHub Auto-Sync: GitHub commit logic
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map LeetCode language names → file extensions.
 */
const LANG_EXT_MAP = {
  python:      ".py",
  python3:     ".py",
  javascript:  ".js",
  typescript:  ".ts",
  java:        ".java",
  "c++":       ".cpp",
  cpp:         ".cpp",
  c:           ".c",
  go:          ".go",
  rust:        ".rs",
  ruby:        ".rb",
  swift:       ".swift",
  kotlin:      ".kt",
  scala:       ".scala",
  php:         ".php",
  dart:        ".dart",
  racket:      ".rkt",
  elixir:      ".ex",
  csharp:      ".cs",
  "c#":        ".cs",
};

/**
 * Resolve a language string to its file extension.
 */
function getExtension(language) {
  const key = (language || "").toLowerCase().trim();
  return LANG_EXT_MAP[key] || ".txt";
}

/**
 * Show a Chrome desktop notification.
 */
function notify(title, message) {
  chrome.notifications.create({
    type:    "basic",
    iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    title,
    message,
    priority: 2,
  });
}

/**
 * Store the latest sync result in chrome.storage.local so the popup can display it.
 */
async function storeSyncResult(status, problem, errorMsg) {
  const now = Date.now();
  const entry = { status, problem, time: now, error: errorMsg || null };

  // Update current status
  await chrome.storage.local.set({
    lastSyncStatus: status,
    lastSyncTime: now,
    lastSyncProblem: problem || null,
    lastSyncError: errorMsg || null,
  });

  // Append to history (keep last 20)
  const { syncHistory = [] } = await chrome.storage.local.get("syncHistory");
  const updated = [entry, ...syncHistory].slice(0, 20);
  await chrome.storage.local.set({ syncHistory: updated });
}

/**
 * Fetch the existing file SHA from GitHub (needed for updates).
 * Returns the sha string, or null if the file doesn't exist yet.
 */
async function getExistingFileSha(repo, path, token) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept:        "application/vnd.github.v3+json",
    },
  });

  if (res.status === 200) {
    const data = await res.json();
    return data.sha;
  }
  // 404 means file doesn't exist yet — that's fine
  return null;
}

/**
 * Create or update a file on GitHub via the Contents API.
 * @param {string} repo       — "owner/repo"
 * @param {string} path       — file path inside the repo
 * @param {string} content    — raw file content (will be Base64-encoded)
 * @param {string} token      — GitHub PAT
 * @param {string} commitMessage
 * @param {string|null} sha   — existing file sha (pass null for new files)
 */
async function commitToGitHub(repo, path, content, token, commitMessage, sha) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

  const body = {
    message: commitMessage,
    content: btoa(unescape(encodeURIComponent(content))),  // UTF-8 safe Base64
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await fetch(url, {
    method:  "PUT",
    headers: {
      Authorization:  `Bearer ${token}`,
      Accept:         "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return { status: res.status, data: await res.json() };
}

/**
 * Main handler: receives the accepted-solution payload from the content script,
 * reads credentials from storage, and pushes to GitHub.
 */
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "MANUAL_SYNC") {
    // Forward manual sync to every matching LeetCode tab's content script
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: "https://leetcode.com/problems/*" });
        if (tabs.length === 0) {
          await storeSyncResult("error", null, "No LeetCode problem tab found. Open a problem page first.");
          sendResponse({ success: false, reason: "no_tab", message: "No LeetCode problem tab found." });
          return;
        }

        // Send to the active/first LeetCode tab
        const tab = tabs[0];
        chrome.tabs.sendMessage(tab.id, { type: "MANUAL_SYNC" }, (response) => {
          if (chrome.runtime.lastError) {
            storeSyncResult("error", null, "Could not reach LeetCode page. Try refreshing the page.");
            sendResponse({ success: false, reason: "tab_error", message: chrome.runtime.lastError.message });
            return;
          }
          sendResponse(response);
        });
      } catch (err) {
        await storeSyncResult("error", null, err.message);
        sendResponse({ success: false, reason: "error", message: err.message });
      }
    })();
    return true;
  }

  if (message.type !== "LEETCODE_ACCEPTED") return;

  (async () => {
    try {
      // 1. Read credentials
      const { ghToken, ghRepo } = await chrome.storage.local.get(["ghToken", "ghRepo"]);

      if (!ghToken || !ghRepo) {
        console.warn("[DSA Timebox] GitHub credentials not configured. Skipping sync.");
        notify("⚠️ GitHub Sync Skipped", "Set your GitHub token & repo in the extension settings.");
        await storeSyncResult("error", message.title, "GitHub credentials not configured.");
        sendResponse({ success: false, reason: "missing_credentials" });
        return;
      }

      // 2. Build file path
      const ext  = getExtension(message.language);
      const path = `${message.slug}/solution${ext}`;

      // 3. Check if file already exists to craft the right commit message
      const existingSha = await getExistingFileSha(ghRepo, path, ghToken);
      const commitMsg = existingSha
        ? `Update: ${message.title} (${message.language})`
        : `Add: ${message.title} (${message.language})`;

      // 4. Push to GitHub
      const { status, data } = await commitToGitHub(
        ghRepo, path, message.code, ghToken, commitMsg, existingSha
      );

      // 5. Handle response
      if (status === 200 || status === 201) {
        console.log("[DSA Timebox] ✅ Committed →", path);
        notify("✅ Solution Synced!", `${message.title} pushed to ${ghRepo}/${path}`);
        await storeSyncResult("success", message.title, null);
        sendResponse({ success: true });
      } else if (status === 401) {
        console.error("[DSA Timebox] ❌ 401 Unauthorized");
        notify("❌ GitHub Auth Failed", "Your token is invalid or expired. Update it in settings.");
        await storeSyncResult("error", message.title, "Token invalid or expired (401).");
        sendResponse({ success: false, reason: "unauthorized" });
      } else if (status === 404) {
        console.error("[DSA Timebox] ❌ 404 Repo Not Found");
        notify("❌ Repo Not Found", `Could not find repository "${ghRepo}". Check the name in settings.`);
        await storeSyncResult("error", message.title, `Repository "${ghRepo}" not found (404).`);
        sendResponse({ success: false, reason: "repo_not_found" });
      } else if (status === 422) {
        console.error("[DSA Timebox] ❌ 422 Unprocessable Entity", data);
        notify("❌ GitHub Sync Error", data.message || "Unprocessable entity — the file may be in conflict.");
        await storeSyncResult("error", message.title, data.message || "Unprocessable entity (422).");
        sendResponse({ success: false, reason: "unprocessable" });
      } else {
        console.error("[DSA Timebox] ❌ Unexpected status:", status, data);
        notify("❌ GitHub Sync Failed", `Unexpected error (HTTP ${status}). Check the console.`);
        await storeSyncResult("error", message.title, `Unexpected error (HTTP ${status}).`);
        sendResponse({ success: false, reason: "unknown", status });
      }
    } catch (err) {
      console.error("[DSA Timebox] ❌ Network/runtime error:", err);
      notify("❌ Sync Error", `Could not reach GitHub: ${err.message}`);
      await storeSyncResult("error", message.title, `Network error: ${err.message}`);
      sendResponse({ success: false, reason: "network_error", error: err.message });
    }
  })();

  // Return true to keep the message channel open for async sendResponse
  return true;
});