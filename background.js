// background.js — Service worker: context menu, Claude API, overlay injection

const SYSTEM_PROMPT = `You are a fact-checking assistant. Analyze the provided text passage for factual accuracy.

Return your analysis as a JSON object with this exact structure:
{
  "verdict": "Accurate" or "Mostly Accurate" or "Mixed" or "Mostly Inaccurate" or "Inaccurate" or "Unverifiable",
  "confidence": 0-100,
  "claims": [
    {
      "claim": "The specific claim extracted from the text",
      "assessment": "Accurate" or "Inaccurate" or "Misleading" or "Unverifiable" or "Lacks Context",
      "explanation": "Brief explanation of why this claim is rated this way"
    }
  ],
  "red_flags": ["Any concerning patterns: emotional manipulation, logical fallacies, missing context, etc."],
  "summary": "A 2-3 sentence overall assessment of the passage's factual reliability"
}

Guidelines:
- Extract and evaluate each distinct factual claim in the passage.
- For well-known facts, state whether they are accurate.
- For claims you cannot verify, mark them as "Unverifiable" rather than guessing.
- Be specific in explanations. Reference what you know to be true when correcting claims.
- If the text is opinion rather than factual claims, note this in the summary.
- Do not add any text outside the JSON object. Return only valid JSON.`;

const MAX_SELECTION_LENGTH = 5000;

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
  let truncated = false;
  if (selectedText.length > MAX_SELECTION_LENGTH) {
    selectedText = selectedText.substring(0, MAX_SELECTION_LENGTH);
    truncated = true;
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

    // Call Claude API
    const result = await factCheckWithClaude(selectedText, truncated);

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

async function factCheckWithClaude(text, truncated) {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  if (!apiKey) {
    throw new Error(
      "API key not set. Click the Slopify icon to add your Claude API key."
    );
  }

  let userMessage = `Fact-check the following passage:\n\n"${text}"`;
  if (truncated) {
    userMessage += `\n\n[Note: The selected text was truncated to ${MAX_SELECTION_LENGTH} characters.]`;
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    if (response.status === 401) {
      throw new Error("Invalid API key. Check your key in the Slopify popup.");
    }
    if (response.status === 429) {
      throw new Error("Rate limited. Please wait a moment and try again.");
    }
    throw new Error(`Claude API error (${response.status}): ${errorBody}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("Failed to parse Claude's response as JSON.");
  }
}
