// background.js — Service worker: context menu, backend API, storage

const DEFAULT_GEMINI_URL = "http://localhost:8000";
const DEFAULT_LAMBDA_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const MAX_SELECTION_LENGTH = 5000;

async function getBackendConfig() {
  const { backendType } = await chrome.storage.local.get(["backendType"]);
  const type = backendType || "gemini";
  return { type, url: type === "lambda" ? DEFAULT_LAMBDA_URL : DEFAULT_GEMINI_URL };
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
  let response;

  if (config.type === "lambda") {
    // AWS Lambda backend expects { snippet, source, url, user_context }
    try {
      response = await fetch(`${config.url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snippet: text,
          text,
          url,
          source: "chrome-extension",
        }),
      });
    } catch (error) {
      throw new Error(
        `Failed to fetch Lambda backend at ${config.url}/verify. Check API Gateway URL, deployment, and CORS.`
      );
    }
  } else {
    // Gemini backend expects { text, url }
    response = await fetch(`${config.url}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, url }),
    });
  }

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 502) {
      throw new Error("Backend could not parse AI response. Please try again.");
    }
    throw new Error(`Backend error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();

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
