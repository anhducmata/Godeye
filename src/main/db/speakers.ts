import { getPool } from './client'

export interface SpeakerProfile {
  id: number
  name: string
  avatar_color: string
  sample_text: string | null
  session_count: number
  created_at: Date
  updated_at: Date
}

export async function createSpeakerProfile(name: string, sampleText?: string, avatarColor = '#f0a030'): Promise<SpeakerProfile> {
  const pool = getPool()
  const result = await pool.query(
    `INSERT INTO speaker_profiles (name, sample_text, avatar_color)
     VALUES ($1, $2, $3) RETURNING *`,
    [name, sampleText || null, avatarColor]
  )
  return result.rows[0]
}

export async function listSpeakerProfiles(): Promise<SpeakerProfile[]> {
  const pool = getPool()
  const result = await pool.query(`SELECT * FROM speaker_profiles ORDER BY session_count DESC, name ASC`)
  return result.rows
}

export async function updateSpeakerProfile(id: number, updates: { name?: string; sample_text?: string; avatar_color?: string }): Promise<void> {
  const pool = getPool()
  const fields: string[] = []
  const values: any[] = []
  let idx = 1

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = $${idx}`)
    values.push(value)
    idx++
  }

  if (fields.length === 0) return
  fields.push(`updated_at = now()`)
  values.push(id)

  await pool.query(`UPDATE speaker_profiles SET ${fields.join(', ')} WHERE id = $${idx}`, values)
}

export async function assignSpeakerToSession(sessionId: string, diarizeLabel: string, speakerProfileId: number): Promise<void> {
  const pool = getPool()
  // Upsert the mapping
  await pool.query(
    `INSERT INTO session_speakers (session_id, diarize_label, speaker_profile_id)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [sessionId, diarizeLabel, speakerProfileId]
  )
  // Increment session count
  await pool.query(
    `UPDATE speaker_profiles SET session_count = session_count + 1, updated_at = now() WHERE id = $1`,
    [speakerProfileId]
  )
}

export async function getSessionSpeakers(sessionId: string): Promise<Array<{ diarize_label: string; profile: SpeakerProfile }>> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT ss.diarize_label, sp.*
     FROM session_speakers ss
     JOIN speaker_profiles sp ON sp.id = ss.speaker_profile_id
     WHERE ss.session_id = $1`,
    [sessionId]
  )
  return result.rows.map((r: any) => ({
    diarize_label: r.diarize_label,
    profile: {
      id: r.id,
      name: r.name,
      avatar_color: r.avatar_color,
      sample_text: r.sample_text,
      session_count: r.session_count,
      created_at: r.created_at,
      updated_at: r.updated_at
    }
  }))
}
