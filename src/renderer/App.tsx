import React, { useRef, useEffect, useState } from 'react'
import { useCapture } from './hooks/useCapture'
import { useTranscript } from './hooks/useTranscript'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './components/MermaidBlock'
import { Sidebar, SidebarHandle } from './components/Sidebar'
import { ChatWidget } from './components/ChatWidget'
import { getTranslations } from './i18n'
import { Mic, Video, Camera, Music, Film, Image, FileText, ClipboardPaste, Square, ChevronDown, Volume2, ArrowUp, ArrowDown, CircleDollarSign, Play, X, Sparkles, Crop, Monitor } from 'lucide-react'

type AppView = 'sessions' | 'recording' | 'viewing' | 'search'

const THEMES: Record<string, { label: string; accent: string; preview: string; vars: Record<string, string> }> = {
  blue: {
    label: 'Default', accent: '#3b82f6', preview: 'linear-gradient(135deg, #09090b, #3b82f6)',
    vars: { '--bg': '#09090b', '--bg-card': '#111113', '--bg-hover': '#18181b', '--bg-input': '#141416', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#3b82f6', '--accent-2': '#60a5fa', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  light: {
    label: 'Light', accent: '#2563eb', preview: 'linear-gradient(135deg, #ffffff, #2563eb)',
    vars: { '--bg': '#f8f9fa', '--bg-card': '#ffffff', '--bg-hover': '#f0f1f3', '--bg-input': '#f4f4f5', '--border': 'rgba(0,0,0,0.08)', '--border-lit': 'rgba(0,0,0,0.12)', '--accent': '#2563eb', '--accent-2': '#3b82f6', '--text': '#18181b', '--text-2': '#52525b', '--text-3': '#a1a1aa' }
  },
  black: {
    label: 'Black', accent: '#ffffff', preview: 'linear-gradient(135deg, #000000, #333333)',
    vars: { '--bg': '#000000', '--bg-card': '#0a0a0a', '--bg-hover': '#141414', '--bg-input': '#0d0d0d', '--border': 'rgba(255,255,255,0.05)', '--border-lit': 'rgba(255,255,255,0.08)', '--accent': '#ffffff', '--accent-2': '#d4d4d8', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  anthropic: {
    label: 'Anthropic', accent: '#d97757', preview: 'linear-gradient(135deg, #faf6f1, #d97757)',
    vars: { '--bg': '#f5f0e8', '--bg-card': '#faf6f1', '--bg-hover': '#ede8e0', '--bg-input': '#f0ebe3', '--border': 'rgba(0,0,0,0.06)', '--border-lit': 'rgba(0,0,0,0.1)', '--accent': '#d97757', '--accent-2': '#c4613e', '--text': '#2d2017', '--text-2': '#6b5d50', '--text-3': '#a09585' }
  },
  emerald: {
    label: 'Emerald', accent: '#10b981', preview: 'linear-gradient(135deg, #09090b, #10b981)',
    vars: { '--bg': '#09090b', '--bg-card': '#0f1210', '--bg-hover': '#141a16', '--bg-input': '#101412', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#10b981', '--accent-2': '#34d399', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  rose: {
    label: 'Rose', accent: '#f43f5e', preview: 'linear-gradient(135deg, #09090b, #f43f5e)',
    vars: { '--bg': '#0b0909', '--bg-card': '#13100f', '--bg-hover': '#1b1516', '--bg-input': '#161011', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#f43f5e', '--accent-2': '#fb7185', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  amber: {
    label: 'Amber', accent: '#f59e0b', preview: 'linear-gradient(135deg, #09090b, #f59e0b)',
    vars: { '--bg': '#0b0a09', '--bg-card': '#131210', '--bg-hover': '#1b1a16', '--bg-input': '#161512', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#f59e0b', '--accent-2': '#fbbf24', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  cyan: {
    label: 'Cyan', accent: '#06b6d4', preview: 'linear-gradient(135deg, #09090b, #06b6d4)',
    vars: { '--bg': '#09090b', '--bg-card': '#0f1213', '--bg-hover': '#141a1b', '--bg-input': '#101416', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#06b6d4', '--accent-2': '#22d3ee', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  },
  violet: {
    label: 'Violet', accent: '#8b5cf6', preview: 'linear-gradient(135deg, #09090b, #8b5cf6)',
    vars: { '--bg': '#0a090b', '--bg-card': '#11101a', '--bg-hover': '#181620', '--bg-input': '#14131a', '--border': 'rgba(255,255,255,0.06)', '--border-lit': 'rgba(255,255,255,0.1)', '--accent': '#8b5cf6', '--accent-2': '#a78bfa', '--text': '#e4e4e7', '--text-2': '#a1a1aa', '--text-3': '#52525b' }
  }
}

interface LoadedSession {
  session: any
  transcripts: any[]
  summary: any
  tags: any[]
  speakers: any[]
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function App() {
  const {
    state, options, setOptions, elapsed,
    debugLogs, addDebugLog,
    startCapture, stopCapture,
    loadSources, selectArea, setSelectedSource, cropRegion, latestFrame
  } = useCapture()

  const { transcripts, interimTranscript, interimWhisperTranscript, summary, postMeetingProcessing, tokenCount, tokenUsage, clearAll, startListening, stopListening } = useTranscript()

  const [view, setView] = useState<AppView>('sessions')
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authTab, setAuthTab] = useState<'signin' | 'register'>('signin')
  const [showDebug, setShowDebug] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini'>('gemini')
  const [aiModel, setAiModel] = useState(() => {
    const saved = localStorage.getItem('meetsense-user')
    if (saved) {
      try { return JSON.parse(saved)?.aiModel || 'gpt-4o-mini' } catch { return 'gpt-4o-mini' }
    }
    return 'gpt-4o-mini'
  })
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('meetsense-user')
    if (saved) {
      try { return JSON.parse(saved)?.language || 'English' } catch { return 'English' }
    }
    return 'English'
  })
  const [colorTheme, setColorTheme] = useState(() => {
    const saved = localStorage.getItem('meetsense-theme')
    return saved && THEMES[saved] ? saved : 'blue'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchMode, setSearchMode] = useState<'fulltext' | 'exact'>('fulltext')
  const [newSessionType, setNewSessionType] = useState<string>('record-audio')
  const [showNewDropdown, setShowNewDropdown] = useState(false)
  const [showPasteModal, setShowPasteModal] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteAnalyzing, setPasteAnalyzing] = useState(false)
  const [sectionSummarizing, setSectionSummarizing] = useState(false)
  const [ttsAudio, setTtsAudio] = useState<HTMLAudioElement | null>(null)
  const [sectionSummaryText, setSectionSummaryText] = useState<string | null>(null)
  const [ttsTitle, setTtsTitle] = useState('')
  const [ttsChunks, setTtsChunks] = useState<string[]>([])
  const [ttsActiveChunk, setTtsActiveChunk] = useState(-1)
  const [showMagicPrompt, setShowMagicPrompt] = useState(false)
  const [magicPrompt, setMagicPrompt] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [colWidths, setColWidths] = useState([33.33, 33.33, 33.34])
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authConfirm, setAuthConfirm] = useState('')
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState('')
  const [currentUser, setCurrentUser] = useState<any>(() => {
    const saved = localStorage.getItem('meetsense-user')
    return saved ? JSON.parse(saved) : null
  })
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const t = getTranslations(language)

  const sidebarRef = useRef<SidebarHandle>(null)
  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const statementsEndRef = useRef<HTMLDivElement>(null)
  const summaryEndRef = useRef<HTMLDivElement>(null)
  const documentEndRef = useRef<HTMLDivElement>(null)
  const debugEndRef = useRef<HTMLDivElement>(null)

  // Apply color theme
  useEffect(() => {
    const theme = THEMES[colorTheme]
    if (!theme) return
    const root = document.documentElement
    Object.entries(theme.vars).forEach(([key, val]) => root.style.setProperty(key, val))
    localStorage.setItem('meetsense-theme', colorTheme)
  }, [colorTheme])

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts, interimTranscript, interimWhisperTranscript])

  useEffect(() => {
    statementsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [summary?.statements])

  useEffect(() => {
    summaryEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [summary?.questions])

  useEffect(() => {
    documentEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [summary?.documentSummary])

  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [debugLogs])

  // Auto-load the saved session when post-meeting processing completes
  const prevProcessingRef = useRef(false)
  useEffect(() => {
    // Only act on the transition from true → false (processing just finished)
    if (prevProcessingRef.current && !postMeetingProcessing) {
      // Load the completed session from DB so user sees full saved data
      setTimeout(async () => {
        sidebarRef.current?.refresh()
        try {
          const sessions = await window.meetsense?.listSessions()
          if (sessions?.length > 0) {
            const data = await window.meetsense?.getSession(sessions[0].id)
            if (data) {
              setLoadedSession(data)
              setView('viewing')
            }
          }
        } catch (err) {
          console.error('[App] Failed to auto-load completed session:', err)
        }
      }, 500)
    }
    prevProcessingRef.current = postMeetingProcessing
  }, [postMeetingProcessing])

  // Close new session dropdown on click outside
  useEffect(() => {
    if (!showNewDropdown) return
    const handleClick = () => setShowNewDropdown(false)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [showNewDropdown])

  const handleNewSession = async () => {
    if (newSessionType === 'paste-memory') {
      setShowPasteModal(true)
      return
    }
    await window.meetsense?.setApiKey({ apiKey, provider: apiProvider, language })
    clearAll()

    // For record-video: auto-enable screen capture and select primary display
    let screenOverrides: { sourceId?: string; enableScreenCapture?: boolean; cropRegion?: any } | undefined
    if (newSessionType === 'record-video') {
      addDebugLog('🖥️ Screen recording mode — loading sources...')
      const screenSources = await window.meetsense?.getScreenSources()
      if (screenSources?.length > 0) {
        const primary = screenSources[0]
        setSelectedSource(primary)
        addDebugLog(`🖥️ Auto-selected source: ${primary.name}`)
        screenOverrides = {
          sourceId: primary.id,
          enableScreenCapture: true,
          cropRegion: cropRegion
        }
      }
    }

    addDebugLog(`▶ Starting: audio=${options.systemAudio}, mic=${options.microphone}, screen=${newSessionType === 'record-video'}`)
    await startCapture(screenOverrides)
    startListening()
    setView('recording')
    // Refresh sidebar to show the new "in progress" session
    setTimeout(() => sidebarRef.current?.refresh(), 1000)
  }

  const ttsStopRef = React.useRef(false)

  // Show summary modal (translate if needed) — NO auto TTS
  const handleShowSummary = async (text: string, title?: string) => {
    if (sectionSummarizing || !text.trim()) return
    setSectionSummarizing(true)
    setSectionSummaryText(text)
    setTtsTitle(title || 'Summary')
    setTtsChunks([])
    setTtsActiveChunk(-1)

    // Translate to user's language
    let processedText = text
    try {
      const translateResult = await window.meetsense?.translateForTts({ text, language })
      if (translateResult?.success && translateResult.translated) {
        processedText = translateResult.translated
        setSectionSummaryText(processedText)
      }
    } catch {}

    // Pre-split into chunks for display
    const maxChunk = 150
    const sentences = processedText.match(/[^.!?。！？]+[.!?。！？]+/g) || [processedText]
    const chunks: string[] = []
    let current = ''
    for (const s of sentences) {
      if ((current + s).length > maxChunk && current) {
        chunks.push(current.trim())
        current = s
      } else {
        current += s
      }
    }
    if (current.trim()) chunks.push(current.trim())
    setTtsChunks(chunks.slice(0, 20))
    setSectionSummarizing(false)
  }

  // Start TTS playback from inside the modal
  const handlePlayTts = async () => {
    if (ttsChunks.length === 0) return
    if (ttsAudio) { ttsAudio.pause(); setTtsAudio(null) }
    ttsStopRef.current = false
    setTtsActiveChunk(-1)

    const fetchAudio = async (chunk: string): Promise<string | null> => {
      try {
        const result = await window.meetsense?.ttsRead({ text: chunk })
        return result?.success && result.audio ? result.audio : null
      } catch { return null }
    }

    let nextAudioPromise = fetchAudio(ttsChunks[0])

    for (let i = 0; i < ttsChunks.length; i++) {
      if (ttsStopRef.current) break
      setTtsActiveChunk(i)

      const audioBase64 = await nextAudioPromise
      if (i + 1 < ttsChunks.length) {
        nextAudioPromise = fetchAudio(ttsChunks[i + 1])
      }

      if (!audioBase64 || ttsStopRef.current) break

      await new Promise<void>((resolve) => {
        const audio = new Audio(`data:audio/mp3;base64,${audioBase64}`)
        setTtsAudio(audio)
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        audio.play().catch(() => resolve())
      })
    }

    if (!ttsStopRef.current) {
      setTtsAudio(null)
      setTtsActiveChunk(-1)
    }
  }

  const handleCloseSummary = () => {
    ttsStopRef.current = true
    if (ttsAudio) { ttsAudio.pause(); setTtsAudio(null) }
    setSectionSummaryText(null)
    setTtsTitle('')
    setTtsChunks([])
    setTtsActiveChunk(-1)
  }

  const handleCustomSummarize = async (prompt: string) => {
    if (!loadedSession?.session?.id || !prompt.trim()) return
    setSectionSummarizing(true)
    setShowMagicPrompt(false)
    setMagicPrompt('')

    const items: string[] = []
    // Only use raw transcript data
    if (loadedSession.transcripts?.length) {
      items.push(...loadedSession.transcripts.map((t: any) => t.text))
    }

    try {
      const result = await window.meetsense?.customSummarize({ sessionId: loadedSession.session.id, items, prompt, language })
      console.log('[Magic] Result:', JSON.stringify(result, null, 2))
      if (result?.success && result.summary) {
        // Update loaded session data in-place so columns refresh
        setLoadedSession((prev: any) => prev ? {
          ...prev,
          summary: {
            ...prev.summary,
            ...result.summary
          }
        } : prev)
        addDebugLog(`✨ AI Rewrite completed: ${Object.keys(result.summary).join(', ')}`)
      } else {
        console.error('[Magic] Failed:', result?.error)
        addDebugLog(`✨ AI Rewrite failed: ${result?.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('[Magic] Error:', err)
    }
    setSectionSummarizing(false)
  }

  const handlePasteMemorySubmit = async () => {
    if (!pasteText.trim() || pasteAnalyzing) return
    setPasteAnalyzing(true)
    try {
      const result = await window.meetsense?.analyzePasteMemory({ text: pasteText, language })
      if (result?.success && result.sessionId) {
        setShowPasteModal(false)
        setPasteText('')
        sidebarRef.current?.refresh()
        // Load the newly created session
        const data = await window.meetsense?.getSession(result.sessionId)
        if (data) {
          setLoadedSession(data)
          setView('viewing')
        }
      } else {
        console.error('[PasteMemory] Analysis failed:', result?.error)
      }
    } catch (err) {
      console.error('[PasteMemory] Error:', err)
    }
    setPasteAnalyzing(false)
  }

  const handleEndSession = async () => {
    stopListening()
    await stopCapture()
    // Don't switch view — keep recording data visible during post-meeting processing
    // The useEffect on postMeetingProcessing will switch to sessions when done
    setTimeout(() => sidebarRef.current?.refresh(), 1500)
  }

  const handleLoadSession = async (id: string) => {
    try {
      const data = await window.meetsense?.getSession(id)
      if (data) {
        setLoadedSession(data)
        setView('viewing')
      }
    } catch (err) {
      console.error('[App] Failed to load session:', err)
    }
  }

  const handleSaveSettings = async () => {
    await window.meetsense?.setApiKey({ apiKey, provider: apiProvider, language, model: aiModel })
    // Persist language + model in localStorage so it survives reloads
    try {
      const saved = localStorage.getItem('meetsense-user')
      if (saved) {
        const user = JSON.parse(saved)
        user.language = language
        user.aiModel = aiModel
        localStorage.setItem('meetsense-user', JSON.stringify(user))
      }
    } catch {}
    addDebugLog(`⚙️ Config set for ${apiProvider} / ${aiModel} (${language})`)
    setShowSettings(false)
  }

  const handleAuth = async () => {
    setAuthError('')
    if (!authEmail || !authPassword) {
      setAuthError('Email and password are required')
      return
    }
    if (authTab === 'register') {
      if (authPassword !== authConfirm) {
        setAuthError('Passwords do not match')
        return
      }
      if (authPassword.length < 6) {
        setAuthError('Password must be at least 6 characters')
        return
      }
      const result = await window.meetsense?.authRegister({ email: authEmail, password: authPassword, displayName: authName })
      if (result?.success) {
        setCurrentUser(result.user)
        if (result.user?.language) setLanguage(result.user.language)
        localStorage.setItem('meetsense-user', JSON.stringify(result.user))
        setShowAuth(false)
        setAuthEmail(''); setAuthPassword(''); setAuthConfirm(''); setAuthName('')
      } else {
        setAuthError(result?.error || 'Registration failed')
      }
    } else {
      const result = await window.meetsense?.authLogin({ email: authEmail, password: authPassword })
      if (result?.success) {
        setCurrentUser(result.user)
        if (result.user?.language) setLanguage(result.user.language)
        localStorage.setItem('meetsense-user', JSON.stringify(result.user))
        setShowAuth(false)
        setAuthEmail(''); setAuthPassword('')
      } else {
        setAuthError(result?.error || 'Invalid email or password')
      }
    }
  }

  const handleLogout = () => {
    setCurrentUser(null)
    localStorage.removeItem('meetsense-user')
  }

  const handleSearch = (query: string, mode?: 'fulltext' | 'exact') => {
    setSearchQuery(query)
    const m = mode || searchMode
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim()) { setSearchResults(null); setView('sessions'); return }
    setView('search')
    setSearchResults(null)
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await window.meetsense?.searchKnowledge(query, m)
        setSearchResults(results || [])
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 400)
  }

  // Column resizer drag handler
  const handleColumnResize = (index: number) => (e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidths = [...colWidths]
    const container = (e.target as HTMLElement).closest('.columns') as HTMLElement
    if (!container) return
    const totalWidth = container.offsetWidth

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ((ev.clientX - startX) / totalWidth) * 100
      const newWidths = [...startWidths]
      newWidths[index] = Math.max(15, startWidths[index] + delta)
      newWidths[index + 1] = Math.max(15, startWidths[index + 1] - delta)
      setColWidths(newWidths)
    }
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  return (
    <div className="app-layout">
      <Sidebar ref={sidebarRef} onLoadSession={handleLoadSession} onOpenSettings={() => setShowSettings(true)} onOpenAuth={() => setShowAuth(true)} onLogout={handleLogout} onGoHome={() => { setView('sessions'); setLoadedSession(null) }} isRecording={state === 'capturing'} isProcessing={!!postMeetingProcessing} tokenCount={tokenCount} currentUser={currentUser} collapsed={sidebarCollapsed} onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)} />
      <div className="app">

      {/* Paste Memory Modal */}
      {showPasteModal && (
        <div className="modal-overlay" onClick={() => { if (!pasteAnalyzing) { setShowPasteModal(false); setPasteText('') } }}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <h2 className="modal__title"><ClipboardPaste size={18} style={{ marginRight: 8, verticalAlign: -3 }} />{t.pasteMemoryTitle}</h2>
            <div className="modal__field">
              <textarea
                className="paste-memory__textarea"
                placeholder={t.pasteMemoryPlaceholder}
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
                rows={14}
                autoFocus
                disabled={pasteAnalyzing}
              />
            </div>
            <div className="modal__actions">
              <button className="btn" onClick={() => { setShowPasteModal(false); setPasteText('') }} disabled={pasteAnalyzing}>{t.cancel}</button>
              <button className="btn btn--primary" onClick={handlePasteMemorySubmit} disabled={!pasteText.trim() || pasteAnalyzing}>
                {pasteAnalyzing ? <><span className="paste-memory__spinner" />{t.pasteMemoryAnalyzing}</> : t.pasteMemoryAnalyze}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Section Summary + TTS Modal */}
      {sectionSummaryText && (
        <div className="modal-overlay" onClick={handleCloseSummary}>
          <div className="modal modal--wide" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 className="modal__title" style={{ margin: 0 }}>📝 Summary</h2>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {ttsAudio ? (
                  <button className="btn btn--icon" onClick={() => { ttsStopRef.current = true; if (ttsAudio) { ttsAudio.pause(); setTtsAudio(null); setTtsActiveChunk(-1) } }} title="Stop"><Square size={12} /></button>
                ) : (
                  <button className="btn btn--icon" onClick={handlePlayTts} title="Read aloud" disabled={ttsChunks.length === 0}><Play size={14} /></button>
                )}
                <button className="btn btn--icon" onClick={handleCloseSummary}><X size={14} /></button>
              </div>
            </div>
            {sectionSummarizing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px', color: 'var(--text-3)', fontSize: 11 }}>
                <span className="paste-memory__spinner" /> Loading...
              </div>
            )}
            {ttsAudio && !sectionSummarizing && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 8px', color: 'var(--accent-2)', fontSize: 11 }}>
                🔊 Playing...
              </div>
            )}
            <div className="section-summary__text">
              {ttsChunks.length > 0 ? (
                ttsChunks.map((chunk, i) => (
                  <p key={i} className={`tts-chunk ${i === ttsActiveChunk ? 'tts-chunk--active' : i < ttsActiveChunk ? 'tts-chunk--done' : ''}`}>
                    {chunk}
                  </p>
                ))
              ) : (
                <div className="document-summary" dangerouslySetInnerHTML={{ __html: sectionSummaryText
                  .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                  .replace(/^### (.+)$/gm, '<h4>$1</h4>')
                  .replace(/^- (.+)$/gm, '<li>$1</li>')
                  .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$&</ul>')
                  .replace(/<\/ul>\s*<ul>/g, '')
                  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br />')
                }} />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal__title">{t.settings}</h2>
            <div className="modal__field">
              <label>{t.colorTheme}</label>
              <select value={colorTheme} onChange={e => setColorTheme(e.target.value)}>
                {Object.entries(THEMES).map(([key, theme]) => (
                  <option key={key} value={key}>{theme.label}</option>
                ))}
              </select>
            </div>
            <div className="modal__field">
              <label>{t.language}</label>
              <select value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="English">English</option>
                <option value="Vietnamese">Vietnamese</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Japanese">Japanese</option>
                <option value="Korean">Korean</option>
                <option value="Chinese (Simplified)">Chinese</option>
              </select>
            </div>
            <div className="modal__field">
              <label>AI Model</label>
              <select value={aiModel} onChange={e => setAiModel(e.target.value)}>
                <option value="gpt-5.3-chat-latest">GPT-5.3 Chat (latest)</option>
                <option value="gpt-4o-mini">GPT-4o Mini (fast, cheap)</option>
                <option value="gpt-4o">GPT-4o (balanced)</option>
                <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="gpt-4.1">GPT-4.1</option>
                <option value="gpt-4.1-nano">GPT-4.1 Nano (fastest)</option>
                <option value="o4-mini">o4-mini (reasoning)</option>
              </select>
            </div>
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowSettings(false)}>{t.cancel}</button>
              <button className="btn btn--primary" onClick={handleSaveSettings}>{t.save}</button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="modal-overlay" onClick={() => setShowAuth(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal__title">{authTab === 'signin' ? t.signIn : t.register}</h2>
            <div className="auth-tabs">
              <button className={`auth-tab ${authTab === 'signin' ? 'auth-tab--active' : ''}`} onClick={() => { setAuthTab('signin'); setAuthError('') }}>{t.signIn}</button>
              <button className={`auth-tab ${authTab === 'register' ? 'auth-tab--active' : ''}`} onClick={() => { setAuthTab('register'); setAuthError('') }}>{t.register}</button>
            </div>
            {authError && <div className="auth-error">{authError}</div>}
            {authTab === 'register' && (
              <div className="modal__field">
                <label>{t.displayName}</label>
                <input type="text" placeholder="Your name" value={authName} onChange={e => setAuthName(e.target.value)} />
              </div>
            )}
            <div className="modal__field">
              <label>{t.email}</label>
              <input type="email" placeholder="you@example.com" value={authEmail} onChange={e => setAuthEmail(e.target.value)} />
            </div>
            <div className="modal__field">
              <label>{t.password}</label>
              <input type="password" placeholder="••••••••" value={authPassword} onChange={e => setAuthPassword(e.target.value)} />
            </div>
            {authTab === 'register' && (
              <div className="modal__field">
                <label>{t.confirmPassword}</label>
                <input type="password" placeholder="••••••••" value={authConfirm} onChange={e => setAuthConfirm(e.target.value)} />
              </div>
            )}
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowAuth(false)}>{t.cancel}</button>
              <button className="btn btn--primary" onClick={handleAuth}>{authTab === 'signin' ? t.signIn : t.register}</button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================
          VIEW: SESSIONS LIST (Default)
          ============================================ */}
      {view === 'sessions' && (
        <>
          <header className="topbar">
            <div className="topbar__center">
              <div className="search-bar">
                <span className="search-bar__icon">🔍</span>
                <input
                  type="text"
                  className="search-bar__input"
                  placeholder={t.searchPlaceholder}
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                />
                {searching && <span className="search-bar__spinner" />}
              </div>
            </div>
            <div className="topbar__right">
              {newSessionType === 'record-video' && (
                <button className="btn btn--sm btn--area" onClick={selectArea} title="Select recording area">
                  {cropRegion ? (
                    <><Crop size={12} /> {cropRegion.width}×{cropRegion.height}</>
                  ) : (
                    <><Monitor size={12} /> Full Screen</>
                  )}
                </button>
              )}
              {(newSessionType === 'record-audio' || newSessionType === 'record-video') && (
                <>
                  <label className="toggle-pill toggle-pill--sm">
                    <input type="checkbox" checked={options.systemAudio}
                      onChange={e => setOptions({ ...options, systemAudio: e.target.checked })} />
                    <span><Volume2 size={12} /> {t.system}</span>
                  </label>
                  <label className="toggle-pill toggle-pill--sm">
                    <input type="checkbox" checked={options.microphone}
                      onChange={e => setOptions({ ...options, microphone: e.target.checked })} />
                    <span><Mic size={12} /> {t.mic}</span>
                  </label>
                </>
              )}
              <div className="btn-split btn-split--sm">
                <button className="btn-split__main" onClick={handleNewSession}>
                  {newSessionType === 'record-audio' && <><Mic size={14} /> {t.recordAudio}</>}
                  {newSessionType === 'record-video' && <><Video size={14} /> {t.recordScreen}</>}
                  {newSessionType === 'take-picture' && <><Camera size={14} /> {t.takePicture}</>}
                  {newSessionType === 'upload-audio' && <><Music size={14} /> {t.uploadAudio}</>}
                  {newSessionType === 'upload-video' && <><Film size={14} /> {t.uploadVideo}</>}
                  {newSessionType === 'upload-image' && <><Image size={14} /> {t.uploadImage}</>}
                  {newSessionType === 'upload-text' && <><FileText size={14} /> {t.uploadText}</>}
                  {newSessionType === 'paste-memory' && <><ClipboardPaste size={14} /> {t.pasteMemory}</>}
                </button>
                <button className="btn-split__toggle" onClick={(e) => { e.stopPropagation(); setShowNewDropdown(!showNewDropdown) }}>
                  <ChevronDown size={14} />
                </button>
                {showNewDropdown && (
                  <div className="btn-split__dropdown">
                    {[
                      { id: 'record-audio', icon: Mic, label: t.recordAudio },
                      { id: 'record-video', icon: Video, label: t.recordScreen },
                      { id: 'take-picture', icon: Camera, label: t.takePicture },
                      { id: 'upload-audio', icon: Music, label: t.uploadAudio },
                      { id: 'upload-video', icon: Film, label: t.uploadVideo },
                      { id: 'upload-image', icon: Image, label: t.uploadImage },
                      { id: 'upload-text', icon: FileText, label: t.uploadText },
                      { id: 'paste-memory', icon: ClipboardPaste, label: t.pasteMemory },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        className={`btn-split__option ${newSessionType === opt.id ? 'btn-split__option--active' : ''}`}
                        onClick={() => { setNewSessionType(opt.id as any); setShowNewDropdown(false) }}
                      >
                        <opt.icon size={14} /> {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="sessions-view">
            <div className="sessions-view__hero">
              <h1 className="sessions-view__title">{t.yourMeetings}</h1>
              <p className="sessions-view__subtitle">{t.startNewSession}</p>
            </div>




          </main>
        </>
      )}

      {/* ============================================
          VIEW: SEARCH RESULTS (Full page)
          ============================================ */}
      {view === 'search' && (
        <>
          <header className="topbar">
            <div className="topbar__center">
              <div className="search-bar">
                <span className="search-bar__icon">🔍</span>
                <input
                  type="text"
                  className="search-bar__input"
                  placeholder="Search across all meetings..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
            <div className="topbar__right">
              <div className="btn-split btn-split--sm">
                <button className="btn-split__main" onClick={handleNewSession}>
                  <Mic size={14} /> Record
                </button>
                <button className="btn-split__toggle" onClick={(e) => { e.stopPropagation(); setShowNewDropdown(!showNewDropdown) }}>
                  <ChevronDown size={14} />
                </button>
                {showNewDropdown && (
                  <div className="btn-split__dropdown">
                    {[
                      { id: 'record-audio', icon: Mic, label: 'Record Audio' },
                      { id: 'record-video', icon: Video, label: 'Record Screen' },
                      { id: 'take-picture', icon: Camera, label: 'Take Picture' },
                      { id: 'upload-audio', icon: Music, label: 'Upload Audio' },
                      { id: 'upload-video', icon: Film, label: 'Upload Video' },
                      { id: 'upload-image', icon: Image, label: 'Upload Image' },
                      { id: 'upload-text', icon: FileText, label: 'Upload Text' },
                      { id: 'paste-memory', icon: ClipboardPaste, label: 'Paste Memory' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        className={`btn-split__option ${newSessionType === opt.id ? 'btn-split__option--active' : ''}`}
                        onClick={() => { setNewSessionType(opt.id as any); setShowNewDropdown(false) }}
                      >
                        <opt.icon size={14} /> {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          <main className="search-page">
            <div className="search-page__header">
              <h2 className="search-page__title">
                {searching ? 'Searching...' : searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${searchQuery}"` : ''}
              </h2>
              <div className="search-page__modes">
                <button className={`search-page__mode ${searchMode === 'fulltext' ? 'search-page__mode--active' : ''}`} onClick={() => { setSearchMode('fulltext'); if (searchQuery) handleSearch(searchQuery, 'fulltext') }}>Full Text</button>
                <button className={`search-page__mode ${searchMode === 'exact' ? 'search-page__mode--active' : ''}`} onClick={() => { setSearchMode('exact'); if (searchQuery) handleSearch(searchQuery, 'exact') }}>Exact Match</button>
              </div>
            </div>

            {searching && (
              <div className="search-page__loading">
                <div className="processing-banner__spinner" />
                <span>Searching across all sessions...</span>
              </div>
            )}

            {!searching && searchResults && searchResults.length === 0 && (
              <div className="search-page__empty">
                <div className="empty__icon">🔍</div>
                <p>No results found for "{searchQuery}"</p>
                <p className="search-page__hint">Try different keywords or search by tag (e.g. #meeting)</p>
              </div>
            )}

            {!searching && searchResults && searchResults.length > 0 && (
              <div className="search-page__results">
                {searchResults.map((r: any, i: number) => {
                  const text = (r.content || r.text || '')
                  // Highlight each word separately
                  const words = searchQuery.trim().split(/\s+/).filter(w => w.length > 0)
                  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
                  const highlighted = escapedWords.length > 0
                    ? text.replace(new RegExp(`(${escapedWords.join('|')})`, 'gi'), '<mark>$1</mark>')
                    : text
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && <hr />}
                      <div className="search-page__item" onClick={() => {
                        if (r.session_id) handleLoadSession(r.session_id)
                        setSearchQuery(''); setSearchResults(null)
                      }}>
                        <div className="search-page__item-header">
                          {r.session_title && (
                            <div className="search-page__item-session">
                              <span>📝</span>
                              {r.session_title}
                            </div>
                          )}
                          {r.speaker && (
                            <span className="search-page__item-speaker">
                              {r.speaker.replace(/SPEAKER_(\d+)/g, (_: string, n: string) => `Person ${parseInt(n) + 1}`)}
                            </span>
                          )}
                        </div>
                        <div className="search-page__item-text" dangerouslySetInnerHTML={{ __html: highlighted }} />
                      </div>
                    </React.Fragment>
                  )
                })}
              </div>
            )}
          </main>
        </>
      )}

      {/* ============================================
          VIEW: SESSION DETAIL (Viewing saved session)
          ============================================ */}
      {view === 'viewing' && loadedSession && (
        <>
          <header className="topbar">
            <div className="topbar__center">
              <div className="search-bar">
                <span className="search-bar__icon">🔍</span>
                <input
                  type="text"
                  className="search-bar__input"
                  placeholder="Search across all meetings..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="topbar__right">
              <div className="btn-split btn-split--sm">
                <button className="btn-split__main" onClick={handleNewSession}>
                  <Mic size={14} /> Record
                </button>
                <button className="btn-split__toggle" onClick={(e) => { e.stopPropagation(); setShowNewDropdown(!showNewDropdown) }}>
                  <ChevronDown size={14} />
                </button>
                {showNewDropdown && (
                  <div className="btn-split__dropdown">
                    {[
                      { id: 'record-audio', icon: Mic, label: 'Record Audio' },
                      { id: 'record-video', icon: Video, label: 'Record Screen' },
                      { id: 'take-picture', icon: Camera, label: 'Take Picture' },
                      { id: 'upload-audio', icon: Music, label: 'Upload Audio' },
                      { id: 'upload-video', icon: Film, label: 'Upload Video' },
                      { id: 'upload-image', icon: Image, label: 'Upload Image' },
                      { id: 'upload-text', icon: FileText, label: 'Upload Text' },
                      { id: 'paste-memory', icon: ClipboardPaste, label: 'Paste Memory' },
                    ].map(opt => (
                      <button
                        key={opt.id}
                        className={`btn-split__option ${newSessionType === opt.id ? 'btn-split__option--active' : ''}`}
                        onClick={() => { setNewSessionType(opt.id as any); setShowNewDropdown(false) }}
                      >
                        <opt.icon size={14} /> {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="session-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h2 className="session-header__title">{loadedSession.session.title || 'Untitled Session'}</h2>
              <button className="btn btn--icon session-header__summarize" title="View summary" disabled={sectionSummarizing} onClick={() => {
                const text = loadedSession.summary?.document_summary || ''
                handleShowSummary(text, loadedSession.session.title || 'Summary')
              }}>{sectionSummarizing ? <span className="paste-memory__spinner" /> : <Play size={14} />}</button>
              <button className="btn btn--icon session-header__summarize" title="Custom AI prompt" disabled={sectionSummarizing} onClick={() => setShowMagicPrompt(true)}>{sectionSummarizing ? <span className="paste-memory__spinner" /> : <Sparkles size={14} />}</button>
            </div>
            {showMagicPrompt && (
              <div className="modal-overlay" onClick={() => setShowMagicPrompt(false)}>
                <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
                  <h2 className="modal__title">✨ AI Rewrite</h2>
                  <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 12px' }}>Enter your instructions to regenerate the session summary, statements, facts, and questions.</p>
                  <div className="modal__field">
                    <textarea
                      style={{ width: '100%', fontSize: 13, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)', background: 'var(--bg-2)', color: 'var(--text)', minHeight: 80, resize: 'vertical', fontFamily: 'inherit' }}
                      placeholder="e.g. Summarize briefly in bullet points, list action items, rewrite in Vietnamese..."
                      value={magicPrompt}
                      onChange={e => setMagicPrompt(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && magicPrompt.trim()) { e.preventDefault(); handleCustomSummarize(magicPrompt) } }}
                      autoFocus
                    />
                  </div>
                  <div className="modal__actions">
                    <button className="btn" onClick={() => setShowMagicPrompt(false)}>Cancel</button>
                    <button className="btn btn--primary" disabled={!magicPrompt.trim()} onClick={() => handleCustomSummarize(magicPrompt)}>✨ Regenerate</button>
                  </div>
                </div>
              </div>
            )}
            <span className="session-header__date">
              {new Date(loadedSession.session.created_at).toLocaleString()}
              {loadedSession.session.duration_seconds && ` · ${formatTime(loadedSession.session.duration_seconds)}`}
            </span>
            {loadedSession.tags.length > 0 && (
              <div className="session-header__tags">
                {loadedSession.tags.map((tag: any) => (
                  <span key={tag.id} className="session-header__tag session-header__tag--clickable" style={{ color: tag.color }} onClick={() => {
                    setView('sessions')
                    setLoadedSession(null)
                    setSearchQuery(`#${tag.name}`)
                    handleSearch(`#${tag.name}`)
                  }}>#{tag.name}</span>
                ))}
              </div>
            )}
          </div>

          <main className="columns" style={{ gridTemplateColumns: colWidths.map(w => `${w}%`).join(' auto ') }}>
            {/* Column 1: Transcript */}
            <section className="col">
              <div className="col__head">
                <h2>{t.transcription}</h2>
                <span className="badge">{loadedSession.transcripts.length}</span>
              </div>
              <div className="col__body">
                {loadedSession.transcripts.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">📝</div>
                    <p>{t.noTranscript}</p>
                  </div>
                ) : (
                  <div className="chat-list">
                    {loadedSession.transcripts.map((entry: any, i: number) => (
                      <div key={i} className={`chat-bubble ${entry.source === 'whisper' ? 'chat-bubble--primary' : 'chat-bubble--secondary'}`}>
                        <div className="chat-bubble__meta">
                          <span className="chat-bubble__speaker">
                            {entry.speaker ? entry.speaker.replace(/SPEAKER_(\d+)/g, (_: string, n: string) => `${t.person} ${parseInt(n) + 1}`) : `${t.person} 1`}
                          </span>
                          <span className="chat-bubble__time">{formatTime(Math.floor(entry.start_sec || 0))}</span>
                        </div>
                        <div className="chat-bubble__text">{entry.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <div className="col-resizer" onMouseDown={handleColumnResize(0)} />

            {/* Column 2: Summary */}
            <section className="col">
              <div className="col__head">
                <h2>{t.summary}</h2>
                <span className="badge">{t.ai}</span>
              </div>
              <div className="col__body" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
                {!loadedSession.summary ? (
                  <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div>
                      <div className="empty__icon">🧠</div>
                      <p>{t.noSummary}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: '0 0 60%', overflowY: 'auto', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="mindmap">
                        {loadedSession.summary.statements?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.statements}</div>
                            {loadedSession.summary.statements.map((d: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--statement" title="Statement">S</span>
                                <span>{typeof d === 'string' ? d : d.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {loadedSession.summary.facts?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.facts}</div>
                            {loadedSession.summary.facts.map((d: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--fact" title="Fact">F</span>
                                <span>{typeof d === 'string' ? d : d.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {loadedSession.summary.questions?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.questions}</div>
                            {loadedSession.summary.questions.map((q: string, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--question" title="Question">Q</span>
                                <span>{q}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!loadedSession.summary.statements?.length && !loadedSession.summary.facts?.length && !loadedSession.summary.questions?.length && (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>{t.noItems}</p>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 40%', overflowY: 'auto', padding: '16px' }}>
                      <div className="mindmap">
                        {loadedSession.summary.unclear_points?.length > 0 ? (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.unclearPoints}</div>
                            {loadedSession.summary.unclear_points.map((u: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className={`mindmap__badge mindmap__badge--${u.type || 'question'}`} title={u.type || 'question'}>{(u.type || 'q').charAt(0).toUpperCase()}</span>
                                <span>{typeof u === 'string' ? u : u.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>{t.noUnclearPoints}</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            <div className="col-resizer" onMouseDown={handleColumnResize(1)} />

            {/* Column 3: Document */}
            <section className="col">
              <div className="col__head">
                <h2>{t.document}</h2>
                <span className="badge">{t.summaryLabel}</span>
              </div>
              <div className="col__body">
                {loadedSession.summary?.document_summary ? (
                  <div className="document-summary">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code(props) {
                          const {children, className, node, ...rest} = props
                          const match = /language-(\w+)/.exec(className || '')
                          if (match && match[1] === 'mermaid') {
                            return <MermaidBlock chart={String(children).replace(/\n$/, '')} />
                          }
                          return <code {...rest} className={className}>{children}</code>
                        }
                      }}
                    >
                      {loadedSession.summary.document_summary}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="empty">
                    <div className="empty__icon">📄</div>
                    <p>{t.noDocument}</p>
                  </div>
                )}
              </div>
            </section>
          </main>
        </>
      )}

      {/* ============================================
          VIEW: RECORDING (Active session)
          ============================================ */}
      {view === 'recording' && (
        <>
          <header className="topbar topbar--recording">
            <div className="topbar__left">
              <span className="topbar__live">
                <span className="topbar__dot"></span>
                REC {formatTime(elapsed)}
              </span>
              {tokenUsage.totalTokens > 0 && (
                <span className="token-usage">
                  <span className="token-usage__item token-usage__in"><ArrowUp size={12} /> {tokenUsage.inputTokens.toLocaleString()}</span>
                  <span className="token-usage__item token-usage__out"><ArrowDown size={12} /> {tokenUsage.outputTokens.toLocaleString()}</span>
                  <span className="token-usage__cost"><CircleDollarSign size={12} /> ${tokenUsage.cost.toFixed(4)}</span>
                </span>
              )}
            </div>
            <div className="topbar__right">
              <label className="toggle-pill">
                <input type="checkbox" checked={options.systemAudio}
                  onChange={e => setOptions({ ...options, systemAudio: e.target.checked })} />
                <span><Volume2 size={13} /> {t.system}</span>
              </label>
              <label className="toggle-pill">
                <input type="checkbox" checked={options.microphone}
                  onChange={e => setOptions({ ...options, microphone: e.target.checked })} />
                <span><Mic size={13} /> {t.mic}</span>
              </label>
              <button className="btn btn--danger btn--end" onClick={handleEndSession}><Square size={12} /> {t.stopRecording}</button>
              <button className={`btn btn--icon ${showDebug ? 'btn--active' : ''}`} onClick={() => setShowDebug(!showDebug)} title="Debug">🐛</button>
            </div>
          </header>

          <main className="columns" style={{ gridTemplateColumns: colWidths.map(w => `${w}%`).join(' auto ') }}>
            {/* Column 1: Transcription */}
            <section className="col">
              <div className="col__head">
                <h2>{t.transcriptionLive}</h2>
                {state === 'capturing' && <span className="badge badge--live">{t.live}</span>}
                {state !== 'capturing' && transcripts.length > 0 && <span className="badge">{transcripts.length}</span>}
              </div>
              <div className="col__body">
                {transcripts.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">🎙️</div>
                    <p>{t.listeningForAudio}</p>
                  </div>
                ) : (
                  <div className="chat-list">
                    {transcripts.map(entry => (
                      <div key={entry.id} className={`chat-bubble ${entry.source === 'whisper' ? 'chat-bubble--primary' : 'chat-bubble--secondary'}`}>
                        <div className="chat-bubble__meta">
                          <span className="chat-bubble__speaker">Person 1</span>
                          <span className="chat-bubble__time">{formatTime(Math.floor(entry.start || 0))}</span>
                          {entry.audioUrl && (
                            <button
                              className="btn btn--icon"
                              style={{ padding: 2, height: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
                              onClick={() => {
                                const audio = new Audio(entry.audioUrl)
                                audio.play().catch(e => console.error('Audio playback failed:', e))
                              }}
                              title="Play audio"
                            >▶️</button>
                          )}
                        </div>
                        <div className="chat-bubble__text">{entry.text}</div>
                      </div>
                    ))}

                    {interimTranscript && (
                      <div className="chat-bubble chat-bubble--interim">
                        <div className="chat-bubble__meta">
                          <span className="chat-bubble__speaker">Person 1</span>
                          <span className="chat-bubble__time">...</span>
                        </div>
                        <div className="chat-bubble__text typing-text">{interimTranscript}</div>
                      </div>
                    )}

                    {interimWhisperTranscript && (
                      <div className="chat-bubble chat-bubble--interim" style={{ color: 'gray', fontStyle: 'italic' }}>
                        <div className="chat-bubble__meta">
                          <span className="chat-bubble__speaker">Person 1</span>
                          <span className="chat-bubble__time">...</span>
                        </div>
                        <div className="chat-bubble__text typing-text">{interimWhisperTranscript}</div>
                      </div>
                    )}
                    <div ref={transcriptEndRef} />
                  </div>
                )}
              </div>
              {/* Screen capture preview */}
              {latestFrame && state === 'capturing' && (
                <div className="screen-preview">
                  <div className="screen-preview__label"><Monitor size={10} /> Screen Capture</div>
                  <img className="screen-preview__img" src={latestFrame} alt="Screen capture" />
                </div>
              )}
            </section>

            <div className="col-resizer" onMouseDown={handleColumnResize(0)} />

            {/* Column 2: Summary */}
            <section className="col">
              <div className="col__head">
                <h2>{t.summary}</h2>
                <span className="badge">{t.ai}</span>
              </div>
              <div className="col__body" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
                {!summary ? (
                  <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div>
                      <div className="empty__icon">🧠</div>
                      <p>{t.waitingForSummary}</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: '0 0 60%', overflowY: 'auto', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="mindmap">
                        {summary.statements?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.statements}</div>
                            {summary.statements.map((d: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--statement" title="Statement">S</span>
                                <span>{typeof d === 'string' ? d : d.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {summary.facts?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.facts}</div>
                            {summary.facts.map((d: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--fact" title="Fact">F</span>
                                <span>{typeof d === 'string' ? d : d.text}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {summary.questions?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.questions}</div>
                            {summary.questions.map((q: string, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className="mindmap__badge mindmap__badge--question" title="Question">Q</span>
                                <span>{q}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {!summary.statements?.length && !summary.facts?.length && !summary.questions?.length && (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>{t.noItems}</p>
                        )}
                      </div>
                      <div ref={statementsEndRef} />
                    </div>
                    <div style={{ flex: '0 0 40%', overflowY: 'auto', padding: '16px' }}>
                      <div className="mindmap">
                        {summary.unclear_points?.length > 0 ? (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">{t.unclearPoints}</div>
                            {summary.unclear_points.map((u: any, i: number) => (
                              <div key={i} className="mindmap__leaf">
                                <span className={`mindmap__badge mindmap__badge--${u.type || 'question'}`} title={u.type || 'question'}>{(u.type || 'q').charAt(0).toUpperCase()}</span>
                                <span>{typeof u === 'string' ? u : u.text}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>{t.noUnclearPoints}</p>
                        )}
                      </div>
                      <div ref={summaryEndRef} />
                    </div>
                  </>
                )}
              </div>
            </section>

            <div className="col-resizer" onMouseDown={handleColumnResize(1)} />

            {/* Column 3: Document / Debug */}
            <section className="col">
              <div className="col__head">
                <h2>{showDebug ? t.debugLog : t.document}</h2>
                {showDebug
                  ? <span className="badge">{debugLogs.length}</span>
                  : <span className="badge">{t.summaryLabel}</span>
                }
              </div>
              <div className="col__body">
                {showDebug ? (
                  <div className="debug-list">
                    {debugLogs.map((log, i) => (
                      <div key={i} className={`debug-line debug-line--${log.level}`}>
                        <span className="debug-line__time">{log.time}</span>
                        <span>{log.message}</span>
                      </div>
                    ))}
                    <div ref={debugEndRef} />
                  </div>
                ) : (
                  !summary ? (
                    <div className="empty">
                      <div className="empty__icon">📄</div>
                      <p>{t.documentWillAppear}</p>
                    </div>
                  ) : (
                  <div className="document-summary" style={{ position: 'relative' }}>
                    {postMeetingProcessing && (
                      <div className="post-meeting-overlay">
                        <div className="post-meeting-overlay__content">
                          <div className="post-meeting-overlay__spinner" />
                          <p>{t.finalizingSession}</p>
                        </div>
                      </div>
                    )}
                    {summary.documentSummary ? (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code(props) {
                              const {children, className, node, ...rest} = props
                              const match = /language-(\w+)/.exec(className || '')
                              if (match && match[1] === 'mermaid') {
                                return <MermaidBlock chart={String(children).replace(/\n$/, '')} />
                              }
                              return <code {...rest} className={className}>{children}</code>
                            }
                          }}
                        >
                          {summary.documentSummary}
                        </ReactMarkdown>
                      ) : (
                        <p style={{ color: 'var(--text-3)' }}>No summary yet...</p>
                      )}
                      <div ref={documentEndRef} />
                    </div>
                  )
                )}
              </div>
              {!showDebug && (
                <div className="col__foot">
                  <button className="btn btn--sm" onClick={() => window.meetsense?.exportMarkdown()}><FileText size={12} /> Export MD</button>
                  <button className="btn btn--sm" onClick={() => window.meetsense?.exportJSON()}><ClipboardPaste size={12} /> Export JSON</button>
                </div>
              )}
            </section>
          </main>
        </>
      )}
      </div>
      <ChatWidget activeSession={view === 'viewing' ? loadedSession : undefined} />

      {/* Floating TTS indicator */}
      {(ttsAudio || sectionSummarizing) && !sectionSummaryText && (
        <div className="tts-indicator">
          <span className="tts-indicator__pulse" />
          <span className="tts-indicator__title">{sectionSummarizing ? '⏳ Loading...' : `🔊 ${ttsTitle}`}</span>
          <button className="tts-indicator__stop" onClick={handleCloseSummary}>■</button>
        </div>
      )}
    </div>
  )
}

export default App
