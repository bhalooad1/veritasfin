// AI Service using xAI Structured Outputs
// The API guarantees responses match our schemas - no manual JSON cleaning needed

// JSON Schemas for structured outputs (xAI format)
const StatementSchema = {
    type: "object",
    properties: {
        statements: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    text: { type: "string" },
                    fullText: { type: "string" },
                    type: { type: "string", enum: ["position", "support", "skip"] },
                    confidence: { type: "number" }
                },
                required: ["text", "fullText", "type", "confidence"]
            }
        }
    },
    required: ["statements"]
};

const RelationshipResponseSchema = {
    type: "object",
    properties: {
        relationship: { type: "string", enum: ["supports", "attacks", "neutral"] },
        confidence: { type: "number" },
        reason: { type: "string" }
    },
    required: ["relationship", "confidence", "reason"]
};

export const aiService = {
    async extractNodesIncremental(statement, speaker, context, apiKey) {
        if (!apiKey) throw new Error('GROK_API_KEY is required');

        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'grok-4-fast-non-reasoning',
                messages: [
                    {
                        role: 'system',
                        content: `You are analyzing statements from a debate. Your task is to extract claims and supporting arguments.

IMPORTANT: If a statement is vague or uses pronouns/references (like "those systems", "that", "it"), use the provided context to EXPAND it into a complete, self-contained statement.

Example:
- Original: "But those systems have major limitations too"
- With context about vaccine monitoring: "Vaccine safety monitoring systems have major limitations"
- This makes the claim understandable without needing the original context.

Classify each extracted statement as:
- "position": A substantive claim or thesis (the main point being argued)
- "support": Evidence, data, or reasoning that backs up a position
- "skip": Questions, filler, or statements with no argumentative content

Rules:
1. EXPAND vague references using the debate context
2. Keep each statement self-contained and clear
3. Multiple claims in one statement should be separate entries
4. Skip pure questions like "How so?" or "What do you mean?"`
                    },
                    {
                        role: 'user',
                        content: `Speaker: ${speaker}\nStatement: "${statement}"${context ? `\n\nDebate Context:\n${context}` : ''}`
                    }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "statement_extraction",
                        strict: true,
                        schema: StatementSchema
                    }
                },
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Grok API error: ${response.status} - ${error}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content;

        // With structured outputs, this is guaranteed to be valid JSON matching our schema
        const result = JSON.parse(content);

        // Filter out "skip" statements (questions, filler, etc.)
        return result.statements
            .filter(s => s.type !== 'skip')
            .map(s => ({
                ...s,
                type: s.type === 'position' ? 'claim' : 'argument',
                speaker
            }));
    },

    /**
     * Analyze relationship between a node and a claim
     * @param {Object} node - The node being analyzed (has type: 'claim' or 'argument')
     * @param {Object} claim - The target claim to compare against
     * @param {string} apiKey - Grok API key
     * @returns {Object|null} - { relationship, confidence, reason } or null if neutral/low confidence
     */
    async analyzeRelationship(node, claim, apiKey) {
        if (!apiKey) throw new Error('GROK_API_KEY is required');

        const nodeType = node.type === 'claim' ? 'position' : 'support';

        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [
                    {
                        role: 'system',
                        content: `You are analyzing whether a statement relates to a claim.

The statement is classified as: ${nodeType}

Determine the relationship:
- "supports": The statement strengthens, agrees with, or provides evidence for the claim
- "attacks": The statement weakens, contradicts, or argues against the claim
- "neutral": The statement has no meaningful relationship to the claim

Be strict. Only use "supports" or "attacks" if there is a clear, direct relationship.
Set confidence high (0.8-1.0) only when the relationship is obvious.`
                    },
                    {
                        role: 'user',
                        content: `Statement (${node.speaker}, ${nodeType}): "${node.fullText}"

Claim (${claim.speaker}): "${claim.fullText}"`
                    }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "relationship_analysis",
                        strict: true,
                        schema: RelationshipResponseSchema
                    }
                },
                temperature: 0.2
            })
        });

        if (!response.ok) {
            const error = await response.text();
            console.error('Relationship API error:', response.status, error);
            return null;
        }

        const data = await response.json();
        const content = data.choices[0].message.content;
        const result = JSON.parse(content);

        // High confidence threshold - only return relationships we're confident about
        const CONFIDENCE_THRESHOLD = 0.75;

        if (result.relationship === 'neutral' || result.confidence < CONFIDENCE_THRESHOLD) {
            return null; // No link created
        }

        return {
            type: result.relationship,
            confidence: result.confidence,
            explanation: result.reason
        };
    },

    /**
     * Generate/update a running context summary of the conversation
     * This helps maintain context across statement-by-statement processing
     */
    async updateContextSummary(currentSummary, newStatement, speaker, existingClaims, apiKey) {
        if (!apiKey) throw new Error('GROK_API_KEY is required');

        const ContextSummarySchema = {
            type: "object",
            properties: {
                summary: { type: "string" },
                mainTopics: { type: "array", items: { type: "string" } },
                speakerPositions: {
                    type: "object",
                    additionalProperties: { type: "string" }
                },
                currentDisagreements: { type: "array", items: { type: "string" } }
            },
            required: ["summary", "mainTopics", "speakerPositions", "currentDisagreements"]
        };

        const claimsContext = existingClaims
            .slice(-5)
            .map(c => `- ${c.speaker}: "${c.text}"`)
            .join('\n');

        const response = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'grok-4-1-fast-non-reasoning',
                messages: [
                    {
                        role: 'system',
                        content: `You are tracking a debate/discussion. Update the running summary based on the new statement.

Current summary: ${currentSummary || 'No previous context.'}

Recent claims in the debate:
${claimsContext || 'None yet.'}

Provide:
- summary: A 1-2 sentence summary of the overall debate so far
- mainTopics: The key topics being discussed (max 3)
- speakerPositions: What each speaker's main stance is
- currentDisagreements: Key points of contention between speakers`
                    },
                    {
                        role: 'user',
                        content: `New statement from ${speaker}: "${newStatement}"`
                    }
                ],
                response_format: {
                    type: "json_schema",
                    json_schema: {
                        name: "context_summary",
                        strict: true,
                        schema: ContextSummarySchema
                    }
                },
                temperature: 0.3
            })
        });

        if (!response.ok) {
            console.error('Context summary API error:', response.status);
            return null;
        }

        const data = await response.json();
        return JSON.parse(data.choices[0].message.content);
    }
};
