import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('meetsense', {
  // Screen capture
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  selectArea: () => ipcRenderer.invoke('select-area'),
  startCapture: (config: any) => ipcRenderer.invoke('start-capture', config),
  stopCapture: () => ipcRenderer.invoke('stop-capture'),

  // Settings
  setApiKey: (config: { apiKey: string; provider: string; language?: string }) => ipcRenderer.invoke('set-api-key', config),

  // Export
  exportMarkdown: () => ipcRenderer.invoke('export-markdown'),
  exportJSON: () => ipcRenderer.invoke('export-json'),

  // Event listeners
  onCaptureFrame: (cb: Function) => ipcRenderer.on('capture-frame', (_e, data) => cb(data)),
  onTranscript: (cb: Function) => ipcRenderer.on('transcript', (_e, data) => cb(data)),
  onTranscriptInterim: (cb: Function) => ipcRenderer.on('transcript-interim', (_e, data) => cb(data)),
  onVisualNote: (cb: Function) => ipcRenderer.on('visual-note', (_e, data) => cb(data)),
  onSummary: (cb: Function) => ipcRenderer.on('summary', (_e, data) => cb(data)),
  onTokens: (cb: Function) => ipcRenderer.on('tokens', (_e, data) => cb(data)),
  onStartAudioCapture: (cb: Function) => ipcRenderer.on('start-audio-capture', (_e, config) => cb(config)),
  onStopAudioCapture: (cb: Function) => ipcRenderer.on('stop-audio-capture', () => cb()),

  // Audio
  sendAudioChunk: (data: any) => ipcRenderer.send('audio-chunk', data),
  sendWebmChunk: (data: ArrayBuffer) => ipcRenderer.send('webm-chunk', data),

  // Post-meeting status
  onPostMeetingStatus: (cb: Function) => ipcRenderer.on('post-meeting-status', (_e, data) => cb(data)),

  // Sessions
  listSessions: () => ipcRenderer.invoke('list-sessions'),
  getSession: (id: string) => ipcRenderer.invoke('get-session', id),
  deleteSession: (id: string) => ipcRenderer.invoke('delete-session', id),

  // Tags
  listTags: () => ipcRenderer.invoke('list-tags'),
  createTag: (data: { name: string; color?: string }) => ipcRenderer.invoke('create-tag', data),
  deleteTag: (id: number) => ipcRenderer.invoke('delete-tag', id),
  tagSession: (sessionId: string, tagId: number) => ipcRenderer.invoke('tag-session', { sessionId, tagId }),
  untagSession: (sessionId: string, tagId: number) => ipcRenderer.invoke('untag-session', { sessionId, tagId }),

  // Speakers
  listSpeakerProfiles: () => ipcRenderer.invoke('list-speaker-profiles'),
  createSpeakerProfile: (data: { name: string; sampleText?: string; avatarColor?: string }) => ipcRenderer.invoke('create-speaker-profile', data),
  assignSpeaker: (data: { sessionId: string; diarizeLabel: string; speakerProfileId: number }) => ipcRenderer.invoke('assign-speaker', data),

  // RAG Knowledge Search
  searchKnowledge: (query: string) => ipcRenderer.invoke('search-knowledge', query),

  // Cleanup
  removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
})
