
// Background service worker for Veritas
// Handles fact-checking logic (currently mock, replace with API calls)

let currentScore = 100;
let checkedClaims = [];

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'FACT_CHECK') {
    // Mock fact-checking - replace with actual API call to your backend
    const result = mockFactCheck(request.text, request.speaker);
    sendResponse(result);
  } else if (request.type === 'OPEN_ANALYTICS') {
    const url = chrome.runtime.getURL('analytics.html') + `?spaceId=${request.spaceId}`;
    chrome.tabs.create({ url });
  } else if (request.type === 'GROK_CHAT_REQUEST') {
    // Proxy the request to the backend
    fetch('http://localhost:3000/api/grokipedia/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request.payload)
    })
      .then(res => res.json())
      .then(data => sendResponse(data))
      .catch(error => sendResponse({ success: false, error: error.message }));
  }
  return true; // Keep message channel open for async response
});

// Mock fact-checking function
// In production, this would call your backend API
function mockFactCheck(text, speaker = 'Unknown') {
  console.log(`Fact - checking claim from ${speaker}: `, text);

  // Simple mock logic to demonstrate
  const verdicts = ['True', 'False', 'Misleading', 'Unverified'];
  const randomVerdict = verdicts[Math.floor(Math.random() * verdicts.length)];

  // Adjust score based on verdict
  let scoreChange = 0;
  let explanation = '';

  switch (randomVerdict) {
    case 'True':
      scoreChange = 0;
      explanation = 'This claim appears to be accurate based on available sources.';
      break;
    case 'False':
      scoreChange = -15;
      explanation = 'This claim contradicts verified information from reliable sources.';
      break;
    case 'Misleading':
      scoreChange = -10;
      explanation = 'This claim contains some truth but lacks important context or exaggerates facts.';
      break;
    case 'Unverified':
      scoreChange = -5;
      explanation = 'Unable to verify this claim with available sources.';
      break;
  }

  currentScore = Math.max(0, Math.min(100, currentScore + scoreChange));

  const result = {
    claim: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    verdict: randomVerdict,
    explanation: explanation,
    score: currentScore,
    speaker: speaker
  };

  checkedClaims.push(result);

  return result;
}

// Example function for real API integration (commented out)
/*
async function realFactCheck(text) {
  try {
    const response = await fetch('YOUR_BACKEND_API_URL/fact-check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text })
    });

    const data = await response.json();

    // Update score based on API response
    currentScore = data.score;

    return {
      claim: text.substring(0, 100),
      verdict: data.verdict,
      explanation: data.explanation,
      score: currentScore
    };
  } catch (error) {
    console.error('Fact-check API error:', error);
    return {
      claim: text.substring(0, 100),
      verdict: 'Error',
      explanation: 'Failed to verify claim',
      score: currentScore
    };
  }
}
*/

// Reset score when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Veritas extension installed');
  currentScore = 100;
  checkedClaims = [];
});
