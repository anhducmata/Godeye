# Godeye MVP — Context-Aware Desktop Observer

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Electron desktop app (Windows-first) that captures screen area + system/mic audio, performs real-time transcription and OCR, and generates live AI summaries combining both modalities.

**Architecture:** Electron main process orchestrates capture and AI pipelines. A Python sidecar runs faster-whisper for audio transcription. Screen capture uses Electron's `desktopCapturer` API for cross-platform compatibility. Tesseract.js handles in-process OCR. An LLM API (OpenAI/Gemini) produces rolling summaries from merged audio+visual context. React frontend displays live transcript, visual notes, and summary.

**Tech Stack:**
- **Desktop shell:** Electron 33+
- **Frontend:** React 19 + Vite
- **Audio transcription:** Python sidecar with `faster-whisper` + `sounddevice`
- **OCR:** Tesseract.js (in-renderer, no native deps)
- **Vision/Summary LLM:** OpenAI GPT-4o / Gemini 2.0 Flash (user-configurable API key)
- **IPC:** Electron IPC (main↔renderer), WebSocket (main↔Python sidecar)
- **State:** In-memory rolling buffer, export to Markdown/JSON

---

## Scope Decisions

**This plan covers Phase 1 MVP only — a working end-to-end prototype on Windows.**
macOS native capture (ScreenCaptureKit) is Phase 2.

### In scope (MVP)
- Screen area/window selection & frame capture (1-2 fps)
- System audio + mic capture
- Real-time speech-to-text (faster-whisper, local)
- OCR from captured frames (Tesseract.js)
- Change detection to skip unchanged frames
- Live summary via LLM API (every 10-15s)
- Live UI: transcript panel, visual notes panel, summary panel
- Export: Markdown summary + JSON timeline
- Action items / decisions extraction

### Out of scope (Phase 2+)
- macOS ScreenCaptureKit native module
- Temporal visual memory (cross-frame state tracking)
- Visual event understanding (Level 2-3 vision)
- Slide change detection / window title tracking
- Speaker diarization
- Offline summary (local LLM)
- "What was on screen when this was said" correlation

---

## File Structure

```
Godeye/
├── package.json
├── electron.vite.config.ts
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # App entry, window management
│   │   ├── capture/
│   │   │   ├── screen.ts         # desktopCapturer + area selection
│   │   │   └── audio.ts          # System audio + mic streams
│   │   ├── sidecar/
│   │   │   └── manager.ts        # Python sidecar lifecycle
│   │   ├── pipeline/
│   │   │   ├── ocr-worker.ts     # Tesseract.js in worker thread
│   │   │   ├── change-detect.ts  # Frame diff to skip unchanged
│   │   │   └── summary-engine.ts # Rolling LLM summary state
│   │   └── ipc/
│   │       └── handlers.ts       # IPC channel definitions
│   ├── preload/
│   │   └── index.ts              # Context bridge API
│   └── renderer/                 # React frontend
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── AreaSelector.tsx   # Screen area selection overlay
│       │   ├── ControlBar.tsx     # Start/Stop, source selection
│       │   ├── TranscriptPanel.tsx
│       │   ├── VisualNotesPanel.tsx
│       │   ├── SummaryPanel.tsx
│       │   ├── ActionItems.tsx
│       │   └── Timeline.tsx
│       ├── hooks/
│       │   ├── useCapture.ts
│       │   └── useTranscript.ts
│       └── styles/
│           └── index.css
├── sidecar/                      # Python audio transcription
│   ├── requirements.txt
│   ├── server.py                 # WebSocket server for streaming ASR
│   └── transcriber.py            # faster-whisper wrapper
└── resources/                    # App icons, etc.
```

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`
- Create: `src/main/index.ts`, `src/preload/index.ts`
- Create: `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Create: `src/renderer/styles/index.css`

- [ ] **Step 1: Initialize Electron + Vite project**

```bash
cd c:\Users\Mata\Godeye
npm init -y
npm install electron electron-vite vite react react-dom
npm install -D @types/react @types/react-dom typescript @vitejs/plugin-react
```

