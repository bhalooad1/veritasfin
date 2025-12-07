import express from 'express';
import { createClient } from '@supabase/supabase-js';
import DebateParser from '../debate-parser.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import twitterService from '../services/twitter.js';

// Load environment variables
dotenv.config();

const router = express.Router();

// Initialize Supabase with a function to ensure env vars are loaded
function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );
}

/**
 * Create a new debate analysis space
 */
router.post('/create-debate-space', async (req, res) => {
    try {
        const { title, description, participants } = req.body;
        const supabase = getSupabase();

        console.log('Creating debate space with:', { title, description, participants });

        // Prepare the space data matching the exact schema
        const spaceData = {
            title: title || 'Presidential Debate Analysis',
            space_url: null, // Not a Twitter space URL
            started_at: new Date().toISOString(),
            ended_at: new Date().toISOString(),
            total_messages: 0,
            overall_credibility_score: 100,
            metadata: JSON.stringify({
                description: description || 'Automated fact-checking of debate transcript',
                type: 'debate',
                participants: participants.map(p => p.name)
            })
        };

        console.log('Space data to insert:', spaceData);

        // Create a new space for the debate
        const { data: space, error: spaceError } = await supabase
            .from('spaces')
            .insert(spaceData)
            .select()
            .single();

        if (spaceError) {
            console.error('Error creating space:', spaceError);
            throw spaceError;
        }

        console.log('Space created successfully:', space);

        // Create or get speakers (speakers are global, not per-space)
        const speakers = {};
        for (const participant of participants) {
            const username = '@' + participant.name.replace(/\s+/g, '');

            // Try to get existing speaker first
            let { data: speaker, error: getError } = await supabase
                .from('speakers')
                .select()
                .eq('username', username)
                .single();

            // If speaker doesn't exist, create them
            if (!speaker) {
                const { data: newSpeaker, error: speakerError } = await supabase
                    .from('speakers')
                    .insert({
                        username: username,
                        display_name: participant.name
                    })
                    .select()
                    .single();

                if (speakerError) {
                    console.error('Error creating speaker:', speakerError);
                    // If error is due to duplicate, try to get again
                    if (speakerError.code === '23505') {
                        const { data: existingSpeaker } = await supabase
                            .from('speakers')
                            .select()
                            .eq('username', username)
                            .single();
                        speaker = existingSpeaker;
                    } else {
                        throw speakerError;
                    }
                } else {
                    speaker = newSpeaker;
                }
            }

            speakers[participant.name] = speaker.id;
        }

        res.json({
            success: true,
            space_id: space.id,
            speakers: speakers
        });

    } catch (error) {
        console.error('Error creating debate space:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Parse and analyze a debate transcript with Grok in one call
 */
router.post('/analyze-transcript', async (req, res) => {
    try {
        const { transcript, space_id, auto_fact_check = true } = req.body;
        const supabase = getSupabase();

        console.log('Analyzing transcript for space:', space_id);

        if (!transcript || !space_id) {
            return res.status(400).json({
                error: 'Missing required fields: transcript and space_id'
            });
        }

        // Parse the transcript to identify speakers
        const parser = new DebateParser();
        const parsedMessages = parser.parseTranscript(transcript);
        console.log(`Parsed ${parsedMessages.length} messages from transcript`);

        // Get all speakers and create a map
        const { data: speakers, error: speakersError } = await supabase
            .from('speakers')
            .select('*');

        if (speakersError) throw speakersError;

        // Create speaker map by display name
        const speakerMap = {};
        speakers.forEach(s => {
            speakerMap[s.display_name] = s.id;
        });

        // If auto_fact_check is enabled, send entire debate to Grok for analysis
        let grokAnalysis = null;
        if (auto_fact_check && parsedMessages.length > 0) {
            console.log('\n========== STARTING GROK ANALYSIS ==========');
            console.log(`Messages to analyze: ${parsedMessages.length}`);
            console.log(`Auto fact-check enabled: ${auto_fact_check}`);
            console.log('Preparing dialogue for Grok...');

            // Prepare the debate text for Grok - format as dialogue
            const debateDialogue = parsedMessages.map(msg =>
                `${msg.speaker}: ${msg.content}`
            ).join('\n\n');

            console.log(`Dialogue prepared: ${debateDialogue.length} characters`);

            console.log(`Total debate text length: ${debateDialogue.length} characters`);

            try {
                console.log('Calling Grok API...');
                const startTime = Date.now();

<<<<<<< HEAD
                // Call Grok with the entire debate at once - with 60 second timeout
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 300000); // 300 second timeout (5 mins)
=======
                // Call Grok with the entire debate at once - with extended timeout for best model
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 600000); // 600 second timeout (10 mins)
>>>>>>> origin/main

                const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
<<<<<<< HEAD
                        model: 'grok-4-1-fast-reasoning',
                        messages: [
                            {
                                role: 'system',
                                content: `You are analyzing a political debate. For each speaker's statement, extract factual claims and fact-check them.

INSTRUCTIONS:
1. Process each speaker's statement separately
2. Extract ALL verifiable factual claims
3. Assign a truth score (1-10) for each statement based on its claims
4. Provide a brief verdict and explanation
5. Include authoritative sources/URLs for fact-checking
6. Skip moderator questions/comments

IMPORTANT JSON FORMATTING RULES:
- Output STRICTLY VALID JSON.
- ESCAPE ALL DOUBLE QUOTES within strings (e.g., "He said \\"hello\\"").
- Do not use markdown formatting (no \`\`\`json blocks).
- Do not include any text outside the JSON object.

IMPORTANT - Use ONLY these verdict values:
- TRUE (score 8-10)
- MOSTLY TRUE (score 6-7)
- MIXED (score 4-5)
- MOSTLY FALSE (score 2-3)
- FALSE (score 1)
- UNVERIFIABLE (when claims cannot be verified)

Return a SINGLE JSON object containing a 'messages' array:
                            {
                              "messages": [
                                {
                                  "speaker": "Speaker Name",
                                  "content": "Their statement",
                                  "sequence_number": 1,
                                  "truth_score": 7,
                                  "verdict": "MOSTLY TRUE",
                                  "explanation": "Brief fact-check summary",
                                  "claims": [
                                    {
                                      "text": "Specific claim from the statement",
                                      "score": 8,
                                      "sources": [
                                        "https://www.cdc.gov/...",
                                        "https://www.factcheck.org/...",
                                        "https://grokipedia.com/..."
                                      ],
                                      "verdict": "TRUE/FALSE/MIXED/UNVERIFIABLE",
                                      "explanation": "Why this is true/false with specific data/facts"
                                    }
                                  ]
                                }
                              ],
                              "overall_credibility": {
                                "Kamala Harris": 75,
                                "Donald Trump": 65
                              }
                            }`
=======
                        model: 'grok-4-0709', // Best model for maximum accuracy
                        messages: [
                            {
                                role: 'system',
                                content: `You are a precise fact-checking AI analyzing a political debate. Your goal is to extract and verify ONLY factual claims, not opinions.

=== CORE PRINCIPLES ===
1. FACTUAL CLAIMS ONLY - Extract claims that can be objectively verified with evidence
   ✅ EXTRACT: "Unemployment is at 3.5%", "The bill passed in 2022", "China is our largest trading partner"
   ❌ SKIP: "This is the best policy", "He's a terrible leader", "I believe we should...", "This will destroy America"

2. IGNORE OPINIONS, PREDICTIONS, AND SUBJECTIVE STATEMENTS
   - Opinions: "She's radical", "He's out of it", "This is immoral"
   - Predictions: "This will end our country", "We will win"
   - Subjective value judgments: "Great", "Horrible", "Excellent"

3. EXTRACT HISTORICAL FACTS, STATISTICS, AND VERIFIABLE EVENTS
   - What someone said/did (if verifiable): "He tweeted 'Thank you President Xi'"
   - Statistical claims: "21 million people crossed the border"
   - Historical events: "He appointed three Supreme Court justices"
   - Policy descriptions: "The law provides life in prison"

=== SOURCE REQUIREMENTS ===
⚠️ CRITICAL: Provide credible sources. If you're not 100% certain a URL exists, describe the source instead.

**SOURCE FORMAT OPTIONS:**

**Option 1 - Descriptive Source (USE THIS when unsure of exact URL):**
Instead of guessing URLs, provide a description:
- "FactCheck.org analysis of [topic]"
- "PolitiFact fact-check on [claim]"
- "U.S. Census Bureau data on [statistic]"
- "Supreme Court opinion in [case name]"

**Option 2 - Known URL Patterns (ONLY use if you're certain):**
FACT-CHECKING:
- https://www.factcheck.org/ (only if you know the exact article path)
- https://www.politifact.com/ (only if you know the exact article path)

GOVERNMENT (use only for specific data):
- https://www.census.gov/
- https://www.bls.gov/
- https://www.cdc.gov/

**GROKIPEDIA (REQUIRED - always include as last source):**
Format: https://grokipedia.com/page/[Wikipedia_Article_Title]

Common Wikipedia articles (use exact names):
- Abortion: Abortion_in_the_United_States, Dobbs_v._Jackson_Women%27s_Health_Organization, Roe_v._Wade
- Immigration: Illegal_immigration_to_the_United_States, Immigration_to_the_United_States
- Trade: China%E2%80%93United_States_trade_war, International_trade
- COVID: COVID-19_pandemic, COVID-19_pandemic_in_the_United_States
- Economy: Economy_of_the_United_States, United_States_federal_budget
- Supreme Court: Supreme_Court_of_the_United_States, List_of_justices_of_the_Supreme_Court_of_the_United_States

**EXAMPLES:**

Good sources ✅:
  "FactCheck.org analysis of Trump's Supreme Court appointments"
  "U.S. Census Bureau trade deficit statistics"
  "https://grokipedia.com/page/Supreme_Court_of_the_United_States"

Bad sources ❌:
  "https://www.factcheck.org/2024/trump-abortion-claims/" (Don't guess article paths)
  "https://www.state.gov/covid-origins/" (Don't make up URLs)

**RULES:**
1. When uncertain about specific URL, use descriptive source instead
2. ALWAYS include 1 Grokipedia link (last source)
3. Provide 2-3 sources per claim
4. Descriptive sources are better than fake URLs

=== VERDICT SCALE ===
Use ONLY these values:
- TRUE (score 8-10): Fully accurate, well-documented
- MOSTLY TRUE (score 6-7): Largely accurate with minor issues
- MIXED (score 4-5): Partially true and partially false
- MOSTLY FALSE (score 2-3): Largely inaccurate
- FALSE (score 1): Completely false, no factual basis
- UNVERIFIABLE: Cannot be confirmed with available sources

=== JSON FORMAT ===
Output STRICTLY VALID JSON:
- ESCAPE double quotes: "He said \\"hello\\""
- NO markdown code blocks
- NO text outside JSON
- Process ALL speaker statements

{
  "messages": [
    {
      "speaker": "Speaker Name",
      "content": "Their full statement",
      "sequence_number": 1,
      "truth_score": 7,
      "verdict": "MOSTLY TRUE",
      "explanation": "Brief overall assessment",
      "claims": [
        {
          "text": "Exact factual claim extracted",
          "score": 8,
          "verdict": "TRUE",
          "explanation": "Why this is true/false with specific evidence",
          "sources": [
            "https://real-government-source.gov/data",
            "https://www.factcheck.org/2024/article",
            "https://grokipedia.com/page/Relevant_Topic"
          ]
        }
      ]
    }
  ],
  "overall_credibility": {
    "Speaker 1": 75,
    "Speaker 2": 45
  }
}`
>>>>>>> origin/main
                            },
                            {
                                role: 'user',
                                content: `Analyze this debate transcript:\n\n${debateDialogue}`
                            }
                        ],
<<<<<<< HEAD
                        temperature: 0.1, // Lower temperature for more consistent formatting
                        max_tokens: 8000  // Increased for longer debates
=======
                        temperature: 0.2, // Balanced for accuracy and consistency
                        max_tokens: 16000  // Increased for comprehensive analysis
>>>>>>> origin/main
                    })
                });

                clearTimeout(timeout);
                const responseTime = Date.now() - startTime;
                console.log(`Grok API responded in ${responseTime}ms`);

                if (!grokResponse.ok) {
                    const errorBody = await grokResponse.text();
                    console.error(`Grok API error ${grokResponse.status}:`, errorBody);
                    throw new Error(`Grok API error: ${grokResponse.status} - ${errorBody}`);
                }

                const grokData = await grokResponse.json();
                const analysisText = grokData.choices[0]?.message?.content;

                if (!analysisText) {
                    console.error('Grok returned empty response');
                    throw new Error('Grok returned empty response');
                }

                // Parse Grok's response
                console.log('Grok response length:', analysisText.length, 'characters');
                console.log('\n========== RAW GROK RESPONSE (first 500 chars) ==========');
                console.log(analysisText.substring(0, 500));
                console.log('========== END PREVIEW ==========\n');

                // Robust JSON extraction
                let jsonString = analysisText;

                // 1. Remove any markdown code blocks (```json ... ``` or ``` ... ```)
                const hadMarkdown = jsonString.includes('```');
                if (hadMarkdown) {
                    console.log('⚠️ Detected markdown code blocks in response, removing...');
                }
                jsonString = jsonString.replace(/```json\s*/g, '').replace(/```\s*/g, '');

                // 2. Find first '{' or '['
                const firstBrace = jsonString.indexOf('{');
                const firstBracket = jsonString.indexOf('[');

                console.log(`JSON boundaries: first '{' at ${firstBrace}, first '[' at ${firstBracket}`);

                if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
                    // It's an object
                    const lastBrace = jsonString.lastIndexOf('}');
                    console.log(`Extracting JSON object from position ${firstBrace} to ${lastBrace}`);
                    if (lastBrace !== -1) {
                        jsonString = jsonString.substring(firstBrace, lastBrace + 1);
                    }
                } else if (firstBracket !== -1) {
                    // It's an array
                    const lastBracket = jsonString.lastIndexOf(']');
                    console.log(`Extracting JSON array from position ${firstBracket} to ${lastBracket}`);
                    if (lastBracket !== -1) {
                        jsonString = jsonString.substring(firstBracket, lastBracket + 1);
                    }
                }

                // 3. Trim whitespace
                jsonString = jsonString.trim();

                console.log('\n========== EXTRACTED JSON (first 300 chars) ==========');
                console.log(jsonString.substring(0, 300));
                console.log('========== END PREVIEW ==========\n');

                try {
                    console.log('Attempting to parse JSON...');
                    grokAnalysis = JSON.parse(jsonString);
                    console.log('✅ JSON parsed successfully!');

                    // Handle array response if Grok ignored instructions and returned array
                    if (Array.isArray(grokAnalysis)) {
                        grokAnalysis = { messages: grokAnalysis };
                    }
                } catch (e) {
                    console.error('❌ JSON Parse Error:', e.message);
                    console.error('First 200 chars of problematic JSON:', jsonString.substring(0, 200));
                    console.error('Last 200 chars of problematic JSON:', jsonString.substring(jsonString.length - 200));

                    // Multiple repair strategies
                    try {
                        console.log('Attempting JSON repair strategies...');

                        // Strategy 1: Try to find the last complete message object
                        const lastCompleteMessage = jsonString.lastIndexOf('},');
                        if (lastCompleteMessage > 0) {
                            // Close the array and object properly
                            let repairedJson = jsonString.substring(0, lastCompleteMessage + 1) + ']}';

                            // Check if we need to add overall_credibility
                            if (!repairedJson.includes('overall_credibility')) {
                                repairedJson = repairedJson.substring(0, repairedJson.length - 1) +
                                    ', "overall_credibility": {"Kamala Harris": 70, "Donald Trump": 60}}';
                            }

                            console.log('Trying repair strategy: truncate at last complete message');
                            grokAnalysis = JSON.parse(repairedJson);
                            console.log('✅ JSON repaired by truncating at last complete message!');
                        }
                    } catch (repairError) {
                        console.error('❌ Repair strategy failed:', repairError.message);

                        // Strategy 2: Extract just the messages array
                        try {
                            console.log('Trying fallback: extract messages array only');
                            const messagesStart = jsonString.indexOf('"messages": [') + 12;
                            const messagesEnd = jsonString.lastIndexOf(']');

                            if (messagesStart > 12 && messagesEnd > messagesStart) {
                                const messagesArray = jsonString.substring(messagesStart, messagesEnd + 1);
                                // Try to parse just the messages
                                const messages = JSON.parse(messagesArray);
                                grokAnalysis = { messages: messages };
                                console.log('✅ Extracted messages array successfully!');
                            }
                        } catch (e3) {
                            console.error('❌ All repair strategies failed:', e3.message);
                            throw new Error(`Failed to parse Grok JSON: ${e.message}`);
                        }
                    }
                }
                console.log('Grok analysis completed:', grokAnalysis.messages?.length || 0, 'messages analyzed');
                console.log('Expected:', parsedMessages.length, 'messages');
                console.log('Sample Grok verdict:', grokAnalysis.messages?.[0]?.verdict);

                // Warn if not all messages were analyzed
                if (grokAnalysis.messages && grokAnalysis.messages.length < parsedMessages.length) {
                    console.warn(`⚠️ WARNING: Grok only analyzed ${grokAnalysis.messages.length}/${parsedMessages.length} messages`);
                    console.warn('This may be due to context length limits or model constraints');
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    console.error('Grok API call timed out after 60 seconds');
                } else {
                    console.error('Error calling Grok:', error.message);
                }
                console.log('Proceeding without Grok analysis - messages will be inserted without truth scores');
                grokAnalysis = null;
            }
        }

        // Insert messages into database with Grok analysis if available
        const insertedMessages = [];
        for (let i = 0; i < parsedMessages.length; i++) {
            const msg = parsedMessages[i];
            const speaker_id = speakerMap[msg.speaker];

            if (!speaker_id) {
                console.log(`Speaker not found: ${msg.speaker}, skipping...`);
                continue;
            }

            // Find matching Grok analysis for this message
            const grokMsg = grokAnalysis?.messages?.find(
                gm => gm.sequence_number === msg.sequence_number ||
                    gm.speaker === msg.speaker && gm.content.includes(msg.content.substring(0, 50))
            );

            const messageData = {
                space_id: space_id,
                speaker_id: speaker_id,
                content: msg.content,
                sequence_number: msg.sequence_number,
                fact_check_status: grokMsg ? 'completed' : 'pending',
                created_at: new Date().toISOString()
            };

            // Add Grok analysis if available
            if (grokMsg) {
                // Map Grok verdicts to database enum values (must be Title Case)
                // Valid enum values are: True, False, Misleading, Unverified
                const verdictMap = {
                    'TRUE': 'True',
                    'MOSTLY TRUE': 'True',
                    'FALSE': 'False',
                    'MOSTLY FALSE': 'False',
                    'MISLEADING': 'Misleading',
                    'MIXED': 'Misleading',  // Map MIXED to Misleading since Mixed isn't in the enum
                    'UNVERIFIABLE': 'Unverified',
                    'UNVERIFIED': 'Unverified'
                };

                messageData.truth_score = grokMsg.truth_score;
                messageData.grok_verdict = verdictMap[grokMsg.verdict] || 'Unverified';
                messageData.grok_explanation = grokMsg.explanation;
                // Store claims array directly (don't double-encode)
                messageData.grok_response_raw = grokMsg.claims || [];
                messageData.processed_at = new Date().toISOString();
            }

            const { data: insertedMsg, error: msgError } = await supabase
                .from('messages')
                .insert(messageData)
                .select()
                .single();

            if (msgError) {
                console.error('Error inserting message:', msgError);
                continue;
            }

            insertedMessages.push(insertedMsg);
        }

        // Get statistics
        const stats = parser.getStatistics();

        // Count how many messages were processed with Grok
        const processedCount = insertedMessages.filter(m => m.fact_check_status === 'completed').length;

        // Calculate average truth score
        const messagesWithScores = insertedMessages.filter(m => m.truth_score !== null && m.truth_score !== undefined);
        let averageScore = 0;
        if (messagesWithScores.length > 0) {
            const totalScore = messagesWithScores.reduce((sum, m) => sum + m.truth_score, 0);
            averageScore = Math.round(totalScore / messagesWithScores.length);

            // Update space with new score
            await supabase
                .from('spaces')
                .update({ overall_credibility_score: averageScore })
                .eq('id', space_id);

            console.log(`Updated space ${space_id} with overall score: ${averageScore}`);
        }

        // Prepare detailed debug information
        const debugInfo = {
            parsed_messages_count: parsedMessages.length,
            unique_speakers: [...new Set(parsedMessages.map(m => m.speaker))],
            speakers_in_db: speakers.map(s => s.display_name),
            grok_was_called: auto_fact_check && parsedMessages.length > 0,
            grok_response_received: !!grokAnalysis,
            grok_messages_analyzed: grokAnalysis?.messages?.length || 0,
            first_parsed_message: parsedMessages[0],
            last_parsed_message: parsedMessages[parsedMessages.length - 1],
            messages_with_truth_scores: insertedMessages.filter(m => m.truth_score !== null).length,
            messages_without_truth_scores: insertedMessages.filter(m => m.truth_score === null).length
        };

        console.log('📊 FINAL DEBUG SUMMARY:');
        console.log('Parsed messages:', parsedMessages.length);
        console.log('Inserted messages:', insertedMessages.length);
        console.log('Messages with truth scores:', debugInfo.messages_with_truth_scores);
        console.log('Messages without truth scores:', debugInfo.messages_without_truth_scores);
        console.log('Unique speakers found:', debugInfo.unique_speakers);

        res.json({
            success: true,
            space_id: space_id,
            statistics: stats,
            messages_inserted: insertedMessages.length,
            messages_processed: processedCount,
            auto_fact_check: auto_fact_check,
            grok_analysis_completed: grokAnalysis !== null,
            overall_score: averageScore,
            debug_info: debugInfo,
<<<<<<< HEAD
            expected_messages: parsedMessages.length
=======
            expected_messages: parsedMessages.length,
            grok_full_response: grokAnalysis  // Full Grok response for debugging
>>>>>>> origin/main
        });

    } catch (error) {
        console.error('Error analyzing transcript:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Process all messages in a debate through Grok for fact-checking
 */
router.post('/process-debate-with-grok/:space_id', async (req, res) => {
    try {
        const { space_id } = req.params;
        const supabase = getSupabase();

        console.log('Processing debate messages for space:', space_id);

        // Get all messages that need processing
        const { data: messages, error: fetchError } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .eq('fact_check_status', 'pending')
            .order('sequence_number');

        if (fetchError) throw fetchError;

        console.log(`Found ${messages.length} messages to process`);

        if (messages.length === 0) {
            return res.json({
                success: true,
                message: 'No messages to process',
                processed: 0
            });
        }

        // Process messages through Grok (similar to the existing fact-check endpoint)
        let processedCount = 0;
        let errorCount = 0;
        const results = [];

        // Process in smaller batches to avoid overwhelming the API
        const batchSize = 3;
        for (let i = 0; i < messages.length; i += batchSize) {
            const batch = messages.slice(i, i + batchSize);

            // Process batch in parallel
            const batchPromises = batch.map(async (message) => {
                try {
                    // Call the fact-check endpoint
                    const response = await fetch('http://localhost:3000/api/spaces/fact-check', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            messageId: message.id,
                            spaceId: space_id
                        })
                    });

                    if (response.ok) {
                        const data = await response.json();
                        processedCount++;
                        results.push({
                            messageId: message.id,
                            speaker: message.speaker_display_name,
                            status: 'processed',
                            data: data
                        });
                        console.log(`✓ Processed message ${message.id} from ${message.speaker_display_name}`);
                    } else {
                        throw new Error(`Failed to process message ${message.id}`);
                    }
                } catch (error) {
                    console.error(`Error processing message ${message.id}:`, error);
                    errorCount++;
                    results.push({
                        messageId: message.id,
                        speaker: message.speaker_display_name,
                        status: 'error',
                        error: error.message
                    });
                }
            });

            // Wait for batch to complete
            await Promise.all(batchPromises);

            // Add delay between batches to respect rate limits
            if (i + batchSize < messages.length) {
                console.log(`Batch complete. Waiting 2 seconds before next batch...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        // Get updated statistics
        const { data: updatedMessages } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .order('sequence_number');

        // Calculate statistics
        const stats = {
            total: updatedMessages.length,
            processed: updatedMessages.filter(m => m.fact_check_status === 'completed').length,
            pending: updatedMessages.filter(m => m.fact_check_status === 'pending').length,
            errors: errorCount,
            averageTruthScore: 0
        };

        // Calculate average truth score
        const messagesWithScores = updatedMessages.filter(m => m.truth_score !== null);
        if (messagesWithScores.length > 0) {
            const totalScore = messagesWithScores.reduce((sum, m) => sum + m.truth_score, 0);
            stats.averageTruthScore = Math.round(totalScore / messagesWithScores.length);
        }

        res.json({
            success: true,
            space_id: space_id,
            processed: processedCount,
            errors: errorCount,
            statistics: stats,
            results: results
        });

    } catch (error) {
        console.error('Error processing debate with Grok:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get analysis results for a debate
 */
router.get('/debate-results/:space_id', async (req, res) => {
    try {
        const { space_id } = req.params;
        const supabase = getSupabase();

        // Get all messages with fact-check results
        const { data: messages, error } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .order('sequence_number');

        if (error) throw error;

        // Calculate statistics
        const stats = {
            total_messages: messages.length,
            fact_checked: messages.filter(m => m.fact_check_status === 'completed').length,
            pending: messages.filter(m => m.fact_check_status === 'pending').length,
            by_speaker: {},
            by_verdict: {
                true: 0,
                false: 0,
                misleading: 0,
                mixed: 0,
                unverified: 0
            }
        };

        // Analyze by speaker
        messages.forEach(msg => {
            const speaker = msg.speaker_display_name;
            if (!stats.by_speaker[speaker]) {
                stats.by_speaker[speaker] = {
                    total: 0,
                    fact_checked: 0,
                    verdicts: { true: 0, false: 0, misleading: 0, mixed: 0, unverified: 0 },
                    avg_truth_score: 0,
                    truth_scores: []
                };
            }

            stats.by_speaker[speaker].total++;

            if (msg.fact_check_status === 'completed') {
                stats.by_speaker[speaker].fact_checked++;
                const verdict = msg.grok_verdict || 'unverified';
                stats.by_speaker[speaker].verdicts[verdict]++;
                stats.by_verdict[verdict]++;

                if (msg.truth_score) {
                    stats.by_speaker[speaker].truth_scores.push(msg.truth_score);
                }
            }
        });

        // Calculate average truth scores
        Object.keys(stats.by_speaker).forEach(speaker => {
            const scores = stats.by_speaker[speaker].truth_scores;
            if (scores.length > 0) {
                stats.by_speaker[speaker].avg_truth_score =
                    scores.reduce((a, b) => a + b, 0) / scores.length;
            }
            delete stats.by_speaker[speaker].truth_scores; // Remove raw array
        });

        res.json({
            success: true,
            space_id: space_id,
            statistics: stats,
            messages: messages
        });

    } catch (error) {
        console.error('Error getting debate results:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Analyze consistency with past statements
<<<<<<< HEAD
 * Aggregates data from X timeline + web search before Grok analysis
 */
router.post('/consistency', async (req, res) => {
    try {
        const { speaker, claim, topic: providedTopic, handle } = req.body;

        // First, extract the actual topic from the claim using Grok
        let topic = providedTopic;
        let claimKeywords = [];

        try {
            const topicResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
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
                            content: `Extract the main topic and key terms from a claim or statement. This can be about any subject (politics, technology, sports, science, business, etc.).

Return JSON:
{
    "topic": "specific topic",
    "keywords": ["keyword1", "keyword2", "keyword3"]
}

Example input: "Tesla's autopilot is safer than human drivers"
Example output:
{
    "topic": "Tesla Autopilot Safety",
    "keywords": ["Tesla", "autopilot", "safety", "self-driving"]
}

Return ONLY JSON.`
                        },
                        {
                            role: 'user',
                            content: claim.substring(0, 500)
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 150
                })
            });
            const topicData = await topicResponse.json();
            const topicContent = topicData.choices[0]?.message?.content;
            const jsonMatch = topicContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                topic = parsed.topic || topic;
                claimKeywords = parsed.keywords || [];
            }
        } catch (e) {
            console.warn('Could not extract topic from claim:', e.message);
        }

        console.log(`Analyzing consistency for ${speaker} on topic: ${topic}`);
        console.log(`Claim keywords: ${claimKeywords.join(', ')}`);

        // Collect real data from multiple sources
        let xPosts = [];
        let webResults = [];
        let webSearchContext = '';
        let dataSource = 'grok_only';

        // Try to get X timeline posts if handle is provided or we can find one
        if (twitterService.isXApiAvailable()) {
            try {
                // Map of known political figures to their X handles
                const knownHandles = {
                    'donald trump': 'realDonaldTrump',
                    'donald j. trump': 'realDonaldTrump',
                    'trump': 'realDonaldTrump',
                    'kamala harris': 'KamalaHarris',
                    'joe biden': 'JoeBiden',
                    'biden': 'JoeBiden',
                    'elon musk': 'elonmusk',
                    'barack obama': 'BarackObama',
                    'hillary clinton': 'HillaryClinton',
                    'bernie sanders': 'BernieSanders',
                    'aoc': 'AOC',
                    'alexandria ocasio-cortez': 'AOC',
                    'ted cruz': 'tedcruz',
                    'marco rubio': 'marcorubio',
                    'ron desantis': 'GovRonDeSantis'
                };

                // Use provided handle, known mapping, or sanitized speaker name
                const speakerLower = speaker.toLowerCase().trim();
                const xHandle = handle || knownHandles[speakerLower] || speaker.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 15);

                console.log(`Attempting to fetch X posts for @${xHandle}...`);
                const tweetData = await twitterService.getTweetsByUsername(xHandle, 100);

                if (tweetData && tweetData.tweets && tweetData.tweets.length > 0) {
                    // MORE LENIENT search - use partial matching and lower thresholds
                    const searchTerms = [topic.toLowerCase(), ...claimKeywords.map(k => k.toLowerCase())];
                    
                    // Also extract individual words from topic for partial matching
                    const topicWords = topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
                    const allSearchTerms = [...new Set([...searchTerms, ...topicWords])];

                    const scoredTweets = tweetData.tweets.map(tweet => {
                        const text = tweet.text.toLowerCase();
                        let score = 0;
                        let matchedTerms = [];

                        allSearchTerms.forEach(term => {
                            // Partial matching - check if term appears anywhere
                            if (term.length > 2 && text.includes(term)) {
                                score += term.length > 6 ? 4 : term.length > 4 ? 3 : 2;
                                matchedTerms.push(term);
                            }
                            // Also check for word stems (e.g., "immigr" matches "immigration", "immigrant")
                            const stem = term.substring(0, Math.max(4, term.length - 3));
                            if (stem.length > 3 && text.includes(stem) && !matchedTerms.includes(term)) {
                                score += 1;
                                matchedTerms.push(stem + '*');
                            }
                        });

                        // Bonus for high engagement tweets (more likely to be important)
                        const engagement = (tweet.public_metrics?.like_count || 0) + (tweet.public_metrics?.retweet_count || 0);
                        if (engagement > 1000) score += 2;
                        if (engagement > 10000) score += 3;

                        return { tweet, score, matchedTerms, engagement };
                    }).filter(t => t.score >= 2); // LOWER threshold from 4 to 2

                    // Sort by score, then engagement
                    scoredTweets.sort((a, b) => b.score - a.score || b.engagement - a.engagement);

                    if (scoredTweets.length > 0) {
                        const topTweets = scoredTweets.slice(0, 15); // Get more tweets

                        xPosts = topTweets.map(({ tweet, matchedTerms }) => ({
                            date: new Date(tweet.created_at).toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: 'numeric'
                            }),
                            text: tweet.text,
                            url: `https://x.com/${xHandle}/status/${tweet.id}`,
                            source: 'X',
                            matched_keywords: matchedTerms,
                            engagement: (tweet.public_metrics?.like_count || 0) + (tweet.public_metrics?.retweet_count || 0),
                            stance: null // Will be determined by Grok
                        }));

                        dataSource = 'x_api';
                        console.log(`✓ Found ${xPosts.length} relevant X posts for @${xHandle}`);
                    } else {
                        // FALLBACK: If no keyword matches, take the most recent/engaged tweets anyway
                        console.log(`No keyword matches, taking top engaged tweets for context`);
                        const topEngaged = tweetData.tweets
                            .map(tweet => ({
                                tweet,
                                engagement: (tweet.public_metrics?.like_count || 0) + (tweet.public_metrics?.retweet_count || 0)
                            }))
                            .sort((a, b) => b.engagement - a.engagement)
                            .slice(0, 10);
                        
                        if (topEngaged.length > 0) {
                            xPosts = topEngaged.map(({ tweet }) => ({
                                date: new Date(tweet.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
                                text: tweet.text,
                                url: `https://x.com/${xHandle}/status/${tweet.id}`,
                                source: 'X',
                                matched_keywords: [],
                                stance: null
                            }));
                            dataSource = 'x_api_general';
                            console.log(`✓ Using ${xPosts.length} top engaged tweets as fallback`);
                        }
                    }
                }
            } catch (xError) {
                console.warn('Could not fetch X posts:', xError.message);
            }
        }

        // Use Grok with web search grounding for additional context
        // This searches the web for past statements by this speaker
        try {
            console.log('Fetching web search context via Grok...');
            const webSearchResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
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
                            content: `You are a research assistant. Search for REAL, VERIFIABLE past statements by ${speaker} about ${topic}.
                            
IMPORTANT: Only include statements you can verify with real sources. Include URLs when available.

Return a JSON array of 3-5 real past statements:
[
    {"date": "actual date or approximate period", "text": "exact or close paraphrase of their statement", "source": "source name like 'Interview with CNN' or 'X post'", "url": "https://... full URL if available, or null if not"}
]

Example output:
[
    {"date": "March 2023", "text": "AI will transform every industry", "source": "TechCrunch interview", "url": "https://techcrunch.com/2023/03/interview"}
]

If you cannot find verifiable statements on this topic, return an empty array: []`
                        },
                        {
                            role: 'user',
                            content: `Find ${speaker}'s past public statements about ${topic}`
                        }
                    ],
                    temperature: 0.1,
                    max_tokens: 1000
                })
            });

            const webData = await webSearchResponse.json();
            const webContent = webData.choices[0]?.message?.content;

            if (webContent) {
                const jsonMatch = webContent.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const webStatements = JSON.parse(jsonMatch[0]);
                    if (webStatements.length > 0) {
                        webSearchContext = webStatements.map(s =>
                            `[${s.date}] "${s.text}" (${s.source || 'public record'})`
                        ).join('\n');

                        if (dataSource !== 'x_api') {
                            dataSource = 'web_search';
                        } else {
                            dataSource = 'x_api_and_web';
                        }
                        console.log(`✓ Found ${webStatements.length} web-sourced statements`);
                    }
                }
            }
        } catch (webError) {
            console.warn('Web search grounding failed:', webError.message);
        }

        // Now analyze consistency with aggregated data
        const aggregatedContext = [];

        if (xPosts.length > 0) {
            aggregatedContext.push('=== FROM X TIMELINE ===');
            xPosts.forEach(p => {
                aggregatedContext.push(`[${p.date}] "${p.text}"`);
            });
        }

        if (webSearchContext) {
            aggregatedContext.push('\n=== FROM WEB SEARCH ===');
            aggregatedContext.push(webSearchContext);
        }

        const hasRealData = aggregatedContext.length > 0;

        const analysisPrompt = hasRealData
            ? `Analyze whether ${speaker}'s CURRENT CLAIM is consistent with THEIR OWN past statements below.

=== ${speaker.toUpperCase()}'S PAST STATEMENTS ===
${aggregatedContext.join('\n')}

=== CURRENT CLAIM BY ${speaker.toUpperCase()} ===
"${claim}"

TOPIC: ${topic}

Question: Has ${speaker} been consistent with their own past positions on this topic?
Return JSON with score, x_score, web_score, verdict, analysis (100-150 words referencing specific past statements), topic_match, and confidence.`
            : `Analyze ${speaker}'s consistency on "${topic}" based on your knowledge of their public statements.
Current claim by ${speaker}: "${claim}"
Note: No X timeline data available. Use your knowledge of ${speaker}'s public record but indicate lower confidence.
If you don't have knowledge of ${speaker}'s past statements on this topic, return "Insufficient Data".`;
=======
 */
