const REUSE_RESULT_WINDOW_MS = 120000;

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

async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs?.[0] || null;
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
    const { isAnalyzing, lastAnalysis, lastAnalysisError, lastPageUrl, lastAnalysisAt } = await chrome.storage.local.get([
        "isAnalyzing",
        "lastAnalysis",
        "lastAnalysisError",
        "lastPageUrl",
        "lastAnalysisAt"
    ]);

    if (isAnalyzing) {
        setStatus("Analyzing selected text...");
        if (lastAnalysis) {
            renderResult(lastAnalysis, lastPageUrl || domain);
            setStatus("Analyzing selected text...");
            return true;
        }
        return true;
    }

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
    setStatus("Waiting for Check Slopify...");

    try {
        const tab = await getActiveTab();
        if (!tab?.id) {
            setStatus("No active tab.");
            return;
        }

        const domain = extractDomain(tab.url || "");
        setRiskScore(0, domain);
        const hadStored = await renderFromStoredResult(tab.url || "");
        if (!hadStored) {
            setStatus("Highlight text, right-click, then press Check Slopify.");
        }

        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName !== "local") {
                return;
            }

            if (
                !changes.isAnalyzing &&
                !changes.lastAnalysis &&
                !changes.lastAnalysisError &&
                !changes.lastPageUrl &&
                !changes.lastAnalysisAt
            ) {
                return;
            }

            await renderFromStoredResult(tab.url || "");
        });
    } catch (error) {
        setStatus(`Error: ${error?.message || "Failed to analyze."}`);
    }
});