import { EventEmitter } from 'events'
import crypto from 'crypto'

/**
 * Transcribes system audio using OpenAI Whisper API.
 * Buffers PCM16 audio chunks and sends to the API every N seconds.
 */

export interface WhisperResult {
  id: string
  text: string
  timestamp: number
  audioBase64?: string
}

export class WhisperTranscriber extends EventEmitter {
  private apiKey: string = ''
  private buffer: Int16Array[] = []
  private bufferSamples = 0
  private sampleRate = 16000
  private checkIntervalMs = 500 // Check audio levels every 500ms
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private minSamples: number // Minimum samples to send (10 seconds target)
  private maxSamples: number // Max samples to buffer before force flush (20 seconds)
  private lastTranscribedText: string = ''

  constructor() {
    super()
    this.minSamples = this.sampleRate * 10 // target 10 seconds
    this.maxSamples = this.sampleRate * 20 // max 20 seconds
  }

  configure(apiKey: string, sampleRate = 16000) {
    this.apiKey = apiKey
    this.sampleRate = sampleRate
    this.minSamples = sampleRate * 10
    this.maxSamples = sampleRate * 20
    console.log(`[WhisperTranscriber] Configured: sampleRate=${sampleRate}`)
  }

  private languageCode: string = ''

  setLanguage(lang: string) {
    // Map display names to ISO 639-1 codes for Whisper API
    const langMap: Record<string, string> = {
      'English': 'en', 'Vietnamese': 'vi', 'Spanish': 'es', 'French': 'fr',
      'German': 'de', 'Japanese': 'ja', 'Korean': 'ko', 'Chinese (Simplified)': 'zh'
    }
    this.languageCode = langMap[lang] || ''
    console.log(`[WhisperTranscriber] Language set: ${lang} → ${this.languageCode || 'auto'}`)
  }

