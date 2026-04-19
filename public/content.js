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
    // LeetCode renders the current language in a button inside the editor toolbar
    const langBtn = document.querySelector(
      'button[class*="lang-btn"], div[class*="editor"] button[id*="lang"]'
    );
    if (langBtn?.textContent?.trim()) {
      return langBtn.textContent.trim().toLowerCase();
    }

    // Broader fallback: any element whose text matches a known language near the editor
    const candidates = document.querySelectorAll(
      'button, div[class*="select"], div[role="button"]'
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

  // ─── Extract the submitted code from the Monaco editor ───────────────────────
  function extractCode() {
    // Monaco renders each line as a <div class="view-line"> inside the editor
    const lines = document.querySelectorAll(
      'div.view-lines[role="presentation"] .view-line'
    );
    if (lines.length > 0) {
      return Array.from(lines)
        .map((line) => line.textContent)
        .join("\n");
    }

    // Fallback: try a <textarea> or <pre> (older layout / code mirror)
    const textarea = document.querySelector(
      'textarea[class*="input"], pre[class*="code"]'
    );
    if (textarea?.textContent?.trim()) return textarea.textContent.trim();

    return null;
  }

  // ─── Detect "Accepted" result in the DOM ─────────────────────────────────────
  function isAcceptedVisible() {
    // LeetCode shows a result panel after submission. The key indicator is
    // a span/div containing the exact word "Accepted" (usually with a green color).
    const resultEls = document.querySelectorAll(
      'span[data-e2e-locator="submission-result"], ' +
      'span[class*="success"], ' +
      'div[class*="result"] span, ' +
      'div[class*="success"]'
    );

    for (const el of resultEls) {
      const text = (el.textContent || "").trim().toLowerCase();
      if (text === "accepted") return true;
    }

    // Broader text scan as a resilience layer
    const allSpans = document.querySelectorAll("span");
    for (const span of allSpans) {
      if (
        span.textContent.trim() === "Accepted" &&
        span.closest('[class*="result"], [class*="submission"], [id*="result"]')
      ) {
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

    console.log("[DSA Timebox] Sending accepted solution →", payload.slug);
    chrome.runtime.sendMessage(payload);
  }

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
