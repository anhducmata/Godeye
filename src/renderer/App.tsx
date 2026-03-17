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
    state, sources, selectedSource, setSelectedSource,
    cropRegion, options, setOptions, latestFrame, elapsed,
    loadSources, selectArea, startCapture, stopCapture,
    frameCount, debugLogs, addDebugLog
  } = useCapture()

  const { transcripts, visualNotes, summary, clearAll } = useTranscript()

  const [showSettings, setShowSettings] = useState(false)
  const [showDebug, setShowDebug] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [apiProvider, setApiProvider] = useState<'openai' | 'gemini'>('openai')

  const transcriptEndRef = useRef<HTMLDivElement>(null)
  const debugEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  // Auto-scroll debug
  useEffect(() => {
    debugEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [debugLogs])

  const handleStart = async () => {
    if (!selectedSource) {
      addDebugLog('⚠️ No source selected — loading sources...')
      await loadSources()
      return
    }
    if (apiKey) {
      await window.godeye.setApiKey({ apiKey, provider: apiProvider })
    }
    addDebugLog(`▶ Starting capture: source="${selectedSource.name}", crop=${cropRegion ? `${cropRegion.width}×${cropRegion.height}` : 'none'}`)
    clearAll()
    await startCapture()
  }

  const handleExportMd = async () => {
    await window.godeye.exportMarkdown()
  }

  const handleExportJson = async () => {
    await window.godeye.exportJSON()
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
            <h2 className="modal__title">⚙️ Settings</h2>
            <div className="modal__field">
              <label>AI Provider</label>
              <select value={apiProvider} onChange={e => setApiProvider(e.target.value as any)}>
                <option value="openai">OpenAI (GPT-4o-mini)</option>
                <option value="gemini">Google Gemini (2.0 Flash)</option>
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
              <button className="btn btn--start" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Header / Control Bar */}
      <header className="control-bar">
        <div className="control-bar__left">
          <div className="logo">
            <span className="logo__icon">👁</span>
            <span className="logo__text">Godeye</span>
          </div>
          <div className="control-bar__status">
            {state === 'idle' && <span className="status status--idle">Ready</span>}
            {state === 'capturing' && (
              <span className="status status--live">
                <span className="status__dot"></span>
                LIVE · {formatTime(elapsed)}
              </span>
            )}
          </div>
        </div>

        <div className="control-bar__center">
          <select
            className="btn btn--source"
            id="select-source"
            value={selectedSource?.id || ''}
            onChange={e => {
              const src = sources.find(s => s.id === e.target.value)
              if (src) {
                setSelectedSource(src)
                addDebugLog(`📺 Selected source: "${src.name}" (${src.id})`)
              }
            }}
            onClick={() => loadSources()}
          >
            <option value="" disabled>🖥️ Select Source</option>
            {sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>

          <button className="btn btn--area" id="select-area" onClick={selectArea}>
            <span className="btn__icon">⬒</span>
            {cropRegion ? `${cropRegion.width}×${cropRegion.height}` : 'Select Area'}
          </button>

          <div className="audio-toggles">
            <label className="toggle">
              <input type="checkbox" checked={options.systemAudio}
                onChange={e => setOptions({ ...options, systemAudio: e.target.checked })} />
              <span className="toggle__label">🔊 System</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={options.microphone}
                onChange={e => setOptions({ ...options, microphone: e.target.checked })} />
              <span className="toggle__label">🎤 Mic</span>
            </label>
          </div>
        </div>

        <div className="control-bar__right">
          {state === 'idle' ? (
            <button className="btn btn--start" onClick={handleStart}>▶ Start</button>
          ) : (
            <button className="btn btn--stop" onClick={stopCapture}>⏹ Stop</button>
          )}
          <button
            className={`btn btn--debug ${showDebug ? 'btn--debug-active' : ''}`}
            onClick={() => setShowDebug(!showDebug)}
            title="Toggle Debug Panel"
          >🐛</button>
          <button className="btn btn--settings" onClick={() => setShowSettings(true)}>⚙️</button>
        </div>
      </header>

      {/* Main Content */}
      <main className="panels">
        {/* Transcript Panel */}
        <section className="panel panel--transcript">
          <div className="panel__header">
            <h2 className="panel__title">📝 Transcript</h2>
            <span className="panel__badge">
              {state === 'capturing' ? 'Live' : `${transcripts.length}`}
            </span>
          </div>
          <div className="panel__content">
            {transcripts.length === 0 ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🎙️</p>
                <p>Start a session to see live transcription</p>
              </div>
            ) : (
              <div className="transcript-list">
                {transcripts.map(entry => (
                  <div key={entry.id} className="transcript-entry">
                    <span className="transcript-entry__time">{formatTime(Math.floor(entry.start))}</span>
                    <span className="transcript-entry__text">{entry.text}</span>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </section>

        {/* Visual Notes Panel — with live frame preview */}
        <section className="panel panel--visual">
          <div className="panel__header">
            <h2 className="panel__title">👁 Visual Notes</h2>
            <span className="panel__badge">
              {state === 'capturing' ? `📷 ${frameCount}` : `${visualNotes.length}`}
            </span>
          </div>
          <div className="panel__content">
            {/* Live frame preview always shown when capturing */}
            {state === 'capturing' && latestFrame && (
              <div className="live-preview">
                <div className="live-preview__label">
                  <span className="live-preview__dot"></span>
                  LIVE PREVIEW
                </div>
                <img
                  src={latestFrame}
                  className="live-preview__img"
                  alt="Live capture"
                />
              </div>
            )}

            {/* Visual notes list */}
            {visualNotes.length === 0 && !latestFrame ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🖥️</p>
                <p>Select a screen area to capture visual context</p>
              </div>
            ) : (
              <div className="visual-notes-list">
                {visualNotes.map(note => (
                  <div key={note.id} className="visual-note">
                    {note.thumbnail && (
                      <div className="visual-note__thumb">
                        <img src={note.thumbnail} alt="" />
                      </div>
                    )}
                    <div className="visual-note__content">
                      <span className="visual-note__time">
                        {new Date(note.timestamp).toLocaleTimeString()}
                      </span>
                      <p className="visual-note__text">{note.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Summary / Debug Panel */}
        <section className="panel panel--summary">
          <div className="panel__header">
            <h2 className="panel__title">
              {showDebug ? '🐛 Debug Console' : '🧠 Summary'}
            </h2>
            <span className="panel__badge">
              {showDebug ? `${debugLogs.length} logs` : 'AI'}
            </span>
          </div>
          <div className="panel__content">
            {showDebug ? (
              /* Debug Console */
              <div className="debug-console">
                {debugLogs.length === 0 ? (
                  <div className="panel__empty">
                    <p className="panel__empty-icon">🔍</p>
                    <p>Debug logs will appear here</p>
                  </div>
                ) : (
                  debugLogs.map((log, i) => (
                    <div key={i} className="debug-entry">
                      <span className="debug-entry__time">{log.time}</span>
                      <span className={`debug-entry__msg ${log.level === 'error' ? 'debug-entry__msg--error' : log.level === 'warn' ? 'debug-entry__msg--warn' : ''}`}>
                        {log.message}
                      </span>
                    </div>
                  ))
                )}
                <div ref={debugEndRef} />
              </div>
            ) : !summary ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">✨</p>
                <p>
                  {!apiKey
                    ? 'Configure API key in ⚙️ Settings to enable AI summaries'
                    : 'AI summary will appear here during your session'}
                </p>
              </div>
            ) : (
              <div className="summary-content">
                <div className="summary-section">
                  <h3 className="summary-section__title">Current Topic</h3>
                  <p className="summary-section__text">{summary.currentTopic}</p>
                </div>
                <div className="summary-section">
                  <h3 className="summary-section__title">Summary</h3>
                  <p className="summary-section__text">{summary.summary}</p>
                </div>
                {summary.decisions?.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">✅ Decisions</h3>
                    <ul className="summary-section__list">
                      {summary.decisions.map((d: string, i: number) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
                {summary.actionItems?.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">🎯 Action Items</h3>
                    <ul className="action-items">
                      {summary.actionItems.map((item: string, i: number) => (
                        <li key={i} className="action-item">
                          <input type="checkbox" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.unresolvedQuestions?.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">❓ Unresolved</h3>
                    <ul className="summary-section__list">
                      {summary.unresolvedQuestions.map((q: string, i: number) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="panel__footer">
            <button className="btn btn--export" onClick={handleExportMd} disabled={state === 'capturing'}>
              📄 Export MD
            </button>
            <button className="btn btn--export" onClick={handleExportJson} disabled={state === 'capturing'}>
              📋 Export JSON
            </button>
          </div>
        </section>
      </main>

      {/* Timeline */}
      <footer className="timeline">
        <div className="timeline__track">
          <div className="timeline__label">
            {state === 'capturing' ? `● REC ${formatTime(elapsed)} · Frames: ${frameCount}` : 'Timeline'}
          </div>
          {state === 'capturing' && (
            <div className="timeline__bar">
              <div className="timeline__progress" style={{ width: '100%' }}></div>
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

export default App
