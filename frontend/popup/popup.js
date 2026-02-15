// Map verdict string to a base risk score (0-100)
var VERDICT_RISK = {
  "Accurate": 10,
  "Mostly Accurate": 25,
  "Mixed": 50,
  "Mostly Inaccurate": 75,
  "Inaccurate": 90,
  "Unverifiable": 50
};

function computeRiskScore(data) {
  var directScore = Number(data && (data.score ?? data.raw_score));
  if (Number.isFinite(directScore)) {
    if (directScore < 0) return 0;
    if (directScore > 100) return 100;
    return Math.round(directScore);
  }

  var base = VERDICT_RISK[data.verdict];
  if (base === undefined) base = 50;

  var confidenceRaw = Number(data && data.confidence);
  var confidencePercent = Number.isFinite(confidenceRaw)
    ? (confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw)
    : 50;

  if (confidencePercent < 0) confidencePercent = 0;
  if (confidencePercent > 100) confidencePercent = 100;

  return Math.round(base * (confidencePercent / 100));
}

function getRiskColor(score) {
  if (score >= 75) return '#ef4444';
  if (score >= 50) return '#f97316';
  if (score >= 25) return '#eab308';
  return '#22c55e';
}

function escapeHtml(str) {
  var div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

function truncateText(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

function getBadgeClass(assessment) {
  var map = {
    'Accurate': 'badge-accurate',
    'Inaccurate': 'badge-inaccurate',
    'Misleading': 'badge-misleading',
    'Unverifiable': 'badge-unverifiable',
    'Lacks Context': 'badge-lacks-context'
  };
  return map[assessment] || 'badge-unverifiable';
}

// Update the circular risk score display
function setRiskScore(score, domain) {
  document.getElementById('scoreNumber').textContent = score;
  document.getElementById('domainText').textContent = domain || '';

  var radius = 90;
  var circumference = 2 * Math.PI * radius;
  var percentage = Math.min(score, 100) / 100;
  var offset = circumference - (circumference * percentage);

  var circle = document.getElementById('progressCircle');
  circle.style.strokeDasharray = circumference;
  circle.style.strokeDashoffset = offset;

  var color = getRiskColor(score);
  circle.style.stroke = color;
  document.getElementById('scoreNumber').style.color = color;
}

// Show loading state
function showLoading(text) {
  document.getElementById('scoreCard').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'block';
  document.getElementById('errorSection').style.display = 'none';
  document.getElementById('summarySection').style.display = 'none';
  document.getElementById('claimsSection').style.display = 'none';
  document.getElementById('flagsSection').style.display = 'none';

  var preview = document.getElementById('loadingPreview');
  if (text) {
    preview.textContent = '"' + truncateText(text, 200) + '"';
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
}

// Show result state
function showResult(data, domain) {
  document.getElementById('scoreCard').style.display = 'flex';
  document.getElementById('loadingSection').style.display = 'none';
  document.getElementById('errorSection').style.display = 'none';

  var risk = computeRiskScore(data);
  setRiskScore(risk, domain);

  // Summary
  var summaryEl = document.getElementById('summarySection');
  var summaryText = data.summary || data.reasoning || data.explanation || '';
  if (summaryText) {
    summaryEl.textContent = summaryText;
    summaryEl.style.display = 'block';
  } else {
    summaryEl.style.display = 'none';
  }

  // Claims
  var claimsSection = document.getElementById('claimsSection');
  var claimsList = document.getElementById('claimsList');
  if (data.claims && data.claims.length > 0) {
    claimsList.innerHTML = '';
    for (var i = 0; i < data.claims.length; i++) {
      var claim = data.claims[i];
      var claimEl = document.createElement('div');
      claimEl.className = 'claim';
      claimEl.innerHTML =
        '<div class="claim-header">' +
          '<span class="claim-badge ' + getBadgeClass(claim.assessment) + '">' + escapeHtml(claim.assessment) + '</span>' +
          '<span class="claim-text">' + escapeHtml(claim.claim) + '</span>' +
        '</div>' +
        '<div class="claim-explanation">' + escapeHtml(claim.explanation) + '</div>';
      claimsList.appendChild(claimEl);
    }
    claimsSection.style.display = 'block';
  } else {
    claimsSection.style.display = 'none';
  }

  // Red flags
  var flagsSection = document.getElementById('flagsSection');
  var flagsList = document.getElementById('flagsList');
  if (data.red_flags && data.red_flags.length > 0) {
    flagsList.innerHTML = '';
    for (var j = 0; j < data.red_flags.length; j++) {
      var flagEl = document.createElement('div');
      flagEl.className = 'flag';
      flagEl.textContent = data.red_flags[j];
      flagsList.appendChild(flagEl);
    }
    flagsSection.style.display = 'block';
  } else {
    flagsSection.style.display = 'none';
  }
}

// Show error state
function showError(message) {
  document.getElementById('scoreCard').style.display = 'none';
  document.getElementById('loadingSection').style.display = 'none';
  document.getElementById('errorSection').style.display = 'block';
  document.getElementById('summarySection').style.display = 'none';
  document.getElementById('claimsSection').style.display = 'none';
  document.getElementById('flagsSection').style.display = 'none';

  document.getElementById('errorMessage').textContent = message;
}

// Render current state from storage
function renderState(state) {
  if (!state) return;

  if (state.status === 'loading') {
    showLoading(state.text);
  } else if (state.status === 'result') {
    showResult(state.data, state.domain);
  } else if (state.status === 'error') {
    showError(state.message);
  }
}

var BACKEND_LABELS = {
  gemini: 'Gemini',
  lambda: 'AWS Lambda'
};

var DEFAULT_GEMINI_URL = 'http://localhost:8000';
var DEFAULT_LAMBDA_URL = 'https://q1zezp536f.execute-api.us-east-1.amazonaws.com';

function normalizeUrl(url, fallback) {
  var value = (url || fallback || '').trim();
  if (!value) return fallback || '';
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function updateBackendLabel(type) {
  document.getElementById('backendLabel').textContent = BACKEND_LABELS[type] || BACKEND_LABELS.gemini;
}

function updateSelectedStyles() {
  document.querySelectorAll('.backend-option').forEach(function (el) {
    var radio = el.querySelector('input[type="radio"]');
    el.classList.toggle('selected', radio.checked);
  });
}

function setSettingsMessage(text) {
  var el = document.getElementById('settingsMessage');
  if (el) el.textContent = text || '';
}

function applySettingsToUi(type, geminiUrl, lambdaUrl) {
  var radios = document.querySelectorAll('input[name="backendType"]');
  radios.forEach(function (r) { r.checked = r.value === type; });
  updateBackendLabel(type);
  updateSelectedStyles();

  var geminiEl = document.getElementById('geminiUrlInput');
  var lambdaEl = document.getElementById('lambdaUrlInput');
  if (geminiEl) geminiEl.value = geminiUrl;
  if (lambdaEl) lambdaEl.value = lambdaUrl;
}

function readSettingsFromStorage(callback) {
  chrome.storage.local.get([
    'backendType',
    'backendProvider',
    'geminiBackendUrl',
    'awsBackendUrl',
    'backendUrl'
  ], function (result) {
      var type = result.backendType || (result.backendProvider === 'aws' ? 'lambda' : result.backendProvider) || 'lambda';
    var geminiUrl = normalizeUrl(result.geminiBackendUrl, DEFAULT_GEMINI_URL);
    var lambdaUrl = normalizeUrl(result.awsBackendUrl || result.backendUrl, DEFAULT_LAMBDA_URL);
    callback({ type: type, geminiUrl: geminiUrl, lambdaUrl: lambdaUrl });
  });
}

function saveSettingsFromUi() {
  var selected = document.querySelector('input[name="backendType"]:checked');
  var type = selected ? selected.value : 'gemini';
  var geminiUrl = normalizeUrl(document.getElementById('geminiUrlInput').value, DEFAULT_GEMINI_URL);
  var lambdaUrl = normalizeUrl(document.getElementById('lambdaUrlInput').value, DEFAULT_LAMBDA_URL);

  chrome.storage.local.set({
    backendType: type,
    backendProvider: type === 'lambda' ? 'aws' : 'gemini',
    geminiBackendUrl: geminiUrl,
    awsBackendUrl: lambdaUrl,
    backendUrl: lambdaUrl
  }, function () {
    applySettingsToUi(type, geminiUrl, lambdaUrl);
    setSettingsMessage('Saved.');
  });
}

function resetSettings() {
  chrome.storage.local.set({
     backendType: 'lambda',
     backendProvider: 'aws',
    geminiBackendUrl: DEFAULT_GEMINI_URL,
    awsBackendUrl: DEFAULT_LAMBDA_URL,
    backendUrl: DEFAULT_LAMBDA_URL
  }, function () {
     applySettingsToUi('lambda', DEFAULT_GEMINI_URL, DEFAULT_LAMBDA_URL);
    setSettingsMessage('Defaults restored.');
  });
}

// On popup open: read current state
document.addEventListener('DOMContentLoaded', function () {
  var settingsPanel = document.getElementById('settingsPanel');
  var saveBtn = document.getElementById('saveSettingsButton');
  var resetBtn = document.getElementById('resetSettingsButton');

  chrome.storage.local.get(['slopifyState', 'lastResult'], function (result) {
    readSettingsFromStorage(function (settings) {
      applySettingsToUi(settings.type, settings.geminiUrl, settings.lambdaUrl);
    });

    var state = result.slopifyState;
    if (state) {
      renderState(state);
    } else if (result.lastResult && result.lastResult.data) {
      showResult(result.lastResult.data, result.lastResult.domain);
    } else {
      setRiskScore(0, 'No analysis yet');
    }
  });

  // Toggle settings panel
  document.getElementById('settingsButton').addEventListener('click', function () {
    var visible = settingsPanel.style.display !== 'none';
    settingsPanel.style.display = visible ? 'none' : 'block';
    if (!visible) {
      readSettingsFromStorage(function (settings) {
        applySettingsToUi(settings.type, settings.geminiUrl, settings.lambdaUrl);
        setSettingsMessage('');
      });
    }
  });

  // Update preview selection only; save through Save button
  document.querySelectorAll('input[name="backendType"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      updateBackendLabel(this.value);
      updateSelectedStyles();
      setSettingsMessage('Unsaved changes');
    });
  });

  if (saveBtn) {
    saveBtn.addEventListener('click', saveSettingsFromUi);
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', resetSettings);
  }

  var geminiUrlInput = document.getElementById('geminiUrlInput');
  var lambdaUrlInput = document.getElementById('lambdaUrlInput');
  if (geminiUrlInput) {
    geminiUrlInput.addEventListener('input', function () {
      setSettingsMessage('Unsaved changes');
    });
  }
  if (lambdaUrlInput) {
    lambdaUrlInput.addEventListener('input', function () {
      setSettingsMessage('Unsaved changes');
    });
  }
});

// Listen for storage changes so the popup updates live
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.slopifyState) {
    renderState(changes.slopifyState.newValue);
  }
  if (changes.backendType) {
    updateBackendLabel(changes.backendType.newValue);
  } else if (changes.backendProvider) {
    updateBackendLabel(changes.backendProvider.newValue === 'aws' ? 'lambda' : changes.backendProvider.newValue);
  }
});
