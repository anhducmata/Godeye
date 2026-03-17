import { ipcMain, BrowserWindow } from 'electron'
import { EventEmitter } from 'events'

/**
 * Audio capture is handled primarily in the renderer process using Web APIs
 * (getUserMedia / getDisplayMedia). This module manages the audio data
 * flowing from renderer → main process for forwarding to the ASR sidecar.
 * 
 * Architecture:
 * - Renderer captures audio via MediaRecorder / AudioWorklet
 * - Sends PCM chunks to main process via IPC
 * - Main process forwards to Python sidecar via WebSocket
 */

export interface AudioConfig {
  systemAudio: boolean
  microphone: boolean
  sampleRate: number
}

export interface AudioChunk {
  timestamp: number
  data: Buffer
  source: 'system' | 'mic' | 'mixed'
}

export class AudioCapturer extends EventEmitter {
  private isCapturing = false
  private config: AudioConfig = {
    systemAudio: true,
    microphone: true,
    sampleRate: 16000
  }

  constructor() {
    super()
  }

  setConfig(config: Partial<AudioConfig>) {
    Object.assign(this.config, config)
  }

  getConfig(): AudioConfig {
    return { ...this.config }
  }

  /**
   * Register IPC handlers for receiving audio data from renderer
   */
  registerIpcHandlers() {
    ipcMain.on('audio-chunk', (_event, data: { timestamp: number; buffer: ArrayBuffer; source: string }) => {
      if (!this.isCapturing) return

      const chunk: AudioChunk = {
        timestamp: data.timestamp,
        data: Buffer.from(data.buffer),
        source: data.source as AudioChunk['source']
      }

      this.emit('chunk', chunk)
    })

    ipcMain.handle('get-audio-config', () => {
      return this.config
    })
  }

  start() {
    this.isCapturing = true
    this.emit('start', this.config)
  }

  stop() {
    this.isCapturing = false
    this.emit('stop')
  }

  isActive(): boolean {
    return this.isCapturing
  }
}
