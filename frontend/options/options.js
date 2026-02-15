function updateSelectedStyles() {
  document.querySelectorAll('.option').forEach(function (el) {
    var radio = el.querySelector('input[type="radio"]');
    if (radio.checked) {
      el.classList.add('selected');
    } else {
      el.classList.remove('selected');
    }
  });
}

// Load saved settings
document.addEventListener('DOMContentLoaded', function () {
  chrome.storage.local.get(['backendType'], function (result) {
    var type = result.backendType || 'gemini';
    var radios = document.querySelectorAll('input[name="backendType"]');
    radios.forEach(function (r) {
      r.checked = r.value === type;
    });

    updateSelectedStyles();
  });

  // Update styles when selection changes
  document.querySelectorAll('input[name="backendType"]').forEach(function (radio) {
    radio.addEventListener('change', function () {
      updateSelectedStyles();
    });
  });

  // Save button
  document.getElementById('saveBtn').addEventListener('click', function () {
    var selected = document.querySelector('input[name="backendType"]:checked').value;

    chrome.storage.local.set({ backendType: selected }, function () {
      var status = document.getElementById('saveStatus');
      status.textContent = 'Settings saved!';
      setTimeout(function () {
        status.textContent = '';
      }, 2000);
    });
  });
});
