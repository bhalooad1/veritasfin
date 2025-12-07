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
let pollingMessageIds = new Set(); // Track messages being polled to prevent duplicates
let liveMessageElement = null; // Current live message element being updated
let truthfulCount = 0; // Messages with score >= 6
let questionableCount = 0; // Messages with score < 6

// Debug function - accessible from console
window.veritasDebug = {
  getProcessedCaptions: () => Array.from(processedCaptions),
  getDisplayedMessages: () => displayedMessages,
  getCurrentSpace: () => currentSpace,
  isMonitoring: () => isMonitoring,
  clearProcessed: () => processedCaptions.clear()
};

// Create overlay UI
function createOverlay() {
  if (document.getElementById('veritas-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'veritas-overlay';
  overlay.innerHTML = `
    <div class="veritas-main-view">
      <div class="veritas-header" id="veritas-header">
        <div class="veritas-header-left">
          <div class="veritas-drag-handle" id="veritas-drag">
            <span class="drag-dot"></span>
            <span class="drag-dot"></span>
            <span class="drag-dot"></span>
          </div>
          <h3>VERITAS</h3>
        </div>
        <div class="veritas-header-right">
          <button id="veritas-analytics" class="veritas-icon-button" title="Analytics">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="4" y1="20" x2="4" y2="8" stroke-linecap="round"/>
              <line x1="9" y1="20" x2="9" y2="12" stroke-linecap="round"/>
              <line x1="14" y1="20" x2="14" y2="5" stroke-linecap="round"/>
              <line x1="19" y1="20" x2="19" y2="14" stroke-linecap="round"/>
            </svg>
          </button>
          <button id="veritas-close" class="veritas-icon-button">×</button>
        </div>
      </div>
      <div class="veritas-stats">
        <div class="stat-item" data-tooltip="TOTAL">
          <div class="stat-value" id="veritas-total">0</div>
        </div>
        <div class="stat-item" data-tooltip="TRUTHFUL">
          <div class="stat-value truthful" id="veritas-truthful">0</div>
        </div>
        <div class="stat-item" data-tooltip="QUESTIONABLE">
          <div class="stat-value questionable" id="veritas-questionable">0</div>
        </div>
      </div>
      <div class="veritas-claims" id="veritas-claims">
        <p class="placeholder">WAITING FOR CAPTIONS...</p>
      </div>
    </div>
    <div class="veritas-detail-view" id="veritas-detail" style="display: none;">
      <div class="detail-header">
        <button class="back-button" id="veritas-back">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
            <path d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"/>
          </svg>
        </button>
        <h3>ANALYSIS DETAILS</h3>
      </div>
      <div class="detail-content" id="veritas-detail-content">
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('veritas-close').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  document.getElementById('veritas-analytics').addEventListener('click', async () => {
    // Open analytics page
    let spaceId = currentSpace ? currentSpace.id : null;

    if (!spaceId) {
      // Try to ensure space exists if we have a URL
      spaceId = await ensureSpaceExists();
    }

    if (spaceId) {
      chrome.runtime.sendMessage({ type: 'OPEN_ANALYTICS', spaceId });
    } else {
      alert('Veritas: No active Twitter Space detected. Please join a Space first.');
    }
  });

  document.getElementById('veritas-back').addEventListener('click', () => {
    hideDetailView();
  });

  // Make overlay draggable
  makeDraggable(overlay);
}

// Show detail view for a message
function showDetailView(displayName, username, content, truthScore, explanation, rawResponse) {
  const mainView = document.querySelector('.veritas-main-view');
  const detailView = document.getElementById('veritas-detail');
  const detailContent = document.getElementById('veritas-detail-content');

  // Debug: Log what we received
  console.log('Veritas DEBUG: Detail view received:', {
    truthScore,
    explanation,
    rawResponse
  });

  // Try to parse structured response if available
  let claims = [];
  let summary = explanation;

  if (rawResponse && typeof rawResponse === 'object') {
    claims = rawResponse.claims || [];
    summary = rawResponse.summary || explanation;
    console.log('Veritas DEBUG: Found claims:', claims);
  }

  // Determine score class and color
  let scoreClass = 'score-very-low';
  let scoreLabel = 'Very Low';
  if (truthScore >= 7) {
    scoreClass = 'score-high';
    scoreLabel = 'High';
  } else if (truthScore >= 5) {
    scoreClass = 'score-medium';
    scoreLabel = 'Medium';
  } else if (truthScore >= 3) {
    scoreClass = 'score-low';
    scoreLabel = 'Low';
  }

  // Build claims HTML
  let claimsHTML = '';
  if (claims.length > 0) {
    claimsHTML = '<div class="claims-breakdown">';

    claims.forEach(claim => {
      const claimScore = claim.score || 5;
      const verdict = (claim.verdict || 'UNVERIFIABLE').toLowerCase();

      // Generate score dots
      let dotsHTML = '<div class="score-dots">';
      for (let i = 1; i <= 10; i++) {
        const filled = i <= claimScore ? 'filled' : '';
        const color = claimScore >= 7 ? '#44ff44' : claimScore >= 5 ? '#ffd700' : claimScore >= 3 ? '#ff8c42' : '#ff4444';
        dotsHTML += `<span class="score-dot ${filled}" style="color: ${color}"></span>`;
      }
      dotsHTML += '</div>';

      // Generate sources HTML
      let sourcesHTML = '';
      if (claim.sources && claim.sources.length > 0) {
        sourcesHTML = '<div class="claim-sources-wrapper">';
        sourcesHTML += '<div class="claim-sources-title">SOURCES</div>';
        sourcesHTML += '<div class="claim-sources-divider"></div>';
        sourcesHTML += '<div class="claim-sources">';
        claim.sources.forEach((source, idx) => {
          // Check if it's a Grokipedia link
          if (source.includes('grokipedia.com')) {
            // Add claim hash for scrolling
            const claimHash = `#veritas-claim=${encodeURIComponent(claim.text)}`;
            const fullUrl = source.includes('#') ? source : source + claimHash;
            sourcesHTML += `<a href="${fullUrl}" target="_blank" class="claim-source-link grokipedia-link">grokipedia</a>`;
          } else {
            // Extract domain from URL for regular links
            let domain = source;
            try {
              const url = new URL(source);
              domain = url.hostname.replace('www.', '');
            } catch (e) {
              // Use as-is if not a valid URL
            }
            sourcesHTML += `<a href="${source}" target="_blank" class="claim-source-link">${domain}</a>`;
          }
          if (idx < claim.sources.length - 1) {
            sourcesHTML += '<span class="claim-source-separator"> › </span>';
          }
        });
        sourcesHTML += '</div>';
        sourcesHTML += '</div>';
      }

      claimsHTML += `
        <div class="claim-item-detail">
          <div class="claim-quote">${claim.text}</div>
          <div class="claim-score-visual">
            ${dotsHTML}
            <span class="claim-verdict-badge ${verdict}">${verdict}</span>
          </div>
          <div class="claim-explanation">${claim.explanation || 'No explanation available'}</div>
          ${sourcesHTML}
        </div>
      `;
    });

    claimsHTML += `<div class="analysis-summary">VERDICT: ${summary}</div>`;
    claimsHTML += '</div>';
  }

  detailContent.innerHTML = `
    <div class="detail-speaker">
      <div class="detail-speaker-name">${displayName}</div>
      <div class="detail-speaker-username">${username}</div>
    </div>

    <div class="detail-claim">${content}</div>

    <div class="detail-score-section">
      <div class="detail-score-label">TRUTH SCORE</div>
      <div class="detail-score-value ${scoreClass}">
        <span class="score-number-large">${truthScore || '—'}</span>
        <span class="score-total-large">/10</span>
      </div>
      <div class="detail-score-bar">
        <div class="score-bar-fill ${scoreClass}" style="width: ${(truthScore || 0) * 10}%"></div>
      </div>
      <div class="detail-score-rating">${scoreLabel.toUpperCase()} CREDIBILITY</div>
    </div>

    <div class="detail-explanation-section">
      <div class="detail-explanation-label">ANALYSIS</div>
      ${claimsHTML || `<div class="detail-explanation-text">${summary || 'No detailed analysis available.'}</div>`}
    </div>
  `;

  // Slide in animation
  mainView.style.display = 'none';
  detailView.style.display = 'flex';
}

