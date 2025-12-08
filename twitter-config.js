// Twitter Bot Configuration Script

document.addEventListener('DOMContentLoaded', async () => {
  // Load existing configuration
  await loadConfiguration();
  await updateStatus();

  // Event listeners
  document.getElementById('saveConfig').addEventListener('click', saveConfiguration);
  document.getElementById('testConfig').addEventListener('click', testConfiguration);
  document.getElementById('disableBot').addEventListener('click', disableBot);
  document.getElementById('backToMain').addEventListener('click', () => window.close());

  // Auto-save on input changes (with debounce)
  let saveTimeout;
  document.querySelectorAll('.input').forEach(input => {
    input.addEventListener('input', () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(saveConfiguration, 1000); // Auto-save after 1 second of no changes
    });
  });
});

async function loadConfiguration() {
  try {
    const result = await chrome.storage.sync.get(['twitterBotConfig']);
    const config = result.twitterBotConfig || {};

    // Populate form fields
    document.getElementById('apiKey').value = config.API_KEY || '';
    document.getElementById('apiSecret').value = config.API_SECRET || '';
    document.getElementById('accessToken').value = config.ACCESS_TOKEN || '';
    document.getElementById('accessTokenSecret').value = config.ACCESS_TOKEN_SECRET || '';
    document.getElementById('botUserId').value = config.BOT_USER_ID || '';
    document.getElementById('checkInterval').value = config.CHECK_INTERVAL || 2;

    console.log('Configuration loaded');
  } catch (error) {
    console.error('Error loading configuration:', error);
    showStatus('Error loading saved configuration', 'error');
  }
}

async function saveConfiguration() {
  try {
    const config = {
      API_KEY: document.getElementById('apiKey').value.trim(),
      API_SECRET: document.getElementById('apiSecret').value.trim(),
      ACCESS_TOKEN: document.getElementById('accessToken').value.trim(),
      ACCESS_TOKEN_SECRET: document.getElementById('accessTokenSecret').value.trim(),
      BOT_USER_ID: document.getElementById('botUserId').value.trim(),
      CHECK_INTERVAL: parseInt(document.getElementById('checkInterval').value) || 2
    };

    // Validate required fields
    const requiredFields = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET', 'BOT_USER_ID'];
    const missingFields = requiredFields.filter(field => !config[field]);

    if (missingFields.length > 0) {
      showStatus(`Missing required fields: ${missingFields.join(', ')}`, 'error');
      return;
    }

    // Save to Chrome storage
    await chrome.storage.sync.set({ twitterBotConfig: config });

    // Send update message to background script
    const response = await chrome.runtime.sendMessage({
      type: 'UPDATE_TWITTER_CONFIG',
      config: config
    });

    if (response.success) {
      showStatus('Configuration saved and bot enabled!', 'success');
    } else {
      showStatus(`Error: ${response.message}`, 'error');
    }

    // Update status
    setTimeout(updateStatus, 1000);

  } catch (error) {
    console.error('Error saving configuration:', error);
    showStatus('Error saving configuration', 'error');
  }
}

async function testConfiguration() {
  showStatus('Testing connection...', 'warning');

  try {
    // Get current config
    const config = {
      API_KEY: document.getElementById('apiKey').value.trim(),
      API_SECRET: document.getElementById('apiSecret').value.trim(),
      ACCESS_TOKEN: document.getElementById('accessToken').value.trim(),
      ACCESS_TOKEN_SECRET: document.getElementById('accessTokenSecret').value.trim(),
      BOT_USER_ID: document.getElementById('botUserId').value.trim()
    };

    // Validate fields
    const requiredFields = ['API_KEY', 'API_SECRET', 'ACCESS_TOKEN', 'ACCESS_TOKEN_SECRET', 'BOT_USER_ID'];
    const missingFields = requiredFields.filter(field => !config[field]);

    if (missingFields.length > 0) {
      showStatus(`Cannot test: Missing fields: ${missingFields.join(', ')}`, 'error');
      return;
    }

    // Test by trying to fetch user mentions (simplified test)
    const testUrl = `https://api.twitter.com/2/users/${config.BOT_USER_ID}/mentions?max_results=5`;

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${config.ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.ok) {
      showStatus('✓ Connection successful! Bot can access Twitter API', 'success');
    } else if (response.status === 401) {
      showStatus('✗ Authentication failed. Check your credentials', 'error');
    } else if (response.status === 403) {
      showStatus('✗ Permission denied. Check app permissions', 'error');
    } else {
      showStatus(`✗ API error: ${response.status} ${response.statusText}`, 'error');
    }

  } catch (error) {
    console.error('Test error:', error);
    showStatus('✗ Network error. Check your internet connection', 'error');
  }
}

async function disableBot() {
  try {
    // Clear configuration
    await chrome.storage.sync.remove(['twitterBotConfig']);

    // Send disable message to background script
    await chrome.runtime.sendMessage({
      type: 'UPDATE_TWITTER_CONFIG',
      config: {}
    });

    // Clear form
    document.querySelectorAll('.input').forEach(input => {
      if (input.type === 'number') {
        input.value = 2;
      } else {
        input.value = '';
      }
    });

    showStatus('Bot disabled and configuration cleared', 'warning');
    setTimeout(updateStatus, 1000);

  } catch (error) {
    console.error('Error disabling bot:', error);
    showStatus('Error disabling bot', 'error');
  }
}

async function updateStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TWITTER_STATUS' });

    if (response.enabled) {
      showStatus(`✓ Bot active (last check: ${response.lastSeenId || 'never'})`, 'success');
    } else {
      showStatus('○ Bot disabled', 'warning');
    }

  } catch (error) {
    console.error('Error checking status:', error);
    showStatus('✗ Cannot connect to background script', 'error');
  }
}

function showStatus(message, type) {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');

  statusIndicator.style.display = 'flex';
  statusText.textContent = message;

  // Remove existing classes
  statusDot.className = 'status-dot';

  // Add appropriate class
  statusDot.classList.add(type);

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusIndicator.style.display = 'none';
    }, 3000);
  }
}