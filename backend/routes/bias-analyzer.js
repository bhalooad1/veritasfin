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
 * Analyze bias in debate statements
 * POST /api/bias/analyze-statement
 */
router.post('/analyze-statement', async (req, res) => {
    try {
        const { statement, speaker } = req.body;

        if (!statement) {
            return res.status(400).json({
                success: false,
                error: 'Statement is required'
            });
        }

        console.log(`\n🔍 Analyzing bias for statement from ${speaker}`);

        // Call Grok to analyze bias
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
                        content: `You are a political bias detection expert. Analyze statements for:

1. IDEOLOGICAL BIAS (Left/Right/Center)
   - Progressive vs Conservative framing
   - Economic policy positioning
   - Social policy positioning

2. LANGUAGE BIAS
   - Loaded language and emotional appeals
   - Framing effects (victim/hero narratives)
   - Euphemisms or dysphemisms

3. SELECTION BIAS
   - Cherry-picked facts or statistics
   - Omitted context or counterarguments
   - Confirmation bias indicators

4. NEUTRALITY SCORE (0-100)
   - 90-100: Highly neutral, fact-based
   - 70-89: Mostly neutral with minor bias
   - 50-69: Mixed, noticeable bias
   - 30-49: Significantly biased
   - 0-29: Extremely biased

Return JSON:
{
  "ideological_lean": "Left" | "Center-Left" | "Center" | "Center-Right" | "Right",
  "neutrality_score": 0-100,
  "bias_indicators": [
    {
      "type": "Loaded Language" | "Cherry-picking" | "Framing" | "Emotional Appeal",
      "text": "exact phrase showing bias",
      "explanation": "why this shows bias"
    }
  ],
  "neutral_rewrite": "Suggested neutral version of the statement",
  "diverse_perspectives": [
    "Alternative framing from opposing view",
    "Counter-argument to consider"
  ]
}`
                    },
                    {
                        role: 'user',
                        content: `Analyze this statement for bias:\n\nSpeaker: ${speaker || 'Unknown'}\nStatement: "${statement}"`
                    }
                ],
                temperature: 0.2,
                max_tokens: 1500
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
        let analysis;
        try {
            let cleanedContent = analysisText.trim();
            if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            }

            const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                analysis = JSON.parse(jsonMatch[0]);
            } else {
                analysis = JSON.parse(cleanedContent);
            }

            console.log('✅ Bias analysis completed');
            console.log(`   Neutrality Score: ${analysis.neutrality_score}/100`);
            console.log(`   Ideological Lean: ${analysis.ideological_lean}`);

        } catch (parseError) {
            console.error('❌ Failed to parse Grok response:', parseError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to parse AI response'
            });
        }

        res.json({
            success: true,
            analysis: analysis
        });

    } catch (error) {
        console.error('❌ Error analyzing bias:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Analyze bias across all messages in a debate
 * POST /api/bias/analyze-debate/:space_id
 */
router.post('/analyze-debate/:space_id', async (req, res) => {
    try {
        const { space_id } = req.params;
        const supabase = getSupabase();

        console.log(`\n🔍 Analyzing bias for entire debate: ${space_id}`);

        // Get all messages
        const { data: messages, error } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .order('sequence_number');

        if (error) throw error;

        console.log(`📊 Found ${messages.length} messages to analyze`);

        // Analyze each message for bias
        const biasResults = [];

        for (const message of messages) {
            try {
                const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/bias/analyze-statement`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        statement: message.content,
                        speaker: message.speaker_display_name
                    })
                });

                if (response.ok) {
                    const data = await response.json();
                    biasResults.push({
                        message_id: message.id,
                        speaker: message.speaker_display_name,
                        sequence: message.sequence_number,
                        ...data.analysis
                    });
                }

                // Rate limiting: wait 1 second between requests
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`Error analyzing message ${message.id}:`, error);
            }
        }

        // Calculate aggregate statistics
        const stats = {
            total_analyzed: biasResults.length,
            by_speaker: {},
            overall_neutrality: 0
        };

        biasResults.forEach(result => {
            if (!stats.by_speaker[result.speaker]) {
                stats.by_speaker[result.speaker] = {
                    message_count: 0,
                    avg_neutrality: 0,
                    neutrality_scores: [],
                    ideological_lean_distribution: {}
                };
            }

            const speakerStats = stats.by_speaker[result.speaker];
            speakerStats.message_count++;
            speakerStats.neutrality_scores.push(result.neutrality_score);

            const lean = result.ideological_lean;
            speakerStats.ideological_lean_distribution[lean] =
                (speakerStats.ideological_lean_distribution[lean] || 0) + 1;
        });

        // Calculate averages
        Object.keys(stats.by_speaker).forEach(speaker => {
            const scores = stats.by_speaker[speaker].neutrality_scores;
            stats.by_speaker[speaker].avg_neutrality =
                scores.reduce((a, b) => a + b, 0) / scores.length;
            delete stats.by_speaker[speaker].neutrality_scores;
        });

        const allScores = biasResults.map(r => r.neutrality_score);
        stats.overall_neutrality = allScores.reduce((a, b) => a + b, 0) / allScores.length;

        console.log('✅ Debate bias analysis completed');
        console.log(`   Overall Neutrality: ${stats.overall_neutrality.toFixed(1)}/100`);

        res.json({
            success: true,
            statistics: stats,
            detailed_results: biasResults
        });

    } catch (error) {
        console.error('❌ Error analyzing debate bias:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

export default router;
