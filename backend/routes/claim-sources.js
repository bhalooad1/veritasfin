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
 * Generate credible sources for a specific claim
 * POST /api/claims/:messageId/:claimIndex/generate-sources
 */
router.post('/:messageId/:claimIndex/generate-sources', async (req, res) => {
    try {
        const { messageId, claimIndex } = req.params;
        const { claimText } = req.body;

        if (!claimText) {
            return res.status(400).json({
                success: false,
                error: 'Claim text is required'
            });
        }

        console.log(`\n🔍 Generating sources for claim ${claimIndex} in message ${messageId}`);
        console.log(`📝 Claim: "${claimText}"`);

        // Debug: Log model being used
        const modelToUse = 'grok-4.1-fast';
        console.log(`\n⚡ MODEL DEBUG:`);
        console.log(`   Using model: ${modelToUse}`);
        console.log(`   Model type: Lightning fast (optimized for widget)`);
        console.log(`   Expected speed: 2-4 seconds`);

        const startTime = Date.now();

        // Call Grok to generate sources
        const grokResponse = await fetch(`${process.env.GROK_API_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GROK_API_KEY}`
            },
            body: JSON.stringify({
                model: modelToUse, // Lightning fast model for widget
                messages: [
                    {
                        role: 'system',
                        content: `You are a research assistant specializing in finding credible, verifiable sources.

TASK: Find 20 REAL, WORKING URLs that verify, discuss, or provide context for the given claim.

CRITICAL REQUIREMENTS:
1. Every URL MUST be real and accessible (no 404s, no made-up paths)
2. Prioritize authoritative sources:
   - Government/Official (.gov, .edu)
   - Fact-checking organizations (factcheck.org, politifact.com, snopes.com)
   - Major news outlets (nytimes.com, washingtonpost.com, reuters.com, apnews.com, npr.org)
   - Academic journals and research institutions
3. Include diverse perspectives when relevant
4. ALWAYS include 1 Grokipedia link as the last source
5. For Grokipedia, use real Wikipedia article names

QUALITY STANDARDS:
- Direct URLs to specific articles (not just homepages)
- Recent sources when possible (prefer 2020+)
- Mix of source types (government data, fact-checks, news, academic)
- Each URL should directly relate to the claim

GROKIPEDIA FORMAT:
https://grokipedia.com/page/[Exact_Wikipedia_Article_Title]

Examples of REAL Wikipedia articles:
- Supreme_Court_of_the_United_States
- COVID-19_pandemic
- Abortion_in_the_United_States
- Climate_change
- United_States_presidential_election

OUTPUT FORMAT:
Return ONLY a valid JSON array of 20 URLs. No explanation, no markdown, just the array.

Example:
["https://www.census.gov/data/tables.html", "https://www.factcheck.org/2024/article-name/", ..., "https://grokipedia.com/page/Topic"]

If you cannot find 20 credible URLs, return fewer rather than making up fake URLs.`
                    },
                    {
                        role: 'user',
                        content: `Find credible sources for this claim:\n\n"${claimText}"`
                    }
                ],
                temperature: 0.3,
                max_tokens: 2000
            })
        });

        const responseTime = Date.now() - startTime;
        console.log(`\n⏱️  TIMING DEBUG:`);
        console.log(`   Grok API responded in: ${responseTime}ms (${(responseTime / 1000).toFixed(2)}s)`);
        console.log(`   Response status: ${grokResponse.status} ${grokResponse.statusText}`);

        if (!grokResponse.ok) {
            const errorBody = await grokResponse.text();
            console.error(`❌ Grok API error ${grokResponse.status}:`, errorBody);
            throw new Error(`Grok API error: ${grokResponse.statusText}`);
        }

        const grokData = await grokResponse.json();

        // Debug: Log model used in response
        console.log(`\n📊 RESPONSE DEBUG:`);
        console.log(`   Model used: ${grokData.model || 'not specified'}`);
        console.log(`   Total tokens: ${grokData.usage?.total_tokens || 'unknown'}`);
        console.log(`   Completion tokens: ${grokData.usage?.completion_tokens || 'unknown'}`);

        const grokContent = grokData.choices[0]?.message?.content;

        if (!grokContent) {
            throw new Error('Empty response from Grok');
        }

        console.log('📨 Grok response length:', grokContent.length, 'characters');

        // Parse the response
        let sources;
        try {
            // Remove markdown code blocks if present
            let cleanedContent = grokContent.trim();
            if (cleanedContent.startsWith('```')) {
                cleanedContent = cleanedContent.replace(/```json\s*/g, '').replace(/```\s*/g, '');
            }

            // Extract JSON array
            const arrayMatch = cleanedContent.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
                sources = JSON.parse(arrayMatch[0]);
            } else {
                sources = JSON.parse(cleanedContent);
            }

            if (!Array.isArray(sources)) {
                throw new Error('Response is not an array');
            }

            console.log(`✅ Parsed ${sources.length} sources from Grok`);
        } catch (parseError) {
            console.error('❌ Failed to parse Grok response:', parseError.message);
            return res.status(500).json({
                success: false,
                error: 'Failed to parse AI response'
            });
        }

        // Validate URLs before saving
        console.log('\n🔍 URL VALIDATION DEBUG:');
        console.log(`   Starting validation of ${sources.length} URLs...`);
        const validationStartTime = Date.now();

        const validatedSources = await validateURLs(sources);

        const validationTime = Date.now() - validationStartTime;
        console.log(`✅ Validation complete in ${validationTime}ms`);
        console.log(`   Valid URLs: ${validatedSources.length}/${sources.length}`);
        console.log(`   Success rate: ${((validatedSources.length / sources.length) * 100).toFixed(1)}%`);

        if (validatedSources.length === 0) {
            return res.status(500).json({
                success: false,
                error: 'No valid URLs found'
            });
        }

        // Update database
        const supabase = getSupabase();

        // Get current message data
        const { data: message, error: fetchError } = await supabase
            .from('messages')
            .select('grok_response_raw')
            .eq('id', messageId)
            .single();

        if (fetchError) {
            throw new Error(`Database fetch error: ${fetchError.message}`);
        }

        if (!message || !message.grok_response_raw) {
            return res.status(404).json({
                success: false,
                error: 'Message or claims not found'
            });
        }

        // Update the specific claim's sources
        let messageData = message.grok_response_raw;

        // Handle both array format and object format
        let claims;
        if (Array.isArray(messageData)) {
            claims = messageData;
        } else if (messageData.claims && Array.isArray(messageData.claims)) {
            claims = messageData.claims;
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid claims data structure'
            });
        }

        // Validate claim index
        const claimIdx = parseInt(claimIndex);
        if (claimIdx < 0 || claimIdx >= claims.length) {
            return res.status(400).json({
                success: false,
                error: 'Invalid claim index'
            });
        }

        // Update sources
        console.log(`📝 Updating claim ${claimIdx} with ${validatedSources.length} sources`);
        console.log('📦 Before update - claim sources:', claims[claimIdx].sources);
        claims[claimIdx].sources = validatedSources;
        console.log('📦 After update - claim sources:', claims[claimIdx].sources);

        // Prepare the data to save
        const dataToSave = Array.isArray(messageData) ? claims : { ...messageData, claims };
        console.log('💾 Data structure to save:', JSON.stringify(dataToSave, null, 2).substring(0, 500));

        // Save back to database
        const { data: updateResult, error: updateError } = await supabase
            .from('messages')
            .update({
                grok_response_raw: dataToSave
            })
            .eq('id', messageId)
            .select();

        if (updateError) {
            console.error('❌ Database update error:', updateError);
            throw new Error(`Database update error: ${updateError.message}`);
        }

        console.log('✅ Sources updated successfully in database');
        console.log('📊 Update result:', updateResult);

        const totalTime = Date.now() - startTime;
        console.log(`\n🎉 TOTAL TIME: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}s)`);
        console.log(`   Breakdown:`);
        console.log(`   - Grok API: ${responseTime}ms`);
        console.log(`   - URL validation: ${validationTime}ms`);
        console.log(`   - Database update: ${totalTime - responseTime - validationTime}ms`);
        console.log(`\n✅ SUCCESS: Generated ${validatedSources.length} verified sources\n`);

        res.json({
            success: true,
            sources: validatedSources,
            message: `Generated ${validatedSources.length} verified sources`,
            debug: {
                model_used: modelToUse,
                response_time_ms: responseTime,
                validation_time_ms: validationTime,
                total_time_ms: totalTime,
                sources_requested: 20,
                sources_returned: sources.length,
                sources_valid: validatedSources.length,
                success_rate: `${((validatedSources.length / sources.length) * 100).toFixed(1)}%`
            }
        });

    } catch (error) {
        console.error('❌ Error generating sources:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Validate URLs by checking if they're accessible
 * Returns only working URLs
 */
async function validateURLs(urls) {
    const validUrls = [];
    const validationPromises = urls.map(async (url) => {
        try {
            // Quick HEAD request to check if URL exists
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000); // 5 second timeout

            const response = await fetch(url, {
                method: 'HEAD',
                signal: controller.signal,
                redirect: 'follow'
            });

            clearTimeout(timeout);

            if (response.ok || response.status === 403) { // 403 might block HEAD but URL exists
                return url;
            }

            console.log(`⚠️  URL failed validation (${response.status}): ${url}`);
            return null;
        } catch (error) {
            console.log(`⚠️  URL failed validation (${error.message}): ${url}`);
            return null;
        }
    });

    const results = await Promise.all(validationPromises);
    return results.filter(url => url !== null);
}

export default router;