router.post('/consistency', async (req, res) => {
    try {
        const { speaker, claim, topic } = req.body;

        // In a real app, we would search a vector DB of past tweets.
        // Here, we'll use Grok to simulate the analysis based on its knowledge base.
>>>>>>> origin/main

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
<<<<<<< HEAD
                        content: `You analyze whether a SPEAKER's current claim is consistent with THEIR OWN past statements.

IMPORTANT: You are checking if THIS PERSON (the speaker) has been consistent with their OWN past positions, NOT whether the claim is true or supported by others.

SCORING RULES:
- Score 8-10: Speaker's past statements DIRECTLY support/match their current claim
- Score 5-7: Past statements are somewhat consistent but not directly on this topic  
- Score 3-4: Some contradictions or significant evolution in the speaker's position
- Score 1-2: Speaker directly contradicted themselves
- null: No relevant past statements from THIS SPEAKER on this topic

CRITICAL: Only consider statements MADE BY THE SPEAKER, not general sources about the topic.

Return JSON:
{
    "score": 5,
    "x_score": 6,
    "web_score": 4,
    "verdict": "Consistent|Evolving|Contradictory|Insufficient Data",
    "analysis": "Explain how the SPEAKER's past statements relate to their current claim. Reference specific past quotes if available. (100-150 words)",
    "topic_match": true,
    "confidence": "high|medium|low"
}

If you cannot find relevant past statements BY THIS SPEAKER, return verdict "Insufficient Data" with score null.`
                    },
                    {
                        role: 'user',
                        content: analysisPrompt
=======
                        content: `You are a political analyst checking for consistency.
                        
                        Analyze the consistency of the speaker's current claim with their known past positions/tweets.
                        
                        Return JSON:
                        {
                            "score": 1-10 (10 = perfectly consistent),
                            "verdict": "Consistent" | "Evolving" | "Contradictory",
                            "analysis": "Brief explanation...",
                            "past_tweets": [
                                { "date": "Approx Date", "text": "A representative past statement..." },
                                { "date": "Approx Date", "text": "Another past statement..." }
                            ]
                        }`
                    },
                    {
                        role: 'user',
                        content: `Speaker: ${speaker}\nTopic: ${topic}\nCurrent Claim: "${claim}"`
>>>>>>> origin/main
                    }
                ],
                temperature: 0.1
            })
        });

        const data = await grokResponse.json();
        const content = data.choices[0]?.message?.content;