  /** Add a PCM16 audio chunk to the buffer */
  addChunk(pcmData: Buffer) {
    const int16 = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength / 2)
    this.buffer.push(int16)
    this.bufferSamples += int16.length
  }

  start() {
    if (this.isRunning) return
    if (!this.apiKey) {
      console.warn('[WhisperTranscriber] No API key set, cannot start')
      return
    }
    this.isRunning = true
    this.buffer = []
    this.bufferSamples = 0

    // Instead of blind flushing, we run a high-frequency loop to check for silence
    this.checkTimer = setInterval(() => this.checkForPauseAndFlush(), this.checkIntervalMs)
    console.log('[WhisperTranscriber] Started, checking for VAD pauses every', this.checkIntervalMs, 'ms')
  }

  stop() {
    this.isRunning = false
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    // Final flush
    this.flush()
    console.log('[WhisperTranscriber] Stopped')
  }

  private checkForPauseAndFlush() {
    if (this.buffer.length === 0 || this.bufferSamples < this.minSamples) return

    let shouldFlush = false

    // 1. Force flush if we hit the maximum buffer size (e.g. 12s)
    if (this.bufferSamples >= this.maxSamples) {
      shouldFlush = true
    } else if (this.bufferSamples >= this.minSamples) {
      // 2. VAD: Voice Activity Detection. Target chunk size 4-8s. Check the LAST 0.5s of audio for silence.
      // If the speaker paused to take a breath, we flush now.
      const silenceWindowSamples = Math.floor(this.sampleRate * 0.5)
      
      // Extract the tail samples to check energy
      const tailData = new Int16Array(silenceWindowSamples)
      let copied = 0
      let i = this.buffer.length - 1
      
      while (i >= 0 && copied < silenceWindowSamples) {
        const chunk = this.buffer[i]
        const need = silenceWindowSamples - copied
        const toTake = Math.min(chunk.length, need)
        
        const offset = chunk.length - toTake
        tailData.set(chunk.subarray(offset, chunk.length), silenceWindowSamples - copied - toTake)
        copied += toTake
        i--
      }

      // Calculate RMS energy of the tail
      let sumSquares = 0
      for (let j = 0; j < copied; j++) {
        const sample = tailData[j] / 32768.0
        sumSquares += sample * sample
      }
      const tailRms = Math.sqrt(sumSquares / copied)

      // If the last 0.5s is silence, naturally split the phrase here
      if (tailRms < 0.01) {
        shouldFlush = true
      }
    }

    if (shouldFlush) {
      this.flush()
    }
  }

  private async flush() {
    if (this.buffer.length === 0 || this.bufferSamples < this.minSamples) return

    // Merge all chunks into one buffer
    const totalSamples = this.bufferSamples
    const merged = new Int16Array(totalSamples)
    let offset = 0
    for (const chunk of this.buffer) {
      merged.set(chunk, offset)
      offset += chunk.length
    }

    // Clear buffer
    this.buffer = []
    this.bufferSamples = 0

    // Calculate Root Mean Square (RMS) energy to detect genuine audio/speech vs noise
    let sumSquares = 0
    for (let i = 0; i < merged.length; i++) {
      const sample = merged[i] / 32768.0 // Normalize to [-1, 1]
      sumSquares += sample * sample
    }
    const rms = Math.sqrt(sumSquares / merged.length)
    
    // threshold of 0.005 is equivalent to ~163 in 16-bit PCM, but RMS is an average energy, 
    // which is much more robust than checking the single max amplitude.
    if (rms < 0.005) {
      // Audio is too quiet (background noise/silence), skip to prevent API hallucination
      return
    }

    console.log(`[WhisperTranscriber] Sending ${totalSamples} samples (${(totalSamples / this.sampleRate).toFixed(1)}s), RMS=${rms.toFixed(4)}`)

    // Convert PCM16 to WAV
    const wavBuffer = this.pcm16ToWav(merged, this.sampleRate)

    // Call OpenAI Whisper API
    try {
      let text = await this.callWhisperAPI(wavBuffer, 'gpt-4o-mini-transcribe')
      
      if (text && text.trim()) {
        let cleanText = text.trim()
        const textLower = cleanText.toLowerCase()
        const blacklist = ["đăng ký kênh", "like và subscribe", "ủng hộ kênh", "ghiền mì gõ", "cảm ơn các bạn đã theo dõi", "cảm ơn các bạn"]
        
        // Suspicious chunk detection
        const isSuspicious = 
          blacklist.some(phrase => textLower.includes(phrase)) ||
          cleanText === this.lastTranscribedText

        if (isSuspicious) {
          console.log(`[WhisperTranscriber] ⚠️ Suspicious chunk detected (duplicate or canned phrase). Retrying with gpt-4o-transcribe...`)
          text = await this.callWhisperAPI(wavBuffer, 'gpt-4o-transcribe')
          cleanText = text ? text.trim() : ''
        }
        
        if (cleanText) {
          this.lastTranscribedText = cleanText

          const result: WhisperResult = {
            id: `wh-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`,
            text: cleanText,
            timestamp: Date.now(),
            audioBase64: wavBuffer.toString('base64')
          }
          console.log(`[WhisperTranscriber] ✅ "${result.text}" (with audio)`)
          this.emit('transcription', result)
        }
      }
    } catch (err: any) {
      console.error('[WhisperTranscriber] API error:', err?.message || err)
    }
  }

  private async callWhisperAPI(wavBuffer: Buffer, model: string): Promise<string> {
    // Build multipart form data manually
    const boundary = '----FormBoundary' + crypto.randomUUID().replace(/-/g, '')

    const parts: Buffer[] = []

    // File part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n` +
      `Content-Type: audio/wav\r\n\r\n`
    ))
    parts.push(wavBuffer)
    parts.push(Buffer.from('\r\n'))

    // Model part
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${model}\r\n`
    ))

    // Prompt (forces model away from YouTube vlog style)
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="prompt"\r\n\r\n` +
      `This is a professional business meeting. The conversation is clear and direct.\r\n`
    ))

    // Response format
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="response_format"\r\n\r\n` +
      `text\r\n`
    ))

    // Temperature (reduces randomness/hallucinations)
    parts.push(Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="temperature"\r\n\r\n` +
      `0\r\n`
    ))

    // Language (helps Whisper pick the correct language)
    if (this.languageCode) {
      parts.push(Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="language"\r\n\r\n` +
        `${this.languageCode}\r\n`
      ))
    }

    // End
    parts.push(Buffer.from(`--${boundary}--\r\n`))

    const body = Buffer.concat(parts)

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    })

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`Whisper API ${response.status}: ${errText}`)
    }

    return await response.text()
  }

  /** Convert PCM16 samples to WAV file buffer */
  private pcm16ToWav(samples: Int16Array, sampleRate: number): Buffer {
    const numChannels = 1
    const bitsPerSample = 16
    const bytesPerSample = bitsPerSample / 8
    const dataSize = samples.length * bytesPerSample
    const headerSize = 44
    const buffer = Buffer.alloc(headerSize + dataSize)

    // RIFF header
    buffer.write('RIFF', 0)
    buffer.writeUInt32LE(36 + dataSize, 4)
    buffer.write('WAVE', 8)

    // fmt chunk
    buffer.write('fmt ', 12)
    buffer.writeUInt32LE(16, 16)       // chunk size
    buffer.writeUInt16LE(1, 20)        // PCM format
    buffer.writeUInt16LE(numChannels, 22)
    buffer.writeUInt32LE(sampleRate, 24)
    buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
    buffer.writeUInt16LE(numChannels * bytesPerSample, 32)
    buffer.writeUInt16LE(bitsPerSample, 34)

    // data chunk
    buffer.write('data', 36)
    buffer.writeUInt32LE(dataSize, 40)

    // Copy PCM data
    const pcmBuffer = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
    pcmBuffer.copy(buffer, 44)

    return buffer
  }
}
