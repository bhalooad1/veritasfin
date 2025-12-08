import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import debateRoutes from './routes/debate-analyzer.js';
import claimSourcesRoutes from './routes/claim-sources.js';
import spaceEndRoutes from './routes/space-end.js';
import twitterService, { getThreadTweets } from './services/twitter.js';

// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from parent directory (for test HTML files)
app.use(express.static(path.join(__dirname, '..')));

// Initialize Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware - Allow all origins and handle Chrome's Private Network Access
app.use(cors({
  origin: true,
  credentials: true
}));

// Add Private Network Access headers for Chrome
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

app.use(express.json());

// =====================================================
// API ROUTES
// =====================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Veritas API is running' });
});

// =====================================================
// SPACES ENDPOINTS
// =====================================================

// Create a new space
app.post('/api/spaces/create', async (req, res) => {
  try {
    const { title, space_url, metadata } = req.body;

    const { data, error } = await supabase.rpc('create_space', {
      p_title: title || null,
      p_space_url: space_url || null,
      p_metadata: metadata || {}
    });

    if (error) throw error;

    res.json({
      success: true,
      space_id: data,
      message: 'Space created successfully'
    });
  } catch (error) {
    console.error('Error creating space:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get space details
app.get('/api/spaces/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get space details
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', id)
      .single();

    if (spaceError) throw spaceError;

    // Get messages with speakers
    const { data: messages, error: messagesError } = await supabase
      .from('messages_with_speakers')
      .select('*')
      .eq('space_id', id)
      .order('sequence_number', { ascending: true });

    if (messagesError) throw messagesError;

    // Get statistics
    const { data: stats, error: statsError } = await supabase
      .from('space_statistics')
      .select('*')
      .eq('space_id', id)
      .single();

    if (statsError) throw statsError;

    res.json({
      success: true,
      data: {
        space,
        messages,
        statistics: stats
      }
    });
  } catch (error) {
    console.error('Error fetching space:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// End a space
app.post('/api/spaces/:id/end', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.rpc('end_space', {
      p_space_id: id
    });

    if (error) throw error;

    res.json({
      success: true,
      message: 'Space ended successfully'
    });
  } catch (error) {
    console.error('Error ending space:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all spaces (for dashboard)
app.get('/api/spaces', async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;

    const { data, error } = await supabase
      .from('space_statistics')
      .select('*')
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    res.json({
      success: true,
      data: data
    });
  } catch (error) {
    console.error('Error fetching spaces:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// SPEAKERS ENDPOINTS
// =====================================================

// Get or create speaker
app.post('/api/speakers/find-or-create', async (req, res) => {
  try {
    const { username, display_name } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: 'Username is required'
      });
    }

    const { data, error } = await supabase.rpc('get_or_create_speaker', {
      p_username: username,
      p_display_name: display_name || null
    });

    if (error) throw error;

    res.json({
      success: true,
      speaker_id: data
    });
  } catch (error) {
    console.error('Error with speaker:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// MESSAGES ENDPOINTS
// =====================================================

// Create a new message
app.post('/api/messages/create', async (req, res) => {
  try {
    const { space_id, speaker_username, speaker_display_name, content } = req.body;

    if (!space_id || !speaker_username || !content) {
      return res.status(400).json({
        success: false,
        error: 'space_id, speaker_username, and content are required'
      });
    }

    // Create message using helper function
    const { data: messageId, error } = await supabase.rpc('create_message', {
      p_space_id: space_id,
      p_speaker_username: speaker_username,
      p_speaker_display_name: speaker_display_name || null,
      p_content: content
    });

    if (error) throw error;

    // Trigger Grok fact-checking asynchronously
    // Don't await - let it process in background
    analyzeMessageWithGrok(messageId, content, space_id).catch(err => {
      console.error('Grok analysis error:', err);
    });

    res.json({
      success: true,
      message_id: messageId,
      message: 'Message created and queued for fact-checking'
    });
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fact-check a specific message
app.post('/api/spaces/fact-check', async (req, res) => {
  try {
    const { messageId, spaceId } = req.body;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        error: 'messageId is required'
      });
    }

    // Get message content
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('*')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      console.error('Error fetching message:', messageError);
      return res.status(404).json({
        success: false,
        error: 'Message not found'
      });
    }

    // Trigger Grok fact-checking
    await analyzeMessageWithGrok(messageId, message.content, spaceId || message.space_id);

    res.json({
      success: true,
      message: 'Fact-checking initiated'
    });
  } catch (error) {
    console.error('Error in fact-check endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get message by ID
app.get('/api/messages/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('messages')
      .select('*, speakers!messages_speaker_id_fkey(username, display_name)')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Flatten the response to match expected format
    const response = {
      ...data,
      speaker_username: data.speakers?.username || data.speaker_username,
      speaker_display_name: data.speakers?.display_name || data.speaker_display_name
    };
    delete response.speakers;

    res.json({
      success: true,
      data: response
    });
  } catch (error) {
    console.error('Error fetching message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// GROK INTEGRATION
// =====================================================

async function analyzeMessageWithGrok(messageId, content, spaceId) {
  try {
    // Check word count - only analyze if longer than 10 words
    const wordCount = content.trim().split(/\s+/).length;

    if (wordCount <= 10) {
      // Skip analysis for short messages
      await supabase
        .from('messages')
        .update({
          fact_check_status: 'completed',
          grok_explanation: 'Message too short for analysis'
        })
        .eq('id', messageId);
      console.log(`⊘ Message ${messageId} skipped: too short (${wordCount} words)`);
      return;
    }

    // Update status to processing
    await supabase
      .from('messages')
      .update({ fact_check_status: 'processing' })
      .eq('id', messageId);

    console.log(`\n🔍 Processing message ${messageId}`);
    console.log(`📨 Content: "${content}"`);
    console.log(`📏 Content length: ${content.length} characters`);

    // Call Grok API (xAI uses OpenAI-compatible endpoint)
    const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-reasoning', // Fast model for widget (Chrome extension)
        messages: [
          {
            role: 'system',
            content: `You are a fact-checking AI. Extract and verify factual claims, EVEN when embedded in casual language or opinion statements.

=== WHAT TO EXTRACT ===
✅ FACTUAL CLAIMS (extract these - even if phrased casually):
- Statistics & numbers: "Unemployment is 3.5%", "21 million people crossed the border"
- Historical events: "He appointed three justices", "The bill passed in 2022"
- Verifiable statements: "He tweeted 'thank you'", "The law provides life in prison"
- Scientific/medical facts: "Vaccines contain mercury", "COVID originated in China"
- Economic/efficiency claims: "nuclear energy is a waste of money", "solar is more efficient than nuclear"
- Comparative claims: "X is better/worse/more expensive than Y" (if objectively measurable)
- Claims about news/studies: "I heard in the news that X" → verify if X is actually true
- Casual factual statements: "I heard that...", "they say that..." → extract and verify the underlying claim

⚠️ IMPORTANT: Don't be fooled by casual phrasing!
- "I heard nuclear is a waste of money" → EXTRACT: "nuclear energy is a waste of money" (verifiable!)
- "I think solar is more efficient" → EXTRACT: "solar is more efficient" (verifiable!)
- "all I've seen in the news is..." → EXTRACT the factual claim being referenced

❌ PURE OPINIONS (skip these):
- Pure value judgments: "She's radical", "He's terrible", "This is immoral"
- Predictions: "This will destroy America", "We will win"
- Subjective preferences: "I prefer...", "The best approach is..." (without factual basis)
- Vague statements: "I heard there's a new study" (no specific claim)

=== SOURCE REQUIREMENTS ===
⚠️ CRITICAL: Use ONLY these approved URLs. NO other URLs allowed.

APPROVED SOURCES (use ONLY base domains):
- https://www.factcheck.org/
- https://www.politifact.com/
- https://www.snopes.com/
- https://www.census.gov/
- https://www.bls.gov/
- https://www.cdc.gov/
- https://www.reuters.com/
- https://apnews.com/
- https://www.npr.org/

GROKIPEDIA (REQUIRED - last source):
Format: https://grokipedia.com/page/[Wikipedia_Article]
Examples: COVID-19_pandemic, Abortion_in_the_United_States, United_States_federal_budget

RULES:
1. Use ONLY base domain URLs (no article paths)
2. Every claim needs 1 Grokipedia link
3. 2-3 sources total per claim

=== SCORING ===
- 9-10: Verified fact, strong evidence
- 7-8: Mostly true, minor issues
- 5-6: Mixed or lacks context
- 3-4: Mostly false
- 1-2: Completely false

=== OUTPUT FORMAT ===
{
  "claims": [
    {
      "text": "exact factual claim",
      "score": 8,
      "verdict": "TRUE/FALSE/MIXED/UNVERIFIABLE",
      "explanation": "Brief explanation with evidence",
      "sources": [
        "https://real-source-1.gov/page",
        "https://www.factcheck.org/2024/article",
        "https://grokipedia.com/page/Topic"
      ]
    }
  ],
  "truth_score": 8,
  "summary": "Overall assessment"
}

If NO factual claims (only opinions):
{
  "claims": [],
  "truth_score": null,
  "summary": "No factual claims to verify"
}`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      })
    });

    if (!grokResponse.ok) {
      throw new Error(`Grok API error: ${grokResponse.statusText}`);
    }

    const grokData = await grokResponse.json();
    const grokContent = grokData.choices[0].message.content;

    // Debug logging
    console.log('\n=== GROK RESPONSE DEBUG ===');
    console.log('📝 Raw Grok response:', grokContent);
    console.log('📝 Response length:', grokContent.length);
    console.log('📝 Response type:', typeof grokContent);

    // Parse Grok's JSON response
    let analysisResult;
    try {
      analysisResult = JSON.parse(grokContent);
      console.log('✅ Successfully parsed Grok JSON');
      console.log('📊 Parsed result:', JSON.stringify(analysisResult, null, 2));
    } catch (e) {
      console.error('❌ Failed to parse Grok response:', e.message);
      console.error('❌ Invalid JSON content:', grokContent);
      // If Grok didn't return valid JSON, create a default response
      analysisResult = {
        claims: [],
        truth_score: 5,
        summary: 'Unable to verify this claim with available sources.'
      };
    }

    const truthScore = analysisResult.truth_score;
    const summary = analysisResult.summary || analysisResult.explanation || 'No explanation provided.';
    const claims = analysisResult.claims || [];

    console.log('📊 Extracted data:');
    console.log('  - Truth Score:', truthScore);
    console.log('  - Summary:', summary);
    console.log('  - Number of claims:', claims.length);
    if (claims.length > 0) {
      claims.forEach((claim, idx) => {
        console.log(`  - Claim ${idx + 1}:`, {
          text: claim.text,
          score: claim.score,
          verdict: claim.verdict,
          sources: claim.sources?.length || 0
        });
      });
    }
    console.log('=== END GROK RESPONSE DEBUG ===\n');

    // Handle cases where no factual claims exist
    if (truthScore === null || truthScore === undefined) {
      await supabase
        .from('messages')
        .update({
          fact_check_status: 'completed',
          grok_explanation: summary,
          grok_response_raw: analysisResult,
          processed_at: new Date().toISOString()
        })
        .eq('id', messageId);

      console.log(`⊘ Message ${messageId} had no factual claims to verify`);
      return;
    }

    // Map truth_score (1-10) to verdict for backwards compatibility
    let verdict;
    if (truthScore >= 8) {
      verdict = 'True';
    } else if (truthScore >= 6) {
      verdict = 'Misleading';
    } else if (truthScore >= 4) {
      verdict = 'Unverified';
    } else {
      verdict = 'False';
    }

    // Get current credibility score for the space
    const { data: spaceData } = await supabase
      .from('spaces')
      .select('overall_credibility_score')
      .eq('id', spaceId)
      .single();

    const currentScore = spaceData?.overall_credibility_score || 100;

    // Calculate new score based on truth_score (1-10 scale)
    // Higher truth score = less penalty
    const scoreChange = (truthScore - 10) * 1.5; // Max penalty: -13.5 for score of 1
    const newScore = Math.max(0, Math.min(100, currentScore + scoreChange));

    // Update message with fact-check results
    const { error } = await supabase
      .from('messages')
      .update({
        fact_check_status: 'completed',
        grok_verdict: verdict,
        grok_explanation: summary,
        truth_score: truthScore,
        credibility_score: Math.round(newScore),
        grok_response_raw: analysisResult,
        processed_at: new Date().toISOString()
      })
      .eq('id', messageId);

    // Update space overall score
    await supabase
      .from('spaces')
      .update({ overall_credibility_score: Math.round(newScore) })
      .eq('id', spaceId);

    if (error) throw error;

    console.log(`✓ Message ${messageId} analyzed: Truth Score ${truthScore}/10`);
  } catch (error) {
    console.error('Error analyzing with Grok:', error);

    // Mark message as failed
    await supabase
      .from('messages')
      .update({ fact_check_status: 'failed' })
      .eq('id', messageId);
  }
}

// Test endpoint for analysis format
app.post('/api/test-analysis', async (req, res) => {
  try {
    const { content = "Elon Musk founded Tesla in 2003 and it's worth $800 billion. Also, eating sugar cures diabetes." } = req.body;

    // Call Grok directly to test
    const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-4-0709', // Best model for maximum accuracy
        messages: [
          {
            role: 'system',
            content: `You are a fact-checking AI. Extract and verify factual claims, EVEN when embedded in casual language or opinion statements.

=== WHAT TO EXTRACT ===
✅ FACTUAL CLAIMS (extract these - even if phrased casually):
- Statistics & numbers: "Unemployment is 3.5%", "21 million people crossed the border"
- Historical events: "He appointed three justices", "The bill passed in 2022"
- Verifiable statements: "He tweeted 'thank you'", "The law provides life in prison"
- Scientific/medical facts: "Vaccines contain mercury", "COVID originated in China"
- Economic/efficiency claims: "nuclear energy is a waste of money", "solar is more efficient than nuclear"
- Comparative claims: "X is better/worse/more expensive than Y" (if objectively measurable)
- Claims about news/studies: "I heard in the news that X" → verify if X is actually true
- Casual factual statements: "I heard that...", "they say that..." → extract and verify the underlying claim

⚠️ IMPORTANT: Don't be fooled by casual phrasing!
- "I heard nuclear is a waste of money" → EXTRACT: "nuclear energy is a waste of money" (verifiable!)
- "I think solar is more efficient" → EXTRACT: "solar is more efficient" (verifiable!)
- "all I've seen in the news is..." → EXTRACT the factual claim being referenced

❌ PURE OPINIONS (skip these):
- Pure value judgments: "She's radical", "He's terrible", "This is immoral"
- Predictions: "This will destroy America", "We will win"
- Subjective preferences: "I prefer...", "The best approach is..." (without factual basis)
- Vague statements: "I heard there's a new study" (no specific claim)

=== SOURCE REQUIREMENTS ===
⚠️ CRITICAL: Use ONLY these approved URLs. NO other URLs allowed.

APPROVED SOURCES (use ONLY base domains):
- https://www.factcheck.org/
- https://www.politifact.com/
- https://www.snopes.com/
- https://www.census.gov/
- https://www.bls.gov/
- https://www.cdc.gov/
- https://www.reuters.com/
- https://apnews.com/
- https://www.npr.org/

GROKIPEDIA (REQUIRED - last source):
Format: https://grokipedia.com/page/[Wikipedia_Article]
Examples: COVID-19_pandemic, Abortion_in_the_United_States, United_States_federal_budget

RULES:
1. Use ONLY base domain URLs (no article paths)
2. Every claim needs 1 Grokipedia link
3. 2-3 sources total per claim

=== SCORING ===
- 9-10: Verified fact, strong evidence
- 7-8: Mostly true, minor issues
- 5-6: Mixed or lacks context
- 3-4: Mostly false
- 1-2: Completely false

=== OUTPUT FORMAT ===
{
  "claims": [
    {
      "text": "exact factual claim",
      "score": 8,
      "verdict": "TRUE/FALSE/MIXED/UNVERIFIABLE",
      "explanation": "Brief explanation with evidence",
      "sources": [
        "https://real-source-1.gov/page",
        "https://www.factcheck.org/2024/article",
        "https://grokipedia.com/page/Topic"
      ]
    }
  ],
  "truth_score": 8,
  "summary": "Overall assessment"
}

If NO factual claims (only opinions):
{
  "claims": [],
  "truth_score": null,
  "summary": "No factual claims to verify"
}`
          },
          {
            role: 'user',
            content: content
          }
        ],
        temperature: 0.3,
        max_tokens: 1500
      })
    });

    const grokData = await grokResponse.json();

    // Check if response has error
    if (!grokResponse.ok || grokData.error) {
      console.error('Grok API error response:', grokData);
      throw new Error(grokData.error?.message || `Grok API error: ${grokResponse.statusText}`);
    }

    if (!grokData.choices || !grokData.choices[0]) {
      console.error('Unexpected Grok response structure:', grokData);
      throw new Error('Invalid response from Grok API');
    }

    const grokContent = grokData.choices[0].message.content;

    let analysisResult;
    try {
      analysisResult = JSON.parse(grokContent);
    } catch (e) {
      analysisResult = { error: 'Failed to parse Grok response', raw: grokContent };
    }

    res.json({
      success: true,
      test_content: content,
      grok_response: analysisResult,
      raw_response: grokData
    });
  } catch (error) {
    console.error('Test analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Manual trigger for re-analyzing a message
app.post('/api/messages/:id/analyze', async (req, res) => {
  try {
    const { id } = req.params;

    // Get message
    const { data: message, error } = await supabase
      .from('messages')
      .select('content, space_id')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Trigger analysis
    analyzeMessageWithGrok(id, message.content, message.space_id).catch(err => {
      console.error('Grok analysis error:', err);
    });

    res.json({
      success: true,
      message: 'Message queued for re-analysis'
    });
  } catch (error) {
    console.error('Error re-analyzing message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// ANALYTICS ENDPOINTS
// =====================================================

// Dive Deeper - Propagation Graph
// Dive Deeper - Propagation Graph
app.post('/api/analytics/dive-deeper', async (req, res) => {
  try {
    const { messageId, claim, skipCache, nodeCount = 60 } = req.body;

    if (!claim) {
      return res.status(400).json({ success: false, error: 'Claim text is required' });
    }

    // Check cache first if messageId is provided and skipCache is not true
    if (messageId && !skipCache) {
      const { data: cachedMsg, error: cacheError } = await supabase
        .from('messages')
        .select('propagation_analysis')
        .eq('id', messageId)
        .single();

      if (!cacheError && cachedMsg?.propagation_analysis) {
        console.log(`Cache hit for message ${messageId}`);
        return res.json({
          success: true,
          propagationGraph: cachedMsg.propagation_analysis,
          cached: true
        });
      }
    }

    if (skipCache) {
      console.log('skipCache=true - fetching fresh data');
    }

    console.log(`Generating propagation graph for claim: "${claim.substring(0, 50)}..."`);

    // Try to use real X API data first
    let graphData = null;
    if (twitterService.isXApiAvailable()) {
      console.log('Attempting to fetch real tweets from X API...');
      try {
        graphData = await twitterService.buildPropagationFromSearch(claim, nodeCount);
        if (graphData) {
          console.log(`✓ Built propagation graph from ${graphData.nodes.length} real tweets`);
        }
      } catch (xApiError) {
        console.warn('X API failed, falling back to Grok:', xApiError.message);
      }
    } else {
      console.log('X API not configured, using Grok to generate graph');
    }

    // Fall back to Grok generation if X API didn't return data
    if (!graphData) {
      console.log('Using Grok to generate propagation graph...');
      const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-reasoning',
          messages: [
            {
              role: 'system',
              content: `Generate a CONNECTED knowledge graph of X posts about a claim.

CRITICAL: Every node MUST be connected. Create a web of relationships, not isolated nodes.

Generate 50-70 nodes with MANY links between them. Structure:

1. Create 5-6 HIGH-IMPACT hub nodes (1M+ impressions, verified accounts)
2. Each hub has 8-12 connected nodes (replies, quotes, retweets)
3. Connect hubs to each other via quote tweets or discourse

JSON Structure:
{
  "claim_summary": "Brief summary",
  "topic": "Specific topic",
  "nodes": [
    {
      "id": "unique_id",
      "username": "@handle",
      "display_name": "Name",
      "impressions": number,
      "followers": number,
      "verified": boolean,
      "tweet_text": "Post content",
      "tweet_url": "https://x.com/handle/status/id",
      "stance": "supports|contradicts",
      "clusterIdx": 0
    }
  ],
  "links": [
    {"source": "hub_id", "target": "reply_id", "type": "reply"},
    {"source": "hub_id", "target": "quote_id", "type": "quote"},
    {"source": "hub1_id", "target": "hub2_id", "type": "discourse"}
  ],
  "statistics": {...}
}

RULES:
- 50-70 nodes, but MUST have 80+ links connecting them
- NO isolated nodes - every node must have at least 1 link
- Create reply chains: A -> B -> C -> D
- Connect hubs to each other
- 45% supports, 45% contradicts, 10% neutral`
            },
            {
              role: 'user',
              content: `Generate a DENSE X interaction graph (50-70 nodes in 5-6 clusters) for this claim:\n\n"${claim}"\n\nMake sure to include high-impression accounts and create realistic reply/quote chains within each cluster.`
            }
          ],
          temperature: 0.7,
          max_tokens: 8000
        })
      });

      if (!grokResponse.ok) {
        throw new Error(`Grok API error: ${grokResponse.statusText}`);
      }

      const grokData = await grokResponse.json();
      const responseContent = grokData.choices[0].message.content;

      // Parse the JSON response
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          graphData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (parseError) {
        console.error('Failed to parse Grok response:', parseError);
        // Return a fallback minimal graph with clusters
        const fallbackNodes = [];
        const fallbackLinks = [];
        const stances = ['supports', 'contradicts', 'supports', 'contradicts', 'supports'];

        for (let i = 0; i < 15; i++) {
          fallbackNodes.push({
            id: `node-${i}`,
            username: `@user${i}`,
            display_name: `User ${i}`,
            impressions: Math.floor(Math.random() * 100000) + 1000,
            followers: Math.floor(Math.random() * 50000) + 100,
            verified: i < 3,
            tweet_text: `Tweet about the claim #${i}`,
            stance: stances[i % stances.length],
            type: ['retweet', 'quote', 'reply'][i % 3],
            timestamp: new Date().toISOString()
          });

          if (i > 0) {
            fallbackLinks.push({
              source: `node-${Math.floor(i / 3) * 3}`,
              target: `node-${i}`,
              type: ['retweet', 'quote', 'reply'][i % 3]
            });
          }
        }

        graphData = {
          claim_summary: claim.substring(0, 100),
          topic: 'General',
          nodes: fallbackNodes,
          links: fallbackLinks,
          statistics: {
            total_impressions: fallbackNodes.reduce((s, n) => s + n.impressions, 0),
            supporters: fallbackNodes.filter(n => n.stance === 'supports').length,
            contradictors: fallbackNodes.filter(n => n.stance === 'contradicts').length,
            neutral: 0
          }
        };
      }
    } // End of if (!graphData) block

    // Remove any origin-type nodes - we want clusters only
    if (graphData.nodes) {
      graphData.nodes = graphData.nodes.filter(n => n.stance !== 'original' && n.id !== 'origin');
    }
    if (graphData.links) {
      graphData.links = graphData.links.filter(l => l.source !== 'origin' && l.target !== 'origin');
    }

    // Recalculate statistics
    if (graphData.nodes && graphData.nodes.length > 0) {
      graphData.statistics = {
        total_impressions: graphData.nodes.reduce((s, n) => s + (n.impressions || 0), 0),
        supporters: graphData.nodes.filter(n => n.stance === 'supports').length,
        contradictors: graphData.nodes.filter(n => n.stance === 'contradicts').length,
        neutral: graphData.nodes.filter(n => !n.stance || n.stance === 'neutral').length
      };
    }

    // Cache the result if messageId is provided
    if (messageId) {
      const { error: updateError } = await supabase
        .from('messages')
        .update({ propagation_analysis: graphData })
        .eq('id', messageId);

      if (updateError) {
        console.warn('Failed to cache propagation analysis:', updateError.message);
      } else {
        console.log(`Cached propagation analysis for message ${messageId}`);
      }
    }

    res.json({
      success: true,
      propagationGraph: graphData,
      cached: false
    });

  } catch (error) {
    console.error('Error in dive deeper:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// TEST ANALYTICS CACHING
// =====================================================

// In-memory cache for test data (use file or DB for persistence)
const testAnalyticsCache = new Map();

/**
 * Generate cached test analytics data
 */
app.post('/api/test/generate-cached-analytics', async (req, res) => {
  try {
    const {
      speakers = ['Speaker A', 'Speaker B'],
      messageCount = 15,
      title = 'Test Debate Analysis'
    } = req.body;

    // Generate a cache ID
    const cacheId = `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Generate test messages with varied truth scores
    const messages = [];
    const verdicts = ['True', 'Misleading', 'False', 'Unverified'];

    for (let i = 0; i < messageCount; i++) {
      const speaker = speakers[i % speakers.length];
      const truthScore = Math.floor(Math.random() * 10) + 1;
      const verdictIndex = truthScore >= 8 ? 0 : truthScore >= 5 ? 1 : truthScore >= 3 ? 2 : 3;

      messages.push({
        id: `msg-${i + 1}`,
        speaker_display_name: speaker,
        speaker_username: speaker.toLowerCase().replace(/\s+/g, ''),
        content: `Test statement ${i + 1} from ${speaker} about various topics including policy, economy, or social issues.`,
        sequence_number: i + 1,
        truth_score: truthScore,
        grok_verdict: verdicts[verdictIndex],
        grok_explanation: `This is a test explanation for message ${i + 1}. The claim ${truthScore >= 5 ? 'is mostly accurate' : 'contains inaccuracies'}.`,
        grok_response_raw: [
          {
            text: `Claim ${i + 1} extracted from the statement`,
            score: truthScore,
            verdict: verdicts[verdictIndex],
            explanation: `Explanation for claim ${i + 1}`,
            sources: [
              'https://example.com/source1',
              'https://grokipedia.com/page/Example'
            ]
          }
        ],
        fact_check_status: 'completed',
        created_at: new Date(Date.now() - (messageCount - i) * 60000).toISOString()
      });
    }

    // Calculate statistics
    const avgScore = messages.reduce((sum, m) => sum + m.truth_score, 0) / messages.length;

    // Create space data
    const space = {
      id: cacheId,
      title: title,
      overall_credibility_score: Math.round(avgScore * 10),
      started_at: new Date(Date.now() - messageCount * 60000).toISOString(),
      ended_at: new Date().toISOString(),
      total_messages: messageCount
    };

    // Generate propagation graph for testing
    const propagationGraph = {
      claim_summary: "Test claim for propagation visualization",
      origin: {
        id: 'origin',
        username: '@testorigin',
        display_name: 'Test Origin Account',
        impressions: 1500000,
        followers: 500000,
        verified: true,
        tweet_text: 'This is the original test tweet for propagation testing.',
        timestamp: new Date().toISOString()
      },
      nodes: [],
      links: [],
      statistics: {
        total_impressions: 2500000,
        supporters: 8,
        contradictors: 4,
        neutral: 3
      }
    };

    // Generate 15 test nodes for propagation
    for (let i = 0; i < 15; i++) {
      const impressions = Math.floor(Math.random() * 1000000) + 1000;
      const stances = ['supports', 'contradicts', 'neutral'];
      const types = ['retweet', 'quote', 'reply'];

      const node = {
        id: `node-${i + 1}`,
        username: `@testuser${i + 1}`,
        display_name: `Test User ${i + 1}`,
        impressions: impressions,
        followers: Math.floor(impressions / 10),
        verified: Math.random() > 0.7,
        tweet_text: `Test tweet ${i + 1} discussing the claim with various perspectives.`,
        stance: stances[i % 3],
        type: types[i % 3],
        timestamp: new Date(Date.now() - i * 3600000).toISOString()
      };

      propagationGraph.nodes.push(node);
      propagationGraph.links.push({
        source: i === 0 ? 'origin' : `node-${Math.floor(Math.random() * i) + 1}`,
        target: `node-${i + 1}`,
        type: types[i % 3]
      });
    }

    // Add origin to nodes
    propagationGraph.nodes.unshift({
      ...propagationGraph.origin,
      stance: 'original',
      type: 'original'
    });

    // Store in cache
    testAnalyticsCache.set(cacheId, {
      space,
      messages,
      propagationGraph,
      createdAt: new Date().toISOString()
    });

    console.log(`✓ Generated test analytics cache: ${cacheId}`);

    res.json({
      success: true,
      cacheId,
      message: `Generated ${messageCount} test messages for ${speakers.length} speakers`,
      testUrl: `/test-cached-analytics.html?cacheId=${cacheId}`
    });

  } catch (error) {
    console.error('Error generating test cache:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Load cached test analytics data
 */
app.get('/api/test/cached-analytics/:cacheId', async (req, res) => {
  try {
    const { cacheId } = req.params;

    const cached = testAnalyticsCache.get(cacheId);

    if (!cached) {
      return res.status(404).json({
        success: false,
        error: 'Cache not found or expired'
      });
    }

    res.json({
      success: true,
      data: {
        space: cached.space,
        messages: cached.messages,
        propagationGraph: cached.propagationGraph
      }
    });

  } catch (error) {
    console.error('Error loading cached analytics:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * List all cached test analytics
 */
app.get('/api/test/cached-analytics', async (req, res) => {
  try {
    const caches = [];
    for (const [id, data] of testAnalyticsCache) {
      caches.push({
        cacheId: id,
        title: data.space.title,
        messageCount: data.messages.length,
        createdAt: data.createdAt
      });
    }

    res.json({ success: true, caches });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Load real space data from Supabase for testing
 * This allows testing features with already-analyzed spaces
 */
app.get('/api/test/load-space/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;

    // Fetch space data
    const { data: space, error: spaceError } = await supabase
      .from('spaces')
      .select('*')
      .eq('id', spaceId)
      .single();

    if (spaceError || !space) {
      return res.status(404).json({
        success: false,
        error: 'Space not found'
      });
    }

    // Fetch messages with speaker names using the view
    const { data: messages, error: messagesError } = await supabase
      .from('messages_with_speakers')
      .select('*')
      .eq('space_id', spaceId)
      .order('sequence_number', { ascending: true });

    if (messagesError) {
      // Fallback to regular messages if view doesn't exist
      console.warn('View query failed, falling back to messages table:', messagesError.message);
      const { data: rawMessages, error: rawError } = await supabase
        .from('messages')
        .select('*')
        .eq('space_id', spaceId)
        .order('sequence_number', { ascending: true });

      if (rawError) throw rawError;

      // Cache with raw messages
      const cacheId = `real-${spaceId}`;
      testAnalyticsCache.set(cacheId, {
        space,
        messages: rawMessages || [],
        propagationGraph: null,
        createdAt: new Date().toISOString(),
        isRealSpace: true
      });

      console.log(`✓ Loaded real space ${spaceId} with ${rawMessages?.length || 0} messages (fallback)`);

      return res.json({
        success: true,
        cacheId,
        data: {
          space,
          messages: rawMessages || []
        }
      });
    }

    // Cache it for quick access
    const cacheId = `real-${spaceId}`;
    testAnalyticsCache.set(cacheId, {
      space,
      messages: messages || [],
      propagationGraph: null,
      createdAt: new Date().toISOString(),
      isRealSpace: true
    });

    console.log(`✓ Loaded real space ${spaceId} with ${messages?.length || 0} messages (with speakers)`);

    res.json({
      success: true,
      cacheId,
      data: {
        space,
        messages: messages || []
      }
    });

  } catch (error) {
    console.error('Error loading real space:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// ERROR HANDLING
// =====================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Grokipedia Chat Endpoint
app.post('/api/grokipedia/chat', async (req, res) => {
  try {
    const { message, context } = req.body;

    const completion = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'grok-4-1-fast-non-reasoning',
        messages: [
          {
            role: 'system',
            content: `You are a helpful assistant on Grokipedia. The user is reading an article. 
            Context/Claim from the article: "${context || 'No specific context provided'}".
            Answer the user's question based on this context if relevant, or general knowledge. 
            Keep answers concise and helpful.`
          },
          { role: 'user', content: message }
        ]
      })
    });

    const data = await completion.json();
    const reply = data.choices[0].message.content;

    res.json({ success: true, reply });
  } catch (error) {
    console.error('Error in Grokipedia chat:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// DEBATE ANALYZER ROUTES
// =====================================================

app.use('/api/debate', debateRoutes);
app.use('/api/claims', claimSourcesRoutes);
app.use('/api/spaces', spaceEndRoutes);

// =====================================================
// TWITTER BOT CONFIG ENDPOINT
// =====================================================

// Endpoint to provide Twitter credentials to the Chrome extension
// Credentials are stored in .env (gitignored) so they stay secret
app.get('/api/twitter/config', (req, res) => {
  // Only serve if credentials are configured
  if (!process.env.X_API_KEY) {
    return res.status(404).json({
      success: false,
      error: 'Twitter credentials not configured on server'
    });
  }

  res.json({
    success: true,
    config: {
      API_KEY: process.env.X_API_KEY,
      API_SECRET: process.env.X_API_SECRET,
      ACCESS_TOKEN: process.env.X_ACCESS_TOKEN,
      ACCESS_TOKEN_SECRET: process.env.X_ACCESS_TOKEN_SECRET,
      BOT_USER_ID: process.env.X_BOT_USER_ID,
      CHECK_INTERVAL: parseFloat(process.env.X_CHECK_INTERVAL) || 0.5
    }
  });
});

// Get bot state from Supabase
app.get('/api/twitter/state/:key', async (req, res) => {
  try {
    const { key } = req.params;

    const { data, error } = await supabase
      .from('bot_state')
      .select('value')
      .eq('key', key)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    res.json({
      success: true,
      value: data?.value || null
    });
  } catch (error) {
    console.error('Error getting bot state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Set bot state in Supabase
app.post('/api/twitter/state/:key', async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    const { error } = await supabase
      .from('bot_state')
      .upsert({
        key: key,
        value: value,
        updated_at: new Date().toISOString()
      }, { onConflict: 'key' });

    if (error) throw error;

    res.json({
      success: true,
      message: 'State updated'
    });
  } catch (error) {
    console.error('Error setting bot state:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// THREAD ANALYSIS ENDPOINTS
// =====================================================

/**
 * Analyze a Twitter thread
 * POST /api/threads/analyze
 */
app.post('/api/threads/analyze', async (req, res) => {
  try {
    const { conversationId, triggeringTweetId, triggeringUsername } = req.body;

    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: 'conversationId is required'
      });
    }

    console.log(`\n🧵 Starting thread analysis for conversation: ${conversationId}`);

    // 1. Fetch all tweets in the thread
    const threadData = await getThreadTweets(conversationId);

    if (!threadData.tweets || threadData.tweets.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No tweets found in thread'
      });
    }

    console.log(`📊 Found ${threadData.tweets.length} tweets in thread`);

    // 2. Create a space for this thread
    const { data: spaceId, error: spaceError } = await supabase.rpc('create_space', {
      p_title: `Thread Analysis: ${conversationId}`,
      p_space_url: `https://x.com/i/status/${conversationId}`,
      p_metadata: {
        type: 'thread',
        conversation_id: conversationId,
        triggering_tweet_id: triggeringTweetId,
        triggering_username: triggeringUsername,
        tweet_count: threadData.tweets.length
      }
    });

    if (spaceError) throw spaceError;

    console.log(`✅ Created space: ${spaceId}`);

    // 3. Mark as not live (thread analysis is instant, not live)
    await supabase
      .from('spaces')
      .update({
        is_live: false,
        ended_at: new Date().toISOString(),
        summary_generated: false  // Will be set true after bot posts reply
      })
      .eq('id', spaceId);

    // 4. Process each tweet as a message
    const analysisPromises = [];

    for (let i = 0; i < threadData.tweets.length; i++) {
      const tweet = threadData.tweets[i];
      const username = tweet.user?.username || 'unknown';
      const displayName = tweet.user?.name || username;

      // Create message
      const { data: messageId, error: msgError } = await supabase.rpc('create_message', {
        p_space_id: spaceId,
        p_speaker_username: `@${username}`,
        p_speaker_display_name: displayName,
        p_content: tweet.text
      });

      if (msgError) {
        console.error(`Error creating message for tweet ${tweet.id}:`, msgError);
        continue;
      }

      // Queue Grok analysis (run in parallel later)
      analysisPromises.push(
        analyzeMessageWithGrok(messageId, tweet.text, spaceId).catch(err => {
          console.error(`Error analyzing tweet ${tweet.id}:`, err);
        })
      );
    }

    // 5. Wait for all analyses to complete
    console.log(`🔍 Running Grok analysis on ${analysisPromises.length} tweets...`);
    await Promise.all(analysisPromises);
    console.log(`✅ Analysis complete`);

    // 6. Generate summary (but don't set summary_generated = true yet)
    const { data: messages } = await supabase
      .from('messages_with_speakers')
      .select('*')
      .eq('space_id', spaceId)
      .eq('fact_check_status', 'completed')
      .order('sequence_number');

    // Calculate stats
    const stats = {
      total: messages?.length || 0,
      true: 0,
      false: 0,
      misleading: 0,
      unverified: 0
    };

    messages?.forEach(msg => {
      const verdict = msg.grok_verdict?.toLowerCase();
      if (stats[verdict] !== undefined) {
        stats[verdict]++;
      }
    });

    // Calculate speaker averages and find worst claim per speaker
    const bySpeaker = {};
    messages?.forEach(msg => {
      if (msg.truth_score !== null) {
        const speaker = msg.speaker_username || 'Unknown';
        if (!bySpeaker[speaker]) {
          bySpeaker[speaker] = {
            displayName: msg.speaker_display_name || speaker,
            scores: [],
            messages: []
          };
        }
        bySpeaker[speaker].scores.push(msg.truth_score);
        bySpeaker[speaker].messages.push(msg);
      }
    });

    // Calculate averages and find worst claim for each speaker
    const speakerStats = [];
    Object.keys(bySpeaker).forEach(username => {
      const data = bySpeaker[username];
      const avgScore = data.scores.reduce((a, b) => a + b, 0) / data.scores.length;
      const worstClaim = data.messages.sort((a, b) => a.truth_score - b.truth_score)[0];

      speakerStats.push({
        username,
        displayName: data.displayName,
        avgScore: avgScore.toFixed(1),
        worstClaim: {
          content: worstClaim.content,
          score: worstClaim.truth_score
        }
      });
    });

    // Get credibility score
    const { data: spaceData } = await supabase
      .from('spaces')
      .select('overall_credibility_score')
      .eq('id', spaceId)
      .single();

    const credibilityScore = spaceData?.overall_credibility_score || 100;

    // Collect all message content for conversation summary
    const allContent = messages?.map(m => m.content).join(' ') || '';

    // Generate summary using Grok
    console.log('🤖 Calling Grok to generate thread summary...');

    let summaryText;
    try {
      const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'grok-4-1-fast-reasoning',
          messages: [
            {
              role: 'system',
              content: `Create a professional, journalist-style tweet summarizing this X thread fact-check analysis. 

CRITICAL RULES:
- NO EMOJIS whatsoever
- Sound professional and human, not AI-generated
- Keep it under 280 characters total
- Use concise, punchy sentences

REQUIRED FORMAT (use this exact structure):
1. First line: Brief 1-sentence summary of what the thread discussed
2. Credibility Score line: "Credibility Score: X/100"
3. Claims breakdown: "Fact-checked X claims: Y true, Z false, W mixed"
4. Speaker accuracy: Each speaker's average score on one line
5. Least accurate section: List each speaker's weakest claim topic (2-3 word description) with score
6. Final verdict: One sentence overall assessment

Example:
"Thread discussed vaccine efficacy claims and CDC data interpretation.

Credibility Score: 72/100

Fact-checked 5 claims: 2 true, 2 false, 1 mixed.

@User1 averaged 7/10.
@User2 averaged 4/10.

Least accurate:
@User1 on efficacy rates (3/10)
@User2 on CDC statistics (2/10)

Mixed accuracy, several claims need verification."

Write naturally. Be direct and informative.`
            },
            {
              role: 'user',
              content: `Create thread summary:

Thread content (use this to write a 1-sentence topic summary):
${allContent.substring(0, 800)}

Credibility Score: ${credibilityScore}/100
Total claims: ${stats.total}
Verdicts: ${stats.true} true, ${stats.false} false, ${stats.misleading} misleading, ${stats.unverified} unverified

Speakers:
${speakerStats.map(s =>
                `${s.username}: averaged ${s.avgScore}/10, worst claim "${s.worstClaim.content.substring(0, 50)}..." (${s.worstClaim.score}/10)`
              ).join('\n')}`
            }
          ],
          temperature: 0.7,
          max_tokens: 350
        })
      });

      if (grokResponse.ok) {
        const grokData = await grokResponse.json();
        summaryText = grokData.choices[0]?.message?.content?.trim();
      }
    } catch (err) {
      console.error('Grok summary error:', err);
    }

    // Fallback if Grok fails
    if (!summaryText) {
      summaryText = `Thread Analyzed (${threadData.tweets.length} tweets)\n`;
      summaryText += `Credibility Score: ${credibilityScore}/100\n`;
      summaryText += `Fact-checked ${stats.total} claims: ${stats.true} true, ${stats.false} false, ${stats.misleading + stats.unverified} mixed.\n`;
      if (stats.false > 0) {
        summaryText += `Found ${stats.false} false claim(s) in this thread.`;
      } else {
        summaryText += `Thread appears mostly accurate.`;
      }
    }

    console.log('✅ Thread summary generated');

    // Store summary but don't trigger edge function yet
    await supabase
      .from('spaces')
      .update({
        summary_text: summaryText
        // summary_generated stays false until /complete is called
      })
      .eq('id', spaceId);

    console.log(`✅ Thread analysis complete: ${spaceId}`);

    res.json({
      success: true,
      spaceId: spaceId,
      summary: summaryText,
      stats: stats,
      tweetCount: threadData.tweets.length
    });

  } catch (error) {
    console.error('❌ Thread analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Lookup a thread analysis by conversation ID
 * GET /api/threads/lookup/:conversationId
 */
app.get('/api/threads/lookup/:conversationId', async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Query spaces where metadata contains this conversation_id
    const { data, error } = await supabase
      .from('spaces')
      .select('id, title, summary_text, metadata')
      .eq('metadata->>conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found

    if (data) {
      res.json({
        success: true,
        found: true,
        spaceId: data.id,
        title: data.title,
        summary: data.summary_text
      });
    } else {
      res.json({
        success: true,
        found: false
      });
    }

  } catch (error) {
    console.error('Error looking up thread:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Mark thread analysis as complete (triggers edge function)
 * POST /api/threads/:id/complete
 */
app.post('/api/threads/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from('spaces')
      .update({
        summary_generated: true,
        summary_generated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (error) throw error;

    console.log(`✅ Thread ${id} marked as complete (edge function triggered)`);

    res.json({
      success: true,
      message: 'Thread analysis marked as complete'
    });

  } catch (error) {
    console.error('Error completing thread:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Veritas API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📝 Debate analyzer: http://localhost:${PORT}/api/debate`);
});

