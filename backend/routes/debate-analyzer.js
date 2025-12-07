import express from 'express';
import { createClient } from '@supabase/supabase-js';
import DebateParser from '../debate-parser.js';
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
 * Parse and analyze a debate transcript
 */
router.post('/analyze-transcript', async (req, res) => {
    try {
        const { transcript, space_id } = req.body;
        const supabase = getSupabase();

        if (!transcript || !space_id) {
            return res.status(400).json({
                error: 'Missing required fields: transcript and space_id'
            });
        }

        // Parse the transcript
        const parser = new DebateParser();
        const parsedMessages = parser.parseTranscript(transcript);

        console.log(`Parsed ${parsedMessages.length} messages from transcript`);

        // Get speakers from database
        const { data: speakers, error: speakersError } = await supabase
            .from('speakers')
            .select('*');

        if (speakersError) throw speakersError;

        const speakerMap = {};
        speakers.forEach(s => {
            speakerMap[s.display_name] = s.id;
        });

        // Insert messages into database
        const insertedMessages = [];
        for (const msg of parsedMessages) {
            const speaker_id = speakerMap[msg.speaker];

            if (!speaker_id) {
                console.log(`Speaker not found: ${msg.speaker}, skipping...`);
                continue;
            }

            const messageData = {
                space_id: space_id,
                speaker_id: speaker_id,
                content: msg.content,
                sequence_number: msg.sequence_number,
                fact_check_status: 'pending',
                created_at: new Date().toISOString()
            };

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

        const stats = parser.getStatistics();

        res.json({
            success: true,
            space_id: space_id,
            statistics: stats,
            messages_inserted: insertedMessages.length
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
