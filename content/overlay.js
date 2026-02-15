(function initSlopifyOverlay() {
  if (window.__slopifyOverlayInitialized) {
    return;
  }
  window.__slopifyOverlayInitialized = true;

  const ID = "slopify-overlay-root";

  function ensureRoot() {
    let root = document.getElementById(ID);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = ID;
    root.style.position = "fixed";
    root.style.right = "16px";
    root.style.bottom = "16px";
    root.style.width = "360px";
    root.style.maxHeight = "55vh";
    root.style.overflow = "auto";
    root.style.padding = "12px";
    root.style.borderRadius = "12px";
    root.style.background = "#0f172a";
    root.style.color = "#e2e8f0";
    root.style.boxShadow = "0 12px 32px rgba(0,0,0,0.35)";
    root.style.zIndex = "2147483647";
    root.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial";
    root.style.fontSize = "13px";
    document.documentElement.appendChild(root);

    return root;
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safeUrl(url) {
    try {
      const parsed = new URL(String(url || ""));
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.toString();
      }
      return null;
    } catch {
      return null;
    }
  }

  function renderLoading(text) {
    const root = ensureRoot();
    root.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">Slopify</div>
      <div style="opacity:.9; margin-bottom:8px;">Analyzing selection...</div>
      <div style="opacity:.8; font-size:12px;">${escapeHtml(String(text).slice(0, 260))}</div>
    `;
  }

  function renderError(message) {
    const root = ensureRoot();
    root.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px; color:#fecaca;">Slopify Error</div>
      <div style="font-size:12px; color:#fecaca;">${escapeHtml(message || "Unknown error")}</div>
    `;
  }

  function renderResult(payload) {
    const root = ensureRoot();
    const data = payload?.result || payload || {};

    const verdict = data.verdict || data.label || "Unknown";
    const confidence = data.confidence ?? "n/a";
    const summary = data.summary || data.reasoning || "No summary provided.";
    const claims = Array.isArray(data.claims) ? data.claims : [];
    const citations = Array.isArray(data.citations) ? data.citations : [];

    const claimsHtml = claims.length
      ? claims
          .slice(0, 5)
          .map((c, i) => {
            const claimText = typeof c === "string" ? c : c.claim || JSON.stringify(c);
            const assessment = c?.assessment ? ` <span style="opacity:.8;">(${escapeHtml(c.assessment)})</span>` : "";
            return `<li style="margin-bottom:6px; overflow-wrap:anywhere;">${escapeHtml(claimText)}${assessment}</li>`;
          })
          .join("")
      : "<li>No claims returned.</li>";

    const citationsHtml = citations.length
      ? citations
          .slice(0, 5)
          .map((c) => {
            const href = safeUrl(c?.url);
            const claim = c?.claim ? `<div style="opacity:.9; margin-top:3px;"><b>Claim:</b> ${escapeHtml(String(c.claim))}</div>` : "";
            const quote = c?.quote ? `<div style="opacity:.85; margin-top:3px;">“${escapeHtml(String(c.quote))}”</div>` : "";
            const link = href
              ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="color:#93c5fd;">${escapeHtml(href)}</a>`
              : `<span style="opacity:.75;">No URL provided</span>`;
            return `<li style="margin-bottom:8px; overflow-wrap:anywhere;">${link}${claim}${quote}</li>`;
          })
          .join("")
      : "<li>No sources returned. If this happens often, disable model-first fast path.</li>";

    root.innerHTML = `
      <div style="font-weight:700; margin-bottom:8px;">Slopify Result</div>
      <div style="margin-bottom:6px;"><b>Verdict:</b> ${escapeHtml(verdict)}</div>
      <div style="margin-bottom:6px;"><b>Confidence:</b> ${escapeHtml(String(confidence))}</div>
      <div style="margin-bottom:10px;"><b>Summary:</b> ${escapeHtml(summary)}</div>
      <div><b>Claims</b></div>
      <ul style="padding-left:18px; margin-top:6px; margin-bottom:10px;">${claimsHtml}</ul>
      <div><b>Sources</b></div>
      <ul style="padding-left:18px; margin-top:6px; margin-bottom:0;">${citationsHtml}</ul>
    `;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (!message?.action) {
      return;
    }

    if (message.action === "slopify-loading") {
      renderLoading(message.text || "");
      return;
    }

    if (message.action === "slopify-result") {
      renderResult(message.data);
      return;
    }

    if (message.action === "slopify-error") {
      renderError(message.message || "Unknown error");
    }
  });
})();
