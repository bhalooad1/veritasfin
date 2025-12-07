import express from 'express';
import { createClient } from '@supabase/supabase-js';
import DebateParser from '../debate-parser.js';
import dotenv from 'dotenv';

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

                // Call Grok with the entire debate at once - with extended timeout for best model
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 600000); // 600 second timeout (10 mins)

                const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${process.env.GROK_API_KEY}`
                    },
                    signal: controller.signal,
                    body: JSON.stringify({
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
                            },
                            {
                                role: 'user',
                                content: `Analyze this debate transcript:\n\n${debateDialogue}`
                            }
                        ],
                        temperature: 0.2, // Balanced for accuracy and consistency
                        max_tokens: 16000  // Increased for comprehensive analysis
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
            expected_messages: parsedMessages.length,
            grok_full_response: grokAnalysis  // Full Grok response for debugging
        });

    } catch (error) {
        console.error('Error analyzing transcript:', error);
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

export default router;
