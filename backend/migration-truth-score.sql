-- Migration: Add truth_score field to messages table
-- Run this in Supabase SQL Editor

-- Add truth_score column (1-10 scale)
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS truth_score INTEGER CHECK (truth_score >= 1 AND truth_score <= 10);

-- Add index for truth_score queries
CREATE INDEX IF NOT EXISTS idx_messages_truth_score ON messages(truth_score);

-- Update the update_message_fact_check function to include truth_score
CREATE OR REPLACE FUNCTION update_message_fact_check(
  p_message_id UUID,
  p_verdict verdict_type,
  p_explanation TEXT,
  p_credibility_score INTEGER,
  p_truth_score INTEGER DEFAULT NULL,
  p_grok_response_raw JSONB DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE messages
  SET
    fact_check_status = 'completed',
    grok_verdict = p_verdict,
    grok_explanation = p_explanation,
    credibility_score = p_credibility_score,
    truth_score = p_truth_score,
    grok_response_raw = p_grok_response_raw,
    processed_at = NOW()
  WHERE id = p_message_id;

  -- Update space overall score
  UPDATE spaces
  SET overall_credibility_score = p_credibility_score
  WHERE id = (SELECT space_id FROM messages WHERE id = p_message_id);

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate messages_with_speakers view to include truth_score
DROP VIEW IF EXISTS messages_with_speakers;

CREATE VIEW messages_with_speakers AS
SELECT
  m.id,
  m.space_id,
  m.content,
  m.sequence_number,
  m.fact_check_status,
  m.grok_verdict,
  m.grok_explanation,
  m.grok_response_raw,
  m.credibility_score,
  m.truth_score,
  m.created_at,
  m.processed_at,
  s.username AS speaker_username,
  s.display_name AS speaker_display_name
FROM messages m
JOIN speakers s ON m.speaker_id = s.id
ORDER BY m.space_id, m.sequence_number;
