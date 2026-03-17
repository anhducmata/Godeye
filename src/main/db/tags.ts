import { getPool } from './client'

export interface Tag {
  id: number
  name: string
  color: string
}

export async function createTag(name: string, color = '#f0a030'): Promise<Tag> {
  const pool = getPool()
  const result = await pool.query(
    `INSERT INTO tags (name, color) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET color = $2
     RETURNING *`,
    [name, color]
  )
  return result.rows[0]
}

export async function listTags(): Promise<Tag[]> {
  const pool = getPool()
  const result = await pool.query(`SELECT * FROM tags ORDER BY name ASC`)
  return result.rows
}

export async function deleteTag(id: number): Promise<void> {
  const pool = getPool()
  await pool.query(`DELETE FROM tags WHERE id = $1`, [id])
}

export async function tagSession(sessionId: string, tagId: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `INSERT INTO session_tags (session_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [sessionId, tagId]
  )
}

export async function untagSession(sessionId: string, tagId: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `DELETE FROM session_tags WHERE session_id = $1 AND tag_id = $2`,
    [sessionId, tagId]
  )
}

export async function getSessionTags(sessionId: string): Promise<Tag[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT t.* FROM tags t
     JOIN session_tags st ON st.tag_id = t.id
     WHERE st.session_id = $1
     ORDER BY t.name ASC`,
    [sessionId]
  )
  return result.rows
}

export async function getSessionsByTag(tagId: number): Promise<string[]> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT session_id FROM session_tags WHERE tag_id = $1`,
    [tagId]
  )
  return result.rows.map((r: any) => r.session_id)
}
