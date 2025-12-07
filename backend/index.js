import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import debateRoutes from './routes/debate-analyzer.js';
import claimSourcesRoutes from './routes/claim-sources.js';
import spaceEndRoutes from './routes/space-end.js';

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3000;

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
    const { messageId, claim } = req.body;

    if (!claim) {
      return res.status(400).json({ success: false, error: 'Claim text is required' });
    }

    // Check cache first if messageId is provided
    if (messageId) {
      const { data: cachedMsg, error: cacheError } = await supabase
        .from('messages')
        .select('propagation_analysis')
        .eq('id', messageId)
        .single();

      if (!cacheError && cachedMsg?.propagation_analysis) {
        console.log(`Cache hit for message ${messageId}`);
        return res.json({
          success: true,
          graph: cachedMsg.propagation_analysis,
          cached: true
        });
      }
    }

    console.log(`Generating propagation graph for claim: "${claim.substring(0, 50)}..."`);

    // Use Grok to analyze how this claim might propagate on social media
    // In a production implementation, this would use the X API to search for similar tweets
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
            content: `You are a social media analyst. Given a claim, generate a realistic propagation graph showing how this claim might spread on Twitter/X.

IMPORTANT: Generate data that shows:
1. The ORIGIN of the claim (who first posted it, their account size/impressions)
2. How it PROPAGATED (retweets, quotes, replies)
3. Who is SPREADING it (influencers, news accounts, regular users)
4. The STANCE of each node (supports claim, contradicts claim, or neutral)

Return a JSON object with this EXACT structure:
{
  "claim_summary": "Brief summary of the claim being traced",
  "origin": {
    "id": "origin",
    "username": "@handle",
    "display_name": "Name",
    "impressions": 1000000,
    "followers": 500000,
    "verified": true,
    "tweet_text": "Original tweet text",
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "nodes": [
    {
      "id": "unique_id",
      "username": "@handle",
      "display_name": "Name",
      "impressions": number,
      "followers": number,
      "verified": boolean,
      "tweet_text": "Tweet snippet",
      "stance": "supports|contradicts|neutral",
      "type": "retweet|quote|reply|original",
      "timestamp": "ISO date"
    }
  ],
  "links": [
    {
      "source": "source_id",
      "target": "target_id",
      "type": "retweet|quote|reply"
    }
  ],
  "statistics": {
    "total_impressions": number,
    "supporters": number,
    "contradictors": number,
    "neutral": number
  }
}

Generate 8-12 nodes with realistic Twitter handles and impression counts.
Higher impression accounts (>100k) should be verifiable claims sources.
Show a mix of supporters, contradictors, and neutral reporters.`
          },
          {
            role: 'user',
            content: `Generate a propagation graph for this claim: "${claim}"`
          }
        ],
        temperature: 0.7,
        max_tokens: 2000
      })
    });

    if (!grokResponse.ok) {
      throw new Error(`Grok API error: ${grokResponse.statusText}`);
    }

    const grokData = await grokResponse.json();
    const responseContent = grokData.choices[0].message.content;

    // Parse the JSON response
    let graphData;
    try {
      // Try to extract JSON from the response (in case there's extra text)
      const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        graphData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Grok response:', parseError);
      // Return a fallback minimal graph
      graphData = {
        claim_summary: claim.substring(0, 100),
        origin: {
          id: 'origin',
          username: '@unknown',
          display_name: 'Unknown Source',
          impressions: 1000,
          followers: 100,
          verified: false,
          tweet_text: claim,
          timestamp: new Date().toISOString()
        },
        nodes: [],
        links: [],
        statistics: {
          total_impressions: 1000,
          supporters: 0,
          contradictors: 0,
          neutral: 1
        }
      };
    }

    // Ensure the origin is included in nodes
    if (graphData.origin && !graphData.nodes.find(n => n.id === 'origin')) {
      graphData.nodes.unshift({
        ...graphData.origin,
        stance: 'original',
        type: 'original'
      });
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
      graph: graphData,
      cached: false
    });

  } catch (error) {
    console.error('Error in dive deeper:', error);
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
        model: 'grok-4-0709', // Best model for maximum accuracy
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
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Veritas API running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📝 Debate analyzer: http://localhost:${PORT}/api/debate`);
});

