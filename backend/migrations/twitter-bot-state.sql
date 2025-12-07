-- =====================================================
-- Twitter Bot State Table
-- Stores bot configuration and state in Supabase
-- =====================================================

-- Table to store bot state (like lastSeenId)
CREATE TABLE IF NOT EXISTS bot_state (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE bot_state ENABLE ROW LEVEL SECURITY;

-- Allow all operations (same as other tables)
CREATE POLICY "Allow all operations on bot_state"
  ON bot_state
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Insert initial state
INSERT INTO bot_state (key, value) VALUES ('twitter_last_seen_id', NULL)
ON CONFLICT (key) DO NOTHING;

-- Function to get bot state value
CREATE OR REPLACE FUNCTION get_bot_state(p_key TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN (SELECT value FROM bot_state WHERE key = p_key);
END;
$$ LANGUAGE plpgsql;

-- Function to set bot state value
CREATE OR REPLACE FUNCTION set_bot_state(p_key TEXT, p_value TEXT)
RETURNS VOID AS $$
BEGIN
  INSERT INTO bot_state (key, value, updated_at)
  VALUES (p_key, p_value, NOW())
  ON CONFLICT (key) 
  DO UPDATE SET value = p_value, updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
