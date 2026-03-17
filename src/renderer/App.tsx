import React, { useState } from 'react'

type AppState = 'idle' | 'capturing' | 'paused'

function App() {
  const [appState, setAppState] = useState<AppState>('idle')
  const [sessionDuration, setSessionDuration] = useState(0)

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
            {appState === 'idle' && <span className="status status--idle">Ready</span>}
            {appState === 'capturing' && (
              <span className="status status--live">
                <span className="status__dot"></span>
                LIVE
              </span>
            )}
            {appState === 'paused' && <span className="status status--paused">Paused</span>}
          </div>
        </div>

        <div className="control-bar__center">
          <button className="btn btn--source" id="select-source">
            <span className="btn__icon">🖥️</span>
            Select Source
          </button>
          <button className="btn btn--area" id="select-area">
            <span className="btn__icon">⬒</span>
            Select Area
          </button>
          <div className="audio-toggles">
            <label className="toggle" id="toggle-system-audio">
              <input type="checkbox" defaultChecked />
              <span className="toggle__label">🔊 System</span>
            </label>
            <label className="toggle" id="toggle-mic">
              <input type="checkbox" defaultChecked />
              <span className="toggle__label">🎤 Mic</span>
            </label>
          </div>
        </div>

        <div className="control-bar__right">
          {appState === 'idle' ? (
            <button
              className="btn btn--start"
              id="btn-start"
              onClick={() => setAppState('capturing')}
            >
              ▶ Start
            </button>
          ) : (
            <>
              <button
                className="btn btn--pause"
                id="btn-pause"
                onClick={() => setAppState(appState === 'paused' ? 'capturing' : 'paused')}
              >
                {appState === 'paused' ? '▶ Resume' : '⏸ Pause'}
              </button>
              <button
                className="btn btn--stop"
                id="btn-stop"
                onClick={() => setAppState('idle')}
              >
                ⏹ Stop
              </button>
            </>
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
            <span className="panel__badge">Live</span>
          </div>
          <div className="panel__content">
            {appState === 'idle' ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🎙️</p>
                <p>Start a session to see live transcription</p>
              </div>
            ) : (
              <div className="transcript-list">
                <div className="transcript-entry">
                  <span className="transcript-entry__time">00:00</span>
                  <span className="transcript-entry__text">Waiting for audio...</span>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Middle Panel: Visual Notes */}
        <section className="panel panel--visual" id="panel-visual">
          <div className="panel__header">
            <h2 className="panel__title">👁 Visual Notes</h2>
            <span className="panel__badge">OCR</span>
          </div>
          <div className="panel__content">
            {appState === 'idle' ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">🖥️</p>
                <p>Select a screen area to capture visual context</p>
              </div>
            ) : (
              <div className="visual-notes-list">
                <div className="visual-note">
                  <div className="visual-note__thumb"></div>
                  <div className="visual-note__content">
                    <span className="visual-note__time">00:00</span>
                    <p className="visual-note__text">Analyzing screen...</p>
                  </div>
                </div>
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
            {appState === 'idle' ? (
              <div className="panel__empty">
                <p className="panel__empty-icon">✨</p>
                <p>AI summary will appear here during your session</p>
              </div>
            ) : (
              <div className="summary-content">
                <div className="summary-section">
                  <h3 className="summary-section__title">Current Topic</h3>
                  <p className="summary-section__text">Waiting for context...</p>
                </div>
                <div className="summary-section">
                  <h3 className="summary-section__title">Key Points</h3>
                  <ul className="summary-section__list">
                    <li>Session just started</li>
                  </ul>
                </div>
                <div className="summary-section">
                  <h3 className="summary-section__title">🎯 Action Items</h3>
                  <ul className="action-items">
                    <li className="action-item">
                      <input type="checkbox" />
                      <span>No action items yet</span>
                    </li>
                  </ul>
                </div>
                <div className="summary-section">
                  <h3 className="summary-section__title">❓ Unresolved</h3>
                  <ul className="summary-section__list">
                    <li>No questions yet</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Export buttons (visible after session) */}
          <div className="panel__footer">
            <button className="btn btn--export" id="btn-export-md">📄 Export MD</button>
            <button className="btn btn--export" id="btn-export-json">📋 Export JSON</button>
          </div>
        </section>
      </main>

      {/* Bottom Timeline */}
      <footer className="timeline" id="timeline">
        <div className="timeline__track">
          <div className="timeline__label">Timeline</div>
          {appState !== 'idle' && (
            <div className="timeline__bar">
              <div className="timeline__progress" style={{ width: '0%' }}></div>
            </div>
          )}
        </div>
      </footer>
    </div>
  )
}

export default App
