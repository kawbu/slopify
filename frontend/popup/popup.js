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
  var base = VERDICT_RISK[data.verdict];
  if (base === undefined) base = 50;
  return Math.round(base * (data.confidence / 100));
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
  if (data.summary) {
    summaryEl.textContent = data.summary;
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

function updateBackendLabel(type) {
  document.getElementById('backendLabel').textContent = BACKEND_LABELS[type] || BACKEND_LABELS.gemini;
}

// On popup open: read current state
document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.local.get(['slopifyState', 'lastResult', 'backendType'], function (result) {
    updateBackendLabel(result.backendType);

    var state = result.slopifyState;
    if (state) {
      renderState(state);
    } else if (result.lastResult && result.lastResult.data) {
      showResult(result.lastResult.data, result.lastResult.domain);
    } else {
      setRiskScore(0, 'No analysis yet');
    }
  });

  // Settings button opens the options page
  document.getElementById('settingsButton').addEventListener('click', function () {
    chrome.runtime.openOptionsPage();
  });
});

// Listen for storage changes so the popup updates live
chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== 'local') return;
  if (changes.slopifyState) {
    renderState(changes.slopifyState.newValue);
  }
  if (changes.backendType) {
    updateBackendLabel(changes.backendType.newValue);
  }
});
