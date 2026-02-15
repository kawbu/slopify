const DEFAULT_AWS_BACKEND_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const DEFAULT_GEMINI_BACKEND_URL = "http://localhost:8000";
const ALT_GEMINI_BACKEND_URL = "http://localhost:8787";
const MAX_SNIPPET_CHARS = 1800;
const DEDUPE_WINDOW_MS = 15000;

function normalizeBaseUrl(url, fallback) {
    const value = String(url || fallback || "").trim();
    return value.endsWith("/") ? value.slice(0, -1) : value;
}

function normalizeSnippet(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length <= MAX_SNIPPET_CHARS) {
        return cleaned;
    }
    return cleaned.slice(0, MAX_SNIPPET_CHARS);
}

function dedupeKey(snippet, url, provider) {
    return `${provider}|${String(url || "")}|${snippet}`;
}

async function getBackendConfig() {
    const values = await chrome.storage.local.get([
        "backendProvider",
        "backendUrl",
        "awsBackendUrl",
        "geminiBackendUrl"
    ]);

    const provider = values.backendProvider === "gemini" ? "gemini" : "aws";
    const awsUrl = normalizeBaseUrl(values.awsBackendUrl || values.backendUrl, DEFAULT_AWS_BACKEND_URL);
    const geminiUrl = normalizeBaseUrl(values.geminiBackendUrl, DEFAULT_GEMINI_BACKEND_URL);
    const backendUrl = provider === "gemini" ? geminiUrl : awsUrl;

    return {
        provider,
        backendUrl
    };
}

async function openPopupSafely() {
    try {
        if (chrome.action?.openPopup) {
            await chrome.action.openPopup();
            return;
        }
    } catch {
        // Fallback below.
    }

    try {
        await chrome.windows.create({
            url: chrome.runtime.getURL("frontend/popup/popup.html"),
            type: "popup",
            width: 440,
            height: 900,
            focused: true
        });
    } catch {
        // Ignore if popup window cannot be created.
    }
}

async function analyzeSelection(selectedText, tab) {
    const snippet = normalizeSnippet(selectedText);
    if (!snippet) {
        throw new Error("No text selected. Highlight text first.");
    }

    const { provider, backendUrl } = await getBackendConfig();

    const key = dedupeKey(snippet, tab?.url || "", provider);
    const { lastRequestKey, lastRequestAt, lastAnalysis } = await chrome.storage.local.get([
        "lastRequestKey",
        "lastRequestAt",
        "lastAnalysis"
    ]);

    if (lastRequestKey === key && Number(lastRequestAt) && Date.now() - Number(lastRequestAt) < DEDUPE_WINDOW_MS && lastAnalysis) {
        return lastAnalysis;
    }

    const body =
        provider === "gemini"
            ? {
                  text: snippet,
                  url: tab?.url || null
              }
            : {
                  snippet,
                  source: "chrome-extension",
                  url: tab?.url || null,
                  user_context: {
                      trigger: "context-menu",
                      browserLocale: chrome.i18n.getUILanguage()
                  }
              };

    const candidateUrls =
        provider === "gemini"
            ? [backendUrl, backendUrl === DEFAULT_GEMINI_BACKEND_URL ? ALT_GEMINI_BACKEND_URL : DEFAULT_GEMINI_BACKEND_URL]
            : [backendUrl];

    let lastError = null;
    let payload = null;
    let activeResponse = null;

    for (const baseUrl of candidateUrls) {
        const target = normalizeBaseUrl(baseUrl, backendUrl);
        if (!target) {
            continue;
        }

        try {
            const response = await fetch(`${target}/verify`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });

            const parsed = await response.json().catch(() => ({}));
            if (!response.ok) {
                const detail = parsed?.detail || parsed?.error || parsed?.message;
                lastError = new Error(detail || `Request failed: HTTP ${response.status}`);
                continue;
            }

            payload = parsed;
            activeResponse = response;
            if (provider === "gemini" && target !== backendUrl) {
                await chrome.storage.local.set({ geminiBackendUrl: target });
            }
            break;
        } catch (error) {
            lastError = error;
        }
    }

    if (!activeResponse) {
        throw new Error(lastError?.message || "Gemini backend is unreachable.");
    }

    await chrome.storage.local.set({
        lastRequestKey: key,
        lastRequestAt: Date.now(),
        lastBackendProvider: provider
    });

    return payload;
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.contextMenus.create({
        id: "analyzeText",
        title: "Check Slopify",
        contexts: ["selection"]
    });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId !== "analyzeText") {
        return;
    }

    // Open popup while still in direct click handling context.
    await openPopupSafely();

    const selectedText = normalizeSnippet(info.selectionText || "");
    if (!selectedText) {
        await chrome.storage.local.set({
            lastAnalysisError: "No text selected. Highlight text first.",
            isAnalyzing: false,
            lastAnalysisAt: Date.now()
        });
        return;
    }

    await chrome.storage.local.set({
        isAnalyzing: true,
        lastAnalysisError: null,
        lastSelectionText: selectedText,
        lastPageUrl: tab?.url || null,
        lastAnalysisAt: Date.now()
    });

    try {
        const data = await analyzeSelection(selectedText, tab);
        await chrome.storage.local.set({
            lastAnalysis: data,
            lastSelectionText: selectedText,
            lastPageUrl: tab?.url || null,
            lastAnalysisError: null,
            isAnalyzing: false,
            lastAnalysisAt: Date.now()
        });
    } catch (error) {
        await chrome.storage.local.set({
            lastAnalysisError: error?.message || "Analysis failed",
            isAnalyzing: false,
            lastAnalysisAt: Date.now()
        });
    }
});
