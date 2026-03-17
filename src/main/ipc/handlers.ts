import { ipcMain, BrowserWindow, dialog } from 'electron'
import { ScreenCapturer, CaptureFrame } from '../capture/screen'
import { AudioCapturer, AudioChunk } from '../capture/audio'
import { OcrPipeline } from '../pipeline/ocr-worker'
import { SummaryEngine, SummaryState } from '../pipeline/summary-engine'
import { WhisperTranscriber, WhisperResult } from '../pipeline/whisper-transcriber'
import { exportMarkdown, exportJSON, SessionData } from '../export'
import fs from 'fs'
import crypto from 'crypto'
import path from 'path'
import os from 'os'
import { processPostMeeting } from '../pipeline/post-meeting'
import { createSession, updateSession, listSessions, getSession, deleteSession, saveTranscripts, saveSummary, getSessionTranscripts } from '../db/sessions'
import { createTag, listTags, deleteTag, tagSession, untagSession, getSessionTags } from '../db/tags'
import { createSpeakerProfile, listSpeakerProfiles, updateSpeakerProfile, assignSpeakerToSession, getSessionSpeakers } from '../db/speakers'
import { uploadSessionAudio, uploadSessionTranscript, uploadSessionSummary } from '../storage/s3-client'
import { uploadSessionToVectorStore, searchKnowledge } from '../rag/vector-store'
import { queueFinetuneData } from '../finetune/trainer'

/**
 * Central IPC handler registry.
 * Audio-first approach: audio capture always works.
 * Screen capture is optional and non-blocking.
 */

let screenCapturer: ScreenCapturer
let audioCapturer: AudioCapturer
let ocrPipeline: OcrPipeline
let summaryEngine: SummaryEngine
let whisperTranscriber: WhisperTranscriber
let mainWindow: BrowserWindow | null = null
let sessionStartTime = 0
let transcriptEntries: any[] = []
let visualNotes: any[] = []
let screenCaptureEnabled = false

