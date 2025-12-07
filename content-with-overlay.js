// Veritas - Auto-saves to backend WITH overlay UI
const BACKEND_URL = 'http://localhost:3000/api';

// Track state
let isMonitoring = false;
let currentSpace = null; // { id, title, url }
let currentSpeaker = null;
let currentSpeakerText = [];
let lastKnownUsername = null;
let processedCaptions = new Set();
let displayedMessages = []; // Messages shown in overlay

// Create overlay UI
function createOverlay() {
  if (document.getElementById('veritas-overlay')) return;

  // Inject CSS if not already present
  if (!document.getElementById('veritas-styles')) {
    const link = document.createElement('link');
    link.id = 'veritas-styles';
    link.rel = 'stylesheet';
    link.href = chrome.runtime.getURL('overlay.css');
    document.head.appendChild(link);
  }

  const overlay = document.createElement('div');
  overlay.id = 'veritas-overlay';
  overlay.innerHTML = `
    <div class="veritas-header">
      <div class="veritas-header-left">
        <div class="veritas-drag-handle">
          <div class="drag-dot"></div>
          <div class="drag-dot"></div>
          <div class="drag-dot"></div>
        </div>
        <h3>VERITAS</h3>
      </div>
      <button id="veritas-close" style="background: transparent; border: none; color: #ffffff; font-size: 20px; cursor: pointer; padding: 0; opacity: 0.5; transition: opacity 0.2s;">×</button>
    </div>
    <div class="veritas-stats">
      <div class="stat-item" data-tooltip="Messages Analyzed">
        <div class="stat-value" id="veritas-count">0</div>
      </div>
      <div class="stat-item" data-tooltip="Truthful Claims">
        <div class="stat-value truthful" id="truthful-count">0</div>
      </div>
      <div class="stat-item" data-tooltip="Questionable Claims">
        <div class="stat-value questionable" id="questionable-count">0</div>
      </div>
    </div>
    <div class="veritas-controls">
      <button class="veritas-button" id="manual-debate-btn">
        <span>MANUAL DEBATE ANALYSIS</span>
      </button>
    </div>
    <div class="veritas-claims" id="veritas-claims">
      <p class="placeholder">WAITING FOR CAPTIONS...</p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('veritas-close').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  document.getElementById('manual-debate-btn').addEventListener('click', () => {
    window.open(chrome.runtime.getURL('process-debate.html'), '_blank');
  });

  // Add hover effects
  const closeBtn = document.getElementById('veritas-close');
  closeBtn.addEventListener('mouseenter', () => closeBtn.style.opacity = '1');
  closeBtn.addEventListener('mouseleave', () => closeBtn.style.opacity = '0.5');
}

// Update overlay with new message
function updateOverlay(speaker, content, truthScore = null, explanation = null) {
  const claimsContainer = document.getElementById('veritas-claims');
  if (!claimsContainer) return;

  // Remove placeholder
  const placeholder = claimsContainer.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  // Create message element
  const messageDiv = document.createElement('div');
  messageDiv.className = 'claim-item';

  let scoreHTML = '';
  if (truthScore !== null) {
    let scoreClass = 'score-very-low';
    if (truthScore >= 8) scoreClass = 'score-high';
    else if (truthScore >= 6) scoreClass = 'score-medium';
    else if (truthScore >= 4) scoreClass = 'score-low';

    scoreHTML = `<div class="truth-score ${scoreClass}">Truth Score: ${truthScore}/10</div>`;
  }

  messageDiv.innerHTML = `
    <div class="claim-speaker">${speaker}</div>
    <div class="claim-text">${content}</div>
    ${scoreHTML}
    ${explanation ? `<div class="claim-explanation">${explanation}</div>` : ''}
    ${truthScore === null ? '<div class="live-indicator">Analyzing...</div>' : ''}
  `;

  // Add to top of list
  claimsContainer.insertBefore(messageDiv, claimsContainer.firstChild);

  // Update count
  displayedMessages.push({ speaker, content, truthScore, explanation, element: messageDiv });
  document.getElementById('veritas-count').textContent = displayedMessages.length;

  // Keep only last 20 messages
  if (displayedMessages.length > 20) {
    const removed = displayedMessages.shift();
    if (removed.element && removed.element.parentNode) {
      removed.element.remove();
    }
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TOGGLE_OVERLAY') {
    const overlay = document.getElementById('veritas-overlay');
    if (overlay) {
      overlay.style.display = overlay.style.display === 'none' ? 'flex' : 'none';
    } else {
      createOverlay();
    }
    sendResponse({ success: true });
  }
  return true;
});

// Auto-start
console.log('Veritas: Initializing with overlay...');
createOverlay();
startMonitoring();

// Create space automatically on first caption
async function ensureSpaceExists() {
  if (currentSpace) return currentSpace.id;

  try {
    const spaceUrl = window.location.href;

    const response = await fetch(`${BACKEND_URL}/spaces/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Twitter Space',
        space_url: spaceUrl,
        metadata: { started_at: new Date().toISOString() }
      })
    });

    const data = await response.json();
    currentSpace = {
      id: data.space_id,
      title: 'Twitter Space',
      url: spaceUrl
    };

    console.log('✓ Veritas: Space created:', currentSpace.id);
    return currentSpace.id;
  } catch (error) {
    console.error('Veritas: Error creating space:', error);
    return null;
  }
}

