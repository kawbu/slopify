// background.js — Service worker: context menu, backend API, overlay injection

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

  try {
    // Inject overlay content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content/overlay.js"],
    });

    // Send loading state
    await chrome.tabs.sendMessage(tab.id, {
      action: "slopify-loading",
      text: selectedText,
    });

    // Call backend API
    const result = await factCheckWithBackend(selectedText, tab.url);

    // Send results to overlay
    await chrome.tabs.sendMessage(tab.id, {
      action: "slopify-result",
      data: result,
      originalText: selectedText,
    });
  } catch (err) {
    console.error("[Slopify] Error:", err);
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "slopify-error",
        message: err.message,
      });
    } catch (e) {
      // Content script may not be ready
      console.error("[Slopify] Could not send error to tab:", e);
    }
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
