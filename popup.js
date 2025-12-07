// Popup script for Veritas extension

document.addEventListener('DOMContentLoaded', async () => {
  // Check backend health
  const backendStatus = document.getElementById('backendStatus');
  const backendDot = document.getElementById('backendDot');

  try {
    const response = await fetch('http://localhost:3000/api/health');
    const data = await response.json();

    if (data.status === 'ok') {
      backendStatus.textContent = 'CONNECTED';
      backendDot.classList.add('active');
    } else {
      backendStatus.textContent = 'UNHEALTHY';
      backendDot.classList.add('warning');
    }
  } catch (error) {
    backendStatus.textContent = 'OFFLINE';
    backendDot.classList.add('error');
  }

  // Process Debate rectangle button
  const processDebateBtn = document.getElementById('processDebateBtn');
  processDebateBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('process-debate.html') });
  });

  // Toggle overlay button
  const toggleButton = document.getElementById('toggleOverlay');
  toggleButton.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab) return;

      if (!tab.url || (!tab.url.includes('twitter.com') && !tab.url.includes('x.com'))) {
        backendStatus.textContent = 'INVALID PAGE';
        backendDot.className = 'status-indicator error';
        return;
      }

      chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }, () => {
        // Silently handle the case where content script isn't ready
        // This is expected on pages that don't have the content script
        void chrome.runtime.lastError;
      });
    });
  });
});

