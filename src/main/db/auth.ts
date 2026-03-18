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
  total_tokens_in?: number
  total_tokens_out?: number
  total_cost?: number
  language?: string
}

export async function registerUser(email: string, password: string, displayName?: string): Promise<User> {
  const pool = getPool()
  const passwordHash = hashPassword(password)
  const result = await pool.query(
    `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING id, email, display_name, created_at, total_tokens_in, total_tokens_out, total_cost, language`,
    [email.toLowerCase().trim(), passwordHash, displayName || null]
  )
  return result.rows[0]
}

export async function loginUser(email: string, password: string): Promise<User | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT id, email, password_hash, display_name, created_at, total_tokens_in, total_tokens_out, total_cost, language FROM users WHERE email = $1`,
    [email.toLowerCase().trim()]
  )
  if (result.rows.length === 0) return null
  const row = result.rows[0]
  if (!verifyPassword(password, row.password_hash)) return null
  return { id: row.id, email: row.email, display_name: row.display_name, created_at: row.created_at, total_tokens_in: Number(row.total_tokens_in || 0), total_tokens_out: Number(row.total_tokens_out || 0), total_cost: Number(row.total_cost || 0), language: row.language || 'English' }
}

export async function getUserById(id: number): Promise<User | null> {
  const pool = getPool()
  const result = await pool.query(
    `SELECT id, email, display_name, created_at, total_tokens_in, total_tokens_out, total_cost, language FROM users WHERE id = $1`,
    [id]
  )
  if (!result.rows[0]) return null
  const row = result.rows[0]
  return { ...row, total_tokens_in: Number(row.total_tokens_in || 0), total_tokens_out: Number(row.total_tokens_out || 0), total_cost: Number(row.total_cost || 0), language: row.language || 'English' }
}

export async function addUserTokens(userId: number, tokensIn: number, tokensOut: number, cost: number): Promise<void> {
  const pool = getPool()
  await pool.query(
    `UPDATE users SET total_tokens_in = total_tokens_in + $2, total_tokens_out = total_tokens_out + $3, total_cost = total_cost + $4 WHERE id = $1`,
    [userId, tokensIn, tokensOut, cost]
  )
}

export async function updateUserLanguage(userId: number, language: string): Promise<void> {
  const pool = getPool()
  await pool.query(`UPDATE users SET language = $2 WHERE id = $1`, [userId, language])
}
