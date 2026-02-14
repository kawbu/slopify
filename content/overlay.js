// content/overlay.js — Injected into the active tab to show fact-check results
// Uses Shadow DOM to prevent style conflicts with the host page

(function () {
  const HOST_ID = "slopify-overlay-host";

  // Idempotency: if already injected, just ensure listener is active
  if (document.getElementById(HOST_ID)) return;

  // Create host element
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all:initial; position:fixed; top:20px; right:20px; z-index:2147483647; font-family:system-ui,sans-serif;";
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "closed" });

  // Inject styles into shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .panel {
      width: 380px;
      max-height: 520px;
      background: #1a1a2e;
      color: #e0e0e0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-size: 13px;
      line-height: 1.5;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #16213e;
      cursor: move;
      user-select: none;
    }

    .header-title {
      font-size: 15px;
      font-weight: 700;
      color: #fff;
    }

    .close-btn {
      background: none;
      border: none;
      color: #888;
      font-size: 18px;
      cursor: pointer;
      padding: 0 4px;
      line-height: 1;
    }
    .close-btn:hover { color: #fff; }

    .body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* Loading state */
    .loading {
      text-align: center;
      padding: 24px 0;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #333;
      border-top-color: #4285f4;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 12px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      color: #aaa;
      font-size: 13px;
    }

    .selected-preview {
      margin-top: 12px;
      padding: 10px;
      background: #16213e;
      border-radius: 6px;
      font-size: 12px;
      color: #888;
      max-height: 80px;
      overflow: hidden;
      font-style: italic;
    }

    /* Verdict */
    .verdict-row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 14px;
    }

    .verdict-badge {
      padding: 4px 12px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 13px;
      white-space: nowrap;
    }

    .verdict-accurate { background: #166534; color: #4ade80; }
    .verdict-mostly-accurate { background: #1a5c2e; color: #86efac; }
    .verdict-mixed { background: #854d0e; color: #fde047; }
    .verdict-mostly-inaccurate { background: #9a3412; color: #fdba74; }
    .verdict-inaccurate { background: #991b1b; color: #fca5a5; }
    .verdict-unverifiable { background: #374151; color: #9ca3af; }

    .confidence {
      font-size: 12px;
      color: #aaa;
    }

    /* Summary */
    .summary {
      margin-bottom: 14px;
      color: #ccc;
    }

    /* Claims */
    .section-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
      margin-bottom: 8px;
    }

    .claim {
      padding: 10px;
      background: #16213e;
      border-radius: 6px;
      margin-bottom: 8px;
    }

    .claim-header {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin-bottom: 4px;
    }

    .claim-badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
      flex-shrink: 0;
      margin-top: 2px;
    }

    .badge-accurate { background: #166534; color: #4ade80; }
    .badge-inaccurate { background: #991b1b; color: #fca5a5; }
    .badge-misleading { background: #854d0e; color: #fde047; }
    .badge-unverifiable { background: #374151; color: #9ca3af; }
    .badge-lacks-context { background: #4a3728; color: #fdba74; }

    .claim-text {
      font-size: 12px;
      color: #ddd;
    }

    .claim-explanation {
      font-size: 11px;
      color: #999;
      margin-top: 4px;
    }

    /* Red flags */
    .red-flags {
      margin-top: 14px;
    }

    .flag {
      padding: 8px 10px;
      background: rgba(239,68,68,0.1);
      border-left: 3px solid #ef4444;
      border-radius: 0 6px 6px 0;
      margin-bottom: 6px;
      font-size: 12px;
      color: #fca5a5;
    }

    /* Error state */
    .error {
      text-align: center;
      padding: 16px 0;
    }

    .error-icon {
      font-size: 28px;
      margin-bottom: 8px;
    }

    .error-message {
      color: #fca5a5;
      font-size: 13px;
    }
  `;
  shadow.appendChild(style);

  // Build panel
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `
    <div class="header">
      <span class="header-title">Slopify</span>
      <button class="close-btn" title="Close">&times;</button>
    </div>
    <div class="body">
      <div class="loading">
        <div class="spinner"></div>
        <div class="loading-text">Fact-checking...</div>
        <div class="selected-preview"></div>
      </div>
    </div>
  `;
  shadow.appendChild(panel);

  const bodyEl = panel.querySelector(".body");
  const closeBtn = panel.querySelector(".close-btn");

  // Close button
  closeBtn.addEventListener("click", () => {
    host.remove();
  });

  // Draggable header
  const header = panel.querySelector(".header");
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  header.addEventListener("mousedown", (e) => {
    if (e.target === closeBtn) return;
    isDragging = true;
    const rect = host.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    host.style.left = e.clientX - dragOffsetX + "px";
    host.style.top = e.clientY - dragOffsetY + "px";
    host.style.right = "auto";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Message listener
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "slopify-loading") {
      showLoading(message.text);
    } else if (message.action === "slopify-result") {
      showResult(message.data, message.originalText);
    } else if (message.action === "slopify-error") {
      showError(message.message);
    }
  });

  function showLoading(text) {
    // Make sure host is visible if it was previously removed
    if (!document.getElementById(HOST_ID)) {
      document.body.appendChild(host);
    }

    bodyEl.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <div class="loading-text">Fact-checking...</div>
        <div class="selected-preview">"${escapeHtml(truncateText(text, 200))}"</div>
      </div>
    `;
  }

  function showResult(data, originalText) {
    const verdictClass = getVerdictClass(data.verdict);

    let claimsHtml = "";
    if (data.claims && data.claims.length > 0) {
      claimsHtml = `<div class="section-title">Claims Analysis</div>`;
      for (const claim of data.claims) {
        const badgeClass = getBadgeClass(claim.assessment);
        claimsHtml += `
          <div class="claim">
            <div class="claim-header">
              <span class="claim-badge ${badgeClass}">${escapeHtml(claim.assessment)}</span>
              <span class="claim-text">${escapeHtml(claim.claim)}</span>
            </div>
            <div class="claim-explanation">${escapeHtml(claim.explanation)}</div>
          </div>
        `;
      }
    }

    let flagsHtml = "";
    if (data.red_flags && data.red_flags.length > 0) {
      flagsHtml = `<div class="red-flags"><div class="section-title">Red Flags</div>`;
      for (const flag of data.red_flags) {
        flagsHtml += `<div class="flag">${escapeHtml(flag)}</div>`;
      }
      flagsHtml += `</div>`;
    }

    bodyEl.innerHTML = `
      <div class="verdict-row">
        <span class="verdict-badge ${verdictClass}">${escapeHtml(data.verdict)}</span>
        <span class="confidence">${data.confidence}% confidence</span>
      </div>
      <div class="summary">${escapeHtml(data.summary)}</div>
      ${claimsHtml}
      ${flagsHtml}
    `;
  }

  function showError(message) {
    bodyEl.innerHTML = `
      <div class="error">
        <div class="error-icon">!</div>
        <div class="error-message">${escapeHtml(message)}</div>
      </div>
    `;
  }

  function getVerdictClass(verdict) {
    const map = {
      Accurate: "verdict-accurate",
      "Mostly Accurate": "verdict-mostly-accurate",
      Mixed: "verdict-mixed",
      "Mostly Inaccurate": "verdict-mostly-inaccurate",
      Inaccurate: "verdict-inaccurate",
      Unverifiable: "verdict-unverifiable",
    };
    return map[verdict] || "verdict-unverifiable";
  }

  function getBadgeClass(assessment) {
    const map = {
      Accurate: "badge-accurate",
      Inaccurate: "badge-inaccurate",
      Misleading: "badge-misleading",
      Unverifiable: "badge-unverifiable",
      "Lacks Context": "badge-lacks-context",
    };
    return map[assessment] || "badge-unverifiable";
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function truncateText(str, maxLen) {
    if (!str) return "";
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + "...";
  }
})();
