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

export function useCapture() {
  const [state, setState] = useState<CaptureState>('idle')
  const [sources, setSources] = useState<ScreenSource[]>([])
  const [selectedSource, setSelectedSource] = useState<ScreenSource | null>(null)
  const [cropRegion, setCropRegion] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [options, setOptions] = useState<CaptureOptions>({ systemAudio: true, microphone: true })
  const [latestFrame, setLatestFrame] = useState<string | null>(null)
  const [startTime, setStartTime] = useState<number>(0)
  const [elapsed, setElapsed] = useState(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Audio capture refs
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

  const loadSources = useCallback(async () => {
    try {
      const s = await window.godeye.getScreenSources()
      setSources(s)
      if (s.length > 0 && !selectedSource) {
        setSelectedSource(s[0])
      }
    } catch (err) {
      console.error('Failed to load sources:', err)
    }
  }, [selectedSource])

  const selectArea = useCallback(async () => {
    try {
      const region = await window.godeye.selectArea()
      setCropRegion(region)
    } catch (err) {
      console.error('Failed to select area:', err)
    }
  }, [])

  const startCapture = useCallback(async () => {
    if (!selectedSource) {
      console.error('No source selected')
      return
    }

    try {
      await window.godeye.startCapture({
        sourceId: selectedSource.id,
        cropRegion: cropRegion || undefined,
        systemAudio: options.systemAudio,
        microphone: options.microphone,
        fps: 1
      })

      setState('capturing')
      setStartTime(Date.now())

      // Start elapsed timer
      elapsedTimerRef.current = setInterval(() => {
        setElapsed(Date.now() - Date.now() + Date.now() - (startTime || Date.now()))
      }, 1000)

    } catch (err) {
      console.error('Failed to start capture:', err)
    }
  }, [selectedSource, cropRegion, options, startTime])

  const stopCapture = useCallback(async () => {
    try {
      await window.godeye.stopCapture()
      setState('idle')

      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current)
        elapsedTimerRef.current = null
      }

      // Stop audio streams
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(t => t.stop())
        mediaStreamRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }

    } catch (err) {
      console.error('Failed to stop capture:', err)
    }
  }, [])

  // Listen for frames from main process
  useEffect(() => {
    window.godeye.onCaptureFrame((frame) => {
      setLatestFrame(frame.dataUrl)
    })

    return () => {
      window.godeye.removeAllListeners('capture-frame')
    }
  }, [])

  // Audio capture in renderer
  useEffect(() => {
    const startAudio = async (config: { systemAudio: boolean; microphone: boolean; sampleRate: number }) => {
      try {
        // Request system audio via desktopCapturer constraint
        if (config.systemAudio && selectedSource) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              // @ts-ignore - Electron-specific constraint
              mandatory: {
                chromeMediaSource: 'desktop'
              }
            },
            video: false
          })

          mediaStreamRef.current = stream
          
          // Create AudioContext and processor for PCM extraction
          const audioCtx = new AudioContext({ sampleRate: config.sampleRate })
          audioContextRef.current = audioCtx
          
          const source = audioCtx.createMediaStreamSource(stream)
          const processor = audioCtx.createScriptProcessor(4096, 1, 1)
          processorRef.current = processor

          processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0)
            // Convert float32 to int16
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
          }

          source.connect(processor)
          processor.connect(audioCtx.destination)
        }
      } catch (err) {
        console.error('Audio capture error:', err)
      }
    }

    window.godeye.onStartAudioCapture(startAudio)
    window.godeye.onStopAudioCapture(() => {
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
    state,
    sources,
    selectedSource,
    setSelectedSource,
    cropRegion,
    setCropRegion,
    options,
    setOptions,
    latestFrame,
    elapsed,
    loadSources,
    selectArea,
    startCapture,
    stopCapture
  }
}
