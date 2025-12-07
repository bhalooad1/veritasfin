import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { dbOps } from './db.js';
import { aiService } from './ai-service.js';

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());

// Helper for async error handling
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// =====================================================
// API ROUTES
// =====================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Argument Mapping API is running (Resilient Mode)',
    timestamp: new Date().toISOString()
  });
});

// =====================================================
// TRANSCRIPT ANALYSIS ENDPOINTS
// =====================================================

// Analyze transcript (Batch Mode)
app.post('/api/analyze-transcript', asyncHandler(async (req, res) => {
  const { transcript } = req.body;

  if (!transcript) {
    return res.status(400).json({ success: false, error: 'Transcript is required' });
  }

  console.log('Analyzing transcript (batch):', transcript.substring(0, 50) + '...');

  // 1. Split transcript into statements
  const lines = transcript.split('\n').filter(line => line.trim());
  const statements = [];

  lines.forEach(line => {
    const match = line.match(/^(Speaker [A-Z]):\s*(.+)$/);
    if (match) {
      statements.push({ speaker: match[1], text: match[2] });
    }
  });

  if (statements.length === 0) {
    return res.status(400).json({ success: false, error: 'No valid statements found in transcript' });
  }

  console.log(`Processing ${statements.length} statements...`);

  // 2. Process statements in parallel batches of 5
  const sessionId = `batch_${Date.now()}`;
  dbOps.createSession(sessionId);

  const allNodes = [];
  const BATCH_SIZE = 5;

  for (let i = 0; i < statements.length; i += BATCH_SIZE) {
    const batch = statements.slice(i, i + BATCH_SIZE);
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(statements.length / BATCH_SIZE)}...`);

    // Process batch in parallel
    const batchResults = await Promise.allSettled(
      batch.map(async (stmt) => {
        try {
          const nodes = await aiService.extractNodesIncremental(
            stmt.text,
            stmt.speaker,
            '', // Skip context for speed
            process.env.GROK_API_KEY
          );
          return nodes.map(n => ({
            ...n,
            id: `${sessionId}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          console.error(`Failed: ${stmt.text.substring(0, 30)}...`, error.message);
          return [];
        }
      })
    );

    // Collect successful results
    batchResults.forEach(result => {
      if (result.status === 'fulfilled') {
        result.value.forEach(node => {
          dbOps.saveNode(node, sessionId);
          allNodes.push(node);
        });
      }
    });
  }

  // 3. AI-powered relationship detection
  console.log('Analyzing relationships with AI...');
  const allLinks = [];

  // Get all claims and arguments
  const claims = allNodes.filter(n => n.type === 'claim');
  const argumentNodes = allNodes.filter(n => n.type === 'argument');
  const relationshipPairs = [];

  // A. Same-speaker: Connect arguments to claims from the same speaker
  // This captures "support" relationships within a speaker's statements
  claims.forEach(claim => {
    const sameSpkrArgs = argumentNodes.filter(arg => arg.speaker === claim.speaker);
    sameSpkrArgs.forEach(arg => {
      relationshipPairs.push([arg, claim]); // arg supports/attacks claim
    });
  });

  // B. Cross-speaker: Connect claims from different speakers
  // This captures "attacks" relationships between opposing speakers
  claims.forEach((claim1, i) => {
    claims.forEach((claim2, j) => {
      if (i < j && claim1.speaker !== claim2.speaker) {
        relationshipPairs.push([claim1, claim2]);
      }
    });
  });

  // Limit total pairs to avoid API overload (prioritize same-speaker first)
  const MAX_PAIRS = 20;
  const pairsToAnalyze = relationshipPairs.slice(0, MAX_PAIRS);

  console.log(`Analyzing ${pairsToAnalyze.length} potential relationships...`);

  // Process relationships in parallel batches
  const REL_BATCH_SIZE = 5;
  for (let i = 0; i < pairsToAnalyze.length; i += REL_BATCH_SIZE) {
    const batch = pairsToAnalyze.slice(i, i + REL_BATCH_SIZE);

    const relResults = await Promise.allSettled(
      batch.map(async ([nodeA, nodeB]) => {
        try {
          const rel = await aiService.analyzeRelationship(
            nodeA,
            nodeB,
            process.env.GROK_API_KEY
          );
          if (rel && rel.confidence > 0.5) {
            return {
              source: nodeA.id,
              target: nodeB.id,
              type: rel.type,
              confidence: rel.confidence,
              explanation: rel.explanation
            };
          }
          return null;
        } catch (error) {
          console.error('Relationship analysis failed:', error.message);
          return null;
        }
      })
    );

    relResults.forEach(result => {
      if (result.status === 'fulfilled' && result.value) {
        allLinks.push(result.value);
        dbOps.saveLink(result.value, sessionId);
      }
    });
  }

  console.log(`Analysis complete: ${allNodes.length} nodes, ${allLinks.length} links`);

  // 4. Return the full graph
  res.json({
    success: true,
    data: {
      nodes: allNodes,
      links: allLinks,
      method: 'grok-batch'
    }
  });
}));

