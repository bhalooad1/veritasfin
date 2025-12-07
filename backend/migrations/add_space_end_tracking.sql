-- Add columns to track space end and summary generation
-- Run this in your Supabase SQL Editor

ALTER TABLE spaces
ADD COLUMN IF NOT EXISTS is_live BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS summary_generated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS summary_text TEXT,
ADD COLUMN IF NOT EXISTS summary_generated_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS posted_to_x BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS x_post_id TEXT,
ADD COLUMN IF NOT EXISTS x_posted_at TIMESTAMP;

-- Add index for faster queries on live spaces
CREATE INDEX IF NOT EXISTS idx_spaces_is_live ON spaces(is_live);

-- Add index for finding spaces needing summaries
CREATE INDEX IF NOT EXISTS idx_spaces_summary_pending
ON spaces(summary_generated, is_live)
WHERE summary_generated = false AND is_live = false;

-- Add index for finding spaces ready to post to X
CREATE INDEX IF NOT EXISTS idx_spaces_ready_to_post
ON spaces(posted_to_x, summary_generated)
WHERE posted_to_x = false AND summary_generated = true;

-- Comment the columns for documentation
COMMENT ON COLUMN spaces.is_live IS 'Whether the space is currently live';
COMMENT ON COLUMN spaces.ended_at IS 'When the space ended';
COMMENT ON COLUMN spaces.summary_generated IS 'Whether AI summary has been generated';
COMMENT ON COLUMN spaces.summary_text IS 'Tweet-ready summary text (280 chars max)';
COMMENT ON COLUMN spaces.summary_generated_at IS 'When the summary was generated';
COMMENT ON COLUMN spaces.posted_to_x IS 'Whether summary has been posted to X';
COMMENT ON COLUMN spaces.x_post_id IS 'X post ID if posted';
COMMENT ON COLUMN spaces.x_posted_at IS 'When posted to X';
