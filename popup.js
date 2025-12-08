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

  // Check Twitter bot status
  const twitterStatus = document.getElementById('twitterStatus');
  const twitterDot = document.getElementById('twitterDot');

  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TWITTER_STATUS' });

    if (response.enabled) {
      twitterStatus.textContent = 'ACTIVE';
      twitterDot.classList.add('active');
    } else {
      twitterStatus.textContent = 'DISABLED';
      twitterDot.classList.add('warning');
    }
  } catch (error) {
    twitterStatus.textContent = 'ERROR';
    twitterDot.classList.add('error');
  }

  // Process Debate rectangle button
  const processDebateBtn = document.getElementById('processDebateBtn');
  processDebateBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('process-debate.html') });
  });

  // View Thread Analytics button - only show if on an analyzed thread
  const viewThreadBtn = document.getElementById('viewThreadAnalyticsBtn');

  // Get the current tab URL and check if this thread has been analyzed
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    const currentUrl = tabs[0]?.url || '';

    // Extract tweet ID from URL (e.g., https://x.com/user/status/1234567890)
    const tweetIdMatch = currentUrl.match(/\/status\/(\d+)/);

    if (tweetIdMatch) {
      const tweetId = tweetIdMatch[1];

      try {
        // Query the backend to see if this thread has been analyzed
        const response = await fetch(`http://localhost:3000/api/threads/lookup/${tweetId}`);
        const data = await response.json();

        if (data.success && data.found) {
          viewThreadBtn.style.display = 'flex';

          viewThreadBtn.addEventListener('click', () => {
            chrome.tabs.create({
              url: chrome.runtime.getURL(`analytics.html?spaceId=${data.spaceId}`)
            });
          });
        }
      } catch (error) {
        console.log('Could not check thread analysis status:', error);
      }
    }
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

