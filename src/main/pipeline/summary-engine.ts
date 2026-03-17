import { EventEmitter } from 'events'

/**
 * Live summary engine that merges audio transcription and visual OCR context,
 * then calls an LLM API to produce rolling summaries.
 */

export interface ContextEntry {
  timestamp: number
  type: 'transcript' | 'visual'
  content: string
}

export interface SummaryState {
  timestamp: number
  currentTopic: string
  summary: string
  decisions: string[]
  actionItems: string[]
  unresolvedQuestions: string[]
}

const SUMMARY_PROMPT = `You are a meeting/session observer AI. You receive two streams of data:
1. TRANSCRIPT: What people are saying (speech-to-text)
2. VISUAL: What's on screen (OCR from captured screen area)

Based on these inputs and the previous summary state, generate an updated summary.

PREVIOUS SUMMARY:
{previous_summary}

RECENT TRANSCRIPT (last 30s):
{recent_transcript}

RECENT VISUAL NOTES (last 30s):
{recent_visual}

Generate a JSON response with exactly this structure:
{
  "currentTopic": "What is currently being discussed/shown",
  "summary": "2-3 sentence summary of the session so far",
  "decisions": ["list of decisions made"],
  "actionItems": ["list of action items identified"],
  "unresolvedQuestions": ["questions that were raised but not answered"]
}

Rules:
- Be concise and specific
- Reference both what was said AND what was shown on screen
- If nothing new since last summary, keep previous values
- Extract action items even if not explicitly stated as such
- Respond ONLY with valid JSON, no markdown or commentary`

export class SummaryEngine extends EventEmitter {
  private buffer: ContextEntry[] = []
  private summaryState: SummaryState | null = null
  private lastSummaryTime = 0
  private summaryInterval: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private apiKey: string = ''
  private apiProvider: 'openai' | 'gemini' = 'openai'
  private bufferDurationMs = 15 * 60 * 1000 // Keep 15 min of context
  private refreshIntervalMs = 10_000 // Summarize every 10s

  constructor() {
    super()
  }

  configure(config: { apiKey: string; provider?: 'openai' | 'gemini' }) {
    this.apiKey = config.apiKey
    this.apiProvider = config.provider || 'openai'
  }

  addEntry(entry: ContextEntry) {
    this.buffer.push(entry)

    // Trim old entries
    const cutoff = Date.now() - this.bufferDurationMs
    this.buffer = this.buffer.filter(e => e.timestamp > cutoff)
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true

    this.summaryInterval = setInterval(async () => {
      if (!this.apiKey) return
      await this.generateSummary()
    }, this.refreshIntervalMs)
  }

  stop() {
    this.isRunning = false
    if (this.summaryInterval) {
      clearInterval(this.summaryInterval)
      this.summaryInterval = null
    }
  }

  private async generateSummary(): Promise<void> {
    const now = Date.now()
    const recentWindow = 30_000 // Last 30 seconds

    const recentTranscripts = this.buffer
      .filter(e => e.type === 'transcript' && e.timestamp > now - recentWindow)
      .map(e => e.content)
      .join('\n')

    const recentVisual = this.buffer
      .filter(e => e.type === 'visual' && e.timestamp > now - recentWindow)
      .map(e => e.content)
      .join('\n')

    if (!recentTranscripts && !recentVisual) return // Nothing new

    const previousSummary = this.summaryState
      ? JSON.stringify(this.summaryState, null, 2)
      : 'No previous summary (session just started)'

    const prompt = SUMMARY_PROMPT
      .replace('{previous_summary}', previousSummary)
      .replace('{recent_transcript}', recentTranscripts || '(no recent speech)')
      .replace('{recent_visual}', recentVisual || '(no recent screen changes)')

    try {
      let result: SummaryState | null = null

      if (this.apiProvider === 'openai') {
        result = await this.callOpenAI(prompt)
      } else {
        result = await this.callGemini(prompt)
      }

      if (result) {
        result.timestamp = now
        this.summaryState = result
        this.lastSummaryTime = now
        this.emit('summary', result)
      }
    } catch (err) {
      console.error('[SummaryEngine] Error:', err)
    }
  }

  private async callOpenAI(prompt: string): Promise<SummaryState | null> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a meeting summary assistant. Always respond with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 500,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    return JSON.parse(content) as SummaryState
  }

  private async callGemini(prompt: string): Promise<SummaryState | null> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 500,
            responseMimeType: 'application/json'
          }
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) return null

    return JSON.parse(content) as SummaryState
  }

  getState(): SummaryState | null {
    return this.summaryState
  }

  getBuffer(): ContextEntry[] {
    return [...this.buffer]
  }

  reset() {
    this.buffer = []
    this.summaryState = null
    this.lastSummaryTime = 0
  }
}
