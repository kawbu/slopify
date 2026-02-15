const DEFAULT_AWS_BACKEND_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com";
const DEFAULT_GEMINI_BACKEND_URL = "http://localhost:8000";

function byId(id) {
    return document.getElementById(id);
}

function setStatus(text) {
    byId("status").textContent = text || "";
}

async function loadSettings() {
    const values = await chrome.storage.local.get([
        "backendProvider",
        "backendUrl",
        "awsBackendUrl",
        "geminiBackendUrl"
    ]);

    const provider = values.backendProvider === "gemini" ? "gemini" : "aws";
    const awsUrl = values.awsBackendUrl || values.backendUrl || DEFAULT_AWS_BACKEND_URL;
    const geminiUrl = values.geminiBackendUrl || DEFAULT_GEMINI_BACKEND_URL;

    byId("providerSelect").value = provider;
    byId("awsUrlInput").value = awsUrl;
    byId("geminiUrlInput").value = geminiUrl;
}

async function saveSettings() {
    const provider = byId("providerSelect").value === "gemini" ? "gemini" : "aws";
    const awsUrl = byId("awsUrlInput").value.trim() || DEFAULT_AWS_BACKEND_URL;
    const geminiUrl = byId("geminiUrlInput").value.trim() || DEFAULT_GEMINI_BACKEND_URL;

    await chrome.storage.local.set({
        backendProvider: provider,
        awsBackendUrl: awsUrl,
        geminiBackendUrl: geminiUrl,
        backendUrl: awsUrl
    });

    setStatus("Saved.");
}

async function resetDefaults() {
    await chrome.storage.local.set({
        backendProvider: "aws",
        awsBackendUrl: DEFAULT_AWS_BACKEND_URL,
        geminiBackendUrl: DEFAULT_GEMINI_BACKEND_URL,
        backendUrl: DEFAULT_AWS_BACKEND_URL
    });
    await loadSettings();
    setStatus("Defaults restored.");
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadSettings();

    byId("saveBtn").addEventListener("click", async () => {
        try {
            await saveSettings();
        } catch (error) {
            setStatus(`Save failed: ${error?.message || "Unknown error"}`);
        }
    });

    byId("resetBtn").addEventListener("click", async () => {
        try {
            await resetDefaults();
        } catch (error) {
            setStatus(`Reset failed: ${error?.message || "Unknown error"}`);
        }
    });
});
