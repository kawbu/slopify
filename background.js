// background.js — Service worker: context menu, backend API, storage

const DEFAULT_GEMINI_URL = "http://localhost:8000";
const ALT_GEMINI_URL = "http://localhost:8787";
const DEFAULT_LAMBDA_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const MAX_SELECTION_LENGTH = 5000;

function normalizeUrl(url, fallback) {
  const value = String(url || fallback || "").trim();
  if (!value) return String(fallback || "");
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildVerifyUrls(baseUrl, type) {
  const base = normalizeUrl(baseUrl, "");
  if (!base) return [];

  if (type === "lambda") {
    const urls = [];
    if (base.endsWith("/verify")) {
      urls.push(base);
    } else {
      urls.push(`${base}/verify`);
      if (!/\/prod$/i.test(base)) {
        urls.push(`${base}/prod/verify`);
      }
    }
    return Array.from(new Set(urls));
  }

  return [base.endsWith("/verify") ? base : `${base}/verify`];
}

async function getBackendConfig() {
  const values = await chrome.storage.local.get([
    "backendType",
    "backendProvider",
    "geminiBackendUrl",
    "awsBackendUrl",
    "backendUrl",
  ]);

  const provider = values.backendProvider === "aws" ? "lambda" : values.backendProvider;
  const type = values.backendType || provider || "gemini";
  const geminiUrl = normalizeUrl(values.geminiBackendUrl, DEFAULT_GEMINI_URL);
  const lambdaUrl = normalizeUrl(values.awsBackendUrl || values.backendUrl, DEFAULT_LAMBDA_URL);

  return {
    type,
    url: type === "lambda" ? lambdaUrl : geminiUrl,
    geminiUrl,
    lambdaUrl,
  };
}

// Register context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "slopify-factcheck",
    title: "Fact-check with Slopify",
    contexts: ["selection"],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "slopify-factcheck") return;
  if (!tab || !tab.id) return;

  if (
    tab.url &&
    (tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://"))
  ) {
    return;
  }

  let selectedText = info.selectionText || "";

  if (!selectedText.trim()) {
    try {
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection().toString(),
      });
      selectedText = result?.result || "";
    } catch (e) {
      console.error("[Slopify] Could not get selection:", e);
      return;
    }
  }

  if (!selectedText.trim()) return;

  if (selectedText.length > MAX_SELECTION_LENGTH) {
    selectedText = selectedText.substring(0, MAX_SELECTION_LENGTH);
  }

  const domain = tab.url ? new URL(tab.url).hostname : "unknown";

  try {
    await chrome.storage.local.set({
      slopifyState: {
        status: "loading",
        text: selectedText,
        domain: domain,
        timestamp: Date.now(),
      },
    });

    try {
      await chrome.action.openPopup();
    } catch (e) {
      console.warn("[Slopify] Could not auto-open popup:", e);
    }

    const result = await factCheckWithBackend(selectedText, tab.url);

    await chrome.storage.local.set({
      lastResult: {
        data: result,
        domain: domain,
        timestamp: Date.now(),
      },
      slopifyState: {
        status: "result",
        data: result,
        domain: domain,
        originalText: selectedText,
        timestamp: Date.now(),
      },
    });
  } catch (err) {
    console.error("[Slopify] Error:", err);
    await chrome.storage.local.set({
      slopifyState: {
        status: "error",
        message: err.message,
        domain: domain,
        timestamp: Date.now(),
      },
    });
  }
});

async function factCheckWithBackend(text, url) {
  const config = await getBackendConfig();
  const body =
    config.type === "lambda"
      ? {
          snippet: text,
          text,
          url,
          source: "chrome-extension",
          user_context: {
            trigger: "context-menu",
            browserLocale: chrome.i18n.getUILanguage(),
          },
        }
      : { text, url };

  const candidateBases =
    config.type === "gemini"
      ? [config.url, config.url === DEFAULT_GEMINI_URL ? ALT_GEMINI_URL : DEFAULT_GEMINI_URL]
      : [config.url];

  const candidateUrls = candidateBases
    .flatMap((base) => buildVerifyUrls(base, config.type));

  let response = null;
  let data = null;
  let lastError = null;

  for (const target of candidateUrls) {
    if (!target) continue;

    try {
      const res = await fetch(target, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const rawText = await res.text();
      const parsed = (() => {
        try {
          return rawText ? JSON.parse(rawText) : {};
        } catch {
          return {};
        }
      })();
      if (!res.ok) {
        const detail = parsed?.detail || parsed?.error || parsed?.message || rawText;
        lastError = new Error(detail || `Backend error (${res.status})`);
        continue;
      }

      response = res;
      data = parsed;

      if (config.type === "gemini") {
        const healthyBase = target.replace(/\/verify$/i, "");
        if (healthyBase && healthyBase !== config.url) {
          await chrome.storage.local.set({ geminiBackendUrl: healthyBase });
        }
      }
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!response) {
    throw new Error(lastError?.message || "Failed to contact backend.");
  }

  // Lambda wraps response in { ok, result }, normalize it
  if (config.type === "lambda" && data.result) {
    return normalizeLambdaResponse(data.result);
  }

  return data;
}

// Convert Lambda response format to the standard Slopify format
function normalizeLambdaResponse(result) {
  const labelToVerdict = {
    "Supported": "Accurate",
    "Refuted": "Inaccurate",
    "Misleading": "Mostly Inaccurate",
    "Unclear": "Unverifiable",
  };

  const confidenceRaw = Number(result.confidence);
  const confidence = Number.isFinite(confidenceRaw)
    ? Math.round((confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw))
    : 50;

  return {
    verdict: labelToVerdict[result.label] || "Unverifiable",
    confidence,
    claims: Array.isArray(result.claims)
      ? result.claims.map((c) => ({
          claim: typeof c === "string" ? c : c.claim || "",
          assessment: labelToVerdict[result.label] || "Unverifiable",
          explanation: result.reasoning || "",
        }))
      : [],
    red_flags: [],
    summary: result.reasoning || "No summary available.",
  };
}
