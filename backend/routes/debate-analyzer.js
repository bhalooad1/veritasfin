import express from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();

// Initialize Supabase
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

        const spaceData = {
            title: title || 'Presidential Debate Analysis',
            space_url: null,
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

        const { data: space, error: spaceError } = await supabase
            .from('spaces')
            .insert(spaceData)
            .select()
            .single();

        if (spaceError) throw spaceError;

        res.json({
            success: true,
            space_id: space.id
        });

    } catch (error) {
        console.error('Error creating debate space:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Placeholder for debate analysis
 */
router.post('/analyze-transcript', async (req, res) => {
    try {
        const { transcript, space_id } = req.body;

        if (!transcript || !space_id) {
            return res.status(400).json({
                error: 'Missing required fields: transcript and space_id'
            });
        }

        // TODO: Implement Grok integration
        // TODO: Implement debate parser
        // TODO: Store messages in database

        res.json({
            success: true,
            message: 'Transcript analysis endpoint ready'
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

        const { data: messages, error } = await supabase
            .from('messages')
            .select('*')
            .eq('space_id', space_id)
            .order('sequence_number');

        if (error) throw error;

        res.json({
            success: true,
            space_id: space_id,
            messages: messages || []
        });

    } catch (error) {
        console.error('Error getting debate results:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
