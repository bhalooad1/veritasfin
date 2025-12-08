
// Background service worker for Veritas
// Handles fact-checking logic (currently mock, replace with API calls)

console.log('🚀 Background script loading...');

let currentScore = 100;
let checkedClaims = [];

console.log('✅ Background script variables initialized');

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
  } else if (request.type === 'UPDATE_TWITTER_CONFIG') {
    // Store new config
    chrome.storage.sync.set({ twitterBotConfig: request.config });
    Object.assign(TWITTER_CONFIG, request.config);

    if (twitterBot.validateConfig()) {
      twitterBot.isEnabled = true;
      twitterBot.startPolling();
      sendResponse({ success: true, message: 'Twitter bot enabled' });
    } else {
      twitterBot.isEnabled = false;
      twitterBot.stopPolling();
      sendResponse({ success: false, message: 'Invalid configuration' });
    }
  } else if (request.type === 'GET_TWITTER_STATUS') {
    sendResponse({
      enabled: twitterBot.isEnabled,
      lastSeenId: twitterBot.lastSeenId,
      config: TWITTER_CONFIG
    });
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

// =====================================================
// TWITTER BOT INTEGRATION
// =====================================================

// Twitter Bot Configuration - Loaded from Chrome storage (set via config UI)
// NOTE: Chrome extensions cannot access environment variables (.env files)
// Users must configure credentials through the Twitter Config page
const TWITTER_CONFIG = {
  API_KEY: null,
  API_SECRET: null,
  ACCESS_TOKEN: null,
  ACCESS_TOKEN_SECRET: null,
  BOT_USER_ID: null,
  CHECK_INTERVAL: 0.5 // minutes (30 seconds)
};

// Twitter Bot Functions
class TwitterBot {
  constructor() {
    this.isEnabled = false;
    this.lastSeenId = null;
  }

  async initialize() {
    // Try to load config from backend first (reads from .env)
    try {
      console.log('🔄 Fetching Twitter config from backend...');
      const response = await fetch('http://localhost:3000/api/twitter/config');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.config) {
          Object.assign(TWITTER_CONFIG, data.config);
          console.log('✅ Twitter config loaded from backend');
        }
      }
    } catch (error) {
      console.log('⚠️ Backend unavailable, checking Chrome storage...');
    }

    // Fall back to Chrome storage if backend didn't provide config
    if (!this.validateConfig()) {
      const result = await chrome.storage.sync.get(['twitterBotConfig']);
      if (result.twitterBotConfig) {
        Object.assign(TWITTER_CONFIG, result.twitterBotConfig);
        console.log('✅ Twitter config loaded from Chrome storage');
      }
    }

    this.isEnabled = this.validateConfig();

    // Load last seen ID from Supabase (via backend)
    try {
      const stateResponse = await fetch('http://localhost:3000/api/twitter/state/twitter_last_seen_id');
      if (stateResponse.ok) {
        const stateData = await stateResponse.json();
        this.lastSeenId = stateData.value || null;
        console.log(`✅ Last seen ID loaded from Supabase: ${this.lastSeenId || 'none'}`);
      }
    } catch (error) {
      // Fall back to Chrome storage
      const lastSeen = await chrome.storage.local.get(['twitterLastSeenId']);
      this.lastSeenId = lastSeen.twitterLastSeenId || null;
      console.log('⚠️ Using Chrome storage for last seen ID');
    }

    if (this.isEnabled) {
      this.startPolling();
    } else {
      console.log('⚠️ Twitter bot not enabled - missing credentials');
    }
  }

  validateConfig() {
    return TWITTER_CONFIG.API_KEY &&
      TWITTER_CONFIG.API_SECRET &&
      TWITTER_CONFIG.ACCESS_TOKEN &&
      TWITTER_CONFIG.ACCESS_TOKEN_SECRET &&
      TWITTER_CONFIG.BOT_USER_ID;
  }

  // OAuth 1.0a implementation using Web Crypto API
  async generateOAuthSignature(method, url, params = {}) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');

    const oauthParams = {
      oauth_consumer_key: TWITTER_CONFIG.API_KEY,
      oauth_token: TWITTER_CONFIG.ACCESS_TOKEN,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
      ...params
    };

    // Create parameter string
    const parameterString = Object.keys(oauthParams)
      .sort()
      .map(key => `${this.percentEncode(key)}=${this.percentEncode(oauthParams[key])}`)
      .join('&');

    // Create signature base string
    const signatureBaseString = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(parameterString)
    ].join('&');

    // Create signing key
    const signingKey = `${this.percentEncode(TWITTER_CONFIG.API_SECRET)}&${this.percentEncode(TWITTER_CONFIG.ACCESS_TOKEN_SECRET)}`;

    // Generate HMAC-SHA1 signature
    const signature = await this.hmacSha1(signingKey, signatureBaseString);

    return {
      oauth_consumer_key: TWITTER_CONFIG.API_KEY,
      oauth_token: TWITTER_CONFIG.ACCESS_TOKEN,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: timestamp,
      oauth_nonce: nonce,
      oauth_version: '1.0',
      oauth_signature: signature
    };
  }

  percentEncode(str) {
    return encodeURIComponent(str)
      .replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  async hmacSha1(key, message) {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(key);
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', cryptoKey, messageData);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  generateAuthorizationHeader(oauthParams) {
    const headerParams = Object.keys(oauthParams)
      .map(key => `${this.percentEncode(key)}="${this.percentEncode(oauthParams[key])}"`)
      .join(', ');

    return `OAuth ${headerParams}`;
  }

  async makeTwitterRequest(endpoint, options = {}) {
    const url = `https://api.twitter.com/2/${endpoint}`;
    const method = options.method || 'GET';

    console.log(`🔍 Making OAuth 1.0a request to: ${url}`);
    console.log(`🔑 Using Consumer Key: ${TWITTER_CONFIG.API_KEY ? 'YES' : 'NO'}`);
    console.log(`👤 Bot User ID: ${TWITTER_CONFIG.BOT_USER_ID}`);

    // Extract query parameters from URL
    const urlObj = new URL(url);
    const queryParams = {};
    for (const [key, value] of urlObj.searchParams) {
      queryParams[key] = value;
    }

    // Generate OAuth signature
    const oauthParams = await this.generateOAuthSignature(method, urlObj.origin + urlObj.pathname, queryParams);
    const authHeader = this.generateAuthorizationHeader(oauthParams);

    console.log(`🔐 Authorization header generated`);

    const response = await fetch(url, {
      method: method,
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    console.log(`📡 Response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Twitter API error details:`, errorText);
      throw new Error(`Twitter API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  async checkMentions() {
    if (!this.isEnabled) return;

    try {
      console.log('Checking for new mentions...');

      // Build request parameters
      const params = new URLSearchParams({
        'user.fields': 'username',
        'tweet.fields': 'author_id,conversation_id',
        'expansions': 'author_id'
      });

      if (this.lastSeenId) {
        params.append('since_id', this.lastSeenId);
      }

      const data = await this.makeTwitterRequest(
        `users/${TWITTER_CONFIG.BOT_USER_ID}/mentions?${params}`
      );

      if (!data.data || data.data.length === 0) {
        console.log('No new mentions found');
        return;
      }

      // Process mentions
      await this.processMentions(data.data, data.includes?.users || []);

    } catch (error) {
      console.error('Error checking mentions:', error);
    }
  }

  async processMentions(mentions, users) {
    // Create user lookup
    const userLookup = {};
    users.forEach(user => {
      userLookup[user.id] = user.username;
    });

    // Process mentions in chronological order (oldest first)
    const sortedMentions = mentions.sort((a, b) => a.id - b.id);

    for (const mention of sortedMentions) {
      try {
        const username = userLookup[mention.author_id] || 'unknown';
        console.log(`Processing mention from @${username}: ${mention.text}`);
        console.log(`  Tweet ID: ${mention.id}`);
        console.log(`  Conversation ID: ${mention.conversation_id}`);

        const isThread = mention.id !== mention.conversation_id;
        console.log(`  Is part of thread: ${isThread}`);

        let reply;

        if (isThread) {
          // This is a thread mention - analyze the full thread
          console.log(`🧵 Analyzing thread with conversation_id: ${mention.conversation_id}`);

          try {
            const analysisResult = await this.analyzeThread(
              mention.conversation_id,
              mention.id,
              username
            );

            if (analysisResult.success) {
              // Format thread analysis reply
              reply = `@${username} ${analysisResult.summary}\n\n🔍 Full analysis available via Veritas extension`;

              // Store for analytics access
              await chrome.storage.local.set({
                lastAnalyzedThreadId: analysisResult.spaceId,
                lastAnalyzedConversationId: mention.conversation_id
              });

              // Post reply first
              await this.postReply(reply, mention.id);

              // Then mark as complete (triggers edge function)
              await fetch(`http://localhost:3000/api/threads/${analysisResult.spaceId}/complete`, {
                method: 'POST'
              });

              console.log(`✅ Thread analysis complete, spaceId: ${analysisResult.spaceId}`);
            } else {
              // Fallback if analysis failed
              reply = `@${username} Sorry, I couldn't analyze this thread. Please try again later.`;
              await this.postReply(reply, mention.id);
            }
          } catch (error) {
            console.error('Thread analysis error:', error);
            reply = `@${username} Sorry, I encountered an error analyzing this thread.`;
            await this.postReply(reply, mention.id);
          }
        } else {
          // Not a thread - use standard reply
          reply = await this.generateReply(mention.text, username);
          await this.postReply(reply, mention.id);
        }

        // Update last seen ID in Supabase
        this.lastSeenId = mention.id;
        try {
          await fetch('http://localhost:3000/api/twitter/state/twitter_last_seen_id', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: mention.id })
          });
        } catch (err) {
          // Fallback to Chrome storage
          await chrome.storage.local.set({ twitterLastSeenId: mention.id });
        }

        console.log(`Replied to @${username}`);

      } catch (error) {
        console.error(`Error processing mention ${mention.id}:`, error);
      }
    }
  }

  async analyzeThread(conversationId, triggeringTweetId, triggeringUsername) {
    console.log(`🧵 Calling thread analysis API...`);

    const response = await fetch('http://localhost:3000/api/threads/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        triggeringTweetId,
        triggeringUsername
      })
    });

    const result = await response.json();
    console.log(`🧵 Thread analysis result:`, result);
    return result;
  }

  async generateReply(mentionText, username) {
    // Integration with your existing fact-checking logic!
    // This is where the magic happens - use your Veritas backend

    try {
      // Option 1: Use your existing backend
      const factCheckResult = await this.callFactCheckAPI(mentionText);

      if (factCheckResult) {
        return `@${username} Fact-check: ${factCheckResult.verdict} - ${factCheckResult.explanation.substring(0, 200)}... #FactCheck`;
      }
    } catch (error) {
      console.log('Backend unavailable, using fallback');
    }

    // Option 2: Use simplified logic
    return `@${username} Thanks for the mention! I'm Veritas, a fact-checking bot. I'm currently analyzing Twitter Spaces for misinformation. Learn more about fact-checking at [your website]. #FactCheck`;
  }

  async callFactCheckAPI(text) {
    // Call your existing backend for fact-checking
    try {
      const response = await fetch('http://localhost:3000/api/fact-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      return response.json();
    } catch (error) {
      return null; // Backend unavailable
    }
  }

  async postReply(text, inReplyToId) {
    await this.makeTwitterRequest('tweets', {
      method: 'POST',
      body: {
        text: text,
        reply: { in_reply_to_tweet_id: inReplyToId }
      }
    });
  }

  startPolling() {
    // Create alarm for periodic checking
    chrome.alarms.create('checkTwitterMentions', {
      delayInMinutes: 1,
      periodInMinutes: TWITTER_CONFIG.CHECK_INTERVAL
    });

    console.log(`Twitter bot polling started (every ${TWITTER_CONFIG.CHECK_INTERVAL} minutes)`);
  }

  stopPolling() {
    chrome.alarms.clear('checkTwitterMentions');
    console.log('Twitter bot polling stopped');
  }
}

// Initialize Twitter bot
const twitterBot = new TwitterBot();

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'checkTwitterMentions') {
    twitterBot.checkMentions();
  }
});

// Bot configuration updates are now handled in the main message listener above

// Reset score when extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  console.log('Veritas extension installed');
  currentScore = 100;
  checkedClaims = [];

  // Initialize Twitter bot
  twitterBot.initialize();
});

// IMPORTANT: Also initialize when service worker starts up (not just on install)
// This ensures the bot keeps running after Chrome restart or service worker suspension
(async () => {
  console.log('🔄 Service worker starting - initializing Twitter bot...');
  await twitterBot.initialize();

  // Also trigger an immediate check
  if (twitterBot.isEnabled) {
    console.log('🔍 Running immediate mention check...');
    twitterBot.checkMentions();
  }
})();
