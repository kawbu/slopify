// background.js — Service worker: context menu, backend API, storage

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const MAX_SELECTION_LENGTH = 5000;

async function getBackendUrl() {
  const { backendUrl } = await chrome.storage.local.get("backendUrl");
  return backendUrl || DEFAULT_BACKEND_URL;
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

  // Get selected text — use info.selectionText, fall back to injecting a script
  // for cases where Chrome truncates long selections
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

  // Truncate if too long
  if (selectedText.length > MAX_SELECTION_LENGTH) {
    selectedText = selectedText.substring(0, MAX_SELECTION_LENGTH);
  }

  const domain = tab.url ? new URL(tab.url).hostname : "unknown";

  try {
    // Store loading state so the popup can show a spinner
    await chrome.storage.local.set({
      slopifyState: {
        status: "loading",
        text: selectedText,
        domain: domain,
        timestamp: Date.now(),
      },
    });

    // Open the extension popup
    try {
      await chrome.action.openPopup();
    } catch (e) {
      // openPopup may not be supported in all Chrome versions
      console.warn("[Slopify] Could not auto-open popup:", e);
    }

    // Call backend API
    const result = await factCheckWithBackend(selectedText, tab.url);

    // Store results so the popup can read them
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
  const backendUrl = await getBackendUrl();
  const response = await fetch(`${backendUrl}/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, url }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 502) {
      throw new Error("Backend could not parse AI response. Please try again.");
    }
    throw new Error(`Backend error (${response.status}): ${errorBody}`);
  }

  return response.json();
}
