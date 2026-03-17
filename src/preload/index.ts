import { contextBridge, ipcRenderer } from 'electron'

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export interface CaptureConfig {
  sourceId: string
  cropRegion?: { x: number; y: number; width: number; height: number }
  systemAudio: boolean
  microphone: boolean
  fps?: number
}

export interface CaptureFrame {
  timestamp: number
  dataUrl: string
  width: number
  height: number
}

export interface TranscriptEntry {
  id: string
  timestamp: number
  text: string
  start: number
  end: number
}

export interface VisualNote {
  id: string
  timestamp: number
  text: string
  thumbnail?: string
}

export interface SummaryUpdate {
  timestamp: number
  currentTopic: string
  summary: string
  decisions: string[]
  actionItems: string[]
  unresolvedQuestions: string[]
}

export interface AudioConfig {
  systemAudio: boolean
  microphone: boolean
  sampleRate: number
}

export interface GodeyeAPI {
  // Screen capture
  getScreenSources: () => Promise<ScreenSource[]>
  selectArea: () => Promise<{ x: number; y: number; width: number; height: number } | null>
  startCapture: (config: CaptureConfig) => Promise<{ success: boolean }>
  stopCapture: () => Promise<{ success: boolean }>

  // Event listeners
  onCaptureFrame: (cb: (frame: CaptureFrame) => void) => void
  onTranscript: (cb: (data: TranscriptEntry) => void) => void
  onVisualNote: (cb: (data: VisualNote) => void) => void
  onSummary: (cb: (data: SummaryUpdate) => void) => void
  onStartAudioCapture: (cb: (config: AudioConfig) => void) => void
  onStopAudioCapture: (cb: () => void) => void

  // Audio
  sendAudioChunk: (data: { timestamp: number; buffer: ArrayBuffer; source: string }) => void

  // Cleanup
  removeAllListeners: (channel: string) => void
}

const api: GodeyeAPI = {
  // Screen capture
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectArea: () => ipcRenderer.invoke('select-area'),
  startCapture: (config) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),

  // Event listeners
  onCaptureFrame: (cb) => ipcRenderer.on('capture-frame', (_e, data) => cb(data)),
  onTranscript: (cb) => ipcRenderer.on('transcript', (_e, data) => cb(data)),
  onVisualNote: (cb) => ipcRenderer.on('visual-note', (_e, data) => cb(data)),
  onSummary: (cb) => ipcRenderer.on('summary', (_e, data) => cb(data)),
  onStartAudioCapture: (cb) => ipcRenderer.on('start-audio-capture', (_e, config) => cb(config)),
  onStopAudioCapture: (cb) => ipcRenderer.on('stop-audio-capture', () => cb()),

  // Audio
  sendAudioChunk: (data) => ipcRenderer.send('audio-chunk', data),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
}

contextBridge.exposeInMainWorld('godeye', api)
