-- Drop the existing view
DROP VIEW IF EXISTS messages_with_speakers CASCADE;

-- Recreate with ALL fields from messages table
CREATE OR REPLACE VIEW messages_with_speakers AS
SELECT
  m.id,
  m.space_id,
  m.speaker_id,
  m.content,
  m.sequence_number,
  m.fact_check_status,
  m.grok_verdict,
  m.grok_explanation,
  m.grok_response_raw,  -- This is the important field we need
  m.credibility_score,
  m.truth_score,
  m.created_at,
  m.processed_at,
  m.updated_at,
  s.username AS speaker_username,
  s.display_name AS speaker_display_name
FROM messages m
JOIN speakers s ON m.speaker_id = s.id
ORDER BY m.space_id, m.sequence_number;