// WebM Recording
let webmStream: fs.WriteStream | null = null
export let sessionAudioPath: string | null = null
let webmBytesWritten = 0
let currentSessionId: string | null = null

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
  ocrPipeline = new OcrPipeline()
  summaryEngine = new SummaryEngine()
  whisperTranscriber = new WhisperTranscriber()

  // Register audio IPC
  audioCapturer.registerIpcHandlers()

  ipcMain.on('webm-chunk', (_event, buffer: ArrayBuffer) => {
    if (webmStream) {
      const buf = Buffer.from(buffer)
      webmStream.write(buf)
      webmBytesWritten += buf.length
      if (webmBytesWritten < 5000 || webmBytesWritten % 50000 < 2000) {
        console.log(`[IPC] WebM chunk written: ${buf.length} bytes (total: ${webmBytesWritten})`)
      }
    }
  })

  // --- Screen capture handlers ---
  ipcMain.handle('get-screen-sources', async () => {
    return screenCapturer.getSources()
  })

  ipcMain.handle('select-area', async () => {
    if (!mainWindow) return null
    return screenCapturer.selectArea(mainWindow)
  })

  // --- Settings ---
  ipcMain.handle('set-api-key', async (_event, config: { apiKey: string; provider: 'openai' | 'gemini'; language?: string }) => {
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

    // Initialize WebM file stream
    sessionAudioPath = path.join(os.tmpdir(), `meetsense-session-${sessionStartTime}.webm`)
    webmStream = fs.createWriteStream(sessionAudioPath)
    webmBytesWritten = 0
    console.log('[IPC] WebM recording path:', sessionAudioPath)

    // Configure audio
    audioCapturer.setConfig({ systemAudio: config.systemAudio, microphone: config.microphone })

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
      // Feed to Whisper API transcriber
      whisperTranscriber.addChunk(chunk.data)
    })

    // OpenAI Whisper API transcription (cloud)
    const apiKey = process.env.OPENAI_API_KEY || ''
    if (apiKey) {
      whisperTranscriber.configure(apiKey, 16000)
      whisperTranscriber.on('transcription', (result: WhisperResult) => {
        const elapsedSeconds = (result.timestamp - sessionStartTime) / 1000
        const entry = {
          id: result.id,
          timestamp: result.timestamp,
          text: result.text,
          start: elapsedSeconds,
          end: elapsedSeconds,
          source: 'whisper' as const,
          audioBase64: result.audioBase64
        }
        transcriptEntries.push(entry)
        safeSend('transcript', entry)
        summaryEngine.addEntry({ timestamp: Date.now(), type: 'transcript', content: result.text })
      })
      whisperTranscriber.start()
      console.log('[IPC] WhisperTranscriber started (OpenAI API)')
    } else {
      console.log('[IPC] No OPENAI_API_KEY — Whisper API transcription disabled')
    }

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

    // Create session in PostgreSQL
    try {
      currentSessionId = await createSession()
      console.log(`[IPC] DB session created: ${currentSessionId}`)
    } catch (err) {
      console.error('[IPC] Failed to create DB session:', err)
    }

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
    whisperTranscriber.stop()
    whisperTranscriber.removeAllListeners('transcription')

    // Stop summary
    summaryEngine.stop()
    summaryEngine.removeAllListeners('summary')

    // Tell renderer to stop audio capture
    safeSend('stop-audio-capture')

    // Finalize WebM and begin post-processing
    if (webmStream) {
      webmStream.end()
      webmStream = null
      console.log('[IPC] WebM recording finalized at:', sessionAudioPath)
      
      const apiKey = process.env.OPENAI_API_KEY || ''
      if (apiKey && sessionAudioPath) {
        // Notify renderer that post-meeting processing is starting
        safeSend('post-meeting-status', { processing: true })

        const audioPath = sessionAudioPath
        const sid = currentSessionId

        // Run in background — parallel DB+S3+diarize
        processPostMeeting(audioPath, apiKey, summaryEngine).then(async (finalSummary) => {
          if (finalSummary) {
            safeSend('summary', finalSummary)
            console.log('[IPC] Final summary sent to renderer')
          }

          // Parallel Phase 2: DB save + S3 upload + Vector Store + Fine-tune
          const saveOps: Promise<any>[] = []

          // Save transcripts to DB
          if (sid && transcriptEntries.length > 0) {
            saveOps.push(
              saveTranscripts(sid, transcriptEntries.map(t => ({
                timestamp: t.timestamp,
                text: t.text,
                source: t.source,
                speaker: t.speaker || null,
                start_sec: t.start || 0,
                end_sec: t.end || 0
              }))).catch(err => console.error('[IPC] Save transcripts failed:', err))
            )
          }

          // Save summary to DB
          if (sid && finalSummary) {
            const summaryState = summaryEngine.getState()
            if (summaryState) {
              saveOps.push(
                saveSummary(sid, {
                  document_summary: summaryState.documentSummary || '',
                  statements: summaryState.statements || [],
                  questions: summaryState.questions || [],
                  follow_ups: []
                }).catch(err => console.error('[IPC] Save summary failed:', err))
              )

              // Update session metadata
              saveOps.push(
                updateSession(sid, {
                  duration_seconds: Math.floor((Date.now() - sessionStartTime) / 1000),
                  document_type: summaryState.documentType || 'general',
                  status: 'completed'
                }).catch(err => console.error('[IPC] Update session failed:', err))
              )
            }
          }

          // Upload audio to S3
          try {
            const audioBuffer = fs.readFileSync(audioPath)
            if (audioBuffer.length > 0 && sid) {
              saveOps.push(
                uploadSessionAudio(sid, audioBuffer)
                  .then(key => { if (sid) updateSession(sid, { s3_audio_key: key }) })
                  .catch(err => console.error('[IPC] S3 upload failed:', err))
              )
            }
          } catch (err) {
            console.error('[IPC] Failed to read audio for S3:', err)
          }

          // Upload to Vector Store for RAG
          if (sid && finalSummary) {
            const state = summaryEngine.getState()
            const docContent = state?.documentSummary || ''
            const transcript = transcriptEntries.map(t => t.text).join('\n')
            saveOps.push(
              uploadSessionToVectorStore(sid, `# Session Summary\n\n${docContent}\n\n# Transcript\n\n${transcript}`)
                .then(fileId => { if (fileId && sid) updateSession(sid, { vector_store_file_id: fileId }) })
                .catch(err => console.error('[IPC] Vector Store upload failed:', err))
            )

            // Queue fine-tuning data
            saveOps.push(
              queueFinetuneData(sid, transcript, docContent)
                .catch(err => console.error('[IPC] Fine-tune queue failed:', err))
            )
          }

          // Wait for all saves
          await Promise.allSettled(saveOps)
          console.log('[IPC] All post-meeting saves completed')

          safeSend('post-meeting-status', { processing: false })
        }).catch(err => {
          console.error('[IPC] Post-meeting error:', err)
          safeSend('post-meeting-status', { processing: false })
        })
      }
    }

    console.log('[IPC] ✅ Capture session stopped')
    return { success: true }
  })

  // --- Export handlers ---
  ipcMain.handle('export-markdown', async () => {
    const sessionData = buildSessionData()
    const markdown = exportMarkdown(sessionData)

    const { filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: 'Export Session as Markdown',
      defaultPath: `meetsense-session-${new Date().toISOString().slice(0, 10)}.md`,
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
      defaultPath: `meetsense-session-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (filePath) {
      fs.writeFileSync(filePath, json, 'utf-8')
      return { success: true, filePath }
    }
    return { success: false }
  })

  // --- Session handlers ---
  ipcMain.handle('list-sessions', async () => {
    return await listSessions()
  })

  ipcMain.handle('get-session', async (_event, id: string) => {
    const session = await getSession(id)
    if (!session) return null
    const transcripts = await getSessionTranscripts(id)
    const tags = await getSessionTags(id)
    const speakers = await getSessionSpeakers(id)
    return { session, transcripts, tags, speakers }
  })

  ipcMain.handle('delete-session', async (_event, id: string) => {
    await deleteSession(id)
    return { success: true }
  })

  // --- Tag handlers ---
  ipcMain.handle('list-tags', async () => {
    return await listTags()
  })

  ipcMain.handle('create-tag', async (_event, data: { name: string; color?: string }) => {
    return await createTag(data.name, data.color)
  })

  ipcMain.handle('delete-tag', async (_event, id: number) => {
    await deleteTag(id)
    return { success: true }
  })

  ipcMain.handle('tag-session', async (_event, data: { sessionId: string; tagId: number }) => {
    await tagSession(data.sessionId, data.tagId)
    return { success: true }
  })

  ipcMain.handle('untag-session', async (_event, data: { sessionId: string; tagId: number }) => {
    await untagSession(data.sessionId, data.tagId)
    return { success: true }
  })

  // --- Speaker handlers ---
  ipcMain.handle('list-speaker-profiles', async () => {
    return await listSpeakerProfiles()
  })

  ipcMain.handle('create-speaker-profile', async (_event, data: { name: string; sampleText?: string; avatarColor?: string }) => {
    return await createSpeakerProfile(data.name, data.sampleText, data.avatarColor)
  })

  ipcMain.handle('assign-speaker', async (_event, data: { sessionId: string; diarizeLabel: string; speakerProfileId: number }) => {
    await assignSpeakerToSession(data.sessionId, data.diarizeLabel, data.speakerProfileId)
    return { success: true }
  })

  // --- RAG handlers ---
  ipcMain.handle('search-knowledge', async (_event, query: string) => {
    return await searchKnowledge(query)
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
