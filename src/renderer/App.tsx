import React, { useRef, useEffect, useState } from 'react'
import { useCapture } from './hooks/useCapture'
import { useTranscript } from './hooks/useTranscript'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MermaidBlock } from './components/MermaidBlock'

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

  const { transcripts, interimTranscript, interimWhisperTranscript, summary, postMeetingProcessing, clearAll, startListening, stopListening } = useTranscript()

  const [showSettings, setShowSettings] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini'>('gemini')
  const [language, setLanguage] = useState('English')

  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const statementsEndRef = useRef<HTMLDivElement>(null)
  const summaryEndRef = useRef<HTMLDivElement>(null)
  const documentEndRef = useRef<HTMLDivElement>(null)
  const debugEndRef = useRef<HTMLDivElement>(null)

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

  const handleStart = async () => {
    // Backend SummaryEngine will fallback to process.env if apiKey is empty
    await window.meetsense.setApiKey({ apiKey, provider: apiProvider, language })
    clearAll()
    addDebugLog(`▶ Starting: audio=${options.systemAudio}, mic=${options.microphone}`)
    await startCapture()
    startListening()
    addDebugLog('🎙️ Web Speech API transcription started')
  }

  const handleSaveSettings = async () => {
    await window.meetsense.setApiKey({ apiKey, provider: apiProvider, language })
    addDebugLog(`⚙️ Config set for ${apiProvider} (${language})`)
    setShowSettings(false)
  }

  return (
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
            <div className="modal__actions">
              <button className="btn" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="topbar">
        <div className="topbar__left">
          <span className="topbar__logo">👁 meetsense</span>
          {state === 'capturing' && (
            <span className="topbar__live">
              <span className="topbar__dot"></span>
              REC {formatTime(elapsed)}
            </span>
          )}
        </div>

        <div className="topbar__center">
          <label className="toggle-pill">
            <input type="checkbox" checked={options.systemAudio}
              onChange={e => setOptions({ ...options, systemAudio: e.target.checked })} />
            <span>🔊 System Audio</span>
          </label>
          <label className="toggle-pill">
            <input type="checkbox" checked={options.microphone}
              onChange={e => setOptions({ ...options, microphone: e.target.checked })} />
            <span>🎤 Microphone</span>
          </label>
        </div>

        <div className="topbar__right">
          {state === 'idle' ? (
            <button className="btn btn--primary" onClick={handleStart}>▶ Start</button>
          ) : (
            <button className="btn btn--danger" onClick={async () => { stopListening(); await stopCapture(); }}>⏹ Stop</button>
          )}
          
          <select 
            className="input" 
            style={{ width: 120, padding: '4px 8px' }}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={state === 'capturing'}
          >
            <option value="English">English</option>
            <option value="Vietnamese">Vietnamese</option>
            <option value="Spanish">Spanish</option>
            <option value="French">French</option>
            <option value="German">German</option>
            <option value="Japanese">Japanese</option>
            <option value="Korean">Korean</option>
            <option value="Chinese (Simplified)">Chinese (Simplified)</option>
          </select>

          <button className={`btn btn--icon ${showDebug ? 'btn--active' : ''}`} onClick={() => setShowDebug(!showDebug)} title="Debug">🐛</button>
          <button className="btn btn--icon" onClick={() => setShowSettings(true)} title="Settings">⚙️</button>
        </div>
      </header>

      {/* Main 3-Column Layout */}
      <main className="columns">
        {/* Column 1: Transcription */}
        <section className="col">
          <div className="col__head">
            <h2>Transcription</h2>
            {state === 'capturing' && <span className="badge badge--live">Live</span>}
            {state === 'idle' && transcripts.length > 0 && <span className="badge">{transcripts.length}</span>}
          </div>
          <div className="col__body">
            {transcripts.length === 0 ? (
              <div className="empty">
                <div className="empty__icon">🎙️</div>
                <p>{state === 'capturing' ? 'Listening...' : 'Press Start to begin recording'}</p>
              </div>
            ) : (
              <div className="chat-list">
                {transcripts.map(entry => (
                  <div key={entry.id} className={`chat-bubble ${entry.source === 'whisper' ? 'chat-bubble--primary' : 'chat-bubble--secondary'}`}>
                    <div className="chat-bubble__meta">
                      <span className="chat-bubble__speaker">
                        {entry.source === 'whisper' ? '🎙️ System/Mic (Whisper)' : '🗣️ You (Instant)'}
                      </span>
                      <span className="chat-bubble__time">{formatTime(Math.floor(entry.start || 0))}</span>
                      {entry.audioUrl && (
                        <button 
                          className="btn btn--icon" 
                          style={{ padding: 2, height: 'auto', background: 'none', border: 'none', cursor: 'pointer', opacity: 0.7 }}
                          onClick={() => {
                            const audio = new Audio(entry.audioUrl)
                            audio.play().catch(e => console.error('Audio playback failed:', e))
                          }}
                          title="Play original audio"
                        >
                          ▶️
                        </button>
                      )}
                    </div>
                    <div className="chat-bubble__text">{entry.text}</div>
                  </div>
                ))}
                
                {interimTranscript && (
                  <div className="chat-bubble chat-bubble--interim">
                    <div className="chat-bubble__meta">
                      <span className="chat-bubble__speaker">🗣️ You (Instant)</span>
                      <span className="chat-bubble__time">...</span>
                    </div>
                    <div className="chat-bubble__text typing-text">{interimTranscript}</div>
                  </div>
                )}
                
                {interimWhisperTranscript && (
                  <div className="chat-bubble chat-bubble--interim" style={{ color: 'gray', fontStyle: 'italic' }}>
                    <div className="chat-bubble__meta">
                      <span className="chat-bubble__speaker">🎙️ System/Mic (Whisper)</span>
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

        {/* Column 2: Statement/Question Summary */}
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
                  <p>{state === 'capturing' ? 'Waiting for transcription data...' : 'AI summary will appear during recording'}</p>
                </div>
              </div>
            ) : (
              <>
                {/* Top 60%: Statements & Facts */}
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
                      <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No statements detected yet...</p>
                    )}
                  </div>
                  <div ref={statementsEndRef} />
                </div>

                {/* Bottom 40%: Questions & Follow-ups */}
                <div style={{ flex: '0 0 40%', overflowY: 'auto', padding: '16px' }}>
                  <div className="mindmap">
                    {summary.questions?.length > 0 && (
                      <div className="mindmap__branch">
                        <div className="mindmap__label">❓ Questions & Open Items</div>
                        {summary.questions.map((q: string, i: number) => (
                          <div key={i} className="mindmap__leaf">{q}</div>
                        ))}
                      </div>
                    )}
                    {summary.questions?.length === 0 && (
                      <p style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center' }}>No questions detected yet...</p>
                    )}
                  </div>
                  <div ref={summaryEndRef} />
                </div>
              </>
            )}
          </div>
        </section>

        {/* Column 3: Document Summary / Debug */}
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
                  <p>{state === 'capturing' ? 'Document will generate soon...' : 'Running document will appear here'}</p>
                </div>
              ) : (
              <div className="document-summary" style={{ position: 'relative' }}>
                {postMeetingProcessing && (
                  <div className="post-meeting-overlay">
                    <div className="post-meeting-overlay__content">
                      <div className="post-meeting-overlay__spinner" />
                      <p>Generating final speaker-aware summary...</p>
                      <p style={{ fontSize: 12, opacity: 0.6 }}>Diarizing audio & running GPT-5.4</p>
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
              <button className="btn btn--sm" onClick={() => window.meetsense.exportMarkdown()}>📄 Export MD</button>
              <button className="btn btn--sm" onClick={() => window.meetsense.exportJSON()}>📋 Export JSON</button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
