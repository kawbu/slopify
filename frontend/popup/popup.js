const DEFAULT_BACKEND_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const MAX_SNIPPET_CHARS = 1800;
const REUSE_RESULT_WINDOW_MS = 120000;

function normalizeSnippet(text) {
    const cleaned = String(text || "").replace(/\s+/g, " ").trim();
    if (cleaned.length <= MAX_SNIPPET_CHARS) {
        return cleaned;
    }
    return cleaned.slice(0, MAX_SNIPPET_CHARS);
}

function parseConfidence(confidence) {
    const n = Number(confidence);
    if (!Number.isFinite(n)) {
        return 50;
    }
    if (n <= 1) {
        return Math.max(0, Math.min(100, Math.round(n * 100)));
    }
    return Math.max(0, Math.min(100, Math.round(n)));
}

function deriveRiskScore(result) {
    const label = String(result?.verdict || result?.label || "Unclear");
    const confidence = parseConfidence(result?.confidence);
    const rawScore = Number(result?.raw_score ?? result?.score);

    if (Number.isFinite(rawScore)) {
        return Math.max(0, Math.min(100, Math.round(rawScore)));
    }

    if (label === "Mostly Accurate" || label === "Supported") {
        return 100 - confidence;
    }
    if (label === "Partially Accurate") {
        return Math.min(100, Math.round(35 + confidence * 0.4));
    }
    if (label === "Inaccurate" || label === "Refuted") {
        return confidence;
    }
    if (label === "Misleading") {
        return Math.min(100, Math.round(50 + confidence * 0.5));
    }
    return 50;
}

function setRiskScore(score, domain = "example.com") {
    document.getElementById("scoreNumber").textContent = score;
    document.querySelector(".domain").textContent = domain;

    const radius = 90;
    const circumference = 2 * Math.PI * radius;
    const percentage = Math.min(score, 100) / 100;
    const offset = circumference - circumference * percentage;

    const circle = document.getElementById("progressCircle");
    circle.style.strokeDasharray = circumference;
    circle.style.strokeDashoffset = offset;

    let scoreColor = "#22c55e";
    if (score >= 75) {
        scoreColor = "#ef4444";
    } else if (score >= 50) {
        scoreColor = "#f97316";
    } else if (score >= 25) {
        scoreColor = "#eab308";
    }

    circle.style.stroke = scoreColor;
    document.getElementById("scoreNumber").style.color = scoreColor;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return "example.com";
    }
}

function setStatus(text) {
    document.getElementById("statusText").textContent = text;
}

function normalizeResult(payload) {
    return payload?.result || payload || {};
}

async function getBackendUrl() {
    const { backendUrl } = await chrome.storage.local.get("backendUrl");
    return backendUrl || DEFAULT_BACKEND_URL;
}

async function analyzeSnippet(snippet, pageUrl) {
    const normalized = normalizeSnippet(snippet);
    if (!normalized) {
        throw new Error("No text selected.");
    }

    const backendUrl = await getBackendUrl();
    const response = await fetch(`${backendUrl}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            snippet: normalized,
            source: "chrome-extension-popup",
            url: pageUrl || null,
            user_context: {
                trigger: "popup",
                browserLocale: chrome.i18n.getUILanguage()
            }
        })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error || `Request failed: HTTP ${response.status}`);
    }

    return payload;
}

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] || null;
}

async function getSelectedText(tabId) {
    const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.getSelection().toString()
    });
    return String(result?.result || "").trim();
}

function renderResult(payload, pageUrl) {
    const result = normalizeResult(payload);
    const domain = extractDomain(pageUrl);
    const riskScore = deriveRiskScore(result);
    const verdict = result?.verdict || result?.label || "Unclear";
    const summary = result?.summary || result?.reasoning || "No summary provided.";
    const confidence = parseConfidence(result?.confidence);

    setRiskScore(riskScore, domain);
    document.getElementById("verdictText").textContent = `Verdict: ${verdict} (${confidence}%)`;
    document.getElementById("summaryText").textContent = `Summary: ${summary}`;

    const redFlags = Array.isArray(result?.red_flags) ? result.red_flags : [];
    document.getElementById("redFlagsCount").textContent = String(redFlags.length);
    document.getElementById("redFlagsDescription").textContent = redFlags.length
        ? `- ${redFlags.map((f) => String(f)).join("\n\n- ")}`
        : "No red flags returned.";

    const claims = Array.isArray(result?.claims)
        ? result.claims
                .map((c) => {
                    if (typeof c === "string") {
                        return c;
                    }
                    const claim = c?.claim || "";
                    const assessment = c?.assessment ? ` [${c.assessment}]` : "";
                    return `${claim}${assessment}`.trim();
                })
                .filter(Boolean)
        : [];
    document.getElementById("claimsCount").textContent = String(claims.length);
    document.getElementById("claimsDescription").textContent = claims.length
        ? `- ${claims.join("\n\n- ")}`
        : "No claims returned.";

    setStatus("Analysis complete.");
}

async function renderFromStoredResult(domain) {
    const { lastAnalysis, lastAnalysisError, lastPageUrl, lastAnalysisAt } = await chrome.storage.local.get([
        "lastAnalysis",
        "lastAnalysisError",
        "lastPageUrl",
        "lastAnalysisAt"
    ]);

    if (lastAnalysis) {
        if (Number(lastAnalysisAt) && Date.now() - Number(lastAnalysisAt) > REUSE_RESULT_WINDOW_MS) {
            return false;
        }
        renderResult(lastAnalysis, lastPageUrl || domain);
        setStatus("Showing latest analysis from context menu.");
        return true;
    }

    if (lastAnalysisError) {
        setStatus(`Last error: ${lastAnalysisError}`);
        return true;
    }

    return false;
}

document.addEventListener("DOMContentLoaded", async () => {
    setRiskScore(0, "example.com");
    setStatus("Fetching selected text...");

    try {
        const tab = await getActiveTab();
        if (!tab?.id) {
            setStatus("No active tab.");
            return;
        }

        const domain = extractDomain(tab.url || "");
        setRiskScore(0, domain);

        let selection = "";
        try {
            selection = normalizeSnippet(await getSelectedText(tab.id));
        } catch {
            // restricted pages may block script injection
        }

        if (!selection) {
            const hadStored = await renderFromStoredResult(tab.url || "");
            if (!hadStored) {
                setStatus("Highlight text on the page, then open popup or use right-click analyze.");
            }
            return;
        }

        const cached = await chrome.storage.local.get(["lastSelectionText", "lastAnalysis", "lastAnalysisAt", "lastPageUrl"]);
        if (
            cached?.lastAnalysis &&
            cached?.lastSelectionText === selection &&
            Number(cached?.lastAnalysisAt) &&
            Date.now() - Number(cached.lastAnalysisAt) <= REUSE_RESULT_WINDOW_MS
        ) {
            renderResult(cached.lastAnalysis, cached.lastPageUrl || tab.url || "");
            setStatus("Showing cached result for current selection.");
            return;
        }

        setStatus("Analyzing selected text...");
        const payload = await analyzeSnippet(selection, tab.url || null);
        await chrome.storage.local.set({
            lastAnalysis: payload,
            lastSelectionText: selection,
            lastPageUrl: tab.url || null,
            lastAnalysisError: null,
            lastAnalysisAt: Date.now()
        });
        renderResult(payload, tab.url || "");
    } catch (error) {
        setStatus(`Error: ${error?.message || "Failed to analyze."}`);
    }
});