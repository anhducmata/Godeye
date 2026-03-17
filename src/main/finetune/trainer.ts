import { getPool } from '../db/client'

export async function queueFinetuneData(sessionId: string, transcript: string, summary: string): Promise<void> {
  const pool = getPool()

  // Format as OpenAI fine-tuning training pair
  const trainingData = {
    messages: [
      {
        role: 'system',
        content: 'You are MeetSense, an AI that generates comprehensive meeting summaries from transcripts. Identify the document type, extract key statements, generate relevant questions, and produce a well-structured document.'
      },
      {
        role: 'user',
        content: `Generate a comprehensive meeting summary from this transcript:\n\n${transcript}`
      },
      {
        role: 'assistant',
        content: summary
      }
    ]
  }

  await pool.query(
    `INSERT INTO finetune_queue (session_id, training_data) VALUES ($1, $2)`,
    [sessionId, JSON.stringify(trainingData)]
  )

  console.log(`[FineTune] Queued training data for session ${sessionId}`)

  // Check if queue has enough data for a batch
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM finetune_queue WHERE status = 'pending'`
  )
  const pendingCount = parseInt(countResult.rows[0].count)
  console.log(`[FineTune] ${pendingCount} pending items in queue (batch threshold: 10)`)
}

export async function getPendingFinetuneCount(): Promise<number> {
  const pool = getPool()
  const result = await pool.query(`SELECT COUNT(*) FROM finetune_queue WHERE status = 'pending'`)
  return parseInt(result.rows[0].count)
}
