import { getPool } from './client'

export interface Session {
  id: string
  title: string | null
  document_type: string
  created_at: Date
  updated_at: Date
  duration_seconds: number | null
  s3_audio_key: string | null
  vector_store_file_id: string | null
  cost_cents: number
  status: string
}

export interface TranscriptRow {
  id: number
  session_id: string
  timestamp: number
  text: string
  source: string
  speaker: string | null
  start_sec: number
  end_sec: number
}

export async function createSession(title?: string): Promise<string> {
  const pool = getPool()
  const result = await pool.query(
    `INSERT INTO sessions (title) VALUES ($1) RETURNING id`,
    [title || null]
  )
  const id = result.rows[0].id
  console.log(`[DB] Session created: ${id}`)
  return id
}

export async function updateSession(id: string, updates: Partial<Session>): Promise<void> {
  const pool = getPool()
  const fields: string[] = []
  const values: any[] = []
  let idx = 1

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'created_at') continue
    fields.push(`${key} = $${idx}`)
    values.push(value)
    idx++
  }

  if (fields.length === 0) return
  fields.push(`updated_at = now()`)
  values.push(id)

  await pool.query(
    `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  )
}

export async function listSessions(limit = 50, offset = 0): Promise<Session[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM sessions ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return result.rows
}

export async function getSession(id: string): Promise<Session | null> {
  const pool = getPool()
  const result = await pool.query(`SELECT * FROM sessions WHERE id = $1`, [id])
  return result.rows[0] || null
}

export async function deleteSession(id: string): Promise<void> {
  const pool = getPool()
  // Delete related rows first (foreign key constraints)
  await pool.query(`DELETE FROM session_tags WHERE session_id = $1`, [id])
  await pool.query(`DELETE FROM transcripts WHERE session_id = $1`, [id])
  await pool.query(`DELETE FROM summaries WHERE session_id = $1`, [id])
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [id])
  console.log(`[DB] Session deleted (with related data): ${id}`)
}

export async function saveTranscripts(sessionId: string, transcripts: Omit<TranscriptRow, 'id' | 'session_id'>[]): Promise<void> {
  if (transcripts.length === 0) return
  const pool = getPool()
  const values: any[] = []
  const placeholders: string[] = []
  let idx = 1

  for (const t of transcripts) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6})`)
    values.push(sessionId, t.timestamp, t.text, t.source, t.speaker || null, t.start_sec, t.end_sec)
    idx += 7
  }

  await pool.query(
    `INSERT INTO transcripts (session_id, timestamp, text, source, speaker, start_sec, end_sec) VALUES ${placeholders.join(', ')}`,
    values
  )
  console.log(`[DB] Saved ${transcripts.length} transcripts for session ${sessionId}`)
}

export async function saveSummary(sessionId: string, summary: {
  document_summary: string
  statements: any[]
  facts: any[]
  questions: string[]
  unclear_points: any[]
  follow_ups: any[]
}): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO summaries (session_id, document_summary, statements, questions, follow_ups)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionId, summary.document_summary, JSON.stringify({ statements: summary.statements, facts: summary.facts, unclear_points: summary.unclear_points }), JSON.stringify(summary.questions), JSON.stringify(summary.follow_ups)]
  )
  console.log(`[DB] Summary saved for session ${sessionId}`)
}

export async function getSessionTranscripts(sessionId: string): Promise<TranscriptRow[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM transcripts WHERE session_id = $1 ORDER BY timestamp ASC`,
    [sessionId]
  )
  return result.rows
}

export interface SummaryRow {
  id: number
  session_id: string
  document_summary: string
  statements: string[]
  questions: string[]
  follow_ups: any[]
}

export async function getSessionSummary(sessionId: string): Promise<SummaryRow | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT * FROM summaries WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  // Parse JSON arrays if stored as strings
  return {
    ...row,
    statements: typeof row.statements === 'string' ? JSON.parse(row.statements) : (row.statements || []),
    questions: typeof row.questions === 'string' ? JSON.parse(row.questions) : (row.questions || []),
    follow_ups: typeof row.follow_ups === 'string' ? JSON.parse(row.follow_ups) : (row.follow_ups || [])
  }
}

export async function listSessionsWithTags(limit = 50, offset = 0): Promise<any[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT s.*,
       COALESCE(
         json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
         FILTER (WHERE t.id IS NOT NULL),
         '[]'
       ) AS tags
     FROM sessions s
     LEFT JOIN session_tags st ON st.session_id = s.id
     LEFT JOIN tags t ON t.id = st.tag_id
     GROUP BY s.id
     ORDER BY s.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  )
  return result.rows
}
