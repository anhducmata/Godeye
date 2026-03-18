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

export interface FollowUpQuestion {
  question: string
  answer: string | null
}

export interface UnclearPoint {
  type: 'question' | 'risk' | 'dependency' | 'decision'
  text: string
}

export interface SummaryState {
  timestamp: number
  documentSummary: string
  statements: string[]
  facts: string[]
  questions: string[]
  unclear_points: UnclearPoint[]
  followUpQuestions: FollowUpQuestion[]
  documentType?: string
}

let _totalTokens = 0

const SUMMARY_PROMPT = `You are a meeting conversation analyzer.
Your job is to extract ONLY meaningful information from the conversation.
IMPORTANT: Write your entire response in: {target_language}
The session has been running for {elapsed_time} so far.

Ignore: greetings, filler words, repeated ideas, small talk.

You receive two streams of data:
1. TRANSCRIPT: What people are saying (speech-to-text)
2. VISUAL: What's on screen (OCR from captured screen area)

PREVIOUS STATE:
{previous_summary}

RECENT TRANSCRIPT (last 30s):
{recent_transcript}

RECENT VISUAL NOTES (last 30s):
{recent_visual}

Classify each meaningful item into:
- statement: ideas, opinions, suggestions, proposals
- fact: confirmed information, data, decisions, conclusions
- question: anything asked during the conversation
- unclear_point: unresolved issues that impact outcome

For unclear_point, also classify the sub-type:
- question: unanswered question
- risk: potential problem or concern
- dependency: something that blocks progress
- decision: a decision that needs to be made

Generate a JSON response with EXACTLY this structure:
{
  "documentSummary": "A concise markdown summary. Be PROPORTIONAL to what was discussed. Use # Headers and - Bullets. Only include Mermaid diagram if a process was actually discussed.",
  "statements": ["idea or opinion expressed - max 1 sentence each"],
  "facts": ["confirmed information or decision - max 1 sentence each"],
  "questions": ["question asked in the conversation - max 1 sentence each"],
  "unclear_points": [
    { "type": "risk", "text": "potential issue identified" },
    { "type": "dependency", "text": "something that blocks progress" },
    { "type": "decision", "text": "decision needed" },
    { "type": "question", "text": "unanswered question" }
  ],
  "followUpQuestions": [
    { "question": "A follow-up question relevant to the current topic.", "answer": null }
  ]
}

Rules:
- Keep each item SHORT (max 1 sentence). Remove redundancy. Focus on impact. Merge similar items.
- KEEP all items from PREVIOUS STATE and append new ones. Do NOT delete old items.
- For 'unclear_points': generate ONLY from the MOST RECENT 30-second window. Do NOT accumulate old entries.
- For 'followUpQuestions': up to 3 relevant open questions. If answered, keep with answer. Drop irrelevant old ones.
- Be CONCISE and PROPORTIONAL. Short transcript = short output.
- ALWAYS respond with valid JSON only, no markdown blocks or commentary.`

export class SummaryEngine extends EventEmitter {
  private buffer: ContextEntry[] = []
  private summaryState: SummaryState | null = null
  private lastSummaryTime = 0
  private summaryInterval: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private apiKey: string = ''
  private apiProvider: 'openai' | 'gemini' = 'openai'
  private targetLanguage = 'English'
  private bufferDurationMs = 15 * 60 * 1000 // Keep 15 min of context
  private refreshIntervalMs = 15_000 // Summarize every 15s
  private lastProcessedEntryTime = 0 // Track newest entry processed
  private lastDocumentSummaryTime = 0 // Track when the big Document was last merged

  constructor() {
    super()
    // Read API key from env as fallback
    if (process.env.OPENAI_API_KEY) {
      this.apiKey = process.env.OPENAI_API_KEY
      this.apiProvider = 'openai'
      console.log('[SummaryEngine] Using OPENAI_API_KEY from environment')
    }
  }

