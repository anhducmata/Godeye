import { ipcMain, BrowserWindow, dialog } from 'electron'
import { ScreenCapturer, CaptureFrame } from '../capture/screen'
import { AudioCapturer, AudioChunk } from '../capture/audio'
import { SidecarManager, TranscriptionResult } from '../sidecar/manager'
import { OcrPipeline, OcrResult } from '../pipeline/ocr-worker'
import { SummaryEngine, SummaryState, ContextEntry } from '../pipeline/summary-engine'
import { exportMarkdown, exportJSON, SessionData } from '../export'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

/**
 * Central IPC handler registry.
 * Wires all pipelines: screen → OCR → summary, audio → ASR → summary
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
    sourceId: string
    cropRegion?: { x: number; y: number; width: number; height: number }
    systemAudio: boolean
    microphone: boolean
    fps?: number
  }) => {
    sessionStartTime = Date.now()
    transcriptEntries = []
    visualNotes = []

    // Configure screen capture
    screenCapturer.setSource(config.sourceId)
    screenCapturer.setCropRegion(config.cropRegion || null)
    if (config.fps) screenCapturer.setFps(config.fps)

    // Configure audio
    audioCapturer.setConfig({ systemAudio: config.systemAudio, microphone: config.microphone })

    // Initialize OCR
    await ocrPipeline.initialize()

    // Start sidecar for ASR
    try {
      await sidecarManager.start()
    } catch (err) {
      console.warn('[IPC] Sidecar failed to start, continuing without ASR:', err)
    }

    // Wire screen frames → OCR → summary
    screenCapturer.on('frame', async (frame: CaptureFrame) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-frame', frame)
      }

      // Run OCR on frame
      const ocrResult = await ocrPipeline.processFrame(frame.dataUrl, frame.timestamp)
      if (ocrResult) {
        const note = {
          id: ocrResult.id,
          timestamp: ocrResult.timestamp,
          text: ocrResult.text,
          thumbnail: ocrResult.thumbnail
        }
        visualNotes.push(note)

        // Send to renderer
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('visual-note', note)
        }

        // Feed into summary engine
        summaryEngine.addEntry({
          timestamp: ocrResult.timestamp,
          type: 'visual',
          content: ocrResult.text
        })
      }
    })

    // Wire audio → sidecar → transcript → summary
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

      // Send to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('transcript', entry)
      }

      // Feed into summary engine
      summaryEngine.addEntry({
        timestamp: Date.now(),
        type: 'transcript',
        content: result.text
      })
    })

    // Wire summary engine → renderer
    summaryEngine.on('summary', (state: SummaryState) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('summary', state)
      }
    })

    // Start all pipelines
    await screenCapturer.startCapture()
    audioCapturer.start()
    summaryEngine.start()

    // Tell renderer to start audio capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('start-audio-capture', audioCapturer.getConfig())
    }

    return { success: true }
  })

  ipcMain.handle('stop-capture', async () => {
    // Stop all pipelines
    screenCapturer.stopCapture()
    screenCapturer.removeAllListeners('frame')
    audioCapturer.stop()
    audioCapturer.removeAllListeners('chunk')
    summaryEngine.stop()
    summaryEngine.removeAllListeners('summary')
    sidecarManager.removeAllListeners('transcription')
    await ocrPipeline.terminate()

    // Tell renderer to stop audio capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-audio-capture')
    }

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

export function getScreenCapturer(): ScreenCapturer { return screenCapturer }
export function getAudioCapturer(): AudioCapturer { return audioCapturer }
export function getSummaryEngine(): SummaryEngine { return summaryEngine }
