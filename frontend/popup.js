// popup.js — API key management

var keyInput = document.getElementById("api-key-input");
var saveBtn = document.getElementById("save-btn");
var keyStatus = document.getElementById("key-status");

// Load existing key status on popup open
chrome.storage.local.get("apiKey", function (result) {
  if (result.apiKey) {
    keyInput.placeholder = "Key saved (click Save to update)";
    keyStatus.textContent = "API key is saved.";
    keyStatus.className = "status-saved";
  } else {
    keyStatus.textContent = "No API key set.";
    keyStatus.className = "status-missing";
  }
});

saveBtn.addEventListener("click", function () {
  var key = keyInput.value.trim();
  if (!key) {
    keyStatus.textContent = "Please enter an API key.";
    keyStatus.className = "status-missing";
    return;
  }

  chrome.storage.local.set({ apiKey: key }, function () {
    keyInput.value = "";
    keyInput.placeholder = "Key saved (click Save to update)";
    keyStatus.textContent = "API key saved!";
    keyStatus.className = "status-saved";
  });
});
