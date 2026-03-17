import { useState, useEffect, useCallback, useRef } from 'react'

export interface TranscriptEntry {
  id: string
  timestamp: number
  text: string
  start: number
  end: number
}

export interface VisualNote {
  id: string
  timestamp: number
  text: string
  thumbnail?: string
}

export interface SummaryData {
  timestamp: number
  currentTopic: string
  summary: string
  decisions: string[]
  actionItems: string[]
  unresolvedQuestions: string[]
}

// Web Speech API types (Chromium/Electron built-in)
interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList
  resultIndex: number
}

export function useTranscript() {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [visualNotes, setVisualNotes] = useState<VisualNote[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [isListening, setIsListening] = useState(false)

  const recognitionRef = useRef<any>(null)
  const startTimeRef = useRef(0)
  const entryCountRef = useRef(0)

  // Listen to IPC events from main process (sidecar fallback)
  useEffect(() => {
    window.godeye.onTranscript((entry: TranscriptEntry) => {
      setTranscripts(prev => [...prev, entry])
    })

    window.godeye.onVisualNote((note: VisualNote) => {
      setVisualNotes(prev => [...prev, note])
    })

    window.godeye.onSummary((data: SummaryData) => {
      setSummary(data)
    })

    return () => {
      window.godeye.removeAllListeners('transcript')
      window.godeye.removeAllListeners('visual-note')
      window.godeye.removeAllListeners('summary')
    }
  }, [])

  /** Start Web Speech API recognition */
  const startListening = useCallback(() => {
    // @ts-ignore — webkitSpeechRecognition is available in Chromium/Electron
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      console.error('[Transcript] Web Speech API not available')
      return
    }

    const recognition = new SpeechRecognition()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = '' // auto-detect language
    recognition.maxAlternatives = 1

    startTimeRef.current = Date.now()
    entryCountRef.current = 0

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          const text = result[0].transcript.trim()
          if (text) {
            entryCountRef.current++
            const elapsed = (Date.now() - startTimeRef.current) / 1000
            const entry: TranscriptEntry = {
              id: `ws-${Date.now()}-${entryCountRef.current}`,
              timestamp: Date.now(),
              text,
              start: elapsed,
              end: elapsed
            }
            setTranscripts(prev => [...prev, entry])
            console.log(`[Transcript] "${text}"`)
          }
        }
      }
    }

    recognition.onerror = (event: any) => {
      console.warn('[Transcript] Speech recognition error:', event.error)
      // 'no-speech' is common and harmless — just means silence was detected
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        // Retry on other errors
        setTimeout(() => {
          if (isListening) {
            try { recognition.start() } catch {}
          }
        }, 1000)
      }
    }

    recognition.onend = () => {
      // Auto-restart if still supposed to be listening
      if (isListening) {
        console.log('[Transcript] Recognition ended, restarting...')
        try { recognition.start() } catch {}
      }
    }

    try {
      recognition.start()
      recognitionRef.current = recognition
      setIsListening(true)
      console.log('[Transcript] ✅ Web Speech API started')
    } catch (err) {
      console.error('[Transcript] Failed to start:', err)
    }
  }, [isListening])

  /** Stop recognition */
  const stopListening = useCallback(() => {
    setIsListening(false)
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
      console.log('[Transcript] Stopped')
    }
  }, [])

  const clearAll = useCallback(() => {
    setTranscripts([])
    setVisualNotes([])
    setSummary(null)
  }, [])

  return {
    transcripts,
    visualNotes,
    summary,
    isListening,
    startListening,
    stopListening,
    clearAll
  }
}
