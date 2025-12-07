-- Add propagation_analysis column to messages table for caching
ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS propagation_analysis JSONB;

COMMENT ON COLUMN messages.propagation_analysis IS 'Cached Grok propagation analysis graph';
