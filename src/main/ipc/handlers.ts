import { ipcMain, BrowserWindow, dialog } from 'electron'
import { ScreenCapturer, CaptureFrame } from '../capture/screen'
import { AudioCapturer, AudioChunk } from '../capture/audio'
import { SidecarManager, TranscriptionResult } from '../sidecar/manager'
import { OcrPipeline } from '../pipeline/ocr-worker'
import { SummaryEngine, SummaryState } from '../pipeline/summary-engine'
import { exportMarkdown, exportJSON, SessionData } from '../export'
import fs from 'fs'
import crypto from 'crypto'

/**
 * Central IPC handler registry.
 * Audio-first approach: audio capture always works.
 * Screen capture is optional and non-blocking.
 */

let screenCapturer: ScreenCapturer
let audioCapturer: AudioCapturer
let sidecarManager: SidecarManager
let ocrPipeline: OcrPipeline
let summaryEngine: SummaryEngine
let mainWindow: BrowserWindow | null = null
let sessionStartTime = 0
let transcriptEntries: any[] = []
let visualNotes: any[] = []
let screenCaptureEnabled = false

/** Safe IPC send — ignores errors when the renderer frame is momentarily unavailable */
function safeSend(channel: string, data?: any) {
  try {
    if (
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.webContents &&
      !mainWindow.webContents.isDestroyed() &&
      !mainWindow.webContents.isLoading()
    ) {
      mainWindow.webContents.send(channel, data)
    }
  } catch {
    // Renderer frame was disposed (HMR reload, overlay, etc.) — safe to ignore
  }
}

