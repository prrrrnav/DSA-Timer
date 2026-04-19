/**
 * content.js — LeetCode Content Script
 *
 * Injected on https://leetcode.com/problems/*
 * Watches for "Accepted" submission results, extracts the problem title,
 * submitted code, and language, then forwards to the background service worker.
 * Injects a visual "D" sync-status badge next to the result panel.
 */

(() => {
  "use strict";

  // ─── Guard: only one instance per page ───────────────────────────────────────
  if (window.__dsaTimeboxContentLoaded) return;
  window.__dsaTimeboxContentLoaded = true;

  // ─── State ───────────────────────────────────────────────────────────────────
  let syncLock = false;
  let lastSyncedCode = "";

  // ─── Inject CSS for the sync badge ───────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById("dsa-timebox-styles")) return;
    const style = document.createElement("style");
    style.id = "dsa-timebox-styles";
    style.textContent = `
      @keyframes dsa-spin {
        from { transform: rotate(0deg); }
        to   { transform: rotate(360deg); }
      }
      @keyframes dsa-glow-pulse-syncing {
        0%, 100% { box-shadow: 0 0 10px 2px rgba(255, 255, 255, 0.5), 0 0 20px 4px rgba(255, 255, 255, 0.2); }
        50%      { box-shadow: 0 0 16px 6px rgba(255, 255, 255, 0.8), 0 0 35px 12px rgba(255, 255, 255, 0.3); }
      }
      @keyframes dsa-glow-pulse-success {
        0%, 100% { box-shadow: 0 0 8px 2px rgba(52, 211, 153, 0.5), 0 0 20px 4px rgba(52, 211, 153, 0.2); }
        50%      { box-shadow: 0 0 14px 4px rgba(52, 211, 153, 0.7), 0 0 30px 8px rgba(52, 211, 153, 0.3); }
      }
      @keyframes dsa-glow-pulse-error {
        0%, 100% { box-shadow: 0 0 8px 2px rgba(239, 68, 68, 0.5), 0 0 20px 4px rgba(239, 68, 68, 0.2); }
        50%      { box-shadow: 0 0 14px 4px rgba(239, 68, 68, 0.7), 0 0 30px 8px rgba(239, 68, 68, 0.3); }
      }
      @keyframes dsa-badge-enter {
        0%   { opacity: 0; transform: scale(0.3) rotate(-180deg); }
        60%  { transform: scale(1.1) rotate(10deg); }
        100% { opacity: 1; transform: scale(1) rotate(0deg); }
      }
      @keyframes dsa-tooltip-enter {
        0%   { opacity: 0; transform: translateX(-50%) translateY(4px); }
        100% { opacity: 1; transform: translateX(-50%) translateY(0); }
      }

      .dsa-sync-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
        font-size: 15px;
        font-weight: 800;
        letter-spacing: -0.5px;
        cursor: pointer;
        position: relative;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        animation: dsa-badge-enter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        vertical-align: middle;
        margin-left: 10px;
        user-select: none;
        flex-shrink: 0;
      }

      /* ── Syncing (spinning) ── */
      .dsa-sync-badge--syncing {
        background: linear-gradient(135deg, #1f2937, #374151); /* Deep dark background */
        color: #fff;
        animation: dsa-badge-enter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                   dsa-glow-pulse-syncing 2s ease-in-out infinite;
      }
      .dsa-sync-badge--syncing .dsa-sync-badge__letter {
        animation: dsa-spin 1s linear infinite;
        display: inline-block;
      }

      /* ── Success (green glow) ── */
      .dsa-sync-badge--success {
        background: linear-gradient(135deg, #059669, #10b981);
        color: #fff;
        animation: dsa-badge-enter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                   dsa-glow-pulse-success 2s ease-in-out infinite;
      }
      .dsa-sync-badge--success .dsa-sync-badge__letter {
        animation: none;
      }

      /* ── Error (red glow) ── */
      .dsa-sync-badge--error {
        background: linear-gradient(135deg, #dc2626, #ef4444);
        color: #fff;
        animation: dsa-badge-enter 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
                   dsa-glow-pulse-error 2s ease-in-out infinite;
      }
      .dsa-sync-badge--error .dsa-sync-badge__letter {
        animation: none;
      }

      /* ── Idle ── */
      .dsa-sync-badge--idle {
        background: linear-gradient(135deg, #374151, #4b5563);
        color: #9ca3af;
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      }

      /* ── Hover effect ── */
      .dsa-sync-badge:hover {
        transform: scale(1.12);
        filter: brightness(1.15);
      }

      /* ── Tooltip ── */
      .dsa-sync-badge__tooltip {
        position: absolute;
        bottom: calc(100% + 8px);
        left: 50%;
        transform: translateX(-50%);
        background: #1f2937;
        color: #e5e7eb;
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0;
        padding: 6px 10px;
        border-radius: 6px;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 99999;
        border: 1px solid rgba(255,255,255,0.08);
      }
      .dsa-sync-badge__tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 5px solid transparent;
        border-top-color: #1f2937;
      }
      .dsa-sync-badge:hover .dsa-sync-badge__tooltip {
        opacity: 1;
        animation: dsa-tooltip-enter 0.2s ease-out forwards;
      }

      /* ── Container to sit inline with result ── */
      .dsa-sync-container {
        display: inline-flex;
        align-items: center;
        gap: 0;
        vertical-align: middle;
      }
    `;
    document.head.appendChild(style);
  }

  // ─── Create or update the sync badge ─────────────────────────────────────────
  let badgeEl = null;
  let tooltipEl = null;
  let letterEl = null;

  function createBadge() {
    if (badgeEl && document.body.contains(badgeEl)) return badgeEl;

    const container = document.createElement("span");
    container.className = "dsa-sync-container";
    container.id = "dsa-timebox-sync-container";

    badgeEl = document.createElement("span");
    badgeEl.className = "dsa-sync-badge dsa-sync-badge--idle";
    badgeEl.id = "dsa-timebox-sync-badge";

    letterEl = document.createElement("span");
    letterEl.className = "dsa-sync-badge__letter";
    letterEl.textContent = "D";

    tooltipEl = document.createElement("span");
    tooltipEl.className = "dsa-sync-badge__tooltip";
    tooltipEl.textContent = "DSA Timebox — Click to sync";

    badgeEl.appendChild(letterEl);
    badgeEl.appendChild(tooltipEl);
    container.appendChild(badgeEl);

    // Click to trigger manual sync
    badgeEl.addEventListener("click", () => {
      triggerManualSync();
    });

    return container;
  }

  function setBadgeState(state, message) {
    if (!badgeEl) return;
    badgeEl.className = `dsa-sync-badge dsa-sync-badge--${state}`;
    if (tooltipEl) tooltipEl.textContent = message || "";
  }

  // ─── Inject badge next to the result/analysis area ───────────────────────────
  function injectBadgeIntoResult() {
    injectStyles();

    // Remove existing if orphaned
    const existing = document.getElementById("dsa-timebox-sync-container");
    if (existing) existing.remove();

    const container = createBadge();

    // Strategy 1: Find the submission result span (data-e2e-locator)
    const resultSpan = document.querySelector('span[data-e2e-locator="submission-result"]');
    if (resultSpan) {
      resultSpan.parentElement.insertBefore(container, resultSpan.nextSibling);
      return true;
    }

    // Strategy 2: Find elements with "Accepted" text that look like a result heading
    const allEls = document.querySelectorAll("span, div, h3, h4, h5, p");
    for (const el of allEls) {
      const text = el.textContent.trim();
      if (text === "Accepted" && el.childElementCount === 0) {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const [, r, g, b] = match.map(Number);
          if (g > r && g > b) {
            // Green "Accepted" text — inject right after it
            el.parentElement.style.display = "flex";
            el.parentElement.style.alignItems = "center";
            el.parentElement.style.flexWrap = "wrap";
            el.parentElement.style.gap = "0px";
            el.parentElement.insertBefore(container, el.nextSibling);
            return true;
          }
        }
        // Even without green check, if parent has "success" in class
        let ancestor = el;
        for (let i = 0; i < 5 && ancestor; i++) {
          if (ancestor.className && typeof ancestor.className === "string" &&
              /success|accepted|correct/i.test(ancestor.className)) {
            el.parentElement.insertBefore(container, el.nextSibling);
            return true;
          }
          ancestor = ancestor.parentElement;
        }
      }
    }

    // Strategy 3: Find results container by common class patterns
    const resultContainers = document.querySelectorAll(
      '[class*="result"], [class*="submission"], [class*="status"]'
    );
    for (const rc of resultContainers) {
      const text = rc.textContent.trim().toLowerCase();
      if (text.includes("accepted") && text.length < 300) {
        rc.style.display = "flex";
        rc.style.alignItems = "center";
        rc.style.gap = "0px";
        rc.appendChild(container);
        return true;
      }
    }

    // Strategy 4: Find "Runtime" or "Memory" stat areas (only on accepted)
    const runtimeHeader = Array.from(document.querySelectorAll("*")).find(
      (el) => el.childElementCount === 0 && /^runtime$/i.test(el.textContent.trim())
    );
    if (runtimeHeader) {
      // Go up to find a meaningful parent container and inject at the top
      let target = runtimeHeader;
      for (let i = 0; i < 5 && target.parentElement; i++) {
        target = target.parentElement;
        if (target.offsetHeight > 100) break;
      }
      target.insertBefore(container, target.firstChild);
      return true;
    }

    // Strategy 5: Fallback — inject floating badge at top-right of the result tab
    const tabContent = document.querySelector('[class*="tab-content"], [class*="result-container"]');
    if (tabContent) {
      container.style.position = "absolute";
      container.style.top = "12px";
      container.style.right = "12px";
      container.style.zIndex = "9999";
      tabContent.style.position = "relative";
      tabContent.appendChild(container);
      return true;
    }

    return false;
  }

  // ─── Utility: slugify a problem title for the file path ──────────────────────
  function slugify(text) {
    return text
      .trim()
      .replace(/^\d+\.\s*/, "")
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // ─── Extract the problem title ───────────────────────────────────────────────
  function extractProblemTitle() {
    const titleTag = document.title || "";
    if (titleTag.includes("-")) {
      const cleaned = titleTag.split("-")[0].trim();
      if (cleaned.length > 0) return cleaned;
    }
    const heading = document.querySelector(
      '[data-cy="question-title"], h4[class*="title"], div[class*="title"]'
    );
    if (heading?.textContent?.trim()) return heading.textContent.trim();
    return "Unknown-Problem";
  }

  // ─── Extract the selected programming language ───────────────────────────────
  function extractLanguage() {
    const langBtn = document.querySelector(
      'button[class*="lang-btn"], div[class*="editor"] button[id*="lang"]'
    );
    if (langBtn?.textContent?.trim()) {
      return langBtn.textContent.trim().toLowerCase();
    }

    const allElements = document.querySelectorAll("div, span");
    for (const el of allElements) {
      const text = (el.textContent || "").trim();
      if (/^Code\s*\|\s*(\w+)$/i.test(text)) {
        const match = text.match(/^Code\s*\|\s*(\w+)$/i);
        if (match) return match[1].toLowerCase();
      }
    }

    const candidates = document.querySelectorAll(
      'button, div[class*="select"], div[role="button"], span'
    );
    const knownLangs = [
      "python", "python3", "javascript", "typescript", "java",
      "c++", "c", "go", "rust", "ruby", "swift", "kotlin", "scala",
      "php", "dart", "racket", "elixir", "csharp", "c#",
    ];
    for (const el of candidates) {
      const txt = (el.textContent || "").trim().toLowerCase();
      if (knownLangs.includes(txt)) return txt;
    }

    return "unknown";
  }

  // ─── Extract the submitted code ──────────────────────────────────────────────
  function extractCode() {
    // Strategy 1: CodeMirror 6
    const cmContent = document.querySelectorAll(".cm-content .cm-line");
    if (cmContent.length > 0) {
      return Array.from(cmContent).map((line) => line.textContent).join("\n");
    }

    // Strategy 2: Multiple CodeMirror editors — pick the largest
    const cmEditors = document.querySelectorAll(".cm-editor");
    if (cmEditors.length > 0) {
      let bestCode = "";
      for (const editor of cmEditors) {
        const lines = editor.querySelectorAll(".cm-line");
        const code = Array.from(lines).map((l) => l.textContent).join("\n");
        if (code.length > bestCode.length) bestCode = code;
      }
      if (bestCode.length > 0) return bestCode;
    }

    // Strategy 3: Monaco editor
    const monacoLines = document.querySelectorAll(
      'div.view-lines[role="presentation"] .view-line'
    );
    if (monacoLines.length > 0) {
      return Array.from(monacoLines).map((line) => line.textContent).join("\n");
    }

    // Strategy 4: textarea / pre fallback
    const textarea = document.querySelector(
      'textarea[class*="input"], pre[class*="code"]'
    );
    if (textarea?.textContent?.trim()) return textarea.textContent.trim();

    return null;
  }

  // ─── Detect "Accepted" result in the DOM ─────────────────────────────────────
  function isAcceptedVisible() {
    // Method 1: data-e2e-locator attribute (stable)
    const resultEl = document.querySelector('span[data-e2e-locator="submission-result"]');
    if (resultEl && resultEl.textContent.trim().toLowerCase() === "accepted") return true;

    // Method 2: success/accepted class names
    const successEls = document.querySelectorAll(
      '[class*="success"], [class*="accepted"], [class*="Accepted"], [class*="Success"]'
    );
    for (const el of successEls) {
      if (el.textContent.trim().toLowerCase().includes("accepted")) return true;
    }

    // Method 3: result-status selectors
    const resultStatus = document.querySelectorAll(
      '[class*="result-status"], [class*="submission-result"], [data-cy*="result"]'
    );
    for (const el of resultStatus) {
      if (el.textContent.trim().toLowerCase().includes("accepted")) return true;
    }

    // Method 4: Green "Accepted" text anywhere
    const allSpans = document.querySelectorAll("span, div, p, h3, h4, h5");
    for (const span of allSpans) {
      const text = span.textContent.trim();
      if (text === "Accepted" || text === "accepted") {
        const style = window.getComputedStyle(span);
        const color = style.color;
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const [, r, g, b] = match.map(Number);
          if (g > r && g > b) return true;
        }
        const parent = span.parentElement;
        if (parent && /testcases?\s*passed/i.test(parent.textContent)) return true;
        const gp = parent?.parentElement;
        if (gp && /testcases?\s*passed/i.test(gp.textContent)) return true;
        // Walk ancestors for success class
        let ancestor = span;
        for (let i = 0; i < 5 && ancestor; i++) {
          if (ancestor.className && typeof ancestor.className === "string" &&
              /success|accepted|correct/i.test(ancestor.className)) return true;
          ancestor = ancestor.parentElement;
        }
      }
    }

    // Method 5: "Congratulations" banner
    const allDivs = document.querySelectorAll("div, p");
    for (const el of allDivs) {
      const text = el.textContent.trim();
      if (/congratulations/i.test(text) && text.length < 200) return true;
    }

    // Method 6: Runtime + Memory beats pattern (only on accepted)
    const bodyText = document.body.textContent;
    if (/beats?\s+\d+.*%/i.test(bodyText) && /runtime/i.test(bodyText) && /memory/i.test(bodyText)) {
      return true;
    }

    return false;
  }

  // ─── Handle submission logic ─────────────────────────────────────────────────
  function tryHandleAccepted() {
    const title = extractProblemTitle();
    const code = extractCode();
    const language = extractLanguage();

    if (!code) {
      console.warn("[DSA Timebox] Accepted detected but could not extract code.");
      return;
    }

    // Duplicate check: if exactly the same code was already synced, don't trigger again
    if (code === lastSyncedCode) {
      console.log("[DSA Timebox] Exact code was already synced, skipping.");
      return;
    }

    lastSyncedCode = code;

    // Inject the badge and set to "syncing"
    injectBadgeIntoResult();
    setBadgeState("syncing", "Syncing to GitHub…");

    const payload = {
      type: "LEETCODE_ACCEPTED",
      title: title,
      slug: slugify(title),
      code: code,
      language: language,
    };

    console.log("[DSA Timebox] Sending accepted solution →", payload.slug, `(${language})`);

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          console.error("[DSA Timebox] Message error:", chrome.runtime.lastError);
          setBadgeState("error", "Sync error — " + chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          setBadgeState("success", "✓ Synced to GitHub!");
          console.log("[DSA Timebox] ✅ Sync confirmed by background");
        } else {
          const reason = response?.reason || "unknown";
          setBadgeState("error", "Sync failed — " + reason);
          console.warn("[DSA Timebox] ❌ Sync failed:", reason);
        }
      });
    } catch (err) {
      setBadgeState("error", "Extension reloaded! Please refresh the page.");
    }
  }

  // ─── Manual sync via badge click ─────────────────────────────────────────────
  function triggerManualSync() {
    const title = extractProblemTitle();
    const code = extractCode();
    const language = extractLanguage();

    if (!code) {
      setBadgeState("error", "No code found on this page");
      setTimeout(() => setBadgeState("idle", "DSA Timebox — Click to sync"), 4000);
      return;
    }

    lastSyncedCode = code; // Update the cache so auto-sync ignores it if it fires right after
    setBadgeState("syncing", "Syncing to GitHub…");

    const payload = {
      type: "LEETCODE_ACCEPTED",
      title: title,
      slug: slugify(title),
      code: code,
      language: language,
      isManual: true,
    };

    console.log("[DSA Timebox] Manual sync →", payload.slug, `(${language})`);

    try {
      chrome.runtime.sendMessage(payload, (response) => {
        if (chrome.runtime.lastError) {
          setBadgeState("error", "Sync error — " + chrome.runtime.lastError.message);
          return;
        }
        if (response?.success) {
          setBadgeState("success", "✓ Synced to GitHub!");
        } else {
          setBadgeState("error", "Sync failed — " + (response?.reason || "unknown"));
        }
      });
    } catch (err) {
      setBadgeState("error", "Extension reloaded! Please refresh the page.");
    }
  }

  // ─── Manual sync: triggered from the popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "MANUAL_SYNC") {
      console.log("[DSA Timebox] Manual sync requested from popup");

      // Inject badge if not present
      injectStyles();
      injectBadgeIntoResult();

      const title = extractProblemTitle();
      const code = extractCode();
      const language = extractLanguage();

      if (!code) {
        setBadgeState("error", "No code found on this page");
        sendResponse({ success: false, reason: "no_code", message: "Could not extract code from this page." });
        return true;
      }

      lastSyncedCode = code; // Update the cache
      setBadgeState("syncing", "Syncing to GitHub…");

      const payload = {
        type: "LEETCODE_ACCEPTED",
        title: title,
        slug: slugify(title),
        code: code,
        language: language,
        isManual: true,
      };

      console.log("[DSA Timebox] Manual sync →", payload.slug, `(${language})`);

      try {
        chrome.runtime.sendMessage(payload, (bgResponse) => {
          if (chrome.runtime.lastError) {
            setBadgeState("error", "Sync error");
            sendResponse({ success: false, reason: "bg_error", message: chrome.runtime.lastError.message });
            return;
          }
          if (bgResponse?.success) {
            setBadgeState("success", "✓ Synced to GitHub!");
          } else {
            setBadgeState("error", "Sync failed — " + (bgResponse?.reason || "unknown"));
          }
          sendResponse({ success: true, title, language, bgResponse });
        });
      } catch (err) {
        setBadgeState("error", "Extension reloaded! Please refresh the page.");
        sendResponse({ success: false, reason: "context_invalidated", message: "Extension reloaded." });
      }

      return true; // keep channel open
    }
  });

  // ─── MutationObserver: watch for DOM changes indicating "Accepted" ───────────
  function startObserver() {
    const observer = new MutationObserver(() => {
      // If we are currently locked waiting for DOM to settle, ignore
      if (syncLock) return;

      if (!isAcceptedVisible()) return;

      // Lock it so we don't spam while waiting
      syncLock = true;

      // Wait 1.5 seconds for final DOM / Code to render then attempt sync
      setTimeout(() => {
        tryHandleAccepted();

        // Keep it locked for a few more seconds to absorb any late mutations
        setTimeout(() => {
          syncLock = false;
        }, 3000);
      }, 1500); 
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  // ─── SPA navigation handling ─────────────────────────────────────────────────
  let currentPath = window.location.pathname;

  function onUrlChange() {
    const newPath = window.location.pathname;
    if (newPath !== currentPath) {
      currentPath = newPath;
      lastSyncedCode = ""; // Reset code tracker for the new problem
      syncLock = false;
      
      // Remove old badge on navigation
      const old = document.getElementById("dsa-timebox-sync-container");
      if (old) old.remove();
      badgeEl = null;
      tooltipEl = null;
      letterEl = null;
      console.log("[DSA Timebox] SPA navigation detected →", newPath);
    }
  }

  const _pushState = history.pushState;
  history.pushState = function (...args) {
    _pushState.apply(this, args);
    onUrlChange();
  };

  const _replaceState = history.replaceState;
  history.replaceState = function (...args) {
    _replaceState.apply(this, args);
    onUrlChange();
  };

  window.addEventListener("popstate", onUrlChange);

  // ─── Boot ────────────────────────────────────────────────────────────────────
  injectStyles();
  startObserver();
  console.log("[DSA Timebox] Content script loaded on", window.location.href);
})();