- [ ] **Step 2: Create `electron.vite.config.ts`**

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()]
  }
})
```

- [ ] **Step 3: Create `tsconfig.json` with path aliases**

- [ ] **Step 4: Create minimal main process `src/main/index.ts`**

```typescript
import { app, BrowserWindow } from 'electron'
import path from 'path'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
```

- [ ] **Step 5: Create preload script `src/preload/index.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('godeye', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  startCapture: (config: any) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),
  onTranscript: (cb: Function) => ipcRenderer.on('transcript', (_e, data) => cb(data)),
  onVisualNote: (cb: Function) => ipcRenderer.on('visual-note', (_e, data) => cb(data)),
  onSummary: (cb: Function) => ipcRenderer.on('summary', (_e, data) => cb(data)),
})
```

- [ ] **Step 6: Create minimal React app with dark theme placeholder UI**

Create `src/renderer/main.tsx`, `App.tsx`, `index.html`, and `index.css` with a dark-themed layout showing three panels (Transcript, Visual Notes, Summary) and a top control bar.

- [ ] **Step 7: Verify app launches**

```bash
npx electron-vite dev
```

Expected: Electron window opens showing dark-themed UI with three empty panels.

- [ ] **Step 8: Commit**

```bash
git init
git add .
git commit -m "feat: initial project scaffolding with Electron + Vite + React"
```

---

## Task 2: Screen Capture — Source Selection & Frame Capture

**Files:**
- Create: `src/main/capture/screen.ts`
- Modify: `src/main/index.ts` (register IPC handlers)
- Modify: `src/preload/index.ts` (expose capture APIs)
- Create: `src/renderer/components/ControlBar.tsx`
- Create: `src/renderer/components/AreaSelector.tsx`

- [ ] **Step 1: Implement `screen.ts` — get available sources**

Use `desktopCapturer.getSources()` to list screens and windows. Return source id, name, and thumbnail.

- [ ] **Step 2: Implement area selection flow**

When user clicks "Select Area", open a transparent fullscreen window. User draws a rectangle. Store the crop region `{x, y, width, height}`.

- [ ] **Step 3: Implement frame capture loop**

Use `setInterval` at 1 fps. Capture the selected source via `desktopCapturer`, crop to region if area-selected, emit frame as base64 PNG via IPC.

- [ ] **Step 4: Build ControlBar component**

Dropdown to select source (screen/window), "Select Area" button, "Start"/"Stop" button.

- [ ] **Step 5: Verify frames are captured**

Start capture, check that frames are logged in main process console at ~1 fps.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: screen capture with source selection and area crop"
```

---

## Task 3: Audio Capture — System Audio + Microphone

**Files:**
- Create: `src/main/capture/audio.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/ControlBar.tsx` (audio source toggles)

- [ ] **Step 1: Implement system audio capture**

In the renderer, use `navigator.mediaDevices.getUserMedia` with the desktopCapturer source's `audio: true` constraint. Stream PCM chunks to main process via IPC.

- [ ] **Step 2: Implement microphone capture**

Use `navigator.mediaDevices.getUserMedia({ audio: true })` for mic. Allow user to toggle mic on/off.

- [ ] **Step 3: Implement audio mixer**

In main process, receive both streams. Interleave/mix PCM buffers into a single mono 16kHz stream (required by Whisper).

- [ ] **Step 4: Add audio source toggles to ControlBar**

Checkboxes: "System Audio" and "Microphone" with device dropdowns.

- [ ] **Step 5: Verify audio capture**

Capture 5 seconds, save to WAV file, play back to confirm audio is captured correctly.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: system audio + microphone capture with mixer"
```

---

## Task 4: Python Sidecar — Faster-Whisper Real-Time ASR

**Files:**
- Create: `sidecar/requirements.txt`
- Create: `sidecar/transcriber.py`
- Create: `sidecar/server.py`
- Create: `src/main/sidecar/manager.ts`

- [ ] **Step 1: Create `requirements.txt`**

```
faster-whisper==1.1.0
websockets>=12.0
numpy
sounddevice
```

- [ ] **Step 2: Implement `transcriber.py`**

```python
from faster_whisper import WhisperModel

class RealtimeTranscriber:
    def __init__(self, model_size="base", device="cpu"):
        self.model = WhisperModel(model_size, device=device, compute_type="int8")
    
    def transcribe_chunk(self, audio_chunk, sr=16000):
        """Transcribe a numpy float32 audio array. Returns list of {text, start, end}."""
        segments, _ = self.model.transcribe(
            audio_chunk,
            beam_size=1,
            language=None,  # auto-detect
            vad_filter=True
        )
        return [{"text": s.text.strip(), "start": s.start, "end": s.end} for s in segments]
