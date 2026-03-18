import { Pool } from 'pg'
import { runMigrations } from './schema'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/meetsense'
    const isNeon = connectionString.includes('neon.tech')
    pool = new Pool({
      connectionString,
      max: 5,
      ssl: isNeon ? { rejectUnauthorized: false } : undefined
    })
    console.log(`[DB] PostgreSQL pool created${isNeon ? ' (Neon + SSL)' : ''}`)
  }
  return pool
}

export async function initDatabase(): Promise<void> {
  const p = getPool()
  try {
    await p.query('SELECT 1')
    console.log('[DB] Connected to PostgreSQL')
    await runMigrations(p)
  } catch (err) {
    console.error('[DB] Failed to connect:', err)
  }
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[DB] Pool closed')
  }
}