// Send message to backend
async function saveMessageToBackend(speaker, content) {
  try {
    const spaceId = await ensureSpaceExists();
    if (!spaceId) {
      console.error('Veritas: No space ID, cannot save message');
      return;
    }

    // Add to overlay immediately (without score)
    updateOverlay(speaker, content);

    const response = await fetch(`${BACKEND_URL}/messages/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        space_id: spaceId,
        speaker_username: speaker,
        content: content
      })
    });

    const data = await response.json();
    if (data.success) {
      console.log(`✓ Veritas: Message saved & queued for analysis`);

      // Poll for analysis results
      if (data.message_id) {
        pollForAnalysis(data.message_id, speaker, content);
      }
    }
  } catch (error) {
    console.error('Veritas: Error saving message:', error);
  }
}

// Poll for analysis results
async function pollForAnalysis(messageId, speaker, content) {
  let attempts = 0;
  const maxAttempts = 10; // 10 seconds max

  const poll = setInterval(async () => {
    attempts++;

    try {
      const response = await fetch(`${BACKEND_URL}/messages/${messageId}`);
      const data = await response.json();

      if (data.message && data.message.fact_check_status === 'completed') {
        clearInterval(poll);

        // Update the overlay with results
        const messageIndex = displayedMessages.findIndex(
          m => m.speaker === speaker && m.content === content && m.truthScore === null
        );

        if (messageIndex !== -1 && displayedMessages[messageIndex].element) {
          const msg = displayedMessages[messageIndex];
          msg.truthScore = data.message.truth_score;
          msg.explanation = data.message.grok_explanation;

          // Update the element
          const element = msg.element;
          const liveIndicator = element.querySelector('.live-indicator');
          if (liveIndicator) liveIndicator.remove();

          if (data.message.truth_score !== null) {
            let scoreClass = 'score-very-low';
            if (data.message.truth_score >= 8) scoreClass = 'score-high';
            else if (data.message.truth_score >= 6) scoreClass = 'score-medium';
            else if (data.message.truth_score >= 4) scoreClass = 'score-low';

            const scoreDiv = document.createElement('div');
            scoreDiv.className = `truth-score ${scoreClass}`;
            scoreDiv.textContent = `Truth Score: ${data.message.truth_score}/10`;
            element.insertBefore(scoreDiv, element.querySelector('.claim-explanation') || null);
          }

          if (data.message.grok_explanation) {
            const explanationDiv = document.createElement('div');
            explanationDiv.className = 'claim-explanation';
            explanationDiv.textContent = data.message.grok_explanation;
            element.appendChild(explanationDiv);
          }
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        console.log('Veritas: Analysis timeout for message', messageId);
      }
    } catch (error) {
      console.error('Veritas: Error polling for analysis:', error);
      clearInterval(poll);
    }
  }, 1000); // Poll every second
}

// Monitor for captions
function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  console.log('Veritas: Monitoring captions...');

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          const layersContainer = document.getElementById('layers');
          if (!layersContainer || !layersContainer.contains(node)) return;

          // Find caption containers
          let captionContainers = [];
          if (node.classList && node.classList.contains('r-13awgt0') && node.classList.contains('r-1lzbym2')) {
            captionContainers.push(node);
          }
          if (node.querySelectorAll) {
            const containers = node.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');
            captionContainers.push(...containers);
          }

          // Extract captions
          captionContainers.forEach(container => {
            const captionDivs = container.querySelectorAll('div.css-146c3p1[dir="ltr"]');
            captionDivs.forEach(captionDiv => {
              const captionSpan = captionDiv.querySelector('span.css-1jxf684');
              if (!captionSpan) return;

              const text = captionSpan.textContent.trim();
              if (!text) return;

              // Skip UI elements
              if (text.startsWith('@') || text === 'Host') return;
              if (isUIText(text)) return;
              if (processedCaptions.has(text)) return;

              // Skip display names
              if (isDisplayName(text, container)) return;

              // Find username
              let username = findUsername(container) || lastKnownUsername || 'Unknown';
              if (username !== 'Unknown') lastKnownUsername = username;

              // Process caption
              processedCaptions.add(text);
              addCaptionToGroup(text, username);
            });
          });
        }
      });
    });
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Check if text is a display name
function isDisplayName(text, container) {
  const displayNamePattern = /^[A-Z][a-z]+([''-]?[A-Za-z]+)?(\s[A-Z][a-z]+([''-]?[A-Za-z]+)?){1,2}$/;
  if (!displayNamePattern.test(text)) return false;

  const allSpans = container.querySelectorAll('span.css-1jxf684');
  const hasUsername = Array.from(allSpans).some(span => {
    const spanText = span.textContent.trim();
    return spanText.startsWith('@') && !spanText.includes(' ');
  });

  return hasUsername;
}

// Find username in container
function findUsername(container) {
  const allSpans = container.querySelectorAll('span.css-1jxf684');
  for (const span of allSpans) {
    const spanText = span.textContent.trim();
    if (spanText.startsWith('@') && !spanText.includes(' ')) {
      return spanText;
    }
  }
  return null;
}

// Check if text is UI element
function isUIText(text) {
  const uiPatterns = [
    'End Space', 'Yes, end', 'Cancel', 'Report this Space',
    'Show captions', 'Hide captions', 'Microphone settings',
    /^\d+ captions?$/, /^Log out @/, /^@\w+$/,
    /^Delete$/, /^Mute$/, /^Unmute$/
  ];
  return uiPatterns.some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(text);
    return text.includes(pattern);
  });
}

// Group captions by speaker
function addCaptionToGroup(text, username) {
  if (username !== currentSpeaker) {
    // Speaker changed - save previous message
    if (currentSpeaker && currentSpeakerText.length > 0) {
      const fullText = currentSpeakerText.join(' ');
      console.log(`Veritas: ${currentSpeaker}: "${fullText}"`);

      // Save to backend
      saveMessageToBackend(currentSpeaker, fullText);
    }

    // Start new group
    currentSpeaker = username;
    currentSpeakerText = [text];
  } else {
    // Same speaker - add to group
    currentSpeakerText.push(text);
  }
}

console.log('Veritas: Ready. Overlay visible, auto-saving to backend.');
