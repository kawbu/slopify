// popup.js — Backend URL configuration

var urlInput = document.getElementById("backend-url-input");
var saveBtn = document.getElementById("save-btn");
var urlStatus = document.getElementById("url-status");

var DEFAULT_URL = "http://localhost:8000";

// Load existing URL on popup open
chrome.storage.local.get("backendUrl", function (result) {
  if (result.backendUrl) {
    urlInput.value = result.backendUrl;
    urlStatus.textContent = "Custom backend URL saved.";
    urlStatus.className = "status-saved";
  } else {
    urlStatus.textContent = "Using default: " + DEFAULT_URL;
    urlStatus.className = "status-default";
  }
});

saveBtn.addEventListener("click", function () {
  var url = urlInput.value.trim();

  if (!url) {
    // Reset to default
    chrome.storage.local.remove("backendUrl", function () {
      urlInput.value = "";
      urlStatus.textContent = "Reset to default: " + DEFAULT_URL;
      urlStatus.className = "status-default";
    });
    return;
  }

  chrome.storage.local.set({ backendUrl: url }, function () {
    urlStatus.textContent = "Backend URL saved!";
    urlStatus.className = "status-saved";
  });
});
