import React, { useRef, useEffect, useState } from 'react'
import { useCapture } from './hooks/useCapture'
import { useTranscript } from './hooks/useTranscript'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './components/MermaidBlock'
import { Sidebar, SidebarHandle } from './components/Sidebar'
import { ChatWidget } from './components/ChatWidget'

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
    startCapture, stopCapture
  } = useCapture()

  const { transcripts, interimTranscript, interimWhisperTranscript, summary, postMeetingProcessing, tokenCount, clearAll, startListening, stopListening } = useTranscript()

  const [view, setView] = useState<AppView>('sessions')
  const [loadedSession, setLoadedSession] = useState<LoadedSession | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authTab, setAuthTab] = useState<'signin' | 'register'>('signin')
  const [showDebug, setShowDebug] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini'>('gemini')
  const [language, setLanguage] = useState('English')
  const [colorTheme, setColorTheme] = useState(() => {
    const saved = localStorage.getItem('meetsense-theme')
    return saved && THEMES[saved] ? saved : 'blue'
  })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[] | null>(null)
  const [searching, setSearching] = useState(false)
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  // Auto-refresh sidebar when post-meeting processing completes
  useEffect(() => {
    if (postMeetingProcessing === false) {
      // Processing just finished — refresh sidebar to show updated title/tags
      setTimeout(() => sidebarRef.current?.refresh(), 500)
    }
  }, [postMeetingProcessing])

  const handleNewSession = async () => {
    await window.meetsense?.setApiKey({ apiKey, provider: apiProvider, language })
    clearAll()
    addDebugLog(`▶ Starting: audio=${options.systemAudio}, mic=${options.microphone}`)
    await startCapture()
    startListening()
    setView('recording')
    // Refresh sidebar to show the new "in progress" session
    setTimeout(() => sidebarRef.current?.refresh(), 1000)
  }

  const handleEndSession = async () => {
    stopListening()
    await stopCapture()
    setView('sessions')
    // Refresh sidebar after session data is saved
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
    await window.meetsense?.setApiKey({ apiKey, provider: apiProvider, language })
    addDebugLog(`⚙️ Config set for ${apiProvider} (${language})`)
    setShowSettings(false)
  }

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
    if (!query.trim()) { setSearchResults(null); setView('sessions'); return }
    setView('search')
    setSearchResults(null)
    searchTimeoutRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await window.meetsense?.searchKnowledge(query)
        setSearchResults(results || [])
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, 400)
  }

  return (
    <div className="app-layout">
      <Sidebar ref={sidebarRef} onLoadSession={handleLoadSession} onOpenSettings={() => setShowSettings(true)} onOpenAuth={() => setShowAuth(true)} onGoHome={() => { setView('sessions'); setLoadedSession(null) }} isRecording={state === 'capturing'} isProcessing={!!postMeetingProcessing} tokenCount={tokenCount} />
      <div className="app">

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal__title">Settings</h2>
            <div className="modal__field">
              <label>AI Provider</label>
              <select value={apiProvider} onChange={e => setApiProvider(e.target.value as any)}>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div className="modal__field">
              <label>API Key</label>
              <input
                type="password"
                placeholder="Enter your API key..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
              />
            </div>
            <div className="modal__field">
              <label>Color Theme</label>
              <select value={colorTheme} onChange={e => setColorTheme(e.target.value)}>
                {Object.entries(THEMES).map(([key, theme]) => (
                  <option key={key} value={key}>{theme.label}</option>
                ))}
              </select>
            </div>
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuth && (
        <div className="modal-overlay" onClick={() => setShowAuth(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal__title">{authTab === 'signin' ? 'Sign In' : 'Create Account'}</h2>
            <div className="auth-tabs">
              <button className={`auth-tab ${authTab === 'signin' ? 'auth-tab--active' : ''}`} onClick={() => setAuthTab('signin')}>Sign In</button>
              <button className={`auth-tab ${authTab === 'register' ? 'auth-tab--active' : ''}`} onClick={() => setAuthTab('register')}>Register</button>
            </div>
            <div className="modal__field">
              <label>Email</label>
              <input type="email" placeholder="you@example.com" />
            </div>
            <div className="modal__field">
              <label>Password</label>
              <input type="password" placeholder="••••••••" />
            </div>
            {authTab === 'register' && (
              <div className="modal__field">
                <label>Confirm Password</label>
                <input type="password" placeholder="••••••••" />
              </div>
            )}
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowAuth(false)}>Cancel</button>
              <button className="btn btn--primary">{authTab === 'signin' ? 'Sign In' : 'Register'}</button>
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
                  placeholder="Search across all meetings..."
                  value={searchQuery}
                  onChange={e => handleSearch(e.target.value)}
                />
                {searching && <span className="search-bar__spinner" />}
              </div>
            </div>
            <div className="topbar__right" />
          </header>

          <main className="sessions-view">
            <div className="sessions-view__hero">
              <h1 className="sessions-view__title">Your Meetings</h1>
              <p className="sessions-view__subtitle">Start a new session or review past conversations</p>
            </div>

            <div className="sessions-view__actions">
              <div className="new-session-controls">
                <label className="toggle-pill">
                  <input type="checkbox" checked={options.systemAudio}
                    onChange={e => setOptions({ ...options, systemAudio: e.target.checked })} />
                  <span>🔊 System</span>
                </label>
                <label className="toggle-pill">
                  <input type="checkbox" checked={options.microphone}
                    onChange={e => setOptions({ ...options, microphone: e.target.checked })} />
                  <span>🎤 Mic</span>
                </label>
                <select
                  className="lang-select"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                >
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
              <button className="btn-new-session" onClick={handleNewSession}>
                <span className="btn-new-session__icon">+</span>
                New Session
              </button>
            </div>

            {postMeetingProcessing && (
              <div className="processing-banner">
                <div className="processing-banner__spinner" />
                <span>Processing...</span>
              </div>
            )}
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
            <div className="topbar__right" />
          </header>

          <main className="search-page">
            <div className="search-page__header">
              <h2 className="search-page__title">
                {searching ? 'Searching...' : searchResults ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${searchQuery}"` : ''}
              </h2>
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
                <p className="search-page__hint">Try different keywords or search by tag</p>
              </div>
            )}

            {!searching && searchResults && searchResults.length > 0 && (
              <div className="search-page__results">
                {searchResults.map((r: any, i: number) => {
                  const text = (r.content || r.text || '').slice(0, 300)
                  const query = searchQuery.toLowerCase()
                  const idx = text.toLowerCase().indexOf(query)
                  return (
                    <div key={i} className="search-page__item" onClick={() => {
                      if (r.session_id) handleLoadSession(r.session_id)
                      setSearchQuery(''); setSearchResults(null)
                    }}>
                      {r.session_title && (
                        <div className="search-page__item-session">
                          <span>📝</span>
                          {r.session_title}
                        </div>
                      )}
                      <div className="search-page__item-text" dangerouslySetInnerHTML={{
                        __html: idx >= 0
                          ? text.slice(0, idx) + '<mark>' + text.slice(idx, idx + query.length) + '</mark>' + text.slice(idx + query.length)
                          : text
                      }} />
                    </div>
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
            <div className="topbar__right" />
          </header>

          <div className="session-header">
            <h2 className="session-header__title">{loadedSession.session.title || 'Untitled Session'}</h2>
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

          <main className="columns">
            {/* Column 1: Transcript */}
            <section className="col">
              <div className="col__head">
                <h2>Transcript</h2>
                <span className="badge">{loadedSession.transcripts.length}</span>
              </div>
              <div className="col__body">
                {loadedSession.transcripts.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">📝</div>
                    <p>No transcript saved for this session</p>
                  </div>
                ) : (
                  <div className="chat-list">
                    {loadedSession.transcripts.map((entry: any, i: number) => (
                      <div key={i} className={`chat-bubble ${entry.source === 'whisper' ? 'chat-bubble--primary' : 'chat-bubble--secondary'}`}>
                        <div className="chat-bubble__meta">
                          <span className="chat-bubble__speaker">
                            {entry.speaker ? entry.speaker.replace(/SPEAKER_(\d+)/g, (_: string, n: string) => `Person ${parseInt(n) + 1}`) : `Person 1`}
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

            {/* Column 2: Summary */}
            <section className="col">
              <div className="col__head">
                <h2>Summary</h2>
                <span className="badge">AI</span>
              </div>
              <div className="col__body" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
                {!loadedSession.summary ? (
                  <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div>
                      <div className="empty__icon">🧠</div>
                      <p>No summary saved for this session</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: '0 0 60%', overflowY: 'auto', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="mindmap">
                        {loadedSession.summary.statements?.length > 0 ? (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">💬 Statements & Facts</div>
                            {loadedSession.summary.statements.map((d: string, i: number) => (
                              <div key={i} className="mindmap__leaf">{d}</div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No statements recorded</p>
                        )}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 40%', overflowY: 'auto', padding: '16px' }}>
                      <div className="mindmap">
                        {loadedSession.summary.questions?.length > 0 ? (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">❓ Questions</div>
                            {loadedSession.summary.questions.map((q: string, i: number) => (
                              <div key={i} className="mindmap__leaf">{q}</div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No questions recorded</p>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Column 3: Document */}
            <section className="col">
              <div className="col__head">
                <h2>Document</h2>
                <span className="badge">Summary</span>
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
                    <p>No document summary saved</p>
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
            </div>
            <div className="topbar__right">
              <button className="btn btn--danger btn--end" onClick={handleEndSession}>⏹ End Session</button>
              <button className={`btn btn--icon ${showDebug ? 'btn--active' : ''}`} onClick={() => setShowDebug(!showDebug)} title="Debug">🐛</button>
            </div>
          </header>

          <main className="columns">
            {/* Column 1: Transcription */}
            <section className="col">
              <div className="col__head">
                <h2>Transcription</h2>
                {state === 'capturing' && <span className="badge badge--live">Live</span>}
                {state !== 'capturing' && transcripts.length > 0 && <span className="badge">{transcripts.length}</span>}
              </div>
              <div className="col__body">
                {transcripts.length === 0 ? (
                  <div className="empty">
                    <div className="empty__icon">🎙️</div>
                    <p>Listening for audio...</p>
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
            </section>

            {/* Column 2: Summary */}
            <section className="col">
              <div className="col__head">
                <h2>Summary</h2>
                <span className="badge">AI</span>
              </div>
              <div className="col__body" style={{ display: 'flex', flexDirection: 'column', gap: 0, padding: 0 }}>
                {!summary ? (
                  <div className="empty" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div>
                      <div className="empty__icon">🧠</div>
                      <p>Waiting for transcription data...</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ flex: '0 0 60%', overflowY: 'auto', padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="mindmap">
                        {summary.statements?.length > 0 ? (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">💬 Statements & Facts</div>
                            {summary.statements.map((d: string, i: number) => (
                              <div key={i} className="mindmap__leaf">{d}</div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No statements yet...</p>
                        )}
                      </div>
                      <div ref={statementsEndRef} />
                    </div>
                    <div style={{ flex: '0 0 40%', overflowY: 'auto', padding: '16px' }}>
                      <div className="mindmap">
                        {summary.questions?.length > 0 && (
                          <div className="mindmap__branch">
                            <div className="mindmap__label">❓ Questions</div>
                            {summary.questions.map((q: string, i: number) => (
                              <div key={i} className="mindmap__leaf">{q}</div>
                            ))}
                          </div>
                        )}
                        {summary.questions?.length === 0 && (
                          <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No questions yet...</p>
                        )}
                      </div>
                      <div ref={summaryEndRef} />
                    </div>
                  </>
                )}
              </div>
            </section>

            {/* Column 3: Document / Debug */}
            <section className="col">
              <div className="col__head">
                <h2>{showDebug ? 'Debug' : 'Document'}</h2>
                {showDebug
                  ? <span className="badge">{debugLogs.length}</span>
                  : <span className="badge">Summary</span>
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
                      <p>Document will generate soon...</p>
                    </div>
                  ) : (
                  <div className="document-summary" style={{ position: 'relative' }}>
                    {postMeetingProcessing && (
                      <div className="post-meeting-overlay">
                        <div className="post-meeting-overlay__content">
                          <div className="post-meeting-overlay__spinner" />
                          <p>Generating final speaker-aware summary...</p>
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
                  <button className="btn btn--sm" onClick={() => window.meetsense?.exportMarkdown()}>📄 Export MD</button>
                  <button className="btn btn--sm" onClick={() => window.meetsense?.exportJSON()}>📋 Export JSON</button>
                </div>
              )}
            </section>
          </main>
        </>
      )}
      </div>
      <ChatWidget />
    </div>
  )
}

export default App
