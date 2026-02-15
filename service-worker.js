const DEFAULT_BACKEND_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const MAX_SNIPPET_CHARS = 1800;
const DEDUPE_WINDOW_MS = 15000;

function normalizeSnippet(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length <= MAX_SNIPPET_CHARS) {
        return cleaned;
    }
    return cleaned.slice(0, MAX_SNIPPET_CHARS);
}

function dedupeKey(snippet, url) {
    return `${String(url || "")}|${snippet}`;
}

async function getBackendUrl() {
    const { backendUrl } = await chrome.storage.local.get("backendUrl");
    return backendUrl || DEFAULT_BACKEND_URL;
}

async function analyzeSelection(selectedText, tab) {
    const snippet = normalizeSnippet(selectedText);
    if (!snippet) {
        throw new Error("No text selected. Highlight text first.");
    }

    const key = dedupeKey(snippet, tab?.url || "");
    const { lastRequestKey, lastRequestAt, lastAnalysis } = await chrome.storage.local.get([
        "lastRequestKey",
        "lastRequestAt",
        "lastAnalysis"
    ]);

    if (lastRequestKey === key && Number(lastRequestAt) && Date.now() - Number(lastRequestAt) < DEDUPE_WINDOW_MS && lastAnalysis) {
        return lastAnalysis;
    }

    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/verify`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            snippet,
            source: "chrome-extension",
            url: tab?.url || null,
            user_context: {
                trigger: "context-menu",
                browserLocale: chrome.i18n.getUILanguage()
            }
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error || `Request failed: HTTP ${response.status}`);
    }

    await chrome.storage.local.set({
        lastRequestKey: key,
        lastRequestAt: Date.now()
    });

    return payload;
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "analyzeText",
        title: "Analyze with Slopify",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "analyzeText") {
        return;
    }

    const selectedText = normalizeSnippet(info.selectionText || "");
    if (!selectedText) {
        await chrome.storage.local.set({
            lastAnalysisError: "No text selected. Highlight text first.",
            lastAnalysisAt: Date.now()
        });
        return;
    }

    try {
        const data = await analyzeSelection(selectedText, tab);
        await chrome.storage.local.set({
            lastAnalysis: data,
            lastSelectionText: selectedText,
            lastPageUrl: tab?.url || null,
            lastAnalysisError: null,
            lastAnalysisAt: Date.now()
        });
    } catch (error) {
        await chrome.storage.local.set({
            lastAnalysisError: error?.message || "Analysis failed",
            lastAnalysisAt: Date.now()
        });
    }
});