// Hide detail view and return to main
function hideDetailView() {
  const mainView = document.querySelector('.veritas-main-view');
  const detailView = document.getElementById('veritas-detail');

  detailView.style.display = 'none';
  mainView.style.display = 'flex';
}

// Update stats display
function updateStats() {
  const totalEl = document.getElementById('veritas-total');
  const truthfulEl = document.getElementById('veritas-truthful');
  const questionableEl = document.getElementById('veritas-questionable');

  if (totalEl) totalEl.textContent = displayedMessages.length;
  if (truthfulEl) truthfulEl.textContent = truthfulCount;
  if (questionableEl) questionableEl.textContent = questionableCount;
}

// Make overlay draggable
function makeDraggable(overlay) {
  const dragHandle = document.getElementById('veritas-drag');
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  dragHandle.addEventListener('mousedown', dragStart);
  document.addEventListener('mousemove', drag);
  document.addEventListener('mouseup', dragEnd);

  function dragStart(e) {
    initialX = e.clientX - xOffset;
    initialY = e.clientY - yOffset;
    isDragging = true;
    overlay.style.transition = 'none';
  }

  function drag(e) {
    if (isDragging) {
      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;
      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, overlay);
    }
  }

  function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
  }

  function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }
}

// Create or update live message (currently speaking)
function updateLiveMessage(displayName, username, content) {
  console.log('Veritas DEBUG: updateLiveMessage called for', displayName, username, 'liveMessageElement exists?', !!liveMessageElement);

  const claimsContainer = document.getElementById('veritas-claims');
  if (!claimsContainer) {
    console.log('Veritas DEBUG: No claims container found!');
    return;
  }

  // Remove placeholder
  const placeholder = claimsContainer.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  // If no live message element exists, create it
  if (!liveMessageElement) {
    console.log('Veritas DEBUG: Creating new live message element');
    liveMessageElement = document.createElement('div');
    liveMessageElement.className = 'claim-item live-preview';
    claimsContainer.insertBefore(liveMessageElement, claimsContainer.firstChild);
  } else {
    console.log('Veritas DEBUG: Updating existing live message element');
  }

  // Update live message content with display name and username
  liveMessageElement.innerHTML = `
    <div class="claim-speaker">
      <span class="speaker-name">${displayName}</span>
      <span class="speaker-username">${username}</span>
    </div>
    <div class="claim-text">${content}</div>
    <div class="live-indicator"><span class="live-dot"></span>LIVE</div>
  `;
  console.log('Veritas DEBUG: Live message updated');
}

