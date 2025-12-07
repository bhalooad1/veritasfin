-- =====================================================
-- VERITAS - Twitter Spaces Fact-Checking Backend
-- Supabase Database Schema
-- =====================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- ENUMS
-- =====================================================

-- Fact check status for messages
CREATE TYPE fact_check_status AS ENUM (
  'pending',
  'processing',
  'completed',
  'failed'
);

-- Grok verdict types
CREATE TYPE verdict_type AS ENUM (
  'True',
  'False',
  'Misleading',
  'Unverified'
);

-- =====================================================
-- TABLES
-- =====================================================

-- Speakers table (Twitter/X users)
CREATE TABLE speakers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username TEXT UNIQUE NOT NULL, -- e.g., "@AdamBhaloo"
  display_name TEXT, -- e.g., "Adam Bhaloo"
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster username lookups
CREATE INDEX idx_speakers_username ON speakers(username);

-- Spaces table (Twitter Spaces sessions)
CREATE TABLE spaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT, -- Optional user-provided title
  space_url TEXT, -- Twitter/X Space URL
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  ended_at TIMESTAMP WITH TIME ZONE,
  total_messages INTEGER DEFAULT 0,
  overall_credibility_score INTEGER DEFAULT 100,
  metadata JSONB DEFAULT '{}'::jsonb, -- Extra info (participant count, etc.)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster queries
CREATE INDEX idx_spaces_started_at ON spaces(started_at DESC);
CREATE INDEX idx_spaces_ended_at ON spaces(ended_at DESC NULLS FIRST);

-- Messages table (Caption blocks with fact-checking results)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  speaker_id UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,
  content TEXT NOT NULL, -- The actual message text
  sequence_number INTEGER NOT NULL, -- Order within the Space

  -- Fact-checking fields
  fact_check_status fact_check_status DEFAULT 'pending',
  grok_verdict verdict_type,
  grok_explanation TEXT,
  credibility_score INTEGER, -- Running score after this message
  grok_response_raw JSONB, -- Full Grok API response

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  processed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  CONSTRAINT messages_space_sequence UNIQUE (space_id, sequence_number)
);

