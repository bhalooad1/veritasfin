// Content script that runs on Twitter/X pages
// Monitors for Twitter Spaces captions and sends them for fact-checking

let isMonitoring = false;
let overallScore = 100;

// Conversation tracking
let currentSpeaker = null;
let currentSpeakerText = [];
let lastKnownUsername = null; // Track last known username for continuation captions

// Create overlay UI
function createOverlay() {
  if (document.getElementById('veritas-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'veritas-overlay';
  overlay.innerHTML = `
    <div class="veritas-header">
      <h3>Veritas Fact Check</h3>
      <button id="veritas-close">×</button>
    </div>
    <div class="veritas-score">
      <div class="score-label">Credibility Score</div>
      <div class="score-value" id="veritas-score">100</div>
    </div>
    <div class="veritas-controls">
      <button id="veritas-refresh" class="veritas-button">
        <svg id="veritas-spinner" class="button-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.3"/>
          <path d="M 8 2 A 6 6 0 0 1 14 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>Scan for Captions</span>
      </button>
      <button id="veritas-analytics" class="veritas-button secondary">
        <span>Analytics</span>
      </button>
    </div>
    <div class="veritas-claims" id="veritas-claims">
      <p class="placeholder">Waiting for captions...</p>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('veritas-close').addEventListener('click', () => {
    overlay.style.display = 'none';
  });

  document.getElementById('veritas-refresh').addEventListener('click', () => {
    const button = document.getElementById('veritas-refresh');
    const spinner = document.getElementById('veritas-spinner');

    // Show spinner and disable button
    button.disabled = true;
    spinner.classList.add('spinning');

    // Run scan
    manualScanForCaptions();

    // Hide spinner after 1 second
    setTimeout(() => {
      button.disabled = false;
      spinner.classList.remove('spinning');
    }, 1000);
  });

  document.getElementById('veritas-analytics').addEventListener('click', () => {
    // Get space ID from storage (set by content-simple.js when monitoring)
    chrome.storage.local.get(['currentSpaceId'], (result) => {
      const spaceId = result.currentSpaceId || 'demo'; // Use 'demo' if no actual space
      chrome.runtime.sendMessage({ type: 'OPEN_ANALYTICS', spaceId });
    });
  });
}

// Track processed captions globally
// Using Set to prevent duplicate processing
// Limit size to prevent memory issues in long Spaces
const processedCaptions = new Set();
const MAX_PROCESSED_CAPTIONS = 1000;

function addToProcessedCaptions(text) {
  processedCaptions.add(text);

  // If we exceed max size, remove oldest entries (first 200)
  if (processedCaptions.size > MAX_PROCESSED_CAPTIONS) {
    const iterator = processedCaptions.values();
    for (let i = 0; i < 200; i++) {
      const value = iterator.next().value;
      if (value) processedCaptions.delete(value);
    }
  }
}

// Manual scan for captions
function manualScanForCaptions() {

  // Look for the Spaces layer container (id="layers")
  const layersContainer = document.getElementById('layers');

  if (!layersContainer) {
    return;
  }

  // BULLETPROOF SELECTOR: Real Space captions are in containers with these specific classes
  // These classes appear ONLY on caption containers, not on UI menus
  const captionContainers = layersContainer.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');

  // Extract caption divs from these containers
  const captionDivs = [];
  captionContainers.forEach(container => {
    const divs = container.querySelectorAll('div.css-146c3p1[dir="ltr"]');
    captionDivs.push(...divs);
  });

  let processedCount = 0;

  // Filter list - ignore these common UI elements
  const ignoreList = [
    'Report this Space',
    'Show captions',
    'Hide captions',
    'Microphone settings',
    'Space settings',
    'Your mic will be off to start',
    'End',
    'Leave',
    'Request',
    'Listeners',
    'Unmute Space',
    'Mute Space',
    'Adam Bhaloo',
    'Vedant Gaur',
    '2 captions',  // Caption counter UI element
    '3 captions',
    '4 captions',
    '5 captions',
    // Twitter menu items
    'Create your Space',
    'Settings and privacy',
    'Record Space',
    'Start now',
    'Get to know Spaces',
    'Add an existing account'
  ];

  // Additional check - skip UI dialog text or caption counters
  function isUIText(text) {
    const uiPatterns = [
      'End Space',
      'Yes, end',
      'will end the conversation',
      'end the conversation for everyone',
      'Cancel',
      /^\d+ captions?$/,  // Match "2 captions", "1 caption", etc.
      /^Log out @/,  // Match "Log out @username"
      /^@\w+$/,  // Match standalone usernames like "@AdamBhaloo"
      // Common menu phrases
      'View post',
      'Embed post',
      'Request Community',
      'Edit post',
      'Pin to',
      'Add/remove from',
      'Change who can',
      'View analytics',
      'View engagements',
      "can't be undone",
      // Standalone action words that appear in menus
      /^Delete$/,
      /^Mute$/,
      /^Unmute$/,
      /^Lists$/,
      /^Monetization$/,
      /^Ads$/,
      /^More$/,
      /^Profile$/
    ];
    return uiPatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(text);
      }
      return text.includes(pattern);
    });
  }

  captionDivs.forEach((captionDiv, index) => {
    // Get the span with the caption text
    const captionSpan = captionDiv.querySelector('span.css-1jxf684');

    if (captionSpan) {
      const text = captionSpan.textContent.trim();

      // Skip empty or ignored text
      if (!text || ignoreList.includes(text)) {
        return;
      }

      // Skip UI dialog text
      if (isUIText(text)) {
        return;
      }

      // Skip usernames (they appear as separate divs)
      if (text.startsWith('@') || text === 'Host') {
        return;
      }

      // Skip display names that appear right before @username
      // Check if this text is immediately followed by a @username in the same container
      const parentContainer = captionDiv.closest('div.css-175oi2r.r-13awgt0.r-1lzbym2');

      // Check if this looks like a display name (e.g., "Neel Jain", "Adam Bhaloo", "John O'Brien")
      // Display names are typically: 2-3 words, each capitalized, may have apostrophes or hyphens
      const displayNamePattern = /^[A-Z][a-z]+([''-]?[A-Za-z]+)?(\s[A-Z][a-z]+([''-]?[A-Za-z]+)?){1,2}$/;
      if (displayNamePattern.test(text) && parentContainer) {
        // Additional check: see if there's a @username in the same container
        const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
        const hasUsername = Array.from(allSpans).some(span => {
          const spanText = span.textContent.trim();
          return spanText.startsWith('@') && !spanText.includes(' ');
        });

        if (hasUsername) {
          return;
        }
      }
      if (parentContainer) {
        const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
        const spanTexts = Array.from(allSpans).map(s => s.textContent.trim());
        const currentIndex = spanTexts.indexOf(text);

        // If the next text is a @username, this is likely a display name, not a caption
        if (currentIndex >= 0 && currentIndex < spanTexts.length - 1) {
          const nextText = spanTexts[currentIndex + 1];
          if (nextText.startsWith('@')) {
            return;
          }
        }

        // ADDITIONAL CHECK: If this text appears in a group with BOTH a @username AND other non-username text,
        // and this text comes BEFORE the @username, then it's a display name
        // Pattern: "Display Name" (current) -> "@username" (somewhere after) -> "actual caption" (somewhere after)
        if (currentIndex >= 0) {
          let hasUsernameAfter = false;
          let hasNonUsernameTextAfter = false;

          for (let i = currentIndex + 1; i < spanTexts.length; i++) {
            const laterText = spanTexts[i];
            if (laterText.startsWith('@') && !laterText.includes(' ')) {
              hasUsernameAfter = true;
            } else if (laterText && !laterText.startsWith('@')) {
              hasNonUsernameTextAfter = true;
            }
          }

          // If there's both a username AND real caption text after this text,
          // then this text is the display name
          if (hasUsernameAfter && hasNonUsernameTextAfter) {
            return;
          }
        }
      }

      // Skip if already processed
      if (processedCaptions.has(text)) {
        return;
      }

      // Find the username - look for sibling divs with @username
      let username = null;
      let usernameSource = null;

      // Strategy 1: Look in the immediate parent container (reuse parentContainer from above)
      if (parentContainer) {
        // Find all spans that might have @username
        const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
        allSpans.forEach(span => {
          const spanText = span.textContent.trim();
          // Check if this span is ONLY a username (starts with @ and no spaces after username)
          if (spanText.startsWith('@') && !spanText.includes(' ')) {
            username = spanText;
            usernameSource = 'Strategy 1: Parent container';
          }
        });
      }

      // Strategy 2: If not found, search in a wider scope (previous siblings)
      if (!username) {
        const widerContainer = captionDiv.closest('div.css-175oi2r');
        if (widerContainer) {
          const allSpans = widerContainer.querySelectorAll('span.css-1jxf684');
          allSpans.forEach(span => {
            const spanText = span.textContent.trim();
            if (spanText.startsWith('@') && !spanText.includes(' ')) {
              username = spanText;
              usernameSource = 'Strategy 2: Wider container';
            }
          });
        }
      }

      // Strategy 3: Look for username in preceding caption containers
      if (!username) {
        // Find all caption containers
        const layersContainer = document.getElementById('layers');
        if (layersContainer) {
          const allCaptionContainers = layersContainer.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');

          // Find our caption's container index
          let ourIndex = -1;
          for (let i = 0; i < allCaptionContainers.length; i++) {
            if (allCaptionContainers[i].contains(captionDiv)) {
              ourIndex = i;
              break;
            }
          }

          // Look backwards from our container for a username
          if (ourIndex > 0) {
            for (let i = ourIndex - 1; i >= 0; i--) {
              const spans = allCaptionContainers[i].querySelectorAll('span.css-1jxf684');
              for (const span of spans) {
                const spanText = span.textContent.trim();
                if (spanText.startsWith('@') && !spanText.includes(' ')) {
                  username = spanText;
                  usernameSource = 'Strategy 3: Preceding container';
                  break;
                }
              }
              if (username) break;
            }
          }
        }
      }

      // If no username found, use the last known username (continuation caption)
      if (!username) {
        username = lastKnownUsername || 'Unknown';
      } else {
        // Update last known username only if we found a definitive username
        lastKnownUsername = username;
      }

      // Process this caption with grouping
      addToProcessedCaptions(text);
      addCaptionToGroup(text, username);
      processedCount++;
    }
  });
}

// Monitor for Twitter Spaces captions
function startMonitoring() {
  if (isMonitoring) return;
  isMonitoring = true;

  // Filter list - ignore these common UI elements
  const ignoreList = [
    'Report this Space',
    'Show captions',
    'Hide captions',
    'Microphone settings',
    'Space settings',
    'Your mic will be off to start',
    'End',
    'Leave',
    'Request',
    'Listeners',
    'Unmute Space',
    'Mute Space',
    'Adam Bhaloo',
    'Vedant Gaur',
    '2 captions',
    '3 captions',
    '4 captions',
    '5 captions',
    // Twitter menu items
    'Create your Space',
    'Settings and privacy',
    'Record Space',
    'Start now',
    'Get to know Spaces',
    'Add an existing account'
  ];

  // Additional check - skip UI dialog text or caption counters
  function isUIText(text) {
    const uiPatterns = [
      'End Space',
      'Yes, end',
      'will end the conversation',
      'end the conversation for everyone',
      'Cancel',
      /^\d+ captions?$/,  // Match "2 captions", "1 caption", etc.
      /^Log out @/,  // Match "Log out @username"
      /^@\w+$/,  // Match standalone usernames like "@AdamBhaloo"
      // Common menu phrases
      'View post',
      'Embed post',
      'Request Community',
      'Edit post',
      'Pin to',
      'Add/remove from',
      'Change who can',
      'View analytics',
      'View engagements',
      "can't be undone",
      // Standalone action words that appear in menus
      /^Delete$/,
      /^Mute$/,
      /^Unmute$/,
      /^Lists$/,
      /^Monetization$/,
      /^Ads$/,
      /^More$/,
      /^Profile$/
    ];
    return uiPatterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(text);
      }
      return text.includes(pattern);
    });
  }

  // Look for caption elements based on actual Twitter DOM structure
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) {
          // Only process nodes that are within the #layers container (Spaces UI)
          const layersContainer = document.getElementById('layers');
          if (!layersContainer) return;

          // Check if this node is within the layers container
          if (!layersContainer.contains(node)) return;

          // BULLETPROOF SELECTOR: Look for caption containers first
          let captionDivs = [];

          // Check if the node itself is a caption container or contains one
          let captionContainers = [];

          if (node.classList && node.classList.contains('r-13awgt0') && node.classList.contains('r-1lzbym2')) {
            captionContainers.push(node);
          }

          // Search within the node for caption containers
          if (node.querySelectorAll) {
            const containers = node.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');
            captionContainers.push(...containers);
          }

          // Extract caption divs from the containers
          captionContainers.forEach(container => {
            const divs = container.querySelectorAll('div.css-146c3p1[dir="ltr"]');
            captionDivs.push(...divs);
          });

          captionDivs.forEach((captionDiv) => {
            const captionSpan = captionDiv.querySelector('span.css-1jxf684');

            if (captionSpan) {
              const text = captionSpan.textContent.trim();

              // Skip empty or ignored text
              if (!text || ignoreList.includes(text)) {
                return;
              }

              // Skip UI dialog text
              if (isUIText(text)) {
                return;
              }

              // Skip usernames
              if (text.startsWith('@') || text === 'Host') {
                return;
              }

              // Skip display names that appear right before @username
              // Check if this text is immediately followed by a @username in the same container
              const parentContainer = captionDiv.closest('div.css-175oi2r.r-13awgt0.r-1lzbym2');

              // Check if this looks like a display name (e.g., "Neel Jain", "Adam Bhaloo", "John O'Brien")
              // Display names are typically: 2-3 words, each capitalized, may have apostrophes or hyphens
              const displayNamePattern = /^[A-Z][a-z]+([''-]?[A-Za-z]+)?(\s[A-Z][a-z]+([''-]?[A-Za-z]+)?){1,2}$/;
              if (displayNamePattern.test(text) && parentContainer) {
                // Additional check: see if there's a @username in the same container
                const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
                const hasUsername = Array.from(allSpans).some(span => {
                  const spanText = span.textContent.trim();
                  return spanText.startsWith('@') && !spanText.includes(' ');
                });

                if (hasUsername) {
                  return;
                }
              }
              if (parentContainer) {
                const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
                const spanTexts = Array.from(allSpans).map(s => s.textContent.trim());
                const currentIndex = spanTexts.indexOf(text);

                // If the next text is a @username, this is likely a display name, not a caption
                if (currentIndex >= 0 && currentIndex < spanTexts.length - 1) {
                  const nextText = spanTexts[currentIndex + 1];
                  if (nextText.startsWith('@')) {
                    return;
                  }
                }

                // ADDITIONAL CHECK: If this text appears in a group with BOTH a @username AND other non-username text,
                // and this text comes BEFORE the @username, then it's a display name
                // Pattern: "Display Name" (current) -> "@username" (somewhere after) -> "actual caption" (somewhere after)
                if (currentIndex >= 0) {
                  let hasUsernameAfter = false;
                  let hasNonUsernameTextAfter = false;

                  for (let i = currentIndex + 1; i < spanTexts.length; i++) {
                    const laterText = spanTexts[i];
                    if (laterText.startsWith('@') && !laterText.includes(' ')) {
                      hasUsernameAfter = true;
                    } else if (laterText && !laterText.startsWith('@')) {
                      hasNonUsernameTextAfter = true;
                    }
                  }

                  // If there's both a username AND real caption text after this text,
                  // then this text is the display name
                  if (hasUsernameAfter && hasNonUsernameTextAfter) {
                    return;
                  }
                }
              }

              // Skip if already processed
              if (processedCaptions.has(text)) {
                return;
              }

              // Find the username - look for sibling divs with @username
              let username = null;
              let usernameSource = null;

              // Strategy 1: Look in the immediate parent container (reuse parentContainer from above)
              if (parentContainer) {
                // Find all spans that might have @username
                const allSpans = parentContainer.querySelectorAll('span.css-1jxf684');
                allSpans.forEach(span => {
                  const spanText = span.textContent.trim();
                  // Check if this span is ONLY a username (starts with @ and no spaces after username)
                  if (spanText.startsWith('@') && !spanText.includes(' ')) {
                    username = spanText;
                    usernameSource = 'Strategy 1: Parent container';
                  }
                });
              }

              // Strategy 2: If not found, search in a wider scope
              if (!username) {
                const widerContainer = captionDiv.closest('div.css-175oi2r');
                if (widerContainer) {
                  const allSpans = widerContainer.querySelectorAll('span.css-1jxf684');
                  allSpans.forEach(span => {
                    const spanText = span.textContent.trim();
                    if (spanText.startsWith('@') && !spanText.includes(' ')) {
                      username = spanText;
                      usernameSource = 'Strategy 2: Wider container';
                    }
                  });
                }
              }

              // Strategy 3: Look for username in preceding caption containers
              if (!username) {
                const layersContainer = document.getElementById('layers');
                if (layersContainer) {
                  const allCaptionContainers = layersContainer.querySelectorAll('div.css-175oi2r.r-13awgt0.r-1lzbym2');

                  // Find our caption's container index
                  let ourIndex = -1;
                  for (let i = 0; i < allCaptionContainers.length; i++) {
                    if (allCaptionContainers[i].contains(captionDiv)) {
                      ourIndex = i;
                      break;
                    }
                  }

                  // Look backwards from our container for a username
                  if (ourIndex > 0) {
                    for (let i = ourIndex - 1; i >= 0; i--) {
                      const spans = allCaptionContainers[i].querySelectorAll('span.css-1jxf684');
                      for (const span of spans) {
                        const spanText = span.textContent.trim();
                        if (spanText.startsWith('@') && !spanText.includes(' ')) {
                          username = spanText;
                          usernameSource = 'Strategy 3: Preceding container';
                          break;
                        }
                      }
                      if (username) break;
                    }
                  }
                }
              }

              // If no username found, use the last known username (continuation caption)
              if (!username) {
                username = lastKnownUsername || 'Unknown';
              } else {
                // Update last known username only if we found a definitive username
                lastKnownUsername = username;
              }

              // Process this caption with grouping
              addToProcessedCaptions(text);
              addCaptionToGroup(text, username);
            }
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

// Add caption to conversation group
function addCaptionToGroup(text, username) {
  // Check if speaker changed
  if (username !== currentSpeaker) {
    // Speaker changed - finalize previous group
    if (currentSpeaker && currentSpeakerText.length > 0) {
      const fullText = currentSpeakerText.join(' ');
      const previousSpeaker = currentSpeaker; // SAVE the old speaker before updating

      // Send the complete conversation chunk for fact-checking
      chrome.runtime.sendMessage({
        type: 'FACT_CHECK',
        text: fullText,
        speaker: previousSpeaker
      }, (response) => {
        if (response) {
          // Update the existing live preview box with fact-check results
          // Use previousSpeaker here, not currentSpeaker (which has already changed)
          updateLivePreviewWithFactCheck(previousSpeaker, response);
        }
      });
    }

    // Start new group
    currentSpeaker = username;
    currentSpeakerText = [text];
  } else {
    // Same speaker - add to current group
    currentSpeakerText.push(text);
  }

  // ALWAYS update live preview immediately to mirror Twitter captions
  updateLivePreview(currentSpeaker, currentSpeakerText);
}

// Show live preview of current speaker's text as it accumulates
function updateLivePreview(speaker, textArray) {
  const claimsElement = document.getElementById('veritas-claims');
  if (!claimsElement) return;

  // Remove placeholder
  const placeholder = claimsElement.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  // Check if there's already a live preview box for this speaker
  let liveBox = document.getElementById('veritas-live-preview-' + speaker.replace('@', ''));

  if (!liveBox) {
    // IMPORTANT: Remove ALL other live preview boxes first
    // There should only ever be ONE "Listening..." box at a time
    const allLiveBoxes = claimsElement.querySelectorAll('.live-preview');
    allLiveBoxes.forEach(box => {
      // Convert it to an analyzed box instead of removing it
      // This preserves the previous speaker's content
      box.classList.remove('live-preview');
      box.classList.add('analyzed');
      const liveIndicator = box.querySelector('.live-indicator');
      if (liveIndicator) {
        liveIndicator.remove();
      }
      box.removeAttribute('id');
    });

    // Create new live preview box for this speaker
    liveBox = document.createElement('div');
    liveBox.id = 'veritas-live-preview-' + speaker.replace('@', '');
    liveBox.className = 'claim-item live-preview';
    liveBox.setAttribute('data-speaker', speaker);
    claimsElement.insertBefore(liveBox, claimsElement.firstChild);
  }

  // Update the live box content
  const fullText = textArray.join(' ');
  liveBox.innerHTML =
    '<div class="claim-speaker">' + speaker + '</div>' +
    '<div class="claim-text">' + fullText + '</div>' +
    '<div class="live-indicator">Listening...</div>';
}

// Update live preview box with fact-check results
function updateLivePreviewWithFactCheck(speaker, result) {
  const liveBoxId = 'veritas-live-preview-' + speaker.replace('@', '');
  const liveBox = document.getElementById(liveBoxId);

  if (!liveBox) return;

  // Build the HTML for fact-check results
  let resultHTML = '<div class="claim-speaker">' + speaker + '</div>' +
    '<div class="claim-text">"' + result.claim + '"</div>';

  // Show truth score if available (1-10 scale)
  if (result.truth_score) {
    const scoreClass = getScoreClassForTruthScore(result.truth_score);
    resultHTML += '<div class="truth-score ' + scoreClass + '">Truth Score: ' + result.truth_score + '/10</div>';
  } else if (result.verdict) {
    // Fallback to verdict if no truth score
    resultHTML += '<div class="claim-verdict ' + result.verdict.toLowerCase() + '">' + result.verdict + '</div>';
  }

  // Add explanation
  if (result.explanation && result.explanation !== 'Message too short for analysis') {
    resultHTML += '<div class="claim-explanation">' + result.explanation + '</div>';
  }

  // Remove the "Listening..." indicator and add fact-check results
  liveBox.className = 'claim-item analyzed';
  liveBox.innerHTML = resultHTML;

  // Remove the live-preview ID so it won't be updated again
  liveBox.removeAttribute('id');
}

// Get score class for truth score (1-10)
function getScoreClassForTruthScore(score) {
  if (score >= 8) return 'score-high';  // 8-10: True
  if (score >= 6) return 'score-medium'; // 6-7: Mostly true
  if (score >= 4) return 'score-low';    // 4-5: Misleading
  return 'score-very-low';               // 1-3: False
}

// Update overlay with grouped fact-check results
function updateOverlayWithGroup(result) {
  const scoreElement = document.getElementById('veritas-score');
  const claimsElement = document.getElementById('veritas-claims');

  if (!scoreElement || !claimsElement) return;

  // Update score
  overallScore = result.score;
  scoreElement.textContent = result.score;
  scoreElement.className = 'score-value ' + getScoreClass(result.score);

  // Remove live preview box (replace with analyzed version)
  const liveBox = document.getElementById('veritas-live-preview');
  if (liveBox) {
    liveBox.remove();
  }

  // Remove placeholder
  const placeholder = claimsElement.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  // Add new conversation group with fact-check results
  const groupDiv = document.createElement('div');
  groupDiv.className = 'claim-item analyzed';
  const speakerTag = result.speaker ? '<div class="claim-speaker">' + result.speaker + '</div>' : '';
  groupDiv.innerHTML =
    speakerTag +
    '<div class="claim-text">"' + result.claim + '"</div>' +
    '<div class="claim-verdict ' + result.verdict.toLowerCase() + '">' + result.verdict + '</div>' +
    '<div class="claim-explanation">' + result.explanation + '</div>';

  claimsElement.insertBefore(groupDiv, claimsElement.firstChild);

  // Keep only last 5 analyzed groups (excluding live preview)
  const analyzedGroups = claimsElement.querySelectorAll('.claim-item.analyzed');
  if (analyzedGroups.length > 5) {
    analyzedGroups[analyzedGroups.length - 1].remove();
  }
}

// Legacy function - keeping for manual scan
function processCaptionText(text, username = 'Unknown') {
  addCaptionToGroup(text, username);
}

// Update overlay with fact-check results
function updateOverlay(result) {
  const scoreElement = document.getElementById('veritas-score');
  const claimsElement = document.getElementById('veritas-claims');

  if (!scoreElement || !claimsElement) return;

  // Update score
  overallScore = result.score;
  scoreElement.textContent = result.score;
  scoreElement.className = 'score-value ' + getScoreClass(result.score);

  // Remove placeholder
  const placeholder = claimsElement.querySelector('.placeholder');
  if (placeholder) placeholder.remove();

  // Add new claim result
  const claimDiv = document.createElement('div');
  claimDiv.className = 'claim-item';
  const speakerTag = result.speaker ? `<div class="claim-speaker">${result.speaker}</div>` : '';
  claimDiv.innerHTML = `
    ${speakerTag}
    <div class="claim-text">"${result.claim}"</div>
    <div class="claim-verdict ${result.verdict.toLowerCase()}">${result.verdict}</div>
    <div class="claim-explanation">${result.explanation}</div>
  `;
  claimsElement.insertBefore(claimDiv, claimsElement.firstChild);

  // Keep only last 5 claims visible
  while (claimsElement.children.length > 5) {
    claimsElement.removeChild(claimsElement.lastChild);
  }
}

function getScoreClass(score) {
  if (score >= 80) return 'score-high';
  if (score >= 50) return 'score-medium';
  return 'score-low';
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  createOverlay();
  startMonitoring();
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TOGGLE_OVERLAY') {
    const overlay = document.getElementById('veritas-overlay');
    if (overlay) {
      // Check if display is 'none' or empty string (which means it's using CSS default)
      const currentDisplay = overlay.style.display;
      if (currentDisplay === 'none') {
        overlay.style.display = 'flex';
      } else {
        overlay.style.display = 'none';
      }
    } else {
      createOverlay();
    }
  }
});
