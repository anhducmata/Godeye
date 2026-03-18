import { EventEmitter } from 'events'

/**
 * Live summary engine that merges audio transcription and visual OCR context,
 * then calls an LLM API to produce rolling summaries.
 * 
 * 3 independent cycles:
 *   1. EXTRACTION: every 5 transcript items or 20s — extracts new items
 *   2. COMPRESSION: every 2 min — deduplicates and merges accumulated items
 *   3. DOCUMENT: every 15s — generates the document summary
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
let _inputTokens = 0
let _outputTokens = 0
let _totalCost = 0

// Real OpenAI pricing per 1M tokens
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-5.4-nano':  { input: 0.10, output: 0.40 },
  'gpt-5.4-mini':  { input: 0.15, output: 0.60 },
}

// =============================================
// PROMPT: Extract new items from recent transcript
// =============================================
const EXTRACT_PROMPT = `You are a meeting conversation analyzer.
Extract ONLY meaningful NEW information from the RECENT transcript below.
IMPORTANT: Write your entire response in: {target_language}

Ignore: greetings, filler words, repeated ideas, small talk.

RECENT TRANSCRIPT:
{recent_transcript}

RECENT VISUAL NOTES:
{recent_visual}

Extract and classify each meaningful item:
- statement: ideas, opinions, suggestions, proposals
- fact: confirmed information, data, decisions, conclusions
- question: anything asked during the conversation
- unclear_point: unresolved issues (with sub-type: question, risk, dependency, decision)

Output JSON:
{
  "statements": ["new statement 1"],
  "facts": ["new fact 1"],
  "questions": ["new question 1"],
  "unclear_points": [{ "type": "risk", "text": "issue" }]
}

Rules:
- ONLY extract items from the transcript above. Do NOT invent or repeat.
- Keep each item SHORT (max 1 sentence).
- ALWAYS respond with valid JSON only.`

// =============================================
// PROMPT: Compress / deduplicate accumulated items
// =============================================
const COMPRESS_PROMPT = `You are a meeting conversation analyzer.
Compress and deduplicate the following accumulated items while keeping FULL MEANING.
IMPORTANT: Write your entire response in: {target_language}

CURRENT ITEMS:
{current_items}

Rules:
- Merge similar or duplicate items into one
- Remove redundant items
- Keep FULL meaning — do not lose important information
- Keep each item SHORT (max 1 sentence)
- Do NOT add new items that weren't in the input

Output JSON:
{
  "statements": ["compressed statements"],
  "facts": ["compressed facts"],
  "questions": ["compressed questions"],
  "unclear_points": [{ "type": "risk|dependency|decision|question", "text": "compressed item" }]
}

ALWAYS respond with valid JSON only.`

// =============================================
// PROMPT: Generate document summary
// =============================================
const DOCUMENT_PROMPT = `You are a meeting summary assistant.
Generate a concise markdown document summary based on the extracted items below.
IMPORTANT: Write your entire response in: {target_language}

The session has been running for {elapsed_time}.

STATEMENTS: {statements}
FACTS: {facts}
QUESTIONS: {questions}
UNCLEAR POINTS: {unclear_points}

PREVIOUS DOCUMENT:
{previous_document}

Generate a JSON response:
{
  "documentSummary": "A concise markdown summary. Use # Headers and - Bullets. Be PROPORTIONAL to content discussed. Only include Mermaid diagram if a process was actually discussed.",
  "followUpQuestions": [
    { "question": "relevant follow-up", "answer": null }
  ]
}

Rules:
- Be CONCISE and PROPORTIONAL. Short content = short summary.
- Up to 3 followUpQuestions. If answered previously, keep with answer.
- ALWAYS respond with valid JSON only.`

export class SummaryEngine extends EventEmitter {
  private buffer: ContextEntry[] = []
  private summaryState: SummaryState | null = null
  private isRunning = false
  private apiKey: string = ''
  private apiProvider: 'openai' | 'gemini' = 'openai'
  private targetLanguage = 'English'
  private bufferDurationMs = 15 * 60 * 1000 // Keep 15 min of buffer

  // Extraction cycle: every 5 items or 20s
  private lastExtractionTime = 0
  private lastExtractedEntryCount = 0
  private extractionCheckInterval: ReturnType<typeof setInterval> | null = null

  // Compression cycle: every 2 min
  private lastCompressionTime = 0
  private compressionInterval: ReturnType<typeof setInterval> | null = null

  // Document cycle: every 15s
  private documentInterval: ReturnType<typeof setInterval> | null = null
  private lastDocumentTime = 0

  // Lock to prevent concurrent API calls
  private isExtracting = false
  private isCompressing = false
  private isGeneratingDoc = false

  constructor() {
    super()
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

    // Check if extraction should trigger (5 new transcript items)
    if (this.isRunning && entry.type === 'transcript') {
      const transcriptCount = this.buffer.filter(e => e.type === 'transcript').length
      if (transcriptCount - this.lastExtractedEntryCount >= 5) {
        this.runExtraction()
      }
    }
  }

  start() {
    if (this.isRunning) return
    this.isRunning = true

    // Extraction check: every 5s, check if 20s has passed since last extraction
    this.extractionCheckInterval = setInterval(async () => {
      if (!this.apiKey) return
      const now = Date.now()
      if (now - this.lastExtractionTime >= 20_000) {
        await this.runExtraction()
      }
    }, 5_000)

    // Compression cycle: every 2 minutes
    this.compressionInterval = setInterval(async () => {
      if (!this.apiKey) return
      await this.runCompression()
    }, 120_000)

    // Document summary cycle: every 15 seconds
    this.documentInterval = setInterval(async () => {
      if (!this.apiKey) return
      await this.runDocumentSummary()
    }, 15_000)
  }

  stop() {
    this.isRunning = false
    if (this.extractionCheckInterval) { clearInterval(this.extractionCheckInterval); this.extractionCheckInterval = null }
    if (this.compressionInterval) { clearInterval(this.compressionInterval); this.compressionInterval = null }
    if (this.documentInterval) { clearInterval(this.documentInterval); this.documentInterval = null }
  }

  // =============================================
  // CYCLE 1: Extract new items from recent transcript
  // =============================================
  private async runExtraction(): Promise<void> {
    if (this.isExtracting) return
    this.isExtracting = true

    try {
      const now = Date.now()
      const windowMs = this.lastExtractionTime > 0 ? (now - this.lastExtractionTime) : 30_000

      const recentTranscripts = this.buffer
        .filter(e => e.type === 'transcript' && e.timestamp > now - windowMs)
        .map(e => e.content)
        .join('\n')

      const recentVisual = this.buffer
        .filter(e => e.type === 'visual' && e.timestamp > now - windowMs)
        .map(e => e.content)
        .join('\n')

      if (!recentTranscripts && !recentVisual) { this.isExtracting = false; return }

      const prompt = EXTRACT_PROMPT
        .replace('{target_language}', this.targetLanguage)
        .replace('{recent_transcript}', recentTranscripts || '(none)')
        .replace('{recent_visual}', recentVisual || '(none)')

      const result = await this.callLLM(prompt, false)

      if (result) {
        // Initialize state if needed
        if (!this.summaryState) {
          this.summaryState = {
            timestamp: now,
            documentSummary: '',
            statements: [],
            facts: [],
            questions: [],
            unclear_points: [],
            followUpQuestions: []
          }
        }

        // APPEND new items to existing state
        if (result.statements?.length) this.summaryState.statements.push(...result.statements)
        if (result.facts?.length) this.summaryState.facts.push(...result.facts)
        if (result.questions?.length) this.summaryState.questions = result.questions // Replace — only recent
        if (result.unclear_points?.length) this.summaryState.unclear_points = result.unclear_points // Replace — only recent

        this.summaryState.timestamp = now
        this.lastExtractionTime = now
        this.lastExtractedEntryCount = this.buffer.filter(e => e.type === 'transcript').length
        this.emit('summary', this.summaryState)
        console.log(`[SummaryEngine] Extraction: +${result.statements?.length || 0}S +${result.facts?.length || 0}F +${result.questions?.length || 0}Q`)
      }
    } catch (err) {
      console.error('[SummaryEngine] Extraction failed:', err)
    }
    this.isExtracting = false
  }

  // =============================================
  // CYCLE 2: Compress / deduplicate accumulated items
  // =============================================
  private async runCompression(): Promise<void> {
    if (this.isCompressing || !this.summaryState) return
    const totalItems = this.summaryState.statements.length + this.summaryState.facts.length
    if (totalItems < 5) return // Not enough to compress

    this.isCompressing = true

    try {
      const currentItems = JSON.stringify({
        statements: this.summaryState.statements,
        facts: this.summaryState.facts,
        questions: this.summaryState.questions,
        unclear_points: this.summaryState.unclear_points
      }, null, 2)

      const prompt = COMPRESS_PROMPT
        .replace('{target_language}', this.targetLanguage)
        .replace('{current_items}', currentItems)

      const result = await this.callLLM(prompt, false)

      if (result) {
        const before = totalItems
        this.summaryState.statements = result.statements || this.summaryState.statements
        this.summaryState.facts = result.facts || this.summaryState.facts
        if (result.unclear_points?.length) this.summaryState.unclear_points = result.unclear_points

        const after = this.summaryState.statements.length + this.summaryState.facts.length
        this.lastCompressionTime = Date.now()
        this.emit('summary', this.summaryState)
        console.log(`[SummaryEngine] Compression: ${before} → ${after} items`)
      }
    } catch (err) {
      console.error('[SummaryEngine] Compression failed:', err)
    }
    this.isCompressing = false
  }

  // =============================================
  // CYCLE 3: Generate document summary
  // =============================================
  private async runDocumentSummary(): Promise<void> {
    if (this.isGeneratingDoc || !this.summaryState) return
    const totalItems = this.summaryState.statements.length + this.summaryState.facts.length + this.summaryState.questions.length
    if (totalItems === 0) return

    this.isGeneratingDoc = true

    try {
      const now = Date.now()
      const earliestEntry = this.buffer.length > 0 ? Math.min(...this.buffer.map(e => e.timestamp)) : now
      const elapsedSec = Math.round((now - earliestEntry) / 1000)
      const elapsedTime = `${Math.floor(elapsedSec / 60).toString().padStart(2, '0')}:${(elapsedSec % 60).toString().padStart(2, '0')}`

      const prompt = DOCUMENT_PROMPT
        .replace('{target_language}', this.targetLanguage)
        .replace('{elapsed_time}', elapsedTime)
        .replace('{statements}', JSON.stringify(this.summaryState.statements))
        .replace('{facts}', JSON.stringify(this.summaryState.facts))
        .replace('{questions}', JSON.stringify(this.summaryState.questions))
        .replace('{unclear_points}', JSON.stringify(this.summaryState.unclear_points))
        .replace('{previous_document}', this.summaryState.documentSummary || '(none)')

      const result = await this.callLLM(prompt, true)

      if (result) {
        if (result.documentSummary) {
          this.summaryState.documentSummary = result.documentSummary
        }
        if (result.followUpQuestions?.length) {
          this.summaryState.followUpQuestions = result.followUpQuestions
        }
        this.summaryState.timestamp = now
        this.lastDocumentTime = now
        this.emit('summary', this.summaryState)
        console.log(`[SummaryEngine] Document summary updated`)
      }
    } catch (err) {
      console.error('[SummaryEngine] Document summary failed:', err)
    }
    this.isGeneratingDoc = false
  }

  // =============================================
  // LLM call (shared by all cycles)
  // =============================================
  private async callLLM(prompt: string, isFullDocument: boolean): Promise<any> {
    if (this.apiProvider === 'openai') {
      return this.callOpenAI(prompt, isFullDocument)
    } else {
      return this.callGemini(prompt, isFullDocument)
    }
  }

  private async callOpenAI(prompt: string, isFullDocument = false): Promise<any> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: isFullDocument ? 'gpt-5.4-mini' : 'gpt-5.4-nano',
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
    if (data.usage) {
      const inTok = data.usage.prompt_tokens || 0
      const outTok = data.usage.completion_tokens || 0
      _inputTokens += inTok
      _outputTokens += outTok
      _totalTokens += inTok + outTok
      const model = isFullDocument ? 'gpt-5.4-mini' : 'gpt-5.4-nano'
      const pricing = MODEL_PRICING[model] || MODEL_PRICING['gpt-5.4-nano']
      _totalCost += (inTok / 1_000_000) * pricing.input + (outTok / 1_000_000) * pricing.output
      this.emit('tokens', _totalTokens)
      this.emit('token-usage', { inputTokens: _inputTokens, outputTokens: _outputTokens, totalTokens: _totalTokens, cost: _totalCost })
    }
    if (!content) return null
    
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleanContent)
  }

  private async callGemini(prompt: string, isFullDocument = false): Promise<any> {
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
    if (data.usageMetadata) {
      const inTok = data.usageMetadata.promptTokenCount || 0
      const outTok = data.usageMetadata.candidatesTokenCount || 0
      _inputTokens += inTok
      _outputTokens += outTok
      _totalTokens += inTok + outTok
      // Gemini is free tier — no cost
      this.emit('tokens', _totalTokens)
      this.emit('token-usage', { inputTokens: _inputTokens, outputTokens: _outputTokens, totalTokens: _totalTokens, cost: _totalCost })
    }
    if (!content) return null

    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    return JSON.parse(cleanContent)
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

  getTokenUsage() {
    return { inputTokens: _inputTokens, outputTokens: _outputTokens, totalTokens: _totalTokens, cost: _totalCost }
  }

  reset() {
    this.buffer = []
    this.summaryState = null
    this.lastExtractionTime = 0
    this.lastExtractedEntryCount = 0
    this.lastCompressionTime = 0
    this.lastDocumentTime = 0
    _inputTokens = 0
    _outputTokens = 0
    _totalTokens = 0
    _totalCost = 0
  }
}