-- Create indexes for faster queries
CREATE INDEX idx_messages_space_id ON messages(space_id);
CREATE INDEX idx_messages_speaker_id ON messages(speaker_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_sequence ON messages(space_id, sequence_number);
CREATE INDEX idx_messages_status ON messages(fact_check_status);

-- =====================================================
-- FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to increment total_messages in spaces
CREATE OR REPLACE FUNCTION increment_space_message_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE spaces
  SET total_messages = total_messages + 1
  WHERE id = NEW.space_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Function to get or create speaker
CREATE OR REPLACE FUNCTION get_or_create_speaker(
  p_username TEXT,
  p_display_name TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_speaker_id UUID;
BEGIN
  -- Try to find existing speaker
  SELECT id INTO v_speaker_id
  FROM speakers
  WHERE username = p_username;

  -- If not found, create new speaker
  IF v_speaker_id IS NULL THEN
    INSERT INTO speakers (username, display_name)
    VALUES (p_username, p_display_name)
    RETURNING id INTO v_speaker_id;
  END IF;

  RETURN v_speaker_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get next sequence number for a space
CREATE OR REPLACE FUNCTION get_next_sequence_number(p_space_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_max_seq INTEGER;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) INTO v_max_seq
  FROM messages
  WHERE space_id = p_space_id;

  RETURN v_max_seq + 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger to update updated_at on speakers
CREATE TRIGGER update_speakers_updated_at
  BEFORE UPDATE ON speakers
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on spaces
CREATE TRIGGER update_spaces_updated_at
  BEFORE UPDATE ON spaces
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to update updated_at on messages
CREATE TRIGGER update_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Trigger to increment message count when new message is added
CREATE TRIGGER increment_space_messages
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION increment_space_message_count();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE speakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- For now, allow all operations (you can restrict this later with auth)
-- This allows anonymous access which is fine for MVP

-- Speakers policies
CREATE POLICY "Allow all operations on speakers"
  ON speakers
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Spaces policies
CREATE POLICY "Allow all operations on spaces"
  ON spaces
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Messages policies
CREATE POLICY "Allow all operations on messages"
  ON messages
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- VIEWS
-- =====================================================

-- View to get messages with speaker info
CREATE OR REPLACE VIEW messages_with_speakers AS
SELECT
  m.id,
  m.space_id,
  m.content,
  m.sequence_number,
  m.fact_check_status,
  m.grok_verdict,
  m.grok_explanation,
  m.credibility_score,
  m.created_at,
  m.processed_at,
  s.username AS speaker_username,
  s.display_name AS speaker_display_name
FROM messages m
JOIN speakers s ON m.speaker_id = s.id
ORDER BY m.space_id, m.sequence_number;

-- View to get space summary statistics
CREATE OR REPLACE VIEW space_statistics AS
SELECT
  s.id AS space_id,
  s.title,
  s.started_at,
  s.ended_at,
  s.total_messages,
  s.overall_credibility_score,
  COUNT(DISTINCT m.speaker_id) AS unique_speakers,
  COUNT(CASE WHEN m.grok_verdict = 'True' THEN 1 END) AS true_count,
  COUNT(CASE WHEN m.grok_verdict = 'False' THEN 1 END) AS false_count,
  COUNT(CASE WHEN m.grok_verdict = 'Misleading' THEN 1 END) AS misleading_count,
  COUNT(CASE WHEN m.grok_verdict = 'Unverified' THEN 1 END) AS unverified_count,
  COUNT(CASE WHEN m.fact_check_status = 'completed' THEN 1 END) AS completed_count,
  COUNT(CASE WHEN m.fact_check_status = 'pending' THEN 1 END) AS pending_count
FROM spaces s
LEFT JOIN messages m ON s.id = m.space_id
GROUP BY s.id, s.title, s.started_at, s.ended_at, s.total_messages, s.overall_credibility_score;

-- =====================================================
-- HELPER FUNCTIONS FOR API
-- =====================================================

-- Function to create a new space
CREATE OR REPLACE FUNCTION create_space(
  p_title TEXT DEFAULT NULL,
  p_space_url TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_space_id UUID;
BEGIN
  INSERT INTO spaces (title, space_url, metadata)
  VALUES (p_title, p_space_url, p_metadata)
  RETURNING id INTO v_space_id;

  RETURN v_space_id;
END;
$$ LANGUAGE plpgsql;

-- Function to end a space
CREATE OR REPLACE FUNCTION end_space(p_space_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE spaces
  SET ended_at = NOW()
  WHERE id = p_space_id AND ended_at IS NULL;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to create a message with auto-sequence
CREATE OR REPLACE FUNCTION create_message(
  p_space_id UUID,
  p_speaker_username TEXT,
  p_speaker_display_name TEXT,
  p_content TEXT
)
RETURNS UUID AS $$
DECLARE
  v_speaker_id UUID;
  v_message_id UUID;
  v_sequence_number INTEGER;
BEGIN
  -- Get or create speaker
  v_speaker_id := get_or_create_speaker(p_speaker_username, p_speaker_display_name);

  -- Get next sequence number
  v_sequence_number := get_next_sequence_number(p_space_id);

  -- Create message
  INSERT INTO messages (space_id, speaker_id, content, sequence_number)
  VALUES (p_space_id, v_speaker_id, p_content, v_sequence_number)
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$ LANGUAGE plpgsql;

-- Function to update message with fact-check results
CREATE OR REPLACE FUNCTION update_message_fact_check(
  p_message_id UUID,
  p_verdict verdict_type,
  p_explanation TEXT,
  p_credibility_score INTEGER,
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

-- =====================================================
-- SAMPLE DATA (Optional - for testing)
-- =====================================================

-- Uncomment below to insert sample data

/*
-- Create a sample space
SELECT create_space('Test Space Discussion', 'https://x.com/i/spaces/example');

-- Create sample speakers
SELECT get_or_create_speaker('@AdamBhaloo', 'Adam Bhaloo');
SELECT get_or_create_speaker('@neelj23', 'Neel Jain');

-- You can now use these via your API
*/

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Additional composite indexes for common queries
CREATE INDEX idx_messages_space_status ON messages(space_id, fact_check_status);
CREATE INDEX idx_messages_space_created ON messages(space_id, created_at DESC);

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE speakers IS 'Stores Twitter/X user information for speakers in Spaces';
COMMENT ON TABLE spaces IS 'Stores Twitter Spaces sessions being tracked';
COMMENT ON TABLE messages IS 'Stores individual message blocks with fact-checking results';

COMMENT ON COLUMN messages.sequence_number IS 'Order of message within the Space (1, 2, 3, ...)';
COMMENT ON COLUMN messages.grok_response_raw IS 'Full JSON response from Grok API for debugging';
COMMENT ON COLUMN spaces.overall_credibility_score IS 'Running credibility score (starts at 100, decreases with false claims)';

-- =====================================================
-- COMPLETION MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Veritas database schema created successfully!';
  RAISE NOTICE 'Tables created: speakers, spaces, messages';
  RAISE NOTICE 'Views created: messages_with_speakers, space_statistics';
  RAISE NOTICE 'Helper functions ready: create_space, create_message, etc.';
END $$;