<<<<<<< HEAD
        // Robust JSON extraction with error handling
        let result;
        try {
            // Try to extract JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                // Clean up common JSON issues
                let jsonStr = jsonMatch[0]
                    .replace(/[\x00-\x1F\x7F]/g, ' ') // Remove control characters
                    .replace(/,\s*}/g, '}')           // Remove trailing commas
                    .replace(/,\s*]/g, ']');          // Remove trailing commas in arrays
                
                result = JSON.parse(jsonStr);
            } else {
                throw new Error('No JSON found in response');
            }
        } catch (parseError) {
            console.warn('JSON parse failed, using fallback:', parseError.message);
            // Fallback with defaults
            result = {
                score: 5,
                verdict: "Insufficient Data",
                analysis: "Could not fully analyze consistency. Limited data available.",
                past_tweets: [],
                confidence: "low"
            };
        }
        
        // Handle null scores for insufficient data
        if (result.topic_match === false || result.verdict === 'Insufficient Data') {
            result.score = null;
            result.verdict = "Insufficient Data";
        }
        
        // Ensure required fields exist with defaults
        result.score = result.score ?? null;
        result.x_score = result.x_score ?? null;
        result.web_score = result.web_score ?? null;
        result.verdict = result.verdict || "Insufficient Data";
        result.analysis = result.analysis || "Not enough relevant data to analyze consistency.";
        result.past_tweets = result.past_tweets || [];
        result.confidence = result.confidence || "low";

        // Count posts from each source
        result.x_posts_found = xPosts.length;
        result.web_sources_found = webResults.length;

        // ALWAYS use real X posts when we have them - they have real URLs
        if (xPosts.length > 0) {
            console.log(`Including ${xPosts.length} real X posts in response`);
            
            // Use real posts directly with proper formatting
            const xPostsFormatted = xPosts.map(p => ({
                date: p.date || 'Recent',
                text: (p.text || '').substring(0, 200),
                url: p.url,
                source: 'X',
                stance: 'neutral'
            })).filter(p => p.url && p.url.startsWith('https://'));
            
            // Combine with any web results
            const webPostsFormatted = webResults.slice(0, 5).map(w => ({
                date: w.date || 'Past',
                text: (w.snippet || w.text || '').substring(0, 200),
                url: w.url || null,
                source: 'Web',
                stance: 'neutral'
            }));
            
            result.past_tweets = [...xPostsFormatted, ...webPostsFormatted].slice(0, 15);
            console.log(`Returning ${result.past_tweets.length} total sources`);
        } else if (webResults.length > 0) {
            // Only web results
            result.past_tweets = webResults.slice(0, 10).map(w => ({
                date: w.date || 'Past',
                text: (w.snippet || w.text || '').substring(0, 200),
                url: w.url || null,
                source: 'Web',
                stance: 'neutral'
            }));
        }

        result.data_source = dataSource;

        console.log(`Consistency analysis complete: ${result.verdict} (${result.score}/10) from ${dataSource}`);
=======
        // Extract JSON
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { score: 5, verdict: "Unknown", analysis: "Could not parse analysis", past_tweets: [] };
>>>>>>> origin/main

        res.json({ success: true, ...result });

    } catch (error) {
        console.error('Consistency analysis error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

export default router;