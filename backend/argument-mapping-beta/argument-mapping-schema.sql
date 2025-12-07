-- =====================================================
-- ARGUMENT MAPPING EXTENSION
-- Add-on schema for Veritas argument mapping feature
-- =====================================================

-- Claims extracted from messages
CREATE TABLE IF NOT EXISTS argument_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  speaker_id UUID NOT NULL REFERENCES speakers(id) ON DELETE CASCADE,

  -- Claim content
  claim_text TEXT NOT NULL,
  claim_type TEXT DEFAULT 'assertion' CHECK (claim_type IN ('assertion', 'evidence', 'reasoning')),

  -- Position within message
  start_position INTEGER DEFAULT 0,
  end_position INTEGER,

  -- Analysis metadata
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
  extraction_method TEXT DEFAULT 'ai', -- 'ai', 'manual', 'pattern'

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Simple relationships between claims
CREATE TABLE IF NOT EXISTS claim_relationships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,

  source_claim_id UUID NOT NULL REFERENCES argument_claims(id) ON DELETE CASCADE,
  target_claim_id UUID NOT NULL REFERENCES argument_claims(id) ON DELETE CASCADE,

  -- Relationship details
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('supports', 'attacks')),
  confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),

  -- Analysis metadata
  detection_method TEXT DEFAULT 'ai', -- 'ai', 'manual', 'semantic'
  explanation TEXT, -- Why this relationship exists

  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Prevent self-references and duplicate relationships
  CONSTRAINT no_self_reference CHECK (source_claim_id != target_claim_id),
  CONSTRAINT unique_relationship UNIQUE (source_claim_id, target_claim_id, relationship_type)
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Claims indexes
CREATE INDEX IF NOT EXISTS idx_claims_message_id ON argument_claims(message_id);
CREATE INDEX IF NOT EXISTS idx_claims_space_id ON argument_claims(space_id);
CREATE INDEX IF NOT EXISTS idx_claims_speaker_id ON argument_claims(speaker_id);
CREATE INDEX IF NOT EXISTS idx_claims_type ON argument_claims(claim_type);
CREATE INDEX IF NOT EXISTS idx_claims_created ON argument_claims(created_at DESC);

