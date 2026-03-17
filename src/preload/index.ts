import { contextBridge, ipcRenderer } from 'electron'

export interface GodeyeAPI {
  getScreenSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>
  startCapture: (config: CaptureConfig) => Promise<void>
  stopCapture: () => Promise<void>
  onTranscript: (cb: (data: TranscriptEntry) => void) => void
  onVisualNote: (cb: (data: VisualNote) => void) => void
  onSummary: (cb: (data: SummaryUpdate) => void) => void
  removeAllListeners: (channel: string) => void
}

export interface CaptureConfig {
  sourceId: string
  cropRegion?: { x: number; y: number; width: number; height: number }
  systemAudio: boolean
  microphone: boolean
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

contextBridge.exposeInMainWorld('godeye', {
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  startCapture: (config: CaptureConfig) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),
  onTranscript: (cb: (data: TranscriptEntry) => void) => {
    ipcRenderer.on('transcript', (_e, data) => cb(data))
  },
  onVisualNote: (cb: (data: VisualNote) => void) => {
    ipcRenderer.on('visual-note', (_e, data) => cb(data))
  },
  onSummary: (cb: (data: SummaryUpdate) => void) => {
    ipcRenderer.on('summary', (_e, data) => cb(data))
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
} satisfies GodeyeAPI)
