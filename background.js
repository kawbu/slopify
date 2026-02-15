const MENU_ID = "check-if-slopped";
const VERIFY_API_URL = "https://q1zezp536f.execute-api.us-east-1.amazonaws.com/verify";

function buildResultMessage(result, selectedText) {
  if (!result) {
    return `No response returned.\n\nSelected:\n${selectedText}`;
  }

  const score = result.score ?? "n/a";
  const label = result.label || "Unknown";
  const confidence =
    typeof result.confidence === "number"
      ? `${Math.round(result.confidence * 100)}%`
      : result.confidence ?? "n/a";
  const reason = result.reasoning || "No reasoning provided.";
  const claims = Array.isArray(result.claims) ? result.claims : [];
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const durationMs = result?.diagnostics?.totalDurationMs;

  const claimsText = claims.length
    ? claims.map((claim, i) => `${i + 1}. ${claim}`).join("\n")
    : "None";

  const citationsText = citations.length
    ? citations
        .slice(0, 3)
        .map((citation, i) => {
          const quote = citation?.quote ? String(citation.quote).slice(0, 160) : "(no quote)";
          return `${i + 1}. ${citation?.url || "(no url)"}\n   Quote: ${quote}`;
        })
        .join("\n")
    : "None";

  const diagnosticsText = durationMs ? `\nDuration: ${durationMs} ms` : "";

  return `Check if Slopped\n\nScore: ${score}\nLabel: ${label}\nConfidence: ${confidence}${diagnosticsText}\n\nReason:\n${reason}\n\nClaims:\n${claimsText}\n\nCitations:\n${citationsText}`;
}

async function verifySnippet(selectedText, tab) {
  if (VERIFY_API_URL.includes("YOUR_API_ID") || VERIFY_API_URL.includes("YOUR_REGION")) {
    throw new Error("Set VERIFY_API_URL in background.js to your API Gateway /verify endpoint.");
  }

  const response = await fetch(VERIFY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      snippet: selectedText,
      source: "chrome-extension",
      url: tab?.url || null,
      user_context: {
        pageTitle: tab?.title || null,
        browserLocale: chrome.i18n.getUILanguage(),
        requestedAt: new Date().toISOString()
      }
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || `Verify request failed: HTTP ${response.status}`);
  }

  return payload;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Check if Slopped",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  const selectedText = (info.selectionText || "").trim();

  if (!tab?.id) {
    console.log("[Slopify] No active tab to display selection.");
    return;
  }

  if (!selectedText) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: ["Please highlight text first."],
      func: (message) => {
        alert(message);
      }
    });
    return;
  }

  verifySnippet(selectedText, tab)
    .then((verifyResponse) => {
      const result = verifyResponse?.result || verifyResponse;
      const message = buildResultMessage(result, selectedText);

      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [message],
        func: (outputMessage) => {
          alert(outputMessage);
        }
      });
    })
    .catch((error) => {
      const msg = `Verification failed: ${error.message}`;
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [msg],
        func: (outputMessage) => {
          alert(outputMessage);
        }
      });
    });
});
