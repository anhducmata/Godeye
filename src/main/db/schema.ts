import { Pool } from 'pg'

export async function runMigrations(pool: Pool): Promise<void> {
  console.log('[DB] Running migrations...')

  await pool.query(`CREATE EXTENSION IF NOT EXISTS unaccent`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT,
      document_type TEXT DEFAULT 'general',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now(),
      duration_seconds INTEGER,
      s3_audio_key TEXT,
      vector_store_file_id TEXT,
      cost_cents INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS transcripts (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      timestamp BIGINT,
      text TEXT,
      source TEXT,
      speaker TEXT,
      start_sec REAL,
      end_sec REAL
    );

    CREATE TABLE IF NOT EXISTS summaries (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      document_summary TEXT,
      statements JSONB DEFAULT '[]',
      questions JSONB DEFAULT '[]',
      follow_ups JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tags (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#f0a030'
    );

    CREATE TABLE IF NOT EXISTS session_tags (
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS finetune_queue (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES sessions(id),
      training_data JSONB,
      status TEXT DEFAULT 'pending',
      job_id TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS speaker_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#f0a030',
      sample_text TEXT,
      session_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS session_speakers (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
      diarize_label TEXT,
      speaker_profile_id INTEGER REFERENCES speaker_profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id);
    CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_tags_session ON session_tags(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_speakers_session ON session_speakers(session_id);
  `)

  // Add lifetime token tracking columns to users (safe to re-run)
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_tokens_in BIGINT DEFAULT 0`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_tokens_out BIGINT DEFAULT 0`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_cost NUMERIC(12,6) DEFAULT 0`)
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English'`)
  } catch (err) {
    console.warn('[DB] Migration columns skipped:', err)
  }

  console.log('[DB] Migrations complete')
}
