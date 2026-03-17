import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('godeye', {
  // Screen capture
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectArea: () => ipcRenderer.invoke('select-area'),
  startCapture: (config: any) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),

  // Settings
  setApiKey: (config: { apiKey: string; provider: string }) => ipcRenderer.invoke('set-api-key', config),

  // Export
  exportMarkdown: () => ipcRenderer.invoke('export-markdown'),
  exportJSON: () => ipcRenderer.invoke('export-json'),

  // Event listeners
  onCaptureFrame: (cb: Function) => ipcRenderer.on('capture-frame', (_e, data) => cb(data)),
  onTranscript: (cb: Function) => ipcRenderer.on('transcript', (_e, data) => cb(data)),
  onVisualNote: (cb: Function) => ipcRenderer.on('visual-note', (_e, data) => cb(data)),
  onSummary: (cb: Function) => ipcRenderer.on('summary', (_e, data) => cb(data)),
  onStartAudioCapture: (cb: Function) => ipcRenderer.on('start-audio-capture', (_e, config) => cb(config)),
  onStopAudioCapture: (cb: Function) => ipcRenderer.on('stop-audio-capture', () => cb()),

  // Audio
  sendAudioChunk: (data: any) => ipcRenderer.send('audio-chunk', data),

  // Cleanup
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
})
