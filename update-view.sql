-- Drop and recreate the view to include grok_response_raw
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