```

- [ ] **Step 3: Implement `server.py` — WebSocket server**

WebSocket server on `localhost:9876`. Receives binary PCM audio chunks, returns JSON transcription results.

```python
import asyncio
import websockets
import json
import numpy as np
from transcriber import RealtimeTranscriber

transcriber = RealtimeTranscriber(model_size="base")

async def handle(ws):
    async for message in ws:
        audio = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
        results = transcriber.transcribe_chunk(audio)
        if results:
            await ws.send(json.dumps(results))

async def main():
    async with websockets.serve(handle, "localhost", 9876):
        print("ASR server running on ws://localhost:9876")
        await asyncio.Future()  # run forever

asyncio.run(main())
```

- [ ] **Step 4: Implement `sidecar/manager.ts`**

Spawn Python process, manage lifecycle, health-check WebSocket connection. Auto-install requirements on first run.

- [ ] **Step 5: Wire audio pipeline to sidecar**

Main process sends audio chunks via WebSocket to sidecar, receives transcription, emits to renderer via IPC.

- [ ] **Step 6: Verify transcription**

Play a YouTube video, capture system audio, see transcript appear in console.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: Python sidecar with faster-whisper real-time transcription"
```

---

## Task 5: OCR Pipeline — Tesseract.js on Captured Frames

**Files:**
- Create: `src/main/pipeline/ocr-worker.ts`
- Create: `src/main/pipeline/change-detect.ts`

- [ ] **Step 1: Install Tesseract.js**

```bash
npm install tesseract.js
```

- [ ] **Step 2: Implement `change-detect.ts`**

Compare current frame to previous frame using pixel difference. If < 5% pixels changed, skip OCR.

```typescript
export function hasSignificantChange(prev: Buffer, curr: Buffer, threshold = 0.05): boolean {
  let diffCount = 0
  const pixelCount = prev.length / 4
  for (let i = 0; i < prev.length; i += 4) {
    const dr = Math.abs(prev[i] - curr[i])
    const dg = Math.abs(prev[i+1] - curr[i+1])
    const db = Math.abs(prev[i+2] - curr[i+2])
    if (dr + dg + db > 30) diffCount++
  }
  return diffCount / pixelCount > threshold
}
```

- [ ] **Step 3: Implement `ocr-worker.ts`**

Use Tesseract.js to extract text from frames. Run in a Worker thread to avoid blocking main process.

- [ ] **Step 4: Wire OCR into capture pipeline**

On each frame: check change → if changed, run OCR → emit visual note with timestamp.

- [ ] **Step 5: Verify OCR output**

Open a slide presentation, capture frames, check that OCR text matches slide content.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: OCR pipeline with change detection and worker thread"
```

---

## Task 6: Live Summary Engine

**Files:**
- Create: `src/main/pipeline/summary-engine.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Implement rolling context buffer**

```typescript
interface ContextEntry {
  timestamp: number
  type: 'transcript' | 'visual'
  content: string
}

class SummaryEngine {
  private buffer: ContextEntry[] = []
  private summaryState: string = ''
  private decisions: string[] = []
  private actionItems: string[] = []
  private lastSummaryTime = 0
  
  addEntry(entry: ContextEntry) {
    this.buffer.push(entry)
    // Keep last 15 minutes
    const cutoff = Date.now() - 15 * 60 * 1000
    this.buffer = this.buffer.filter(e => e.timestamp > cutoff)
  }
  
  shouldRefresh(): boolean {
    return Date.now() - this.lastSummaryTime > 10_000
  }
}
```

- [ ] **Step 2: Implement LLM summary call**

Build a prompt that includes:
- Previous summary state
- Recent transcript utterances (last 30s)
- Recent visual notes (last 30s)
- Instructions to extract: current topic, key decisions, action items, unresolved questions

Call OpenAI/Gemini API. Parse structured response.

- [ ] **Step 3: Implement API key configuration**

Show settings dialog on first launch. Store API key in electron-store. Support OpenAI and Gemini.

- [ ] **Step 4: Wire summary engine into pipeline**

Every 10s: collect recent context → call LLM → emit summary to renderer.

- [ ] **Step 5: Verify summary generation**