  configure(config: { apiKey: string; provider?: 'openai' | 'gemini'; language?: string }) {
    if (config.apiKey) {
      this.apiKey = config.apiKey
      this.apiProvider = config.provider || 'openai'
    }
    if (config.language) this.targetLanguage = config.language
    console.log(`[SummaryEngine] Configured: provider=${this.apiProvider}, lang=${this.targetLanguage}`)
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
    
    // Check for new data: is the newest entry in the buffer newer than our last process time?
    const newestEntryTime = this.buffer.length > 0 ? Math.max(...this.buffer.map(e => e.timestamp)) : 0
    if (newestEntryTime <= this.lastProcessedEntryTime) {
      return // No new data since last summary, skip generation to prevent hallucination/loops
    }

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

    const shouldGenerateDocument = (now - this.lastDocumentSummaryTime) >= 60_000

    // Construct the prompt conditionally
    const earliestEntry = this.buffer.length > 0 ? Math.min(...this.buffer.map(e => e.timestamp)) : now
    const elapsedSec = Math.round((now - earliestEntry) / 1000)
    const elapsedMin = Math.floor(elapsedSec / 60).toString().padStart(2, '0')
    const elapsedSecRem = (elapsedSec % 60).toString().padStart(2, '0')
    const elapsedTime = `${elapsedMin}:${elapsedSecRem}`

    let prompt = SUMMARY_PROMPT
      .replace('{target_language}', this.targetLanguage)
      .replace('{elapsed_time}', elapsedTime)
      .replace('{previous_summary}', previousSummary)
      .replace('{recent_transcript}', recentTranscripts || '(no recent speech)')
      .replace('{recent_visual}', recentVisual || '(no recent screen changes)')

    if (!shouldGenerateDocument) {
      // Instruct LLM to skip the documentSummary generation to save tokens and time
      prompt += `\n\nCRITICAL OVERRIDE: Skip generating the 'documentSummary' this time. Set "documentSummary": null. Focus ONLY on extracting statements, facts, questions, unclear_points, and followUpQuestions.`
    } else {
      // Full doc cycle — but still proportional
      prompt += `\n\nThis is a FULL DOCUMENT GENERATION cycle. Write a thorough but proportional documentSummary covering all topics discussed so far. Use markdown headers, bullets, and tables where helpful. Include a Mermaid diagram ONLY if a process or architecture was discussed. The length should match the amount of actual content discussed — do NOT inflate.`
    }

    try {
      let result: SummaryState | null = null

      if (this.apiProvider === 'openai') {
        result = await this.callOpenAI(prompt, shouldGenerateDocument)
      } else {
        result = await this.callGemini(prompt, shouldGenerateDocument)
      }

      if (result) {
        result.timestamp = now
        // Clean up arrays if AI returns null/undefined
        result.statements = result.statements || []
        result.facts = result.facts || []
        result.questions = result.questions || []
        result.unclear_points = result.unclear_points || []
        result.followUpQuestions = result.followUpQuestions || []

        // If we skipped doc generation, manually stitch the previous doc summary back in
        if (!shouldGenerateDocument && this.summaryState) {
          result.documentSummary = this.summaryState.documentSummary
        } else if (result.documentSummary) {
          // LLM actually generated a new doc summary
          this.lastDocumentSummaryTime = now
        }
        
        this.summaryState = result
        this.lastSummaryTime = now
        this.lastProcessedEntryTime = newestEntryTime // Mark these entries as processed
        this.emit('summary', result)
        console.log(`[SummaryEngine] Summary emitted! Document Generated: ${shouldGenerateDocument}`)
      }
    } catch (err) {
      console.error('[SummaryEngine] Failed to generate/parse summary:', err)
    }
  }

  private async callOpenAI(prompt: string, isFullDocument = false): Promise<SummaryState | null> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: isFullDocument ? 'gpt-5.4' : 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: 'You are a meeting summary assistant. Always respond with valid JSON.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_completion_tokens: isFullDocument ? 1500 : 500,
        response_format: { type: 'json_object' }
      })
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error(`[SummaryEngine] OpenAI API error body:`, errText)
      throw new Error(`OpenAI API error: ${response.status} ${errText}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (data.usage?.total_tokens) {
      _totalTokens += data.usage.total_tokens
      this.emit('tokens', _totalTokens)
    }
    if (!content) return null
    
    // Strip markdown codeblocks just in case the LLM didn't respect response_format strictly
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleanContent) as SummaryState
  }

  private async callGemini(prompt: string, isFullDocument = false): Promise<SummaryState | null> {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: isFullDocument ? 1500 : 500,
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
    if (data.usageMetadata?.totalTokenCount) {
      _totalTokens += data.usageMetadata.totalTokenCount
      this.emit('tokens', _totalTokens)
    }
    if (!content) return null

    // Strip markdown codeblocks
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleanContent) as SummaryState
  }

  getState(): SummaryState | null {
    return this.summaryState
  }

  getBuffer(): ContextEntry[] {
    return [...this.buffer]
  }

  getTokens(): number {
    return _totalTokens
  }

  reset() {
    this.buffer = []
    this.summaryState = null
    this.lastSummaryTime = 0
    this.lastProcessedEntryTime = 0
  }
}