// Convert live message to analyzing state
function finalizeLiveMessage(displayName, username, content) {
  console.log('Veritas DEBUG: finalizeLiveMessage called for', displayName, username, 'liveMessageElement exists?', !!liveMessageElement);

  if (liveMessageElement) {
    console.log('Veritas DEBUG: Finalizing live message, changing to Analyzing...');

    // Change from LIVE to Analyzing
    liveMessageElement.classList.remove('live-preview');
    liveMessageElement.classList.add('analyzing');
    liveMessageElement.innerHTML = `
      <div class="claim-speaker">
        <span class="speaker-name">${displayName}</span>
        <span class="speaker-username">${username}</span>
      </div>
      <div class="claim-text">${content}</div>

      <div class="live-indicator">ANALYZING<span class="loading-dots"></span></div>
    `;

    // Add to tracked messages
    displayedMessages.push({
      displayName,
      username,
      content,
      truthScore: null,
      explanation: null,
      element: liveMessageElement
    });

    // Update count
    updateStats();

    // Reset live element so next speaker gets a new one
    console.log('Veritas DEBUG: Setting liveMessageElement to null');
    liveMessageElement = null;

    // Keep only last 20 messages
    if (displayedMessages.length > 20) {
      const removed = displayedMessages.shift();
      if (removed.element && removed.element.parentNode) {
        removed.element.remove();
      }
    }
  } else {
    console.log('Veritas DEBUG: No live message element to finalize!');
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
    return false; // Synchronous response
  }
  return true; // Keep open for other async messages
});

// Auto-start
console.log('Veritas: Initializing with overlay...');
createOverlay();
startMonitoring();

// Create space immediately if on a Space page
if (window.location.href.includes('/spaces/')) {
  console.log('Veritas: On Space page - creating space session...');
  ensureSpaceExists().then(spaceId => {
    if (spaceId) {
      console.log('✅ Veritas: Space session ready for end detection');
    } else {
      console.warn('⚠️  Veritas: Failed to create space session');
    }
  });
}

