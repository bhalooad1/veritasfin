import express from 'express';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();

function getSupabase() {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_KEY
    );
}

/**
 * Mark space as ended and trigger summary generation
 * POST /api/spaces/end
 */
router.post('/end', async (req, res) => {
    try {
        const { space_id } = req.body;
        const supabase = getSupabase();

        if (!space_id) {
            return res.status(400).json({
                success: false,
                error: 'space_id is required'
            });
        }

        console.log(`\n🏁 Ending space: ${space_id}`);

        // Check if space exists
        const { data: space, error: fetchError } = await supabase
            .from('spaces')
            .select('*')
            .eq('id', space_id)
            .single();

        if (fetchError || !space) {
            return res.status(404).json({
                success: false,
                error: 'Space not found'
            });
        }

        // Check if already ended
        if (space.is_live === false) {
            console.log('⚠️  Space already marked as ended');
            return res.json({
                success: true,
                message: 'Space already ended',
                space_id: space_id
            });
        }

        // Mark space as ended
        const { error: updateError } = await supabase
            .from('spaces')
            .update({
                is_live: false,
                ended_at: new Date().toISOString()
            })
            .eq('id', space_id);

        if (updateError) {
            throw updateError;
        }

        console.log('✅ Space marked as ended');

        // Trigger summary generation asynchronously (don't wait for it)
        generateSummaryAsync(space_id).catch(err => {
            console.error('Error generating summary:', err);
        });

        res.json({
            success: true,
            message: 'Space ended successfully. Summary generation started.',
            space_id: space_id
        });

    } catch (error) {
        console.error('❌ Error ending space:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get space summary status
 * GET /api/spaces/:space_id/summary
 */
router.get('/:space_id/summary', async (req, res) => {
    try {
        const { space_id } = req.params;
        const supabase = getSupabase();

        const { data: space, error } = await supabase
            .from('spaces')
            .select('summary_generated, summary_text, summary_generated_at, posted_to_x')
            .eq('id', space_id)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            summary: {
                generated: space.summary_generated || false,
                text: space.summary_text || null,
                generated_at: space.summary_generated_at || null,
                posted_to_x: space.posted_to_x || false
            }
        });

    } catch (error) {
        console.error('❌ Error getting summary:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Generate summary asynchronously
 */
async function generateSummaryAsync(space_id) {
    const supabase = getSupabase();

    try {
        console.log(`\n📝 Generating summary for space: ${space_id}`);

        // Get all fact-checked messages
        const { data: messages, error: messagesError } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .eq('fact_check_status', 'completed')
            .order('sequence_number');

        if (messagesError) throw messagesError;

        if (!messages || messages.length === 0) {
            console.log('⚠️  No fact-checked messages found. Skipping summary.');
            return;
        }

        console.log(`📊 Found ${messages.length} fact-checked messages`);

        // Calculate statistics
        const stats = {
            total_messages: messages.length,
            by_verdict: { true: 0, false: 0, misleading: 0, unverified: 0 }
        };

        messages.forEach(msg => {
            if (msg.grok_verdict) {
                const verdict = msg.grok_verdict.toLowerCase();
                if (stats.by_verdict[verdict] !== undefined) {
                    stats.by_verdict[verdict]++;
                }
            }
        });

        // Calculate speaker averages and find worst claim per speaker
        const bySpeaker = {};
        messages.forEach(msg => {
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

        // Sort by most messages (primary speakers first)
        speakerStats.sort((a, b) => bySpeaker[b.username].messages.length - bySpeaker[a.username].messages.length);

        // Get space info for credibility score
        const { data: spaceData } = await supabase
            .from('spaces')
            .select('overall_credibility_score, title')
            .eq('id', space_id)
            .single();

        const credibilityScore = spaceData?.overall_credibility_score || 100;

        // Collect all message content for conversation summary
        const allContent = messages.map(m => m.content).join(' ');

        // Call Grok for summary
        console.log('🤖 Calling Grok to generate tweet summary...');

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
                        content: `Create a professional, journalist-style tweet summarizing this X Space fact-check analysis. 

CRITICAL RULES:
- NO EMOJIS whatsoever
- Sound professional and human, not AI-generated
- Keep it under 280 characters total
- Use concise, punchy sentences

REQUIRED FORMAT (use this exact structure):
1. First line: Brief 1-sentence summary of what the conversation was about (the main topics discussed)
2. Credibility Score line: "Credibility Score: X/100"
3. Claims breakdown: "Fact-checked X claims: Y true, Z false, W mixed"
4. Speaker accuracy: Each speaker's average score on one line
5. Least accurate section: List each speaker's weakest claim topic (2-3 word description) with score
6. Final verdict: One sentence overall assessment

Example:
"Discussion covered election security measures and voting data accuracy.

Credibility Score: 72/100

Fact-checked 16 claims: 8 true, 5 false, 3 mixed.

@SpeakerA averaged 7/10.
@SpeakerB averaged 4/10.

Least accurate:
@SpeakerA on voter turnout data (3/10)
@SpeakerB on fraud statistics (2/10)

Mixed accuracy overall, several claims need context."

Write naturally. Be direct and informative.`
                    },
                    {
                        role: 'user',
                        content: `Create tweet summary:

Conversation content (use this to write a 1-sentence topic summary):
${allContent.substring(0, 800)}

Credibility Score: ${credibilityScore}/100
Total claims: ${stats.total_messages}
Verdicts: ${stats.by_verdict.true} true, ${stats.by_verdict.false} false, ${stats.by_verdict.misleading} misleading, ${stats.by_verdict.unverified} unverified

Speakers:
${speakerStats.map(s =>
                            `@${s.username}: averaged ${s.avgScore}/10, worst claim "${s.worstClaim.content.substring(0, 50)}..." (${s.worstClaim.score}/10)`
                        ).join('\n')}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 350
            })
        });

        if (!grokResponse.ok) {
            throw new Error(`Grok API error: ${grokResponse.statusText}`);
        }

        const grokData = await grokResponse.json();
        const summaryText = grokData.choices[0]?.message?.content?.trim();

        if (!summaryText) {
            throw new Error('Empty summary from Grok');
        }

        console.log('✅ Summary generated:', summaryText);

        // Store summary in database
        const { error: updateError } = await supabase
            .from('spaces')
            .update({
                summary_generated: true,
                summary_text: summaryText,
                summary_generated_at: new Date().toISOString()
            })
            .eq('id', space_id);

        if (updateError) {
            throw updateError;
        }

        console.log('✅ Summary saved to database');

    } catch (error) {
        console.error('❌ Error generating summary:', error);

        // Mark as failed but don't throw
        await supabase
            .from('spaces')
            .update({
                summary_generated: false,
                summary_text: `Error generating summary: ${error.message}`
            })
            .eq('id', space_id);
    }
}

export default router;
