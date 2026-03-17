import { useState, useEffect, useCallback, useRef } from 'react'

// Type declarations for the window.godeye API
declare global {
  interface Window {
    godeye: {
      getScreenSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>
      selectArea: () => Promise<{ x: number; y: number; width: number; height: number } | null>
      startCapture: (config: {
        sourceId: string
        cropRegion?: { x: number; y: number; width: number; height: number }
        systemAudio: boolean
        microphone: boolean
        fps?: number
      }) => Promise<{ success: boolean }>
      stopCapture: () => Promise<{ success: boolean }>
      setApiKey: (config: { apiKey: string; provider: string }) => Promise<{ success: boolean }>
      exportMarkdown: () => Promise<{ success: boolean; filePath?: string }>
      exportJSON: () => Promise<{ success: boolean; filePath?: string }>
      onCaptureFrame: (cb: (frame: { timestamp: number; dataUrl: string }) => void) => void
      onStartAudioCapture: (cb: (config: { systemAudio: boolean; microphone: boolean; sampleRate: number }) => void) => void
      onStopAudioCapture: (cb: () => void) => void
      sendAudioChunk: (data: { timestamp: number; buffer: ArrayBuffer; source: string }) => void
      onTranscript: (cb: (data: any) => void) => void
      onVisualNote: (cb: (data: any) => void) => void
      onSummary: (cb: (data: any) => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export type CaptureState = 'idle' | 'capturing' | 'paused'

export interface CaptureOptions {
  systemAudio: boolean
  microphone: boolean
}

export interface DebugLog {
  time: string
  message: string
  level: 'info' | 'warn' | 'error'
}

function timestamp(): string {
  return new Date().toLocaleTimeString('en-GB', { hour12: false })
}

export function useCapture() {
  const [state, setState] = useState<CaptureState>('idle')
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ScreenSource | null>(null)
  const [cropRegion, setCropRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [options, setOptions] = useState<CaptureOptions>({ systemAudio: true, microphone: true })
  const [latestFrame, setLatestFrame] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [frameCount, setFrameCount] = useState(0)
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([])

  // Audio capture refs
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const addDebugLog = useCallback((message: string, level: 'info' | 'warn' | 'error' = 'info') => {
    setDebugLogs(prev => [...prev.slice(-200), { time: timestamp(), message, level }])
    console.log(`[Godeye Debug] ${message}`)
  }, [])

  const loadSources = useCallback(async () => {
    try {
      addDebugLog('🔍 Loading screen sources...')
      const s = await window.godeye.getScreenSources()
      setSources(s)
      addDebugLog(`✅ Found ${s.length} sources: ${s.map(x => x.name).join(', ')}`)
      if (s.length > 0 && !selectedSource) {
        setSelectedSource(s[0])
        addDebugLog(`📺 Auto-selected: "${s[0].name}"`)
      }
    } catch (err: any) {
      addDebugLog(`❌ Failed to load sources: ${err?.message || err}`, 'error')
    }
  }, [selectedSource, addDebugLog])

  const selectArea = useCallback(async () => {
    try {
      addDebugLog('🔲 Opening area selector overlay...')
      const region = await window.godeye.selectArea()
      if (region) {
        setCropRegion(region)
        addDebugLog(`✅ Area selected: ${region.width}×${region.height} at (${region.x}, ${region.y})`)
      } else {
        addDebugLog('ℹ️ Area selection cancelled')
      }
    } catch (err: any) {
      addDebugLog(`❌ Area selection error: ${err?.message || err}`, 'error')
    }
  }, [addDebugLog])

  const startCapture = useCallback(async () => {
    if (!selectedSource) {
      addDebugLog('⚠️ Cannot start: no source selected', 'warn')
      return
    }

    try {
      addDebugLog(`🚀 Calling startCapture(sourceId="${selectedSource.id}", systemAudio=${options.systemAudio}, mic=${options.microphone})`)
      setFrameCount(0)

      const result = await window.godeye.startCapture({
        sourceId: selectedSource.id,
        cropRegion: cropRegion || undefined,
        systemAudio: options.systemAudio,
        microphone: options.microphone,
        fps: 1
      })

      if (result.success) {
        setState('capturing')
        addDebugLog('✅ Capture started successfully! Waiting for frames...')
      } else {
        addDebugLog('❌ startCapture returned success=false', 'error')
      }
    } catch (err: any) {
      addDebugLog(`❌ startCapture error: ${err?.message || err}`, 'error')
    }
  }, [selectedSource, cropRegion, options, addDebugLog])

  const stopCapture = useCallback(async () => {
    try {
      addDebugLog('⏹ Stopping capture...')
      await window.godeye.stopCapture()
      setState('idle')
      addDebugLog(`✅ Capture stopped. Total frames captured: ${frameCount}`)

      // Stop audio streams
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop())
        mediaStreamRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
    } catch (err: any) {
      addDebugLog(`❌ Stop error: ${err?.message || err}`, 'error')
    }
  }, [addDebugLog, frameCount])

  // Listen for frames from main process
  useEffect(() => {
    window.godeye.onCaptureFrame((frame) => {
      setLatestFrame(frame.dataUrl)
      setFrameCount(prev => {
        const newCount = prev + 1
        if (newCount === 1) {
          console.log('[Godeye Debug] 🎉 First frame received!')
        }
        if (newCount % 10 === 0) {
          console.log(`[Godeye Debug] 📷 Frames received: ${newCount}`)
        }
        return newCount
      })
    })

    return () => {
      window.godeye.removeAllListeners('capture-frame')
    }
  }, [])

  // Audio capture in renderer
  useEffect(() => {
    const startAudio = async (config: { systemAudio: boolean; microphone: boolean; sampleRate: number }) => {
      try {
        console.log('[Godeye Debug] 🔊 Starting audio capture in renderer...', config)

        if (config.systemAudio && selectedSource) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore - Electron-specific constraint
              mandatory: { chromeMediaSource: 'desktop' }
            },
            video: false
          })

          mediaStreamRef.current = stream
          const audioCtx = new AudioContext({ sampleRate: config.sampleRate })
          audioContextRef.current = audioCtx
          const source = audioCtx.createMediaStreamSource(stream)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          let chunkCount = 0
          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0)
            const int16 = new Int16Array(inputData.length)
            for (let i = 0; i < inputData.length; i++) {
              const s = Math.max(-1, Math.min(1, inputData[i]))
              int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
            }
            window.godeye.sendAudioChunk({
              timestamp: Date.now(),
              buffer: int16.buffer,
              source: 'system'
            })
            chunkCount++
            if (chunkCount % 50 === 0) {
              console.log(`[Godeye Debug] 🔊 Audio chunks sent: ${chunkCount}`)
            }
          }

          source.connect(processor)
          processor.connect(audioCtx.destination)
          console.log('[Godeye Debug] ✅ Audio capture started successfully')
        }
      } catch (err: any) {
        console.error('[Godeye Debug] ❌ Audio capture error:', err)
      }
    }

    window.godeye.onStartAudioCapture(startAudio)
    window.godeye.onStopAudioCapture(() => {
      console.log('[Godeye Debug] 🔊 Stopping audio capture in renderer')
      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop())
        mediaStreamRef.current = null
      }
    })

    return () => {
      window.godeye.removeAllListeners('start-audio-capture')
      window.godeye.removeAllListeners('stop-audio-capture')
    }
  }, [selectedSource])

  // Load sources on mount
  useEffect(() => {
    loadSources()
  }, [loadSources])

  // Update elapsed time
  useEffect(() => {
    if (state === 'capturing') {
      const timer = setInterval(() => {
        setElapsed(prev => prev + 1)
      }, 1000)
      return () => clearInterval(timer)
    } else if (state === 'idle') {
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
