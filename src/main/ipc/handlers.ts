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
// Post-meeting processing removed — data is saved live to DB during recording
import { createSession, updateSession, listSessions, getSession, deleteSession, saveTranscripts, saveSummary, getSessionTranscripts, getSessionSummary, listSessionsWithTags } from '../db/sessions'
import { createTag, listTags, deleteTag, tagSession, untagSession, getSessionTags } from '../db/tags'
import { createSpeakerProfile, listSpeakerProfiles, updateSpeakerProfile, assignSpeakerToSession, getSessionSpeakers } from '../db/speakers'
import { uploadSessionAudio, uploadSessionTranscript, uploadSessionSummary, uploadSessionFrame } from '../storage/s3-client'
import { uploadSessionToVectorStore } from '../rag/vector-store'
import { queueFinetuneData } from '../finetune/trainer'
import { addUserTokens, updateUserLanguage } from '../db/auth'
import { registerUser, loginUser } from '../db/auth'

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
let liveSummaryTimer: ReturnType<typeof setTimeout> | null = null
let lastSavedTranscriptCount = 0
let currentSessionId: string | null = null
let frameUploadCount = 0

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

  // Module-level AI model setting
  let selectedModel = 'gpt-4o-mini'

  // --- Settings ---
  ipcMain.handle('set-api-key', async (_event, config: { apiKey: string; provider: 'openai' | 'gemini'; language?: string; model?: string }) => {
    summaryEngine.configure(config)
    if (config.model) {
      selectedModel = config.model
    }
    if (config.language) {
      whisperTranscriber.setLanguage(config.language)
      // Persist language to DB on user account
      try {
        const store = (await import('electron-store')).default
        const settings = new store()
        const userData = settings.get('user') as any
        if (userData?.id) {
          await updateUserLanguage(userData.id, config.language)
        }
      } catch {}
    }
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
    frameUploadCount = 0
    transcriptEntries = []
    visualNotes = []
    summaryEngine.reset()
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
        // Send to renderer (without the large buffers)
        const { s3Buffer, fullResDataUrl, ...rendererFrame } = frame
        safeSend('capture-frame', rendererFrame)

        // Upload to S3 only every 5th frame (cost optimization)
        frameUploadCount++
        if (currentSessionId && s3Buffer && frameUploadCount % 5 === 0) {
          const idx = frameUploadCount
          uploadSessionFrame(currentSessionId, idx, s3Buffer)
            .then(key => { if (idx <= 15 || idx % 50 === 0) console.log(`[IPC] Frame #${idx} uploaded: ${key}`) })
            .catch(err => console.error(`[IPC] Frame #${idx} S3 upload failed:`, err))
        }

        // Run OCR on full-res frame
        try {
          const ocrResult = await ocrPipeline.processFrame(fullResDataUrl, frame.timestamp)
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

        // Live save transcript to DB
        if (currentSessionId) {
          saveTranscripts(currentSessionId, [{
            timestamp: entry.timestamp,
            text: entry.text,
            source: entry.source,
            speaker: null,
            start_sec: entry.start || 0,
            end_sec: entry.end || 0
          }]).catch(err => console.error('[IPC] Live transcript save failed:', err))
        }
      })
      whisperTranscriber.start()
      console.log('[IPC] WhisperTranscriber started (OpenAI API)')
    } else {
      console.log('[IPC] No OPENAI_API_KEY — Whisper API transcription disabled')
    }

    // --- Summary engine → renderer + live DB save ---
    summaryEngine.on('summary', (state: SummaryState) => {
      safeSend('summary', state)

      // Debounced live save summary to DB (every 10s max)
      if (currentSessionId && !liveSummaryTimer) {
        liveSummaryTimer = setTimeout(() => {
          liveSummaryTimer = null
          const sid = currentSessionId
          if (!sid) return
          const s = summaryEngine.getState()
          if (!s) return
          saveSummary(sid, {
            document_summary: s.documentSummary || '',
            statements: s.statements || [],
            facts: s.facts || [],
            questions: s.questions || [],
            unclear_points: s.unclear_points || [],
            follow_ups: []
          }).catch(err => console.error('[IPC] Live summary save failed:', err))
        }, 10_000)
      }
    })
    summaryEngine.on('tokens', (total: number) => {
      safeSend('tokens', total)
    })
    summaryEngine.on('token-usage', (usage: any) => {
      safeSend('token-usage', usage)
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

    // Clear any pending live summary timer
    if (liveSummaryTimer) { clearTimeout(liveSummaryTimer); liveSummaryTimer = null }

    // Finalize WebM
    if (webmStream) {
      webmStream.end()
      webmStream = null
      console.log('[IPC] WebM recording finalized at:', sessionAudioPath)
    }

    const apiKey = process.env.OPENAI_API_KEY || ''
    const durationSec = Math.floor((Date.now() - sessionStartTime) / 1000)
    const sid = currentSessionId

    // Skip for recordings shorter than 30 seconds
    if (durationSec < 30) {
      console.log(`[IPC] Recording too short (${durationSec}s < 30s) — deleting session`)
      if (sid) await deleteSession(sid).catch(() => {})
      safeSend('post-meeting-status', { processing: false })
    } else if (sid) {
      safeSend('post-meeting-status', { processing: true })

      // Background finalization: final DB save + S3 + vector store + title
      ;(async () => {
        try {
          const saveOps: Promise<any>[] = []

          // Final summary save (ensures latest state is persisted)
          const summaryState = summaryEngine.getState()
          if (summaryState) {
            saveOps.push(
              saveSummary(sid, {
                document_summary: summaryState.documentSummary || '',
                statements: summaryState.statements || [],
                facts: summaryState.facts || [],
                questions: summaryState.questions || [],
                unclear_points: summaryState.unclear_points || [],
                follow_ups: []
              }).catch(err => console.error('[IPC] Final summary save failed:', err))
            )

            // Update session metadata
            saveOps.push(
              updateSession(sid, {
                duration_seconds: durationSec,
                document_type: summaryState.documentType || 'general',
                status: 'completed'
              }).catch(err => console.error('[IPC] Update session failed:', err))
            )
          }

          // Delete temp audio file
          if (sessionAudioPath) {
            try { if (fs.existsSync(sessionAudioPath)) fs.unlinkSync(sessionAudioPath) } catch {}
          }

          // Upload to Vector Store for RAG
          if (summaryState) {
            const docContent = summaryState.documentSummary || ''
            const transcript = transcriptEntries.map(t => t.text).join('\n')
            saveOps.push(
              uploadSessionToVectorStore(sid, `# Session Summary\n\n${docContent}\n\n# Transcript\n\n${transcript}`)
                .then(fileId => { if (fileId) updateSession(sid, { vector_store_file_id: fileId }) })
                .catch(err => console.error('[IPC] Vector Store upload failed:', err))
            )
          }

          await Promise.allSettled(saveOps)
          console.log('[IPC] All post-meeting saves completed')

          // Auto-generate title
          if (apiKey && summaryState) {
            try {
              const OpenAI = (await import('openai')).default
              const openai = new OpenAI({ apiKey })
              const docContent = summaryState.documentSummary || ''
              const statementsText = (summaryState.statements || []).join('. ')
              const contextText = (docContent + '\n' + statementsText).slice(0, 2000)

              const titleResult = await openai.chat.completions.create({
                model: 'gpt-5.4-nano',
                temperature: 0.3,
                max_completion_tokens: 100,
                messages: [{
                  role: 'user',
                  content: `Based on this meeting summary, generate a concise title (3-6 words) describing the main topic.\n\nSummary:\n${contextText}\n\nRespond in this exact JSON format:\n{"title": "..."}`
                }],
                response_format: { type: 'json_object' }
              })

              const parsed = JSON.parse(titleResult.choices[0]?.message?.content || '{}')
              if (parsed.title) {
                await updateSession(sid, { title: parsed.title } as any)
                console.log(`[IPC] Auto-title set: "${parsed.title}"`)
              }
            } catch (err) {
              console.error('[IPC] Auto title generation failed:', err)
            }
          }

          // Save lifetime token usage
          try {
            const tokenUsage = summaryEngine.getTokenUsage()
            const store = (await import('electron-store')).default
            const settings = new store()
            const userData = settings.get('user') as any
            if (userData?.id && tokenUsage.totalTokens > 0) {
              await addUserTokens(userData.id, tokenUsage.inputTokens, tokenUsage.outputTokens, tokenUsage.cost)
              console.log(`[IPC] Saved ${tokenUsage.totalTokens} tokens ($${tokenUsage.cost.toFixed(4)}) to user ${userData.id}`)
            }
          } catch (err) {
            console.warn('[IPC] Failed to save lifetime tokens:', err)
          }

          safeSend('post-meeting-status', { processing: false })
        } catch (err) {
          console.error('[IPC] Post-meeting finalization error:', err)
          safeSend('post-meeting-status', { processing: false })
        }
      })()
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
    return await listSessionsWithTags()
  })

  ipcMain.handle('get-session', async (_event, id: string) => {
    const session = await getSession(id)
    if (!session) return null
    const transcripts = await getSessionTranscripts(id)
    const summary = await getSessionSummary(id)
    const tags = await getSessionTags(id)
    const speakers = await getSessionSpeakers(id)
    return { session, transcripts, summary, tags, speakers }
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

  // --- Search handlers ---
  ipcMain.handle('search-knowledge', async (_event, query: string, mode: string = 'fulltext') => {
    try {
      const pool = (await import('../db/client')).getPool()

      // Tag-based search: #tagname
      if (query.startsWith('#')) {
        const tagName = query.slice(1).trim().toLowerCase()
        const res = await pool.query(`
          SELECT s.id as session_id, s.title as session_title, s.created_at,
                 (SELECT t2.text FROM transcripts t2 WHERE t2.session_id = s.id ORDER BY t2.id LIMIT 1) as text
          FROM sessions s
          JOIN session_tags st ON st.session_id = s.id
          JOIN tags t ON t.id = st.tag_id
          WHERE LOWER(t.name) = $1
          ORDER BY s.created_at DESC
          LIMIT 20
        `, [tagName])
        return res.rows.map((r: any) => ({
          session_id: r.session_id,
          session_title: r.session_title || 'Untitled Session',
          text: r.text || '',
          content: r.text || ''
        }))
      }

      // Exact search: case-sensitive, accent-insensitive
      if (mode === 'exact') {
        const pattern = `%${query}%`
        const res = await pool.query(`
          SELECT t.session_id, s.title as session_title, t.text, t.speaker, t.start_sec
          FROM transcripts t
          JOIN sessions s ON s.id = t.session_id
          WHERE unaccent(t.text) LIKE unaccent($1)
          ORDER BY s.created_at DESC, t.id
          LIMIT 50
        `, [pattern])
        return res.rows.map((r: any) => ({
          session_id: r.session_id,
          session_title: r.session_title || 'Untitled Session',
          text: r.text || '',
          content: r.text || '',
          speaker: r.speaker || '',
          start_sec: r.start_sec || 0
        }))
      }

      // Full-text search: split into words, accent-insensitive, match ALL words (AND logic)
      const words = query.trim().split(/\s+/).filter(w => w.length > 0)
      const conditions = words.map((_, i) => `(unaccent(t.text) ILIKE unaccent($${i + 1}) OR unaccent(s.title) ILIKE unaccent($${i + 1}))`).join(' AND ')
      const params = words.map(w => `%${w}%`)
      const res = await pool.query(`
        SELECT t.session_id, s.title as session_title, t.text, t.speaker, t.start_sec
        FROM transcripts t
        JOIN sessions s ON s.id = t.session_id
        WHERE ${conditions}
        ORDER BY s.created_at DESC, t.id
        LIMIT 50
      `, params)
      return res.rows.map((r: any) => ({
        session_id: r.session_id,
        session_title: r.session_title || 'Untitled Session',
        text: r.text || '',
        content: r.text || '',
        speaker: r.speaker || '',
        start_sec: r.start_sec || 0
      }))
    } catch (err) {
      console.error('[Search] Failed:', err)
      return []
    }
  })

  // --- Chat with session (context-aware chat bubble) ---
  ipcMain.handle('chat-with-session', async (_event, data: { sessionId: string; query: string; history?: { role: string; content: string }[]; language?: string }) => {
    const { sessionId, query, history, language } = data
    if (!sessionId || !query?.trim()) return { success: false, error: 'Missing sessionId or query' }

    const apiKey = process.env.OPENAI_API_KEY || ''
    if (!apiKey) return { success: false, error: 'No OPENAI_API_KEY configured' }

    try {
      // Load session data from DB
      const transcripts = await getSessionTranscripts(sessionId)
      const summary = await getSessionSummary(sessionId)
      const session = await getSession(sessionId)

      // Build context from session data
      const sessionTitle = session?.title || 'Untitled Session'
      const transcriptText = (transcripts || []).map((t: any) => t.text).join('\n')
      const summaryDoc = summary?.document_summary || ''
      const statements = (summary?.statements || []).map((s: any) => typeof s === 'string' ? s : s.text).join('\n')
      const facts = (summary?.facts || []).map((f: any) => typeof f === 'string' ? f : f.text).join('\n')
      const questions = (summary?.questions || []).map((q: any) => typeof q === 'string' ? q : q.text).join('\n')

      const contextBlock = [
        `# Session: ${sessionTitle}`,
        summaryDoc ? `\n## Summary\n${summaryDoc}` : '',
        statements ? `\n## Key Statements\n${statements}` : '',
        facts ? `\n## Facts\n${facts}` : '',
        questions ? `\n## Questions Discussed\n${questions}` : '',
        transcriptText ? `\n## Transcript\n${transcriptText.slice(0, 6000)}` : ''
      ].filter(Boolean).join('\n')

      const targetLang = language || 'English'

      const messages: any[] = [
        {
          role: 'system',
          content: `You are a helpful AI assistant for a meeting/session note-taking app called MeetSense. The user is asking about a specific session. Answer based ONLY on the session data provided below. If the answer is not in the data, say so honestly. Respond in ${targetLang}. Keep responses concise and helpful.\n\n--- SESSION DATA ---\n${contextBlock.slice(0, 10000)}\n--- END SESSION DATA ---`
        }
      ]

      // Add chat history for multi-turn conversation
      if (history?.length) {
        for (const msg of history.slice(-6)) {
          messages.push({ role: msg.role, content: msg.content })
        }
      }

      messages.push({ role: 'user', content: query })

      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })

      const result = await openai.chat.completions.create({
        model: selectedModel,
        temperature: 0.4,
        max_completion_tokens: 1500,
        messages
      })

      const answer = result.choices[0]?.message?.content?.trim() || 'No response generated.'

      // Track token usage
      if (result.usage) {
        try {
          const store = (await import('electron-store')).default
          const settings = new store()
          const userData = settings.get('user') as any
          if (userData?.id) {
            const inTok = result.usage.prompt_tokens || 0
            const outTok = result.usage.completion_tokens || 0
            const cost = (inTok / 1_000_000) * 0.15 + (outTok / 1_000_000) * 0.60
            await addUserTokens(userData.id, inTok, outTok, cost)
          }
        } catch {}
      }

      return { success: true, answer }
    } catch (err: any) {
      console.error('[ChatWithSession] Failed:', err)
      return { success: false, error: err.message || 'Chat failed' }
    }
  })

  // --- Paste Memory handler ---
  ipcMain.handle('analyze-paste-memory', async (_event, data: { text: string; language?: string }) => {
    const { text, language } = data
    if (!text || !text.trim()) return { success: false, error: 'No text provided' }

    const apiKey = process.env.OPENAI_API_KEY || ''
    if (!apiKey) return { success: false, error: 'No OPENAI_API_KEY configured' }

    const targetLang = language || 'English'

    try {
      // 1. Create session in DB
      const sessionId = await createSession()
      console.log(`[PasteMemory] Session created: ${sessionId}`)

      // 2. Save the pasted text as a transcript entry
      await saveTranscripts(sessionId, [{
        timestamp: Date.now(),
        text: text.trim(),
        source: 'paste',
        speaker: null,
        start_sec: 0,
        end_sec: 0
      }])

      // 3. Call OpenAI to analyze the pasted text
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })

      const analyzeResult = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        temperature: 0.3,
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are a text analysis assistant. Always respond with valid JSON.' },
          {
            role: 'user',
            content: `Analyze the following text and extract structured information.
IMPORTANT: Write your entire response in: ${targetLang}

TEXT TO ANALYZE:
${text.trim().slice(0, 8000)}

Extract and classify each meaningful item:
- statements: ideas, opinions, suggestions, proposals, key points
- facts: confirmed information, data, decisions, conclusions, numbers
- questions: anything asked or that remains unanswered
- unclear_points: unresolved issues (with sub-type: question, risk, dependency, decision)
- documentSummary: a comprehensive markdown summary of the entire text with # Headers and - Bullets

Output JSON:
{
  "statements": ["statement 1", "statement 2"],
  "facts": ["fact 1", "fact 2"],
  "questions": ["question 1"],
  "unclear_points": [{ "type": "risk", "text": "issue" }],
  "documentSummary": "# Title\\n\\n- summary point 1\\n- summary point 2"
}

Rules:
- Extract ALL meaningful items from the text
- Keep each item SHORT (max 1-2 sentences)
- documentSummary should be detailed and well-structured
- ALWAYS respond with valid JSON only.`
          }
        ]
      })

      const content = analyzeResult.choices[0]?.message?.content
      if (!content) {
        return { success: false, error: 'No response from AI' }
      }

      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      const analysis = JSON.parse(cleanContent)

      // 4. Save analysis as summary
      await saveSummary(sessionId, {
        document_summary: analysis.documentSummary || '',
        statements: analysis.statements || [],
        facts: analysis.facts || [],
        questions: analysis.questions || [],
        unclear_points: analysis.unclear_points || [],
        follow_ups: []
      })

      // 5. Track token usage
      if (analyzeResult.usage) {
        try {
          const store = (await import('electron-store')).default
          const settings = new store()
          const userData = settings.get('user') as any
          if (userData?.id) {
            const inTok = analyzeResult.usage.prompt_tokens || 0
            const outTok = analyzeResult.usage.completion_tokens || 0
            const cost = (inTok / 1_000_000) * 0.15 + (outTok / 1_000_000) * 0.60
            await addUserTokens(userData.id, inTok, outTok, cost)
          }
        } catch {}
      }

      // 6. Auto-generate title
      try {
        const titleResult = await openai.chat.completions.create({
          model: 'gpt-5.4-nano',
          temperature: 0.3,
          max_completion_tokens: 100,
          response_format: { type: 'json_object' },
          messages: [{
            role: 'user',
            content: `Based on this text analysis, generate a concise title (3-6 words) describing the main topic.\n\nSummary:\n${(analysis.documentSummary || '').slice(0, 1000)}\n\nRespond in this exact JSON format:\n{"title": "..."}`
          }]
        })
        const parsed = JSON.parse(titleResult.choices[0]?.message?.content || '{}')
        if (parsed.title) {
          await updateSession(sessionId, { title: parsed.title, status: 'completed' } as any)
          console.log(`[PasteMemory] Title: "${parsed.title}"`)
        }
      } catch (err) {
        console.error('[PasteMemory] Title generation failed:', err)
        await updateSession(sessionId, { status: 'completed' } as any)
      }

      // 7. Upload to vector store for RAG
      try {
        const docContent = analysis.documentSummary || ''
        const fileId = await uploadSessionToVectorStore(sessionId, `# Paste Memory\n\n${docContent}\n\n# Original Text\n\n${text.trim().slice(0, 4000)}`)
        if (fileId) await updateSession(sessionId, { vector_store_file_id: fileId } as any)
      } catch (err) {
        console.error('[PasteMemory] Vector store upload failed:', err)
      }

      console.log(`[PasteMemory] ✅ Analysis complete for session ${sessionId}`)
      return { success: true, sessionId, analysis }
    } catch (err: any) {
      console.error('[PasteMemory] Analysis failed:', err)
      return { success: false, error: err.message || 'Analysis failed' }
    }
  })
  // --- Translate for TTS handler ---
  ipcMain.handle('translate-for-tts', async (_event, data: { text: string; language?: string }) => {
    const { text, language } = data
    if (!text?.trim()) return { success: false, error: 'No text' }
    if (!language || language === 'en') return { success: true, translated: text }

    const apiKey = process.env.OPENAI_API_KEY || ''
    if (!apiKey) return { success: true, translated: text }

    try {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })

      const result = await openai.chat.completions.create({
        model: selectedModel,
        temperature: 0.3,
        max_completion_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Translate the following summary to ${language}. Keep the same structure and meaning. Output ONLY the translated text, nothing else.\n\n${text.slice(0, 3000)}`
        }]
      })

      const translated = result.choices[0]?.message?.content?.trim() || text

      if (result.usage) {
        try {
          const store = (await import('electron-store')).default
          const settings = new store()
          const userData = settings.get('user') as any
          if (userData?.id) {
            const inTok = result.usage.prompt_tokens || 0
            const outTok = result.usage.completion_tokens || 0
            const cost = (inTok / 1_000_000) * 0.15 + (outTok / 1_000_000) * 0.60
            await addUserTokens(userData.id, inTok, outTok, cost)
          }
        } catch {}
      }

      return { success: true, translated }
    } catch (err: any) {
      console.error('[TranslateForTTS] Failed:', err)
      return { success: true, translated: text }
    }
  })

  // --- Custom Summarize handler ---
  ipcMain.handle('custom-summarize', async (_event, data: { sessionId: string; items: string[]; prompt: string; language?: string }) => {
    const { sessionId, items, prompt, language } = data
    if (!items?.length) return { success: false, error: 'No items' }

    const apiKey = process.env.OPENAI_API_KEY || ''
    if (!apiKey) return { success: false, error: 'No OPENAI_API_KEY' }

    try {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })

      const result = await openai.chat.completions.create({
        model: selectedModel,
        temperature: 0.3,
        max_completion_tokens: 4000,
        messages: [{
          role: 'system',
          content: `You are a meeting analyst. You must respond ONLY with valid JSON matching this exact structure:
{
  "document_summary": "A comprehensive document summary",
  "statements": [{"text": "statement 1"}, {"text": "statement 2"}],
  "facts": [{"text": "fact 1"}, {"text": "fact 2"}],
  "questions": ["question 1", "question 2"],
  "unclear_points": [{"text": "unclear point", "type": "question"}]
}
Respond in ${language || 'English'}. Follow the user's request precisely.`
        }, {
          role: 'user',
          content: `Here are the items from a meeting session:\n\n${items.map((item, i) => `${i + 1}. ${item}`).join('\n')}\n\nUser request: ${prompt}`
        }]
      })

      let content = result.choices[0]?.message?.content?.trim() || ''
      // Strip markdown code fences if present
      content = content.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim()

      let parsed: any
      try {
        parsed = JSON.parse(content)
      } catch {
        return { success: true, summary: { document_summary: content, statements: [], facts: [], questions: [], unclear_points: [], follow_ups: [] } }
      }

      const summaryData = {
        document_summary: parsed.document_summary || content,
        statements: parsed.statements || [],
        facts: parsed.facts || [],
        questions: parsed.questions || [],
        unclear_points: parsed.unclear_points || [],
        follow_ups: parsed.follow_ups || []
      }

      // Save to database
      if (sessionId) {
        try {
          await saveSummary(sessionId, summaryData)
          console.log(`[CustomSummarize] Saved to DB for session ${sessionId}`)
        } catch (err) {
          console.error('[CustomSummarize] DB save failed:', err)
        }
      }

      if (result.usage) {
        try {
          const store = (await import('electron-store')).default
          const settings = new store()
          const userData = settings.get('user') as any
          if (userData?.id) {
            const inTok = result.usage.prompt_tokens || 0
            const outTok = result.usage.completion_tokens || 0
            const cost = (inTok / 1_000_000) * 0.15 + (outTok / 1_000_000) * 0.60
            await addUserTokens(userData.id, inTok, outTok, cost)
          }
        } catch {}
      }

      return { success: true, summary: summaryData }
    } catch (err: any) {
      console.error('[CustomSummarize] Failed:', err)
      return { success: false, error: err.message }
    }
  })

  // --- TTS Read handler (single chunk) ---
  ipcMain.handle('tts-read', async (_event, data: { text: string }) => {
    const { text } = data
    if (!text || !text.trim()) return { success: false, error: 'No text' }

    const apiKey = process.env.OPENAI_API_KEY || ''
    if (!apiKey) return { success: false, error: 'No OPENAI_API_KEY configured' }

    try {
      const OpenAI = (await import('openai')).default
      const openai = new OpenAI({ apiKey })

      const response = await openai.audio.speech.create({
        model: 'tts-1',
        voice: 'nova',
        input: text.slice(0, 1000),
        response_format: 'mp3',
        speed: 1.0,
      })

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')

      // Track cost: TTS-1 = $15/1M chars
      try {
        const store = (await import('electron-store')).default
        const settings = new store()
        const userData = settings.get('user') as any
        if (userData?.id) {
          const cost = (text.length / 1_000_000) * 15
          await addUserTokens(userData.id, 0, 0, cost)
        }
      } catch {}

      return { success: true, audio }
    } catch (err: any) {
      console.error('[TTS] Failed:', err)
      return { success: false, error: err.message || 'Failed to generate speech' }
    }
  })

  // --- Auth handlers ---
  ipcMain.handle('auth-register', async (_event, data: { email: string; password: string; displayName?: string }) => {
    try {
      const user = await registerUser(data.email, data.password, data.displayName)
      console.log(`[Auth] User registered: ${user.email}`)
      return { success: true, user }
    } catch (err: any) {
      if (err.code === '23505') {
        return { success: false, error: 'Email already registered' }
      }
      console.error('[Auth] Register failed:', err)
      return { success: false, error: 'Registration failed' }
    }
  })

  ipcMain.handle('auth-login', async (_event, data: { email: string; password: string }) => {
    try {
      const user = await loginUser(data.email, data.password)
      if (!user) {
        return { success: false, error: 'Invalid email or password' }
      }
      console.log(`[Auth] User logged in: ${user.email}`)
      return { success: true, user }
    } catch (err) {
      console.error('[Auth] Login failed:', err)
      return { success: false, error: 'Login failed' }
    }
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
