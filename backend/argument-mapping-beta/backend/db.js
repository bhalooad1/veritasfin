import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'argument_mapping.db');

const db = new Database(dbPath);

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    start_time TEXT,
    last_update TEXT,
    statement_count INTEGER DEFAULT 0,
    context_summary TEXT  -- JSON string for running context summary
  );

  CREATE TABLE IF NOT EXISTS speakers (
    session_id TEXT,
    name TEXT,
    PRIMARY KEY (session_id, name),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    text TEXT,
    full_text TEXT,
    speaker TEXT,
    type TEXT,
    confidence REAL,
    theme TEXT,
    validity_score REAL,
    timestamp TEXT,
    metadata TEXT, -- JSON string
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS links (
    source TEXT,
    target TEXT,
    session_id TEXT,
    type TEXT,
    confidence REAL,
    explanation TEXT,
    PRIMARY KEY (source, target, session_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (source) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (target) REFERENCES nodes(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS evidence_chains (
    claim_id TEXT,
    session_id TEXT,
    chain_data TEXT, -- JSON string containing arguments, evidence, strength, etc.
    PRIMARY KEY (claim_id, session_id),
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

// Add context_summary column if it doesn't exist (migration)
try {
  db.exec(`ALTER TABLE sessions ADD COLUMN context_summary TEXT`);
} catch (e) {
  // Column already exists, ignore
}

console.log(`✓ SQLite database initialized at ${dbPath}`);

// Prepared statements
const insertSession = db.prepare('INSERT OR REPLACE INTO sessions (id, start_time, last_update, statement_count) VALUES (?, ?, ?, ?)');
const getSessionStmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
const getAllSessionsStmt = db.prepare('SELECT * FROM sessions ORDER BY last_update DESC');
const deleteSessionStmt = db.prepare('DELETE FROM sessions WHERE id = ?');
const deleteAllSessionsStmt = db.prepare('DELETE FROM sessions');

const insertSpeaker = db.prepare('INSERT OR IGNORE INTO speakers (session_id, name) VALUES (?, ?)');
const getSpeakersStmt = db.prepare('SELECT name FROM speakers WHERE session_id = ?');

const insertNode = db.prepare('INSERT OR REPLACE INTO nodes (id, session_id, text, full_text, speaker, type, confidence, theme, validity_score, timestamp, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const getNodesStmt = db.prepare('SELECT * FROM nodes WHERE session_id = ?');
const getNodeStmt = db.prepare('SELECT * FROM nodes WHERE id = ?');

const insertLink = db.prepare('INSERT OR REPLACE INTO links (source, target, session_id, type, confidence, explanation) VALUES (?, ?, ?, ?, ?, ?)');
const getLinksStmt = db.prepare('SELECT * FROM links WHERE session_id = ?');

const insertChain = db.prepare('INSERT OR REPLACE INTO evidence_chains (claim_id, session_id, chain_data) VALUES (?, ?, ?)');
const getChainsStmt = db.prepare('SELECT * FROM evidence_chains WHERE session_id = ?');

// Exported functions
export const dbOps = {
  createSession: (id) => {
    const now = new Date().toISOString();
    insertSession.run(id, now, now, 0);
    return { id, startTime: now, lastUpdate: now, statementCount: 0, speakers: [], contextSummary: null };
  },

  getSession: (id) => {
    const session = getSessionStmt.get(id);
    if (!session) return null;
    const speakers = getSpeakersStmt.all(id).map(s => s.name);
    return {
      id: session.id,
      startTime: session.start_time,
      lastUpdate: session.last_update,
      statementCount: session.statement_count,
      contextSummary: session.context_summary ? JSON.parse(session.context_summary) : null,
      speakers
    };
  },

  getAllSessions: () => {
    return getAllSessionsStmt.all().map(s => ({
      id: s.id,
      startTime: s.start_time,
      lastUpdate: s.last_update,
      statementCount: s.statement_count,
      contextSummary: s.context_summary ? JSON.parse(s.context_summary) : null,
      speakers: getSpeakersStmt.all(s.id).map(sp => sp.name)
    }));
  },

  updateSession: (id, statementCount) => {
    const now = new Date().toISOString();
    db.prepare('UPDATE sessions SET last_update = ?, statement_count = ? WHERE id = ?').run(now, statementCount, id);
  },

  updateContextSummary: (id, contextSummary) => {
    const summaryJson = JSON.stringify(contextSummary);
    db.prepare('UPDATE sessions SET context_summary = ? WHERE id = ?').run(summaryJson, id);
  },

  getContextSummary: (id) => {
    const session = getSessionStmt.get(id);
    if (!session || !session.context_summary) return null;
    return JSON.parse(session.context_summary);
  },

  addSpeaker: (sessionId, name) => {
    insertSpeaker.run(sessionId, name);
  },

  saveNode: (node, sessionId) => {
    insertNode.run(
      node.id,
      sessionId,
      node.text,
      node.fullText || node.text,
      node.speaker,
      node.type,
      node.confidence || 0.8,
      node.theme || 'general',
      node.validityScore || 0.5,
      node.timestamp || new Date().toISOString(),
      JSON.stringify(node.metadata || {})
    );
  },

  getNodes: (sessionId) => {
    return getNodesStmt.all(sessionId).map(n => ({
      ...n,
      fullText: n.full_text,
      validityScore: n.validity_score,
      metadata: JSON.parse(n.metadata)
    }));
  },

  saveLink: (link, sessionId) => {
    insertLink.run(
      link.source,
      link.target,
      sessionId,
      link.type,
      link.confidence || 0.8,
      link.explanation || ''
    );
  },

  getLinks: (sessionId) => {
    return getLinksStmt.all(sessionId);
  },

  saveChain: (chain, sessionId) => {
    insertChain.run(chain.claim, sessionId, JSON.stringify(chain));
  },

  getChains: (sessionId) => {
    return getChainsStmt.all(sessionId).map(c => JSON.parse(c.chain_data));
  },

  clearSession: (id) => {
    deleteSessionStmt.run(id);
  },

  clearAll: () => {
    deleteAllSessionsStmt.run();
  }
};