Run a mock meeting (play video + audio), check that summaries appear and are coherent.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: live summary engine with LLM API integration"
```

---

## Task 7: React Frontend — Live Panels

**Files:**
- Create: `src/renderer/components/TranscriptPanel.tsx`
- Create: `src/renderer/components/VisualNotesPanel.tsx`
- Create: `src/renderer/components/SummaryPanel.tsx`
- Create: `src/renderer/components/ActionItems.tsx`
- Create: `src/renderer/components/Timeline.tsx`
- Create: `src/renderer/hooks/useCapture.ts`
- Create: `src/renderer/hooks/useTranscript.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles/index.css`

- [ ] **Step 1: Build `useCapture` and `useTranscript` hooks**

Custom hooks that subscribe to IPC events and manage state.

- [ ] **Step 2: Build TranscriptPanel**

Scrollable list of timestamped utterances. Auto-scroll to bottom. Highlight current.

- [ ] **Step 3: Build VisualNotesPanel**

Show OCR results grouped by change events. Include small thumbnail of the frame.

- [ ] **Step 4: Build SummaryPanel**

Display current summary, key decisions, action items. Updates live.

- [ ] **Step 5: Build ActionItems component**

Extracted action items with checkboxes. Editable.

- [ ] **Step 6: Polish layout and styling**

Dark theme, glassmorphism panels, smooth transitions, responsive layout. Three-column layout: Transcript | Visual Notes | Summary+Actions.

- [ ] **Step 7: Build Timeline component**

Horizontal timeline showing events (transcript + visual) along a time axis.

- [ ] **Step 8: Verify full UI**

Run capture session, verify all panels update live.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: live UI panels — transcript, visual notes, summary, actions"
```

---

## Task 8: Export & Session Management

**Files:**
- Create: `src/main/export.ts`
- Modify: `src/renderer/components/ControlBar.tsx`

- [ ] **Step 1: Implement Markdown export**

Generate a structured Markdown document with:
- Meeting metadata (date, duration)
- Full transcript
- Summary
- Decisions
- Action items
- Visual timeline

- [ ] **Step 2: Implement JSON export**

Raw timeline data with timestamps, transcript entries, visual notes, and summaries.

- [ ] **Step 3: Add export buttons to UI**

"Export Markdown" and "Export JSON" buttons in the control bar after session ends.

- [ ] **Step 4: Implement session save/load**

Auto-save session data to `~/.godeye/sessions/`. Allow loading past sessions.

- [ ] **Step 5: Verify export**

Run a session, export both formats, inspect output files.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat: session export to Markdown and JSON"
```

---

## Task 9: Integration Testing & Polish

- [ ] **Step 1: End-to-end test**

Run a full 5-minute session capturing a Zoom/Meet call. Verify:
- Transcript captures speech correctly
- OCR captures shared screen content
- Summaries are coherent and reference both audio and visual context
- No memory leaks over extended sessions

- [ ] **Step 2: Performance profiling**

Check CPU/memory usage. Target: < 20% CPU, < 500MB RAM during active capture.

- [ ] **Step 3: Error handling**

- Sidecar crash recovery
- API rate limit handling
- Permission denied handling
- Graceful degradation if OCR or ASR fails

- [ ] **Step 4: Polish UI**

- Loading states
- Error toasts
- Keyboard shortcuts (Ctrl+S to export, Space to pause)
- System tray for background running

- [ ] **Step 5: Final commit and tag**

```bash
git add .
git commit -m "feat: integration test, error handling, and UI polish"
git tag v0.1.0
```

---

## Verification Plan

### Automated Tests
Since this is a desktop app with hardware dependencies (screen, audio), automated unit tests will focus on the data processing pipeline:

```bash
# Run unit tests for change detection, summary buffer, export formatting
npm test

# Run Python sidecar tests
cd sidecar && python -m pytest test_transcriber.py -v
```

### Manual Verification

Each task includes a verification step. The key end-to-end verification is:

1. **Launch app:** `npx electron-vite dev`
2. **Select a screen region** containing a video call or presentation
3. **Enable system audio + mic**
4. **Press Start**
5. **Verify panels update:** Transcript shows speech, Visual Notes show OCR text, Summary updates every ~10s
6. **After 2-3 minutes**, press Stop
7. **Export Markdown** — open file, verify it contains transcript, summary, action items
8. **Export JSON** — open file, verify timeline entries have correct timestamps

### User Testing
After Task 9 is complete, the user should:
1. Run a real meeting with Godeye active
2. Verify the summary captures key discussion points
3. Verify OCR captures shared screen content
4. Provide feedback on summary quality and UI usability