// Extract the hosting tweet URL for this Space
function getSpaceTweetUrl() {
  console.log('Veritas DEBUG: Extracting tweet URL for Space...');
  console.log('Veritas DEBUG: Current URL:', window.location.href);

  // Look for article elements that contain a Space link
  const articles = document.querySelectorAll('article');
  console.log(`Veritas DEBUG: Found ${articles.length} articles on page`);

  // Find all articles with Space links
  const spaceTweets = [];
  for (const article of articles) {
    const spaceLink = article.querySelector('a[href*="/i/spaces/"]');
    if (spaceLink) {
      const tweetLink = article.querySelector('a[href*="/status/"]');
      if (tweetLink) {
        // Get full URL (handle both relative and absolute URLs)
        let tweetUrl = tweetLink.href;
        if (!tweetUrl.startsWith('http')) {
          tweetUrl = 'https://x.com' + tweetUrl;
        }

        spaceTweets.push({
          article,
          spaceUrl: spaceLink.href,
          tweetUrl: tweetUrl
        });
        console.log(`Veritas DEBUG: Found Space tweet #${spaceTweets.length}:`, tweetUrl);
      }
    }
  }

  console.log(`Veritas DEBUG: Total tweets with Space links: ${spaceTweets.length}`);

  if (spaceTweets.length > 0) {
    // Return the FIRST one (topmost/most recent on Twitter)
    const mostRecent = spaceTweets[0];
    console.log('✅ Veritas: Using topmost Space tweet URL:', mostRecent.tweetUrl);
    console.log('   Space link:', mostRecent.spaceUrl);
    return mostRecent.tweetUrl;
  }

  // Fallback to space URL if tweet not found
  console.log('⚠️  Veritas: Could not find hosting tweet, using current URL');
  return window.location.href;
}

