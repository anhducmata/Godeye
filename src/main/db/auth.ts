import { getPool } from './client'
import crypto from 'crypto'

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  const attempt = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex')
  return hash === attempt
}

export interface User {
  id: number
  email: string
  display_name: string | null
  created_at: string
}

export async function registerUser(email: string, password: string, displayName?: string): Promise<User> {
  const pool = getPool()
  const passwordHash = hashPassword(password)
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at`,
    [email.toLowerCase().trim(), passwordHash, displayName || null]
  )
  return result.rows[0]
}

export async function loginUser(email: string, password: string): Promise<User | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  if (!verifyPassword(password, row.password_hash)) return null
  return { id: row.id, email: row.email, display_name: row.display_name, created_at: row.created_at }
}

export async function getUserById(id: number): Promise<User | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT id, email, display_name, created_at FROM users WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}
