import { useState, useEffect, useCallback, useRef } from 'react'

export interface TranscriptEntry {
  id: string
  timestamp: number
  text: string
  start: number
  end: number
  source?: 'web' | 'whisper'
  audioBase64?: string
  audioUrl?: string
}

export interface VisualNote {
  id: string
  timestamp: number
  text: string
  thumbnail?: string
}

export interface FollowUpQuestion {
  question: string
  answer: string | null
}

export interface SummaryData {
  timestamp: number
  documentSummary: string
  statements: any[]
  facts: any[]
  questions: string[]
  unclear_points: any[]
  followUpQuestions: FollowUpQuestion[]
}

export function useTranscript() {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [interimTranscript, setInterimTranscript] = useState<string>('')
  const [interimWhisperTranscript, setInterimWhisperTranscript] = useState<string>('')
  const [visualNotes, setVisualNotes] = useState<VisualNote[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [postMeetingProcessing, setPostMeetingProcessing] = useState(false)
  const [tokenCount, setTokenCount] = useState(0)

  const recognitionRef = useRef<any>(null)
  const isListeningRef = useRef(false)
  const startTimeRef = useRef(0)
  const entryCountRef = useRef(0)

  // Listen to IPC events (Whisper / OpenAI transcription from main process)
  useEffect(() => {
    if (!window.meetsense) return
    window.meetsense.onTranscript((entry: TranscriptEntry) => {
      setTranscripts(prev => {
        // Two-Pass Deduplication: when a high-quality Whisper transcript arrives,
        // it covers the last ~5-10 seconds of audio. We remove any 'web' (mic) 
        // transcripts from that time window so we don't show duplicates.
        const whisperTime = entry.timestamp
        const deduplicated = prev.filter(t => {
          if (t.source !== 'web') return true
          const ageDiff = whisperTime - t.timestamp
          // Drop web transcripts that happened within the last 10 seconds of this Whisper result
          if (ageDiff >= 0 && ageDiff < 10000) return false
          return true
        })

        // Convert base64 audio to a playable Blob URL if present
        let audioUrl = entry.audioUrl
        if (entry.audioBase64 && !audioUrl) {
          try {
            const binaryString = window.atob(entry.audioBase64)
            const len = binaryString.length
            const bytes = new Uint8Array(len)
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            const blob = new Blob([bytes], { type: 'audio/wav' })
            audioUrl = URL.createObjectURL(blob)
          } catch (e) {
            console.error('Failed to parse audio base64', e)
          }
        }

        return [...deduplicated, { ...entry, source: entry.source || 'whisper', audioUrl }]
      })
    })
    // @ts-ignore - added to preload
    window.meetsense.onTranscriptInterim((data: { text: string; source: string }) => {
      setInterimWhisperTranscript(data.text)
    })
    window.meetsense.onVisualNote((note: VisualNote) => {
      setVisualNotes(prev => [...prev, note])
    })
    window.meetsense.onSummary((data: SummaryData) => {
      setSummary(data)
    })
    // @ts-ignore
    window.meetsense.onTokens?.((total: number) => {
      setTokenCount(total)
    })
    // @ts-ignore
    window.meetsense.onPostMeetingStatus((data: { processing: boolean }) => {
      setPostMeetingProcessing(data.processing)
    })
    return () => {
      window.meetsense.removeAllListeners('transcript')
      window.meetsense.removeAllListeners('transcript-interim')
      window.meetsense.removeAllListeners('visual-note')
      window.meetsense.removeAllListeners('summary')
      window.meetsense.removeAllListeners('post-meeting-status')
    }
  }, [])

  /** Start Web Speech API for mic transcription */
  const startListening = useCallback(() => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.warn('[Transcript] Web Speech API not available')
      return
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true // Enable instant typing preview
    recognition.maxAlternatives = 1

    startTimeRef.current = Date.now()
    entryCountRef.current = 0
    isListeningRef.current = true

    recognition.onstart = () => {
      console.log('[Transcript] ✅ Web Speech API listening (mic)')
    }

    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript

        if (result.isFinal) {
          if (text.trim()) {
            entryCountRef.current++
            const elapsed = (Date.now() - startTimeRef.current) / 1000
            setTranscripts(prev => [...prev, {
              id: `web-${Date.now()}-${entryCountRef.current}`,
              timestamp: Date.now(),
              text: text.trim(),
              start: elapsed,
              end: elapsed,
              source: 'web'
            }])
            console.log(`[Transcript] 🎤 "${text.trim()}"`)
          }
        } else {
          interim += text
        }
      }
      setInterimTranscript(interim)
    }

    recognition.onerror = (event: any) => {
      console.warn('[Transcript] Web Speech API Error:', event.error)
      // Stop looping if the network pipe crashes (common in Electron with system audio)
      if (event.error === 'network' || event.error === 'not-allowed') {
        isListeningRef.current = false
        setInterimTranscript('Instant transcription disabled (network error). Waiting for Whisper...')
        setTimeout(() => setInterimTranscript(''), 3000)
        return
      }

      if (event.error === 'no-speech' && isListeningRef.current) {
        setTimeout(() => { if (isListeningRef.current) try { recognition.start() } catch {} }, 500)
      }
    }

    recognition.onend = () => {
      if (isListeningRef.current) {
        // Use a longer backoff to prevent flooding the network process if it's failing
        setTimeout(() => { if (isListeningRef.current) try { recognition.start() } catch {} }, 1000)
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch (err) { console.error('[Transcript] Start failed:', err) }
  }, [])

  const stopListening = useCallback(() => {
    isListeningRef.current = false
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
      recognitionRef.current = null
    }
  }, [])

  const clearAll = useCallback(() => {
    setTranscripts([])
    setInterimTranscript('')
    setInterimWhisperTranscript('')
    setVisualNotes([])
    setSummary(null)
  }, [])

  return {
    transcripts, interimTranscript, interimWhisperTranscript, visualNotes, summary, postMeetingProcessing, tokenCount,
    startListening, stopListening, clearAll
  }
}