// Create space automatically on first caption
async function ensureSpaceExists() {
  if (currentSpace) return currentSpace.id;

  try {
    console.log('Veritas DEBUG: Creating space at', `${BACKEND_URL}/spaces/create`);
    const spaceUrl = getSpaceTweetUrl();

    const response = await fetch(`${BACKEND_URL}/spaces/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'X Space',
        space_url: spaceUrl,
        metadata: { started_at: new Date().toISOString() }
      })
    });

    console.log('Veritas DEBUG: Response status:', response.status);
    const data = await response.json();
    console.log('Veritas DEBUG: Response data:', data);

    currentSpace = {
      id: data.space_id,
      title: 'Twitter Space',
      url: spaceUrl
    };

    // Store space ID for space-end-detector
    chrome.storage.local.set({ currentSpaceId: currentSpace.id }, () => {
      console.log('✓ Veritas: Space ID stored for end detection:', currentSpace.id);
    });

    console.log('✓ Veritas: Space created:', currentSpace.id);
    return currentSpace.id;
  } catch (error) {
    console.error('Veritas: Error creating space:', error);
    console.error('Veritas DEBUG: Error details:', error.message, error.stack);
    return null;
  }
}

// Send message to backend (without finalizing - already done)
async function saveMessageToBackendWithoutFinalize(speaker, content) {
  try {
    const spaceId = await ensureSpaceExists();
    if (!spaceId) {
      console.error('Veritas: No space ID, cannot save message');
      return;
    }

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
    console.log('Veritas DEBUG: Backend response:', data);

    if (data.success) {
      console.log(`✓ Veritas: Message saved & queued for analysis`);

      // Poll for analysis results
      if (data.message_id) {
        console.log('Veritas DEBUG: Starting polling for message_id:', data.message_id);
        pollForAnalysis(data.message_id, speaker, content);
      } else {
        console.log('Veritas DEBUG: No message_id in response!', data);
      }
    }
  } catch (error) {
    console.error('Veritas: Error saving message:', error);
  }
}

// Poll for analysis results
async function pollForAnalysis(messageId, speaker, content) {
  // Check if already polling for this message
  if (pollingMessageIds.has(messageId)) {
    console.log('Veritas DEBUG: Already polling for message', messageId, '- skipping duplicate');
    return;
  }

  // Add to tracking set
  pollingMessageIds.add(messageId);

  let attempts = 0;
  const maxAttempts = 60; // 60 seconds max for Grok 4 reasoning model

  console.log('Veritas DEBUG: Starting poll for message', messageId);

  const poll = setInterval(async () => {
    attempts++;

    try {
      const response = await fetch(`${BACKEND_URL}/messages/${messageId}`);
      const result = await response.json();

      // Backend returns { success: true, data: <message> }
      const message = result.data;

      console.log('Veritas DEBUG: Poll attempt', attempts, 'status:', message?.fact_check_status);

      if (message && (message.fact_check_status === 'completed' || message.fact_check_status === 'failed')) {
        clearInterval(poll);
        pollingMessageIds.delete(messageId); // Remove from tracking

        if (message.fact_check_status === 'failed') {
          console.log('Veritas DEBUG: Analysis failed for message', messageId);
          // Remove the "Analyzing" indicator but don't show score
          const messageIndex = displayedMessages.findIndex(
            m => m.username === speaker && m.content === content && m.truthScore === null
          );
          if (messageIndex !== -1 && displayedMessages[messageIndex].element) {
            const element = displayedMessages[messageIndex].element;
            const liveIndicator = element.querySelector('.live-indicator');
            if (liveIndicator) liveIndicator.remove();

            // Add failed indicator
            const failedDiv = document.createElement('div');
            failedDiv.className = 'score-skip';
            failedDiv.textContent = 'ANALYSIS FAILED';
            failedDiv.style.color = '#ff4444';
            element.appendChild(failedDiv);
            element.classList.remove('analyzing');
            element.classList.add('completed');
          }
          return;
        }

        console.log('Veritas DEBUG: Analysis completed!', message);

        // Update the overlay with results
        const messageIndex = displayedMessages.findIndex(
          m => m.username === speaker && m.content === content && m.truthScore === null
        );

        console.log('Veritas DEBUG: Found message at index', messageIndex);

        if (messageIndex !== -1 && displayedMessages[messageIndex].element) {
          const msg = displayedMessages[messageIndex];
          msg.truthScore = message.truth_score;
          msg.explanation = message.grok_explanation;
          msg.rawResponse = message.grok_response_raw;

          // Debug: Log the raw response structure
          console.log('Veritas DEBUG: grok_response_raw:', message.grok_response_raw);

          // Update the element
          const element = msg.element;
          const liveIndicator = element.querySelector('.live-indicator');
          if (liveIndicator) liveIndicator.remove();

          // Remove any existing score elements before adding new one
          const existingScore = element.querySelector('.truth-score, .score-skip');
          if (existingScore) {
            console.log('Veritas DEBUG: Removing existing score element before update');
            existingScore.remove();
          }

          // Add completed animation
          element.classList.remove('analyzing');
          element.classList.add('completed');

          if (message.truth_score !== null && message.truth_score !== undefined) {
            // Has truth score - show clickable pill
            console.log(`Veritas DEBUG: Adding truth score ${message.truth_score} to element`);
            let scoreClass = 'score-very-low';
            if (message.truth_score >= 7) scoreClass = 'score-high';
            else if (message.truth_score >= 5) scoreClass = 'score-medium';
            else if (message.truth_score >= 3) scoreClass = 'score-low';

            const scoreDiv = document.createElement('div');
            scoreDiv.className = `truth-score ${scoreClass} clickable`;
            scoreDiv.innerHTML = `<span class="score-number">${message.truth_score}</span><span class="score-total">/10</span>`;

            // Store explanation in data attribute
            scoreDiv.dataset.explanation = message.grok_explanation || 'No explanation available';
            scoreDiv.dataset.score = message.truth_score;
            scoreDiv.dataset.speaker = msg.displayName;
            scoreDiv.dataset.content = msg.content;

            // Add click handler to show detail view
            scoreDiv.addEventListener('click', () => {
              showDetailView(msg.displayName, msg.username, msg.content, message.truth_score, message.grok_explanation, message.grok_response_raw);
            });

            element.appendChild(scoreDiv);
            console.log(`Veritas DEBUG: Successfully added truth score ${message.truth_score} to element`);

            // Update stats based on score
            if (message.truth_score >= 6) {
              truthfulCount++;
            } else {
              questionableCount++;
            }
            updateStats();
          } else {
            // No score - could be opinion, too short, or no factual claims
            console.log('Veritas DEBUG: No truth score for message');
            const skipDiv = document.createElement('div');
            skipDiv.className = 'score-skip';

            // Check message length to determine appropriate message
            const messageLength = msg.content ? msg.content.length : 0;
            if (messageLength > 100) {
              // Long message with no score = likely opinion or no factual claims
              skipDiv.textContent = 'OPINION/NO CLAIMS';
              skipDiv.title = 'This appears to be an opinion or contains no verifiable factual claims';
            } else {
              // Short message
              skipDiv.textContent = 'TOO SHORT TO ANALYZE';
              skipDiv.title = 'Message is too short for meaningful fact-checking';
            }

            element.appendChild(skipDiv);
          }
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(poll);
        pollingMessageIds.delete(messageId); // Remove from tracking
        console.log('Veritas: Analysis timeout for message', messageId);
      }
    } catch (error) {
      console.error('Veritas: Error polling for analysis:', error);
      clearInterval(poll);
      pollingMessageIds.delete(messageId); // Remove from tracking
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
          if (!layersContainer || !layersContainer.contains(node)) {
            console.log('Veritas DEBUG: Node not in layers container');
            return;
          }

          // Find caption containers
          let captionContainers = [];
          if (node.classList && node.classList.contains('r-13awgt0') && node.classList.contains('r-1lzbym2')) {
            console.log('Veritas DEBUG: Found caption container via classList');
            captionContainers.push(node);
          }
          if (node.querySelectorAll) {
            const containers = node.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');
            if (containers.length > 0) {
              console.log('Veritas DEBUG: Found', containers.length, 'caption containers via querySelectorAll');
            }
            captionContainers.push(...containers);
          }

          if (captionContainers.length > 0) {
            console.log('Veritas DEBUG: Processing', captionContainers.length, 'caption containers');
          }

          // Extract captions
          captionContainers.forEach(container => {
            const captionDivs = container.querySelectorAll('div.css-146c3p1[dir="ltr"]');
            console.log('Veritas DEBUG: Found', captionDivs.length, 'caption divs in container');

            captionDivs.forEach(captionDiv => {
              // Get ALL spans in this caption div
              const allSpans = captionDiv.querySelectorAll('span.css-1jxf684');
              if (allSpans.length === 0) {
                console.log('Veritas DEBUG: No caption spans found');
                return;
              }

              console.log('Veritas DEBUG: Found', allSpans.length, 'spans in caption div');

              // Find username and display name first
              let username = findUsername(container) || lastKnownUsername || 'Unknown';
              let displayName = findDisplayName(container) || username;
              if (username !== 'Unknown') lastKnownUsername = username;

              console.log('Veritas DEBUG: Container has username:', username, 'displayName:', displayName);

              // Process each span
              allSpans.forEach((captionSpan, spanIndex) => {
                const text = captionSpan.textContent.trim();
                if (!text) {
                  console.log('Veritas DEBUG: Empty text');
                  return;
                }

                console.log('Veritas DEBUG: [Span', spanIndex, '] Found text:', text);

                // Skip UI elements
                if (text.startsWith('@') || text === 'Host') {
                  console.log('Veritas DEBUG: [Span', spanIndex, '] Skipped - starts with @ or is Host');
                  return;
                }
                if (isUIText(text)) {
                  console.log('Veritas DEBUG: [Span', spanIndex, '] Skipped - is UI text');
                  return;
                }
                if (processedCaptions.has(text)) {
                  console.log('Veritas DEBUG: [Span', spanIndex, '] Skipped - already processed');
                  return;
                }

                // Skip if text matches the display name we found for this container
                if (text === displayName) {
                  console.log('Veritas DEBUG: [Span', spanIndex, '] Skipped - matches container display name');
                  return;
                }

                // Skip display names (check against the parent container, not just this div)
                const isName = isDisplayName(text, container);
                console.log('Veritas DEBUG: [Span', spanIndex, '] isDisplayName check:', isName, 'for text:', text);

                if (isName) {
                  console.log('Veritas DEBUG: [Span', spanIndex, '] Skipped - is display name');
                  return;
                }

                console.log('Veritas DEBUG: [Span', spanIndex, '] ✓ PROCESSING CAPTION:', text, 'from', displayName, username);

                // Process caption
                processedCaptions.add(text);
                addCaptionToGroup(text, username, displayName);
              });
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

  console.log('Veritas: MutationObserver started');
}

// Check if text is a display name
function isDisplayName(text, captionDiv) {
  console.log('Veritas DEBUG: isDisplayName checking:', text);

  // Pattern for display names: starts with capital letter, no lowercase start, relatively short
  // Matches: "Test", "Adam Bhaloo", "John Smith", etc.
  // Does NOT match: "hello there", "going to this space"
  const displayNamePattern = /^[A-Z][A-Za-z'\-\s]{0,30}$/;

  // Must start with capital and be reasonably short (display names are typically < 30 chars)
  const matchesPattern = displayNamePattern.test(text);
  console.log('Veritas DEBUG:   - Matches pattern:', matchesPattern);
  if (!matchesPattern) return false;

  // Additional check: display names don't usually have common sentence words
  const sentenceWords = ['the', 'this', 'that', 'is', 'are', 'was', 'were', 'have', 'has', 'had', 'will', 'would', 'could', 'should'];
  const lowerText = text.toLowerCase();
  const hasCommonWords = sentenceWords.some(word => lowerText.includes(' ' + word + ' ') || lowerText.startsWith(word + ' ') || lowerText.endsWith(' ' + word));
  console.log('Veritas DEBUG:   - Has common words:', hasCommonWords);
  if (hasCommonWords) return false;

  // Check if there's a username (@handle) in the same caption div
  const allSpans = captionDiv.querySelectorAll('span.css-1jxf684');
  const usernameSpans = Array.from(allSpans).filter(span => {
    const spanText = span.textContent.trim();
    return spanText.startsWith('@') && !spanText.includes(' ');
  });
  const hasUsername = usernameSpans.length > 0;
  console.log('Veritas DEBUG:   - Has username in same div:', hasUsername, 'usernames:', usernameSpans.map(s => s.textContent));

  // If there's a username in the same div AND text matches name pattern, it's likely a display name
  const result = hasUsername;
  console.log('Veritas DEBUG:   - Final result:', result);
  return result;
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

// Find display name in container (e.g., "Adam Bhaloo", "Test")
function findDisplayName(container) {
  const allSpans = container.querySelectorAll('span.css-1jxf684');
  const displayNamePattern = /^[A-Z][A-Za-z'\-\s]{0,30}$/;

  for (const span of allSpans) {
    const spanText = span.textContent.trim();
    // Check if it matches display name pattern and is in same container as a username
    if (displayNamePattern.test(spanText)) {
      // Verify there's a username nearby
      const hasUsername = Array.from(allSpans).some(s => s.textContent.trim().startsWith('@'));
      if (hasUsername) {
        return spanText;
      }
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

// Track current speaker's display name
let currentDisplayName = null;

// Group captions by speaker
function addCaptionToGroup(text, username, displayName) {
  console.log('Veritas DEBUG: addCaptionToGroup called with:', text, username, displayName);
  console.log('Veritas DEBUG: currentSpeaker:', currentSpeaker);

  if (username !== currentSpeaker) {
    console.log('Veritas DEBUG: Speaker changed from', currentSpeaker, 'to', username);

    // Speaker changed - finalize and save previous message IF there was one
    if (currentSpeaker && currentSpeakerText.length > 0) {
      const fullText = currentSpeakerText.join(' ');
      console.log(`Veritas: ${currentSpeaker}: "${fullText}"`);

      // FIRST: Finalize the live message (convert to "Analyzing...")
      finalizeLiveMessage(currentDisplayName, currentSpeaker, fullText);

      // THEN: Save to backend (async, won't block)
      saveMessageToBackendWithoutFinalize(currentSpeaker, fullText);
    }

    // Start new group
    currentSpeaker = username;
    currentDisplayName = displayName;
    currentSpeakerText = [text];
    console.log('Veritas DEBUG: Started new group for', displayName, username);
    console.log('Veritas DEBUG: Current pending message:', text);

    // ALWAYS show live message for new speaker (even if it's the first speaker)
    updateLiveMessage(displayName, username, text);
  } else {
    // Same speaker - add to group
    currentSpeakerText.push(text);
    console.log('Veritas DEBUG: Added to existing group. Total texts:', currentSpeakerText.length);

    // Update live message with accumulated text
    const fullText = currentSpeakerText.join(' ');
    console.log('Veritas DEBUG: Current pending message:', fullText);
    updateLiveMessage(displayName, username, fullText);
  }
}

// Expose function to manually flush current message (for debugging)
window.veritasFlush = function () {
  if (currentSpeaker && currentSpeakerText.length > 0) {
    const fullText = currentSpeakerText.join(' ');
    console.log(`Veritas: Manually flushing ${currentSpeaker}: "${fullText}"`);
    saveMessageToBackend(currentSpeaker, fullText);
    currentSpeakerText = [];
  } else {
    console.log('Veritas: No pending message to flush');
  }
};

console.log('Veritas: Ready. Overlay visible, auto-saving to backend.');
