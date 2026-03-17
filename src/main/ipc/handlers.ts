import { ipcMain, BrowserWindow, desktopCapturer } from 'electron'
import { ScreenCapturer, CaptureFrame } from '../capture/screen'
import { AudioCapturer, AudioChunk } from '../capture/audio'

/**
 * Central IPC handler registry.
 * All renderer ↔ main IPC channels are registered here.
 */

let screenCapturer: ScreenCapturer
let audioCapturer: AudioCapturer
let mainWindow: BrowserWindow | null = null

export function initializeHandlers(window: BrowserWindow) {
  mainWindow = window
  screenCapturer = new ScreenCapturer()
  audioCapturer = new AudioCapturer()

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

  ipcMain.handle('start-capture', async (_event, config: {
    sourceId: string
    cropRegion?: { x: number; y: number; width: number; height: number }
    systemAudio: boolean
    microphone: boolean
    fps?: number
  }) => {
    // Configure screen capture
    screenCapturer.setSource(config.sourceId)
    screenCapturer.setCropRegion(config.cropRegion || null)
    if (config.fps) screenCapturer.setFps(config.fps)

    // Configure audio
    audioCapturer.setConfig({
      systemAudio: config.systemAudio,
      microphone: config.microphone
    })

    // Start screen capture — forward frames to renderer
    screenCapturer.on('frame', (frame: CaptureFrame) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('capture-frame', frame)
      }
    })

    // Start audio capture — forward chunks for ASR
    audioCapturer.on('chunk', (chunk: AudioChunk) => {
      // Will be forwarded to Python sidecar (Task 4)
      // For now, just emit event
    })

    await screenCapturer.startCapture()
    audioCapturer.start()

    // Tell renderer to start audio capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('start-audio-capture', audioCapturer.getConfig())
    }

    return { success: true }
  })

  ipcMain.handle('stop-capture', async () => {
    screenCapturer.stopCapture()
    screenCapturer.removeAllListeners('frame')
    audioCapturer.stop()
    audioCapturer.removeAllListeners('chunk')

    // Tell renderer to stop audio capture
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stop-audio-capture')
    }

    return { success: true }
  })
}

export function getScreenCapturer(): ScreenCapturer {
  return screenCapturer
}

export function getAudioCapturer(): AudioCapturer {
  return audioCapturer
}
