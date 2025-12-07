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

        // Extract top claims (highest and lowest truth scores)
        const rankedMessages = messages
            .filter(m => m.truth_score !== null)
            .sort((a, b) => b.truth_score - a.truth_score);

        const topTrueClaim = rankedMessages[0];
        const topFalseClaim = rankedMessages[rankedMessages.length - 1];

        // Call Grok for summary
        console.log('🤖 Calling Grok to generate tweet summary...');

        const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'grok-4-1-fast-reasoning', // Fast Grok 4.1 model for summaries
                messages: [
                    {
                        role: 'system',
                        content: `Create a punchy, engaging tweet (280 chars max) summarizing this debate fact-check.

Format example:
🎯 Presidential Debate Fact-Checked
✅ TRUE: 8 | ❌ FALSE: 3 | ⚠️ MIXED: 5
📌 Most accurate: [speaker] on [topic]
🔍 Full analysis: [will be added]

Be concise, factual, use emojis for visual appeal. Focus on the numbers and key findings.`
                    },
                    {
                        role: 'user',
                        content: `Create tweet summary:

Total Statements: ${stats.total_messages}
Verdicts:
- TRUE: ${stats.by_verdict.true}
- FALSE: ${stats.by_verdict.false}
- MISLEADING: ${stats.by_verdict.misleading}
- UNVERIFIED: ${stats.by_verdict.unverified}

Top True Claim: "${topTrueClaim?.content?.substring(0, 100)}..." (${topTrueClaim?.speaker_display_name})
Top False Claim: "${topFalseClaim?.content?.substring(0, 100)}..." (${topFalseClaim?.speaker_display_name})`
                    }
                ],
                temperature: 0.7,
                max_tokens: 150
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
