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

export interface SummaryState {
  timestamp: number
  documentSummary: string
  statements: string[]
  questions: string[]
  followUpQuestions: FollowUpQuestion[]
  documentType?: string
}

const SUMMARY_PROMPT = `You are a meeting/session observer AI analyzing a live discussion.

You receive two streams of data:
1. TRANSCRIPT: What people are saying (speech-to-text)
2. VISUAL: What's on screen (OCR from captured screen area)

Based on these inputs and the previous state, generate an updated summary.
IMPORTANT: You must write your entire response in the following language: {target_language}

PREVIOUS STATE:
{previous_summary}

RECENT TRANSCRIPT (last 30s):
{recent_transcript}

RECENT VISUAL NOTES (last 30s):
{recent_visual}

Generate a JSON response with EXACTLY this structure:
{
  "documentSummary": "A DETAILED, comprehensive markdown document summarizing the ENTIRE session from the beginning. Write it like professional meeting minutes. CRITICAL: You MUST include at least one Mermaid.js diagram visualizing a key process, architecture, decision tree, or complex relationship discussed in the meeting. Place it where it makes the most sense. Use '# Headers' for sections (e.g. Introduction, Discussion, Key Points, Conclusions), '## Subheaders' for topics, '- Bullet points' for details, and '| Tables |' for structured data. Include specific names, numbers, and quotes when available. The document should be at least 200-500 words and grow as the session progresses.",
  "statements": ["List of key statements, facts, or decisions made in the recent discussion"],
  "questions": ["List of questions raised in the RECENT 30s window ONLY"],
  "followUpQuestions": [
    {
      "question": "A smart, highly specific follow-up question the listener should ask the speaker to dig deeper or clarify the current topic.",
      "answer": null 
    }
  ]
}

Rules:
- Write the 'documentSummary' as a DETAILED and COMPREHENSIVE narrative. Do NOT be brief or overly concise. Include context, explanations, and specific details. It should read like professional meeting minutes that someone who missed the meeting could fully understand.
- Reference both what was said AND what was shown on screen.
- You MUST create a Mermaid diagram if the discussion involves any logical flows, systems, steps, algorithms, or connected ideas.
- The 'documentSummary' should be a continuously evolving narrative of the whole session, growing longer as more content is discussed.
- CRITICAL: For 'statements', you MUST KEEP ALL IMPORTANT ITEMS from the PREVIOUS STATE and APPEND any new ones from the recent transcript. Do NOT delete old statements just because they aren't in the recent 30s window.
- CRITICAL: For 'questions', generate ONLY questions that are relevant to the MOST RECENT 30-second window. Do NOT accumulate old questions from previous rounds. Fresh questions only.
- CRITICAL: For 'followUpQuestions', generate up to 3 NEW open questions with "answer": null that are relevant to the MOST RECENT discussion. If a previously suggested question has been ANSWERED in the recent discussion, keep it but set "answer" to the actual answer. Drop any old unanswered follow-up questions that are no longer relevant.
- ALWAYS respond ONLY with valid JSON, no markdown blocks or commentary.`

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
    let prompt = SUMMARY_PROMPT
      .replace('{target_language}', this.targetLanguage)
      .replace('{previous_summary}', previousSummary)
      .replace('{recent_transcript}', recentTranscripts || '(no recent speech)')
      .replace('{recent_visual}', recentVisual || '(no recent screen changes)')

    if (!shouldGenerateDocument) {
      // Instruct LLM to skip the documentSummary generation to save tokens and time
      prompt += `\n\nCRITICAL OVERRIDE: Skip generating the 'documentSummary' this time. Set "documentSummary": null. Focus ONLY on extracting statements, questions, and followUpQuestions.`
    } else {
      // For full document cycle, emphasize the document is the PRIMARY output
      prompt += `\n\nCRITICAL: This is a FULL DOCUMENT GENERATION cycle. The 'documentSummary' is the PRIMARY and most important output. Write it as a LONG, detailed professional document (at minimum 300-800 words). Cover ALL topics discussed throughout the entire session with rich detail, context, and structure. You MUST include a Mermaid.js diagram visualizing a key concept from the meeting. Use headers, subheaders, bullet lists, and tables where appropriate. Do NOT write a brief overview — write comprehensive meeting minutes. The statements, questions, and followUpQuestions are secondary.`
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
        result.questions = result.questions || []
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
        max_completion_tokens: isFullDocument ? 4000 : 800,
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
            maxOutputTokens: isFullDocument ? 4000 : 800,
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

  reset() {
    this.buffer = []
    this.summaryState = null
    this.lastSummaryTime = 0
    this.lastProcessedEntryTime = 0
  }
}
