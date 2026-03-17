import { useState, useEffect, useCallback } from 'react'

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

export function useTranscript() {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([])
  const [visualNotes, setVisualNotes] = useState<VisualNote[]>([])
  const [summary, setSummary] = useState<SummaryData | null>(null)

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

  const clearAll = useCallback(() => {
    setTranscripts([])
    setVisualNotes([])
    setSummary(null)
  }, [])

  return {
    transcripts,
    visualNotes,
    summary,
    clearAll
  }
}
