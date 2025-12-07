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
 * Generate Grokipedia-formatted article from debate analysis
 * POST /api/grokipedia/generate-article/:space_id
 */
router.post('/generate-article/:space_id', async (req, res) => {
    try {
        const { space_id } = req.params;
        const { topic_focus } = req.body;
        const supabase = getSupabase();

        console.log(`\n📝 Generating Grokipedia article for space: ${space_id}`);

        // Get debate space info
        const { data: space, error: spaceError } = await supabase
            .from('spaces')
            .select('*')
            .eq('id', space_id)
            .single();

        if (spaceError) throw spaceError;

        // Get all fact-checked messages
        const { data: messages, error: messagesError } = await supabase
            .from('messages_with_speakers')
            .select('*')
            .eq('space_id', space_id)
            .eq('fact_check_status', 'completed')
            .order('sequence_number');

        if (messagesError) throw messagesError;

        console.log(`📊 Processing ${messages.length} fact-checked messages`);

        // Extract all claims with sources
        const allClaims = [];
        messages.forEach(msg => {
            if (msg.grok_response_raw && Array.isArray(msg.grok_response_raw)) {
                msg.grok_response_raw.forEach(claim => {
                    allClaims.push({
                        speaker: msg.speaker_display_name,
                        claim: claim.text,
                        verdict: claim.verdict,
                        score: claim.score,
                        explanation: claim.explanation,
                        sources: claim.sources || []
                    });
                });
            }
        });

        console.log(`📋 Extracted ${allClaims.length} total claims`);

        // Call Grok to synthesize into Grokipedia article
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
                        content: `You are a Grokipedia article writer. Create comprehensive, neutral encyclopedia articles from fact-checked debate data.

REQUIREMENTS:
1. **Neutral tone** - No bias, present all verified facts objectively
2. **Proper citations** - Use [[ref:N]] format for inline citations
3. **Comprehensive coverage** - Organize claims by topic/theme
4. **Accuracy** - Only include verified claims (TRUE or MOSTLY TRUE)
5. **Wikipedia format** - Use standard sections: Summary, Background, Key Claims, Controversies, Sources

ARTICLE STRUCTURE:
# [Topic Title]

## Summary
[2-3 sentence overview of the debate topic]

## Background
[Historical context and importance of the topic]

## Key Claims and Facts
[Organize verified claims by subtopic, with citations]

### [Subtopic 1]
- [Verified claim 1] [[ref:1]]
- [Verified claim 2] [[ref:2]]

### [Subtopic 2]
- [Verified claim 3] [[ref:3]]

## Controversies and Disputed Claims
[Claims rated as FALSE or MISLEADING, with explanations]

## Sources
[Numbered list of all citations used]

OUTPUT FORMAT:
Return valid Markdown following Wikipedia/Grokipedia conventions.`
                    },
                    {
                        role: 'user',
                        content: `Create a Grokipedia article from this fact-checked debate data:

Topic Focus: ${topic_focus || space.title || 'Political Debate'}
Date: ${space.created_at}

Verified Claims:
${JSON.stringify(allClaims, null, 2)}`
                    }
                ],
                temperature: 0.3,
                max_tokens: 4000
            })
        });

        if (!grokResponse.ok) {
            throw new Error(`Grok API error: ${grokResponse.statusText}`);
        }

        const grokData = await grokResponse.json();
        const articleContent = grokData.choices[0]?.message?.content;

        if (!articleContent) {
            throw new Error('Empty response from Grok');
        }

        console.log('✅ Article generated successfully');
        console.log(`   Length: ${articleContent.length} characters`);

        // Store article in database
        const { data: article, error: insertError } = await supabase
            .from('grokipedia_articles')
            .insert({
                space_id: space_id,
                topic: topic_focus || space.title,
                content: articleContent,
                claim_count: allClaims.length,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (insertError) {
            console.warn('⚠️  Could not store article in database:', insertError.message);
        }

        res.json({
            success: true,
            article: {
                content: articleContent,
                metadata: {
                    topic: topic_focus || space.title,
                    claim_count: allClaims.length,
                    message_count: messages.length,
                    generated_at: new Date().toISOString()
                }
            }
        });

    } catch (error) {
        console.error('❌ Error generating article:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Get source quality metrics
 * POST /api/grokipedia/analyze-sources
 */
router.post('/analyze-sources', async (req, res) => {
    try {
        const { sources } = req.body;

        if (!sources || !Array.isArray(sources)) {
            return res.status(400).json({
                success: false,
                error: 'Sources array is required'
            });
        }

        console.log(`\n🔍 Analyzing quality of ${sources.length} sources`);

        // Categorize sources
        const categorized = {
            government: [],
            academic: [],
            fact_checkers: [],
            news_major: [],
            news_other: [],
            grokipedia: [],
            other: []
        };

        const domainPatterns = {
            government: /\.(gov|mil)$/,
            academic: /\.(edu|ac\.|edu\.)|\/(doi|arxiv|scholar)/,
            fact_checkers: /(factcheck|politifact|snopes|fullfact)/i,
            news_major: /(nytimes|washingtonpost|reuters|apnews|bbc|npr|wsj)/i,
            grokipedia: /grokipedia\.com/i
        };

        sources.forEach(url => {
            try {
                const urlObj = new URL(url);
                const domain = urlObj.hostname;

                if (domainPatterns.government.test(domain)) {
                    categorized.government.push(url);
                } else if (domainPatterns.academic.test(url)) {
                    categorized.academic.push(url);
                } else if (domainPatterns.fact_checkers.test(url)) {
                    categorized.fact_checkers.push(url);
                } else if (domainPatterns.news_major.test(url)) {
                    categorized.news_major.push(url);
                } else if (domainPatterns.grokipedia.test(url)) {
                    categorized.grokipedia.push(url);
                } else if (urlObj.hostname.includes('news') || urlObj.hostname.includes('press')) {
                    categorized.news_other.push(url);
                } else {
                    categorized.other.push(url);
                }
            } catch (e) {
                categorized.other.push(url);
            }
        });

        // Calculate quality score
        const weights = {
            government: 10,
            academic: 10,
            fact_checkers: 9,
            news_major: 7,
            grokipedia: 6,
            news_other: 5,
            other: 3
        };

        let totalScore = 0;
        let maxScore = 0;

        Object.keys(categorized).forEach(category => {
            const count = categorized[category].length;
            totalScore += count * weights[category];
            maxScore += count * 10; // Maximum possible score
        });

        const qualityScore = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

        // Diversity score (more categories = better)
        const categoriesUsed = Object.values(categorized).filter(arr => arr.length > 0).length;
        const diversityScore = Math.round((categoriesUsed / 7) * 100);

        console.log('✅ Source analysis completed');
        console.log(`   Quality Score: ${qualityScore}/100`);
        console.log(`   Diversity Score: ${diversityScore}/100`);

        res.json({
            success: true,
            analysis: {
                total_sources: sources.length,
                quality_score: qualityScore,
                diversity_score: diversityScore,
                categorization: Object.keys(categorized).map(cat => ({
                    category: cat,
                    count: categorized[cat].length,
                    weight: weights[cat]
                })),
                recommendations: generateRecommendations(categorized, sources.length)
            }
        });

    } catch (error) {
        console.error('❌ Error analyzing sources:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

function generateRecommendations(categorized, total) {
    const recommendations = [];

    if (categorized.government.length === 0) {
        recommendations.push('Add official government sources (.gov) for authoritative data');
    }

    if (categorized.fact_checkers.length === 0) {
        recommendations.push('Include fact-checking organizations for verification');
    }

    if (categorized.academic.length === 0) {
        recommendations.push('Add academic sources (.edu) for scholarly perspective');
    }

    const majorNewsRatio = categorized.news_major.length / total;
    if (majorNewsRatio > 0.7) {
        recommendations.push('Over-reliance on news sources - diversify with primary sources');
    }

    if (categorized.grokipedia.length === 0) {
        recommendations.push('Add Grokipedia link for comprehensive background');
    }

    const otherRatio = categorized.other.length / total;
    if (otherRatio > 0.3) {
        recommendations.push('Too many unclassified sources - verify credibility');
    }

    if (recommendations.length === 0) {
        recommendations.push('Source diversity and quality looks good!');
    }

    return recommendations;
}

export default router;
