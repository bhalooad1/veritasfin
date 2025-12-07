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
 * Compare claims between two speakers on the same topic
 * POST /api/compare/speakers/:space_id
 */
router.post('/speakers/:space_id', async (req, res) => {
    try {
        const { space_id } = req.params;
        const { speaker1, speaker2, topic } = req.body;
        const supabase = getSupabase();

        console.log(`\n🔍 Comparing ${speaker1} vs ${speaker2} on topic: ${topic}`);

        // Get all messages from both speakers
        const { data: messages, error } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .in('speaker_display_name', [speaker1, speaker2])
            .order('sequence_number');

        if (error) throw error;

        // Extract claims from both speakers
        const speaker1Claims = [];
        const speaker2Claims = [];

        messages.forEach(msg => {
            const claims = msg.grok_response_raw || [];
            if (Array.isArray(claims)) {
                claims.forEach(claim => {
                    const claimData = {
                        text: claim.text,
                        verdict: claim.verdict,
                        score: claim.score,
                        explanation: claim.explanation,
                        sources: claim.sources || []
                    };

                    if (msg.speaker_display_name === speaker1) {
                        speaker1Claims.push(claimData);
                    } else {
                        speaker2Claims.push(claimData);
                    }
                });
            }
        });

        console.log(`📊 ${speaker1}: ${speaker1Claims.length} claims`);
        console.log(`📊 ${speaker2}: ${speaker2Claims.length} claims`);

        // Call Grok to analyze contradictions and agreements
        const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'grok-4-0709',
                messages: [
                    {
                        role: 'system',
                        content: `You are a debate analyst comparing claims from two speakers.

TASK: Identify contradictions, agreements, and provide comparative analysis.

ANALYSIS CATEGORIES:

1. DIRECT CONTRADICTIONS
   - Claims that directly oppose each other
   - Cite specific quotes from both sides

2. AGREEMENTS
   - Claims both speakers agree on
   - Shared facts or positions

3. EMPHASIS DIFFERENCES
   - Same topic, different framing or emphasis
   - What each speaker focuses on

4. FACTUAL ACCURACY COMPARISON
   - Truth score averages
   - Who made more verifiable claims

5. SOURCE QUALITY
   - Which speaker provided better sources

Return JSON:
{
  "contradictions": [
    {
      "topic": "specific topic in dispute",
      "speaker1_claim": "exact quote",
      "speaker2_claim": "exact quote",
      "analysis": "why these contradict"
    }
  ],
  "agreements": [
    {
      "topic": "agreed upon topic",
      "shared_position": "what they agree on"
    }
  ],
  "accuracy_comparison": {
    "speaker1_avg_score": 0-10,
    "speaker2_avg_score": 0-10,
    "winner": "speaker name"
  },
  "summary": "Overall comparative analysis"
}`
                    },
                    {
                        role: 'user',
                        content: `Compare these speakers on topic: ${topic || 'overall debate'}

${speaker1} CLAIMS:
${JSON.stringify(speaker1Claims, null, 2)}

${speaker2} CLAIMS:
${JSON.stringify(speaker2Claims, null, 2)}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 3000
            })
        });

        if (!grokResponse.ok) {
            throw new Error(`Grok API error: ${grokResponse.statusText}`);
        }

        const grokData = await grokResponse.json();
        const analysisText = grokData.choices[0]?.message?.content;

        if (!analysisText) {
            throw new Error('Empty response from Grok');
        }

        // Parse JSON response
        let comparison;
        try {
            let cleanedContent = analysisText.trim();
            if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            }

            const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                comparison = JSON.parse(jsonMatch[0]);
            } else {
                comparison = JSON.parse(cleanedContent);
            }

            console.log('✅ Comparative analysis completed');
            console.log(`   Contradictions found: ${comparison.contradictions?.length || 0}`);
            console.log(`   Agreements found: ${comparison.agreements?.length || 0}`);

        } catch (parseError) {
            console.error('❌ Failed to parse Grok response:', parseError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to parse AI response'
            });
        }

        res.json({
            success: true,
            comparison: {
                ...comparison,
                metadata: {
                    speaker1: speaker1,
                    speaker2: speaker2,
                    topic: topic,
                    speaker1_claim_count: speaker1Claims.length,
                    speaker2_claim_count: speaker2Claims.length
                }
            }
        });

    } catch (error) {
        console.error('❌ Error comparing speakers:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Analyze claim evolution over time
 * POST /api/compare/claim-evolution
 */
router.post('/claim-evolution', async (req, res) => {
    try {
        const { speaker, topic, time_periods } = req.body;
        const supabase = getSupabase();

        console.log(`\n📈 Analyzing claim evolution for ${speaker} on ${topic}`);

        // Get historical debates for this speaker
        const { data: spaces, error: spacesError } = await supabase
            .from('spaces')
            .select('*')
            .order('created_at', { ascending: true });

        if (spacesError) throw spacesError;

        const claimsByPeriod = [];

        for (const space of spaces) {
            const { data: messages, error: messagesError } = await supabase
                .from('messages_with_speakers')
                .select('*')
                .eq('space_id', space.id)
                .eq('speaker_display_name', speaker);

            if (!messagesError && messages) {
                const periodClaims = [];
                messages.forEach(msg => {
                    if (msg.grok_response_raw && Array.isArray(msg.grok_response_raw)) {
                        msg.grok_response_raw.forEach(claim => {
                            // Filter by topic if specified
                            if (!topic || claim.text.toLowerCase().includes(topic.toLowerCase())) {
                                periodClaims.push({
                                    text: claim.text,
                                    verdict: claim.verdict,
                                    score: claim.score,
                                    date: space.created_at
                                });
                            }
                        });
                    }
                });

                if (periodClaims.length > 0) {
                    claimsByPeriod.push({
                        period: space.created_at,
                        space_title: space.title,
                        claims: periodClaims
                    });
                }
            }
        }

        console.log(`📊 Found claims across ${claimsByPeriod.length} time periods`);

        if (claimsByPeriod.length === 0) {
            return res.json({
                success: true,
                evolution: {
                    message: 'No historical data found for this speaker and topic'
                }
            });
        }

        // Call Grok to analyze evolution
        const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'grok-4-0709',
                messages: [
                    {
                        role: 'system',
                        content: `You are analyzing how a speaker's claims have evolved over time.

TASK: Identify patterns, contradictions, and position changes.

ANALYSIS:
1. Position consistency - Has the speaker been consistent?
2. Flip-flops - Claims that directly contradict earlier positions
3. Refinement - Claims that evolved but stayed consistent
4. New topics - Topics they started discussing later

Return JSON:
{
  "consistency_score": 0-100,
  "flip_flops": [
    {
      "topic": "what changed",
      "earlier_position": "quote from earlier",
      "later_position": "quote from later",
      "dates": ["date1", "date2"]
    }
  ],
  "consistent_positions": ["topics they've been consistent on"],
  "new_focus_areas": ["topics added over time"],
  "overall_trend": "summary of evolution"
}`
                    },
                    {
                        role: 'user',
                        content: `Analyze claim evolution for ${speaker} on topic: ${topic || 'all topics'}

Historical Claims:
${JSON.stringify(claimsByPeriod, null, 2)}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        if (!grokResponse.ok) {
            throw new Error(`Grok API error: ${grokResponse.statusText}`);
        }

        const grokData = await grokResponse.json();
        const evolutionText = grokData.choices[0]?.message?.content;

        let evolution;
        try {
            let cleanedContent = evolutionText.trim();
            if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            }

            const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                evolution = JSON.parse(jsonMatch[0]);
            } else {
                evolution = JSON.parse(cleanedContent);
            }

            console.log('✅ Evolution analysis completed');
            console.log(`   Consistency Score: ${evolution.consistency_score}/100`);

        } catch (parseError) {
            console.error('❌ Failed to parse response:', parseError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to parse AI response'
            });
        }

        res.json({
            success: true,
            evolution: {
                ...evolution,
                metadata: {
                    speaker: speaker,
                    topic: topic,
                    periods_analyzed: claimsByPeriod.length
                }
            }
        });

    } catch (error) {
        console.error('❌ Error analyzing evolution:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