-- Relationships indexes
CREATE INDEX IF NOT EXISTS idx_relationships_source ON claim_relationships(source_claim_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON claim_relationships(target_claim_id);
CREATE INDEX IF NOT EXISTS idx_relationships_space ON claim_relationships(space_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON claim_relationships(relationship_type);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Update timestamp triggers
CREATE TRIGGER update_claims_updated_at
  BEFORE UPDATE ON argument_claims
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_relationships_updated_at
  BEFORE UPDATE ON claim_relationships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- VIEWS
-- =====================================================

-- Claims with speaker and message context
CREATE OR REPLACE VIEW claims_with_context AS
SELECT
  c.id,
  c.claim_text,
  c.claim_type,
  c.confidence,
  c.created_at,

  -- Message context
  m.content as message_content,
  m.truth_score,
  m.grok_verdict,
  m.sequence_number,

  -- Speaker context
  s.username as speaker_username,
  s.display_name as speaker_display_name,

  -- Space context
  sp.id as space_id,
  sp.title as space_title
FROM argument_claims c
JOIN messages m ON c.message_id = m.id
JOIN speakers s ON c.speaker_id = s.id
JOIN spaces sp ON c.space_id = sp.id
ORDER BY c.created_at;

-- Argument graph view - shows all relationships
CREATE OR REPLACE VIEW argument_graph AS
SELECT
  r.id as relationship_id,
  r.relationship_type,
  r.confidence as relationship_confidence,

  -- Source claim
  c1.id as source_claim_id,
  c1.claim_text as source_claim_text,
  c1.claim_type as source_claim_type,
  s1.username as source_speaker,
  s1.display_name as source_display_name,

  -- Target claim
  c2.id as target_claim_id,
  c2.claim_text as target_claim_text,
  c2.claim_type as target_claim_type,
  s2.username as target_speaker,
  s2.display_name as target_display_name,

  -- Space context
  sp.id as space_id,
  sp.title as space_title
FROM claim_relationships r
JOIN argument_claims c1 ON r.source_claim_id = c1.id
JOIN argument_claims c2 ON r.target_claim_id = c2.id
JOIN speakers s1 ON c1.speaker_id = s1.id
JOIN speakers s2 ON c2.speaker_id = s2.id
JOIN spaces sp ON r.space_id = sp.id;

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to extract claims from a message
CREATE OR REPLACE FUNCTION create_claim(
  p_message_id UUID,
  p_claim_text TEXT,
  p_claim_type TEXT DEFAULT 'assertion',
  p_confidence FLOAT DEFAULT 1.0,
  p_extraction_method TEXT DEFAULT 'ai'
)
RETURNS UUID AS $$
DECLARE
  v_claim_id UUID;
  v_space_id UUID;
  v_speaker_id UUID;
BEGIN
  -- Get space_id and speaker_id from message
  SELECT space_id, speaker_id INTO v_space_id, v_speaker_id
  FROM messages
  WHERE id = p_message_id;

  IF v_space_id IS NULL THEN
    RAISE EXCEPTION 'Message not found: %', p_message_id;
  END IF;

  -- Create claim
  INSERT INTO argument_claims (
    message_id, space_id, speaker_id,
    claim_text, claim_type, confidence, extraction_method
  )
  VALUES (
    p_message_id, v_space_id, v_speaker_id,
    p_claim_text, p_claim_type, p_confidence, p_extraction_method
  )
  RETURNING id INTO v_claim_id;

  RETURN v_claim_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create relationship between claims
CREATE OR REPLACE FUNCTION create_claim_relationship(
  p_source_claim_id UUID,
  p_target_claim_id UUID,
  p_relationship_type TEXT,
  p_confidence FLOAT DEFAULT 1.0,
  p_explanation TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_relationship_id UUID;
  v_space_id UUID;
BEGIN
  -- Get space_id from source claim
  SELECT space_id INTO v_space_id
  FROM argument_claims
  WHERE id = p_source_claim_id;

  IF v_space_id IS NULL THEN
    RAISE EXCEPTION 'Source claim not found: %', p_source_claim_id;
  END IF;

  -- Create relationship
  INSERT INTO claim_relationships (
    space_id, source_claim_id, target_claim_id,
    relationship_type, confidence, explanation
  )
  VALUES (
    v_space_id, p_source_claim_id, p_target_claim_id,
    p_relationship_type, p_confidence, p_explanation
  )
  RETURNING id INTO v_relationship_id;

  RETURN v_relationship_id;
END;
$$ LANGUAGE plpgsql;

-- Function to get argument graph for a space
CREATE OR REPLACE FUNCTION get_space_argument_graph(p_space_id UUID)
RETURNS TABLE (
  nodes JSONB,
  edges JSONB
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Nodes (claims)
    jsonb_agg(DISTINCT jsonb_build_object(
      'id', c.id,
      'text', c.claim_text,
      'type', c.claim_type,
      'speaker', s.username,
      'displayName', s.display_name,
      'confidence', c.confidence,
      'truthScore', m.truth_score,
      'messageId', c.message_id
    )) as nodes,

    -- Edges (relationships)
    COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
      'id', r.id,
      'source', r.source_claim_id,
      'target', r.target_claim_id,
      'type', r.relationship_type,
      'confidence', r.confidence
    )) FILTER (WHERE r.id IS NOT NULL), '[]'::jsonb) as edges

  FROM argument_claims c
  JOIN messages m ON c.message_id = m.id
  JOIN speakers s ON c.speaker_id = s.id
  LEFT JOIN claim_relationships r ON (c.id = r.source_claim_id OR c.id = r.target_claim_id)
  WHERE c.space_id = p_space_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================

-- Enable RLS
ALTER TABLE argument_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE claim_relationships ENABLE ROW LEVEL SECURITY;

-- Allow all operations (same as main tables)
CREATE POLICY "Allow all operations on argument_claims"
  ON argument_claims
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on claim_relationships"
  ON claim_relationships
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE argument_claims IS 'Individual claims extracted from speaker messages';
COMMENT ON TABLE claim_relationships IS 'Support/attack relationships between claims';

COMMENT ON COLUMN argument_claims.claim_text IS 'The actual claim statement extracted from message';
COMMENT ON COLUMN argument_claims.claim_type IS 'Type: assertion (main claim), evidence (supporting data), reasoning (warrant)';
COMMENT ON COLUMN claim_relationships.relationship_type IS 'How claims relate: supports or attacks';

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Argument mapping schema extension created successfully!';
  RAISE NOTICE 'Tables: argument_claims, claim_relationships';
  RAISE NOTICE 'Views: claims_with_context, argument_graph';
  RAISE NOTICE 'Functions: create_claim, create_claim_relationship, get_space_argument_graph';
END $$;