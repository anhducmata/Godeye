import React, { useRef, useEffect, useState } from 'react'
import { useCapture } from './hooks/useCapture'
import { useTranscript } from './hooks/useTranscript'

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

  const { transcripts, summary, clearAll, startListening, stopListening } = useTranscript()

  const [showSettings, setShowSettings] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini'>('gemini')

  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const debugEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [debugLogs])

  const handleStart = async () => {
    if (apiKey) {
      await window.godeye.setApiKey({ apiKey, provider: apiProvider })
    }
    clearAll()
    addDebugLog(`▶ Starting: audio=${options.systemAudio}, mic=${options.microphone}`)
    await startCapture()
    startListening()
    addDebugLog('🎙️ Web Speech API transcription started')
  }

  const handleSaveSettings = async () => {
    if (apiKey) {
      await window.godeye.setApiKey({ apiKey, provider: apiProvider })
      addDebugLog(`⚙️ API key set for ${apiProvider}`)
    }
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
          <span className="topbar__logo">👁 Godeye</span>
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
              <div className="transcript-list">
                {transcripts.map(entry => (
                  <div key={entry.id} className="tr-entry">
                    <span className="tr-entry__time">{formatTime(Math.floor(entry.start || 0))}</span>
                    <span className="tr-entry__text">{entry.text}</span>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </section>

        {/* Column 2: Mindmap Summary */}
        <section className="col">
          <div className="col__head">
            <h2>Mindmap</h2>
            <span className="badge">AI</span>
          </div>
          <div className="col__body">
            {!summary ? (
              <div className="empty">
                <div className="empty__icon">🧠</div>
                <p>{!apiKey ? 'Set API key in ⚙️ to enable' : 'Summary will appear here'}</p>
              </div>
            ) : (
              <div className="mindmap">
                <div className="mindmap__topic">{summary.currentTopic || 'Session'}</div>
                {summary.decisions?.length > 0 && (
                  <div className="mindmap__branch">
                    <div className="mindmap__label">✅ Decisions</div>
                    {summary.decisions.map((d: string, i: number) => (
                      <div key={i} className="mindmap__leaf">{d}</div>
                    ))}
                  </div>
                )}
                {summary.actionItems?.length > 0 && (
                  <div className="mindmap__branch">
                    <div className="mindmap__label">🎯 Actions</div>
                    {summary.actionItems.map((a: string, i: number) => (
                      <div key={i} className="mindmap__leaf mindmap__leaf--action">
                        <input type="checkbox" /> {a}
                      </div>
                    ))}
                  </div>
                )}
                {summary.unresolvedQuestions?.length > 0 && (
                  <div className="mindmap__branch">
                    <div className="mindmap__label">❓ Open Questions</div>
                    {summary.unresolvedQuestions.map((q: string, i: number) => (
                      <div key={i} className="mindmap__leaf">{q}</div>
                    ))}
                  </div>
                )}
              </div>
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
            ) : !summary ? (
              <div className="empty">
                <div className="empty__icon">📄</div>
                <p>Document summary will appear here during your session</p>
              </div>
            ) : (
              <div className="doc-summary">
                <p>{summary.summary}</p>
              </div>
            )}
          </div>
          {!showDebug && (
            <div className="col__foot">
              <button className="btn btn--sm" onClick={() => window.godeye.exportMarkdown()}>📄 Export MD</button>
              <button className="btn btn--sm" onClick={() => window.godeye.exportJSON()}>📋 Export JSON</button>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

export default App