export function initializeHandlers(window: BrowserWindow) {
  mainWindow = window
  screenCapturer = new ScreenCapturer()
  audioCapturer = new AudioCapturer()
  sidecarManager = new SidecarManager()
  ocrPipeline = new OcrPipeline()
  summaryEngine = new SummaryEngine()

  // Register audio IPC
  audioCapturer.registerIpcHandlers()

  // --- Screen capture handlers ---
  ipcMain.handle('get-screen-sources', async () => {
    return screenCapturer.getSources()
  })

  ipcMain.handle('select-area', async () => {
    if (!mainWindow) return null
    return screenCapturer.selectArea(mainWindow)
  })

  // --- Settings ---
  ipcMain.handle('set-api-key', async (_event, config: { apiKey: string; provider: 'openai' | 'gemini' }) => {
    summaryEngine.configure(config)
    return { success: true }
  })

  // --- Capture lifecycle ---
  ipcMain.handle('start-capture', async (_event, config: {
    sourceId?: string
    cropRegion?: { x: number; y: number; width: number; height: number }
    systemAudio: boolean
    microphone: boolean
    fps?: number
    enableScreenCapture?: boolean
  }) => {
    console.log('[IPC] start-capture called with config:', JSON.stringify({
      sourceId: config.sourceId,
      systemAudio: config.systemAudio,
      microphone: config.microphone,
      enableScreenCapture: config.enableScreenCapture
    }))

    sessionStartTime = Date.now()
    transcriptEntries = []
    visualNotes = []
    screenCaptureEnabled = config.enableScreenCapture === true && !!config.sourceId

    // Configure audio
    audioCapturer.setConfig({ systemAudio: config.systemAudio, microphone: config.microphone })

    // Start sidecar for ASR (non-blocking, optional)
    try {
      await sidecarManager.start()
      console.log('[IPC] Sidecar started')
    } catch (err) {
      console.warn('[IPC] Sidecar failed to start, continuing without ASR:', err)
    }

    // --- Screen capture (OPTIONAL — only if enabled) ---
    if (screenCaptureEnabled && config.sourceId) {
      console.log('[IPC] Screen capture enabled for source:', config.sourceId)
      screenCapturer.setSource(config.sourceId)
      screenCapturer.setCropRegion(config.cropRegion || null)
      if (config.fps) screenCapturer.setFps(config.fps)

      try {
        await ocrPipeline.initialize()
      } catch (err) {
        console.warn('[IPC] OCR init failed:', err)
      }

      screenCapturer.on('frame', async (frame: CaptureFrame) => {
        safeSend('capture-frame', frame)

        // Run OCR on frame
        try {
          const ocrResult = await ocrPipeline.processFrame(frame.dataUrl, frame.timestamp)
          if (ocrResult) {
            const note = {
              id: ocrResult.id,
              timestamp: ocrResult.timestamp,
              text: ocrResult.text,
              thumbnail: ocrResult.thumbnail
            }
            visualNotes.push(note)
            safeSend('visual-note', note)
            summaryEngine.addEntry({
              timestamp: ocrResult.timestamp,
              type: 'visual',
              content: ocrResult.text
            })
          }
        } catch (err) {
          console.error('[IPC] OCR error:', err)
        }
      })

      try {
        await screenCapturer.startCapture()
        console.log('[IPC] Screen capture started')
      } catch (err) {
        console.warn('[IPC] Screen capture failed to start:', err)
      }
    } else {
      console.log('[IPC] Screen capture disabled — audio-only mode')
    }

    // --- Audio pipeline (ALWAYS wired) ---
    audioCapturer.on('chunk', (chunk: AudioChunk) => {
      sidecarManager.sendAudio(chunk.data)
    })

    sidecarManager.on('transcription', (result: TranscriptionResult) => {
      const entry = {
        id: `tr-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        timestamp: Date.now(),
        text: result.text,
        start: result.start,
        end: result.end
      }
      transcriptEntries.push(entry)
      safeSend('transcript', entry)
      summaryEngine.addEntry({
        timestamp: Date.now(),
        type: 'transcript',
        content: result.text
      })
    })

    // --- Summary engine → renderer ---
    summaryEngine.on('summary', (state: SummaryState) => {
      safeSend('summary', state)
    })

    // Start audio + summary
    audioCapturer.start()
    summaryEngine.start()

    // Tell renderer to start audio capture
    safeSend('start-audio-capture', audioCapturer.getConfig())

    console.log('[IPC] ✅ Capture session started (audio=' + config.systemAudio + ', mic=' + config.microphone + ', screen=' + screenCaptureEnabled + ')')
    return { success: true }
  })

  ipcMain.handle('stop-capture', async () => {
    console.log('[IPC] stop-capture called')

    // Stop screen capture if it was running
    if (screenCaptureEnabled) {
      screenCapturer.stopCapture()
      screenCapturer.removeAllListeners('frame')
      try { await ocrPipeline.terminate() } catch {}
    }

    // Stop audio pipeline
    audioCapturer.stop()
    audioCapturer.removeAllListeners('chunk')
    sidecarManager.removeAllListeners('transcription')

    // Stop summary
    summaryEngine.stop()
    summaryEngine.removeAllListeners('summary')

    // Tell renderer to stop audio capture
    safeSend('stop-audio-capture')

    console.log('[IPC] ✅ Capture session stopped')
    return { success: true }
  })

  // --- Export handlers ---
  ipcMain.handle('export-markdown', async () => {
    const sessionData = buildSessionData()
    const markdown = exportMarkdown(sessionData)

    const { filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Session as Markdown',
      defaultPath: `godeye-session-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })

    if (filePath) {
      fs.writeFileSync(filePath, markdown, 'utf-8')
      return { success: true, filePath }
    }
    return { success: false }
  })

  ipcMain.handle('export-json', async () => {
    const sessionData = buildSessionData()
    const json = exportJSON(sessionData)

    const { filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Session as JSON',
      defaultPath: `godeye-session-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (filePath) {
      fs.writeFileSync(filePath, json, 'utf-8')
      return { success: true, filePath }
    }
    return { success: false }
  })
}

function buildSessionData(): SessionData {
  return {
    startTime: sessionStartTime,
    endTime: Date.now(),
    transcripts: transcriptEntries,
    visualNotes: visualNotes,
    summary: summaryEngine.getState(),
    contextBuffer: summaryEngine.getBuffer()
  }
}