// =====================================================
// SESSION MANAGEMENT
// =====================================================

// Get all active sessions
app.get('/api/sessions', asyncHandler(async (req, res) => {
  const sessions = dbOps.getAllSessions();
  res.json({
    success: true,
    sessions: sessions,
    count: sessions.length
  });
}));

// Create new session
app.post('/api/sessions', asyncHandler(async (req, res) => {
  const { sessionId } = req.body;
  const id = sessionId || `session_${Date.now()}`;
  const session = dbOps.createSession(id);

  res.json({
    success: true,
    session
  });
}));

// Clear session or all sessions
app.post('/api/clear-sessions', asyncHandler(async (req, res) => {
  const { sessionId } = req.body;

  if (sessionId) {
    dbOps.clearSession(sessionId);
    res.json({ success: true, message: `Session ${sessionId} cleared` });
  } else {
    dbOps.clearAll();
    res.json({ success: true, message: 'All sessions cleared' });
  }
}));

// Get current graph state for a session
app.get('/api/graph-state/:sessionId?', asyncHandler(async (req, res) => {
  const sessionId = req.params.sessionId || 'default';
  let session = dbOps.getSession(sessionId);

  if (!session) {
    // Auto-create if not exists (for ease of testing)
    session = dbOps.createSession(sessionId);
  }

  const nodes = dbOps.getNodes(sessionId);
  const links = dbOps.getLinks(sessionId);
  const chains = dbOps.getChains(sessionId);

  res.json({
    success: true,
    sessionId: session.id,
    nodes: nodes,
    links: links,
    evidenceChains: chains,
    speakers: session.speakers,
    nodeCount: nodes.length,
    linkCount: links.length,
    statementCount: session.statementCount,
    lastUpdate: session.lastUpdate
  });
}));

// =====================================================
// INCREMENTAL PROCESSING
// =====================================================

