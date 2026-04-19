/**
 * content.js — LeetCode Content Script
 *
 * Injected on https://leetcode.com/problems/*
 * Watches for "Accepted" submission results, extracts the problem title,
 * submitted code, and language, then forwards to the background service worker.
 */

(() => {
  "use strict";

  // ─── Guard: only one instance per page ───────────────────────────────────────
  if (window.__dsaTimeboxContentLoaded) return;
  window.__dsaTimeboxContentLoaded = true;

  // ─── State ───────────────────────────────────────────────────────────────────
  let lastProcessedUrl = "";
  let debounceTimer = null;
  const DEBOUNCE_MS = 2000; // ignore duplicate "Accepted" within this window

  // ─── Utility: slugify a problem title for the file path ──────────────────────
  function slugify(text) {
    return text
      .trim()
      .replace(/^\d+\.\s*/, "")   // remove leading number e.g. "1. Two Sum" → "Two Sum"
      .replace(/[^a-zA-Z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // ─── Extract the problem title ───────────────────────────────────────────────
  function extractProblemTitle() {
    // Method 1: the <title> tag (format: "Two Sum - LeetCode")
    const titleTag = document.title || "";
    if (titleTag.includes("-")) {
      const cleaned = titleTag.split("-")[0].trim();
      if (cleaned.length > 0) return cleaned;
    }

    // Method 2: the heading element inside the problem description
    const heading = document.querySelector(
      '[data-cy="question-title"], h4[class*="title"], div[class*="title"]'
    );
    if (heading?.textContent?.trim()) return heading.textContent.trim();

    // Fallback
    return "Unknown-Problem";
  }

  // ─── Extract the selected programming language ───────────────────────────────
  function extractLanguage() {
    // Method 1: LeetCode shows language in the editor toolbar dropdown button
    const langBtn = document.querySelector(
      'button[class*="lang-btn"], div[class*="editor"] button[id*="lang"]'
    );
    if (langBtn?.textContent?.trim()) {
      return langBtn.textContent.trim().toLowerCase();
    }

    // Method 2: Look for the language label in the submission result area
    // e.g., "Code  |  Java" appears in the result details panel
    const allElements = document.querySelectorAll('div, span');
    for (const el of allElements) {
      const text = (el.textContent || "").trim();
      // Match patterns like "Code | Java" or just a standalone language name near the code
      if (/^Code\s*\|\s*(\w+)$/i.test(text)) {
        const match = text.match(/^Code\s*\|\s*(\w+)$/i);
        if (match) return match[1].toLowerCase();
      }
    }

    // Method 3: Broader fallback — any button/element whose text matches a known language
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
    // Strategy 1: CodeMirror 6 (current LeetCode editor)
    // CodeMirror renders lines as <div class="cm-line"> inside <div class="cm-content">
    const cmContent = document.querySelectorAll('.cm-content .cm-line');
    if (cmContent.length > 0) {
      return Array.from(cmContent)
        .map((line) => line.textContent)
        .join("\n");
    }

    // Strategy 2: Multiple CodeMirror editors may exist on the page
    // Get ALL cm-editor instances — the code editor is typically the largest one
    const cmEditors = document.querySelectorAll('.cm-editor');
    if (cmEditors.length > 0) {
      let bestCode = "";
      for (const editor of cmEditors) {
        const lines = editor.querySelectorAll('.cm-line');
        const code = Array.from(lines).map(l => l.textContent).join("\n");
        if (code.length > bestCode.length) bestCode = code;
      }
      if (bestCode.length > 0) return bestCode;
    }

    // Strategy 3: Monaco editor fallback (older LeetCode layout)
    const monacoLines = document.querySelectorAll(
      'div.view-lines[role="presentation"] .view-line'
    );
    if (monacoLines.length > 0) {
      return Array.from(monacoLines)
        .map((line) => line.textContent)
        .join("\n");
    }

    // Strategy 4: <textarea> or <pre> (very old layout)
    const textarea = document.querySelector(
      'textarea[class*="input"], pre[class*="code"]'
    );
    if (textarea?.textContent?.trim()) return textarea.textContent.trim();

    return null;
  }

  // ─── Detect "Accepted" result in the DOM ─────────────────────────────────────
  function isAcceptedVisible() {
    // LeetCode shows "Accepted" prominently after a successful submission.
    // We use multiple strategies for resilience against layout/class changes.

    // Method 1: data-e2e-locator attribute (stable selector)
    const resultEl = document.querySelector('span[data-e2e-locator="submission-result"]');
    if (resultEl && resultEl.textContent.trim().toLowerCase() === "accepted") {
      return true;
    }

    // Method 2: Look for success-themed result containers
    // LeetCode often uses class names containing "success" or "accepted"
    const successEls = document.querySelectorAll(
      '[class*="success"], [class*="accepted"], [class*="Accepted"], [class*="Success"]'
    );
    for (const el of successEls) {
      const text = el.textContent.trim().toLowerCase();
      if (text.includes("accepted")) return true;
    }

    // Method 3: result-status classes used by modern LeetCode
    const resultStatus = document.querySelectorAll(
      '[class*="result-status"], [class*="submission-result"], [data-cy*="result"]'
    );
    for (const el of resultStatus) {
      if (el.textContent.trim().toLowerCase().includes("accepted")) return true;
    }

    // Method 4: "Congratulations" banner that sometimes appears
    const allDivs = document.querySelectorAll('div, p');
    for (const el of allDivs) {
      const text = el.textContent.trim();
      if (/congratulations/i.test(text) && text.length < 200) return true;
    }

    // Method 5: Look for any element with green "Accepted" text
    // LeetCode often renders it as a <span> with green color
    const allSpans = document.querySelectorAll("span, div, p, h3, h4, h5");
    for (const span of allSpans) {
      const text = span.textContent.trim();
      if (text === "Accepted" || text === "accepted") {
        // Verify it's actually a result indicator (has green color or is near testcases info)
        const style = window.getComputedStyle(span);
        const color = style.color;
        // Green-ish color check (rgb values where green > red and green > blue)
        const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (match) {
          const [, r, g, b] = match.map(Number);
          if (g > r && g > b) return true;  // It's green text
        }
        // Also check if nearby text mentions "testcases passed"
        const parent = span.parentElement;
        if (parent && /testcases?\s*passed/i.test(parent.textContent)) {
          return true;
        }
        // Check broader parent context
        const grandparent = parent?.parentElement;
        if (grandparent && /testcases?\s*passed/i.test(grandparent.textContent)) {
          return true;
        }
        // Check if the element or its ancestors have a "success" class hint
        let ancestor = span;
        for (let i = 0; i < 5 && ancestor; i++) {
          if (ancestor.className && typeof ancestor.className === 'string') {
            if (/success|accepted|correct/i.test(ancestor.className)) return true;
          }
          ancestor = ancestor.parentElement;
        }
      }
    }

    // Method 6: Check for the runtime/memory result panels which only appear on accepted
    // LeetCode shows "Runtime" and "Memory" stats only on accepted submissions
    const runtimeEl = document.querySelector('[class*="runtime"], [class*="Runtime"]');
    const memoryEl = document.querySelector('[class*="memory"], [class*="Memory"]');
    if (runtimeEl && memoryEl) {
      // Both exist — check if the page also has "faster than" or "less than" text patterns
      const bodyText = document.body.textContent;
      if (/beats?\s+\d+.*%/i.test(bodyText) || /faster\s+than/i.test(bodyText)) {
        return true;
      }
    }

    return false;
  }

  // ─── Core handler: called when we believe a submission was accepted ──────────
  function handleAccepted() {
    const title = extractProblemTitle();
    const code = extractCode();
    const language = extractLanguage();

    if (!code) {
      console.warn("[DSA Timebox] Accepted detected but could not extract code.");
      return;
    }

    const payload = {
      type: "LEETCODE_ACCEPTED",
      title: title,
      slug: slugify(title),
      code: code,
      language: language,
    };

    console.log("[DSA Timebox] Sending accepted solution →", payload.slug, `(${language})`);
    chrome.runtime.sendMessage(payload);
  }

  // ─── Manual sync: triggered from the popup ──────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "MANUAL_SYNC") {
      console.log("[DSA Timebox] Manual sync requested");

      const title = extractProblemTitle();
      const code = extractCode();
      const language = extractLanguage();

      if (!code) {
        sendResponse({ success: false, reason: "no_code", message: "Could not extract code from this page. Make sure you're on a LeetCode problem page with code visible." });
        return true;
      }

      const payload = {
        type: "LEETCODE_ACCEPTED",
        title: title,
        slug: slugify(title),
        code: code,
        language: language,
        isManual: true,
      };

      console.log("[DSA Timebox] Manual sync →", payload.slug, `(${language})`);

      // Send to background and relay the result back
      chrome.runtime.sendMessage(payload, (bgResponse) => {
        sendResponse({ success: true, title, language, bgResponse });
      });

      return true; // keep channel open for async response
    }
  });

  // ─── MutationObserver: watch for DOM changes indicating "Accepted" ───────────
  function startObserver() {
    const observer = new MutationObserver(() => {
      if (!isAcceptedVisible()) return;

      // Debounce: don't fire for the same submission repeatedly
      const currentUrl = window.location.href;
      if (debounceTimer && currentUrl === lastProcessedUrl) return;

      lastProcessedUrl = currentUrl;
      clearTimeout(debounceTimer);

      // Small delay to let the full result panel render
      debounceTimer = setTimeout(() => {
        handleAccepted();
        // Reset after a cooldown so the user can re-submit
        setTimeout(() => {
          lastProcessedUrl = "";
          debounceTimer = null;
        }, 10_000);
      }, DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return observer;
  }

  // ─── SPA navigation handling ─────────────────────────────────────────────────
  // LeetCode uses client-side routing. The content script is injected once,
  // so we need to detect navigation between problems.
  let currentPath = window.location.pathname;

  function onUrlChange() {
    const newPath = window.location.pathname;
    if (newPath !== currentPath) {
      currentPath = newPath;
      lastProcessedUrl = "";
      debounceTimer = null;
      console.log("[DSA Timebox] SPA navigation detected →", newPath);
    }
  }

  // Intercept pushState / replaceState for SPA detection
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
  startObserver();
  console.log("[DSA Timebox] Content script loaded on", window.location.href);
})();
