import React, { useRef, useEffect } from 'react'
import { useCapture } from './hooks/useCapture'
import { useTranscript } from './hooks/useTranscript'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0')
  const s = (seconds % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}

function App() {
  const {
    state,
    sources,
    selectedSource,
    setSelectedSource,
    cropRegion,
    options,
    setOptions,
    latestFrame,
    elapsed,
    loadSources,
    selectArea,
    startCapture,
    stopCapture
  } = useCapture()

  const {
    transcripts,
    visualNotes,
    summary,
    clearAll
  } = useTranscript()

  const transcriptEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [transcripts])

  const handleStart = async () => {
    if (!selectedSource) {
      await loadSources()
      return
    }
    clearAll()
    await startCapture()
  }

  const handleStop = async () => {
    await stopCapture()
  }

  return (
    <div className="app">
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
          {/* Source selector */}
          <select
            className="btn btn--source"
            id="select-source"
            value={selectedSource?.id || ''}
            onChange={(e) => {
              const src = sources.find(s => s.id === e.target.value)
              if (src) setSelectedSource(src)
            }}
            onClick={() => loadSources()}
          >
            <option value="" disabled>🖥️ Select Source</option>
            {sources.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>

          <button className="btn btn--area" id="select-area" onClick={selectArea}>
            <span className="btn__icon">⬒</span>
            {cropRegion ? `${cropRegion.width}×${cropRegion.height}` : 'Select Area'}
          </button>

          <div className="audio-toggles">
            <label className="toggle" id="toggle-system-audio">
              <input
                type="checkbox"
                checked={options.systemAudio}
                onChange={e => setOptions({ ...options, systemAudio: e.target.checked })}
              />
              <span className="toggle__label">🔊 System</span>
            </label>
            <label className="toggle" id="toggle-mic">
              <input
                type="checkbox"
                checked={options.microphone}
                onChange={e => setOptions({ ...options, microphone: e.target.checked })}
              />
              <span className="toggle__label">🎤 Mic</span>
            </label>
          </div>
        </div>

        <div className="control-bar__right">
          {state === 'idle' ? (
            <button className="btn btn--start" id="btn-start" onClick={handleStart}>
              ▶ Start
            </button>
          ) : (
            <button className="btn btn--stop" id="btn-stop" onClick={handleStop}>
              ⏹ Stop
            </button>
          )}
          <button className="btn btn--settings" id="btn-settings">⚙️</button>
        </div>
      </header>

      {/* Main Content — Three Column Layout */}
      <main className="panels">
        {/* Left Panel: Transcript */}
        <section className="panel panel--transcript" id="panel-transcript">
          <div className="panel__header">
            <h2 className="panel__title">📝 Transcript</h2>
            <span className="panel__badge">{state === 'capturing' ? 'Live' : `${transcripts.length} entries`}</span>
          </div>
          <div className="panel__content">
            {transcripts.length === 0 ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🎙️</p>
                <p>Start a session to see live transcription</p>
              </div>
            ) : (
              <div className="transcript-list">
                {transcripts.map((entry) => (
                  <div key={entry.id} className="transcript-entry">
                    <span className="transcript-entry__time">
                      {formatTime(Math.floor(entry.start))}
                    </span>
                    <span className="transcript-entry__text">{entry.text}</span>
                  </div>
                ))}
                <div ref={transcriptEndRef} />
              </div>
            )}
          </div>
        </section>

        {/* Middle Panel: Visual Notes */}
        <section className="panel panel--visual" id="panel-visual">
          <div className="panel__header">
            <h2 className="panel__title">👁 Visual Notes</h2>
            <span className="panel__badge">{state === 'capturing' ? 'OCR' : `${visualNotes.length} notes`}</span>
          </div>
          <div className="panel__content">
            {visualNotes.length === 0 ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🖥️</p>
                <p>Select a screen area to capture visual context</p>
                {latestFrame && (
                  <img
                    src={latestFrame}
                    className="panel__preview"
                    style={{ maxWidth: '100%', marginTop: 16, borderRadius: 8, opacity: 0.6 }}
                    alt="Latest frame"
                  />
                )}
              </div>
            ) : (
              <div className="visual-notes-list">
                {visualNotes.map((note) => (
                  <div key={note.id} className="visual-note">
                    {note.thumbnail && (
                      <div className="visual-note__thumb">
                        <img src={note.thumbnail} alt="Frame" />
                      </div>
                    )}
                    <div className="visual-note__content">
                      <span className="visual-note__time">{formatTime(Math.floor((note.timestamp - (transcripts[0]?.timestamp || note.timestamp)) / 1000))}</span>
                      <p className="visual-note__text">{note.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Right Panel: Summary + Actions */}
        <section className="panel panel--summary" id="panel-summary">
          <div className="panel__header">
            <h2 className="panel__title">🧠 Summary</h2>
            <span className="panel__badge">AI</span>
          </div>
          <div className="panel__content">
            {!summary ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">✨</p>
                <p>AI summary will appear here during your session</p>
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
                {summary.decisions.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">✅ Decisions</h3>
                    <ul className="summary-section__list">
                      {summary.decisions.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                )}
                {summary.actionItems.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">🎯 Action Items</h3>
                    <ul className="action-items">
                      {summary.actionItems.map((item, i) => (
                        <li key={i} className="action-item">
                          <input type="checkbox" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {summary.unresolvedQuestions.length > 0 && (
                  <div className="summary-section">
                    <h3 className="summary-section__title">❓ Unresolved Questions</h3>
                    <ul className="summary-section__list">
                      {summary.unresolvedQuestions.map((q, i) => <li key={i}>{q}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="panel__footer">
            <button className="btn btn--export" id="btn-export-md" disabled={state === 'capturing'}>
              📄 Export MD
            </button>
            <button className="btn btn--export" id="btn-export-json" disabled={state === 'capturing'}>
              📋 Export JSON
            </button>
          </div>
        </section>
      </main>

      {/* Bottom Timeline */}
      <footer className="timeline" id="timeline">
        <div className="timeline__track">
          <div className="timeline__label">
            {state === 'capturing' ? `● REC ${formatTime(elapsed)}` : 'Timeline'}
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