// Process single statement in real-time
app.post('/api/process-statement', asyncHandler(async (req, res) => {
  const { statement, speaker, sessionId, metadata } = req.body;

  if (!statement || !speaker) {
    return res.status(400).json({ success: false, error: 'statement and speaker are required' });
  }

  const sid = sessionId || 'default';
  let session = dbOps.getSession(sid);
  if (!session) session = dbOps.createSession(sid);

  dbOps.addSpeaker(sid, speaker);
  dbOps.updateSession(sid, session.statementCount + 1);

  console.log(`🎤 Processing statement [${sid}]: ${statement.substring(0, 60)}...`);

  // 1. Get existing context
  const existingNodes = dbOps.getNodes(sid);
  const existingClaims = existingNodes.filter(n => n.type === 'claim');

  // Get current context summary (running summary of the debate)
  const currentContext = session.contextSummary;
  const contextText = currentContext
    ? `Debate context: ${currentContext.summary}\nMain topics: ${currentContext.mainTopics?.join(', ')}`
    : '';

  // 2. Extract Nodes using AI Service with context
  let newNodes = [];
  try {
    newNodes = await aiService.extractNodesIncremental(
      statement,
      speaker,
      contextText,
      process.env.GROK_API_KEY
    );
  } catch (error) {
    console.error('AI Extraction Failed:', error.message);
    return res.status(503).json({
      success: false,
      error: 'AI Service Unavailable: ' + error.message
    });
  }

  // 3. Update context summary (async, don't wait for response)
  aiService.updateContextSummary(
    currentContext?.summary || '',
    statement,
    speaker,
    existingClaims,
    process.env.GROK_API_KEY
  ).then(newSummary => {
    if (newSummary) {
      dbOps.updateContextSummary(sid, newSummary);
      console.log(`📝 Updated context: ${newSummary.summary?.substring(0, 60)}...`);
    }
  }).catch(err => console.error('Context update failed:', err.message));

  // 4. Save New Nodes & assign IDs first
  const savedNodes = [];
  for (const node of newNodes) {
    const nodeWithId = {
      ...node,
      id: `${sid}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      metadata: metadata || {}
    };
    dbOps.saveNode(nodeWithId, sid);
    savedNodes.push(nodeWithId);
  }

  // 5. Find Relationships
  const newLinks = [];

  // A. Connect supports to claims FROM THE SAME STATEMENT
  const newClaims = savedNodes.filter(n => n.type === 'claim');
  const newArguments = savedNodes.filter(n => n.type === 'argument');

  for (const arg of newArguments) {
    for (const claim of newClaims) {
      try {
        const rel = await aiService.analyzeRelationship(arg, claim, process.env.GROK_API_KEY);
        if (rel) {
          const link = { source: arg.id, target: claim.id, ...rel };
          dbOps.saveLink(link, sid);
          newLinks.push(link);
        }
      } catch (error) {
        console.error('Same-statement relationship failed:', error.message);
      }
    }
  }

  // B. Connect new claims to PREVIOUS claims (cross-speaker - attack/respond)
  const recentClaims = existingClaims.slice(-5);
  for (const newClaim of newClaims) {
    for (const oldClaim of recentClaims) {
      if (oldClaim.speaker === newClaim.speaker) continue; // Skip same-speaker

      try {
        const rel = await aiService.analyzeRelationship(newClaim, oldClaim, process.env.GROK_API_KEY);
        if (rel) {
          const link = { source: newClaim.id, target: oldClaim.id, ...rel };
          dbOps.saveLink(link, sid);
          newLinks.push(link);
        }
      } catch (error) {
        console.error('Relationship analysis failed:', error.message);
      }
    }
  }

  // C. Connect new arguments to recent claims (any speaker)
  // This handles cases where the current statement is pure support without its own claim
  // Limited to last 3 claims for scaling
  if (newClaims.length === 0 && newArguments.length > 0) {
    const claimsToCheck = recentClaims.slice(-3);

    for (const arg of newArguments) {
      for (const claim of claimsToCheck) {
        try {
          const rel = await aiService.analyzeRelationship(arg, claim, process.env.GROK_API_KEY);
          if (rel) {
            const link = { source: arg.id, target: claim.id, ...rel };
            dbOps.saveLink(link, sid);
            newLinks.push(link);
          }
        } catch (error) {
          console.error('Cross-statement support failed:', error.message);
        }
      }
    }
  }

  res.json({
    success: true,
    sessionId: sid,
    newNodes: newNodes.length,
    newLinks: newLinks.length,
    contextSummary: currentContext?.summary || 'Initializing...',
    message: `Processed statement: ${newNodes.length} new nodes, ${newLinks.length} new links`
  });
}));

// =====================================================
// ERROR HANDLING
// =====================================================

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// =====================================================
// START SERVER
// =====================================================

app.listen(PORT, () => {
  console.log(`🚀 Argument Mapping API (Resilient) running on port ${PORT}`);

  if (!process.env.GROK_API_KEY) {
    console.warn('⚠️  WARNING: GROK_API_KEY is missing. AI features will fail.');
  }
});