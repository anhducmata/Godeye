import { useState, useEffect, useCallback, useRef } from 'react'

declare global {
  interface Window {
    meetsense: {
      getScreenSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>
      selectArea: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      startCapture: (config: any) => Promise<{ success: boolean }>
      stopCapture: () => Promise<{ success: boolean }>
      setApiKey: (config: { apiKey: string; provider: string; language?: string }) => Promise<{ success: boolean }>
      exportMarkdown: () => Promise<{ success: boolean; filePath?: string }>
      exportJSON: () => Promise<{ success: boolean; filePath?: string }>
      onCaptureFrame: (cb: (frame: { timestamp: number; dataUrl: string }) => void) => void
      onStartAudioCapture: (cb: (config: any) => void) => void
      onStopAudioCapture: (cb: () => void) => void
      sendAudioChunk: (data: any) => void
      sendWebmChunk: (data: ArrayBuffer) => void
      onTranscript: (cb: (data: any) => void) => void
      onTranscriptInterim: (cb: (data: any) => void) => void
      onVisualNote: (cb: (data: any) => void) => void
      onSummary: (cb: (data: any) => void) => void
      onPostMeetingStatus: (cb: (data: { processing: boolean }) => void) => void
      // Sessions
      listSessions: () => Promise<any[]>
      getSession: (id: string) => Promise<any>
      deleteSession: (id: string) => Promise<{ success: boolean }>
      // Tags
      listTags: () => Promise<any[]>
      createTag: (data: { name: string; color?: string }) => Promise<any>
      deleteTag: (id: number) => Promise<{ success: boolean }>
      tagSession: (sessionId: string, tagId: number) => Promise<{ success: boolean }>
      untagSession: (sessionId: string, tagId: number) => Promise<{ success: boolean }>
      // Speakers
      listSpeakerProfiles: () => Promise<any[]>
      createSpeakerProfile: (data: { name: string; sampleText?: string; avatarColor?: string }) => Promise<any>
      assignSpeaker: (data: { sessionId: string; diarizeLabel: string; speakerProfileId: number }) => Promise<{ success: boolean }>
      // Search
      searchKnowledge: (query: string, mode?: string) => Promise<any[]>
      removeAllListeners: (channel: string) => void
    }
  }
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export type CaptureState = 'idle' | 'capturing'

export interface CaptureOptions {
  systemAudio: boolean
  microphone: boolean
  enableScreenCapture: boolean
}

export interface DebugLog {
  time: string
  message: string
  level: 'info' | 'warn' | 'error'
}

function ts(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

export function useCapture() {
  const [state, setState] = useState<CaptureState>('idle')
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ScreenSource | null>(null)
  const [cropRegion, setCropRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [options, setOptions] = useState<CaptureOptions>({
    systemAudio: true,
    microphone: true,
    enableScreenCapture: false  // OFF by default — audio first
  })
  const [latestFrame, setLatestFrame] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [frameCount, setFrameCount] = useState(0)
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([])

  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)

  const addDebugLog = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    setDebugLogs(prev => [...prev.slice(-200), { time: ts(), message, level }])
    console.log(`[meetsense] ${message}`)
  }, [])

  const loadSources = useCallback(async () => {
    try {
      addDebugLog('🔍 Loading screen sources...')
      const s = await window.meetsense.getScreenSources()
      setSources(s)
      addDebugLog(`✅ Found ${s.length} sources`)
    } catch (err: any) {
      addDebugLog(`❌ Failed to load sources: ${err?.message || err}`, 'error')
    }
  }, [addDebugLog])

  const selectArea = useCallback(async () => {
    try {
      addDebugLog('🔲 Opening area selector...')
      const region = await window.meetsense.selectArea()
      if (region) {
        setCropRegion(region)
        addDebugLog(`✅ Area: ${region.width}×${region.height}`)
      } else {
        addDebugLog('ℹ️ Cancelled')
      }
    } catch (err: any) {
      addDebugLog(`❌ Area error: ${err?.message || err}`, 'error')
    }
  }, [addDebugLog])

  // Start capture — works without a source selected (audio-only mode)
  const startCapture = useCallback(async () => {
    try {
      const config = {
        sourceId: selectedSource?.id,
        cropRegion: cropRegion || undefined,
        systemAudio: options.systemAudio,
        microphone: options.microphone,
        enableScreenCapture: options.enableScreenCapture && !!selectedSource,
        fps: 1
      }

      addDebugLog(`🚀 Starting capture: audio=${options.systemAudio}, mic=${options.microphone}, screen=${config.enableScreenCapture}`)
      setFrameCount(0)

      const result = await window.meetsense.startCapture(config)

      if (result.success) {
        setState('capturing')
        addDebugLog('✅ Capture started!')
      } else {
        addDebugLog('❌ startCapture returned false', 'error')
      }
    } catch (err: any) {
      addDebugLog(`❌ Start error: ${err?.message || err}`, 'error')
    }
  }, [selectedSource, cropRegion, options, addDebugLog])

  const stopCapture = useCallback(async () => {
    try {
      addDebugLog('⏹ Stopping...')
      await window.meetsense.stopCapture()
      setState('idle')
      addDebugLog('✅ Stopped')

      // Stop renderer audio streams
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null }
      if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null }
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null }
    } catch (err: any) {
      addDebugLog(`❌ Stop error: ${err?.message || err}`, 'error')
    }
  }, [addDebugLog])

  // Listen for frames
  useEffect(() => {
    if (!window.meetsense) return
    window.meetsense.onCaptureFrame((frame) => {
      setLatestFrame(frame.dataUrl)
      setFrameCount(prev => prev + 1)
    })
    return () => { window.meetsense.removeAllListeners('capture-frame') }
  }, [])

  // Audio capture in renderer (handles system audio via Electron)
  useEffect(() => {
    const startAudio = async (config: any) => {
      try {
        addDebugLog('🔊 Starting audio capture in renderer...')

        // Electron quirk: chromeMediaSource 'desktop' requires requesting
        // BOTH audio and video. We request both, then discard the video track.
        let stream: MediaStream

        if (config.systemAudio && config.microphone) {
          addDebugLog('🔊 Requesting system audio AND microphone...')
          const sysStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore
              mandatory: { chromeMediaSource: 'desktop' }
            },
            video: {
              // @ts-ignore
              mandatory: { chromeMediaSource: 'desktop', maxWidth: 1, maxHeight: 1, maxFrameRate: 1 }
            }
          })
          const micStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          })
          
          stream = new MediaStream([
            ...sysStream.getAudioTracks(),
            ...micStream.getAudioTracks()
          ])
          
          sysStream.getVideoTracks().forEach(t => t.stop())
          
          mediaStreamRef.current = stream
          const audioCtx = new AudioContext({ sampleRate: config.sampleRate || 16000 })
          audioContextRef.current = audioCtx
          
          const sysSource = audioCtx.createMediaStreamSource(sysStream)
          const micSource = audioCtx.createMediaStreamSource(micStream)
          const merger = audioCtx.createChannelMerger(2)
          
          sysSource.connect(merger, 0, 0) // connect to L channel
          micSource.connect(merger, 0, 1) // connect to R channel
          // Merge to mono for our processor
          sysSource.connect(audioCtx.destination) // Optional: output for speaker if needed, but we don't
          
          const processor = audioCtx.createScriptProcessor(4096, 2, 1)
          processorRef.current = processor
          
          merger.connect(processor)
          processor.connect(audioCtx.destination)
          
          let chunkCount = 0
          processor.onaudioprocess = (e) => {
            const inputL = e.inputBuffer.getChannelData(0)
            const inputR = e.inputBuffer.getChannelData(1)
            const int16 = new Int16Array(inputL.length)
            
            for (let i = 0; i < inputL.length; i++) {
              // Mix L and R into mono
              const s = Math.max(-1, Math.min(1, (inputL[i] + inputR[i]) / 2))
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
            }
            window.meetsense.sendAudioChunk({
              timestamp: Date.now(),
              buffer: int16.buffer,
              source: 'system+mic'
            })
            chunkCount++
            if (chunkCount === 1) addDebugLog('🔊 First mixed audio chunk sent')
            if (chunkCount % 100 === 0) addDebugLog(`🔊 Audio chunks: ${chunkCount}`)
          }
          
          addDebugLog(`✅ Combined stream via Web Audio API`)
        } else if (config.systemAudio) {
          addDebugLog('🔊 Requesting system audio (+ dummy video for Electron)...')
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore — Electron-specific
              mandatory: { chromeMediaSource: 'desktop' }
            },
            video: {
              // @ts-ignore — Electron requires this for desktop audio
              mandatory: {
                chromeMediaSource: 'desktop',
                maxWidth: 1,
                maxHeight: 1,
                maxFrameRate: 1
              }
            }
          })
          // Remove the video tracks — we only need audio
          stream.getVideoTracks().forEach(t => {
            t.stop()
            stream.removeTrack(t)
          })
          addDebugLog(`✅ System audio stream: ${stream.getAudioTracks().length} audio tracks`)
          setupSingleStreamProcessor(stream, 'system')
        } else if (config.microphone) {
          addDebugLog('🎤 Requesting microphone...')
          stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          })
          setupSingleStreamProcessor(stream, 'mic')
        } else {
          addDebugLog('⚠️ No audio source enabled', 'warn')
          return
        }

        function setupSingleStreamProcessor(s: MediaStream, sourceName: string) {
          mediaStreamRef.current = s
          const audioCtx = new AudioContext({ sampleRate: config.sampleRate || 16000 })
          audioContextRef.current = audioCtx
          const source = audioCtx.createMediaStreamSource(s)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          let chunkCount = 0
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0)
            const int16 = new Int16Array(inputData.length)
            for (let i = 0; i < inputData.length; i++) {
              const sample = Math.max(-1, Math.min(1, inputData[i]))
              int16[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
            }
            window.meetsense.sendAudioChunk({
              timestamp: Date.now(),
              buffer: int16.buffer,
              source: sourceName
            })
            chunkCount++
            if (chunkCount === 1) addDebugLog(`🔊 First ${sourceName} chunk sent`)
            if (chunkCount % 100 === 0) addDebugLog(`🔊 Audio chunks: ${chunkCount}`)
          }

          source.connect(processor)
          processor.connect(audioCtx.destination)
          addDebugLog(`✅ Audio capture started (${sourceName})`)
        }

        // Set up MediaRecorder for WebM streaming to enable post-meeting diarization
        // We need a SEPARATE fresh mic stream for MediaRecorder because the AudioContext
        // may have consumed the original streams
        try {
          let recorderStream: MediaStream
          try {
            recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
            addDebugLog(`🎤 MediaRecorder using dedicated mic stream (${recorderStream.getAudioTracks().length} tracks)`)
          } catch {
            // Fallback: use the existing stream
            recorderStream = mediaStreamRef.current || stream
            addDebugLog('⚠️ MediaRecorder falling back to existing stream', 'warn')
          }

          let mimeType = 'audio/webm;codecs=opus'
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'audio/webm' // fallback
            addDebugLog('⚠️ audio/webm;codecs=opus not supported, falling back', 'warn')
          }
          
          const recorder = new MediaRecorder(recorderStream, { mimeType })
          mediaRecorderRef.current = recorder
          
          let webmChunkCount = 0
          recorder.ondataavailable = async (e) => {
            if (e.data.size > 0) {
              webmChunkCount++
              const buffer = await e.data.arrayBuffer()
              window.meetsense.sendWebmChunk(buffer)
              if (webmChunkCount <= 3 || webmChunkCount % 10 === 0) {
                addDebugLog(`📦 WebM chunk #${webmChunkCount}: ${buffer.byteLength} bytes`)
              }
            }
          }
          
          recorder.start(1000) // 1 second chunks
          addDebugLog(`✅ MediaRecorder started (${mimeType})`)
        } catch (err: any) {
          addDebugLog(`❌ MediaRecorder error: ${err?.message || err}`, 'error')
        }
      } catch (err: any) {
        addDebugLog(`❌ Audio error: ${err?.message || err}`, 'error')
      }
    }

    if (!window.meetsense) return
    window.meetsense.onStartAudioCapture(startAudio)
    window.meetsense.onStopAudioCapture(() => {
      addDebugLog('🔊 Audio stopped')
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') { mediaRecorderRef.current.stop() }
      mediaRecorderRef.current = null
      if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null }
      if (audioContextRef.current) { audioContextRef.current.close(); audioContextRef.current = null }
      if (mediaStreamRef.current) { mediaStreamRef.current.getTracks().forEach(t => t.stop()); mediaStreamRef.current = null }
    })

    return () => {
      window.meetsense.removeAllListeners('start-audio-capture')
      window.meetsense.removeAllListeners('stop-audio-capture')
    }
  }, [addDebugLog])

  // Elapsed timer
  useEffect(() => {
    if (state === 'capturing') {
      const timer = setInterval(() => setElapsed(prev => prev + 1), 1000)
      return () => clearInterval(timer)
    } else {
      setElapsed(0)
    }
  }, [state])

  return {
    state, sources, selectedSource, setSelectedSource,
    cropRegion, setCropRegion, options, setOptions,
    latestFrame, elapsed, frameCount, debugLogs,
    loadSources, selectArea, startCapture, stopCapture, addDebugLog
  }
}
