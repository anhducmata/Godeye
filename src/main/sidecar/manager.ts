import { spawn, ChildProcess } from 'child_process'
import { WebSocket } from 'ws'
import path from 'path'
import { EventEmitter } from 'events'

/**
 * Manages the Python sidecar process for real-time ASR.
 * Handles spawning, health-checking, WebSocket communication,
 * and automatic restart on crash.
 */

export interface TranscriptionResult {
  text: string
  start: number
  end: number
  language: string
}

export class SidecarManager extends EventEmitter {
  private process: ChildProcess | null = null
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isRunning = false
  private pythonPath: string
  private sidecarDir: string
  private wsUrl: string

  constructor(options?: { pythonPath?: string; port?: number }) {
    super()
    this.pythonPath = options?.pythonPath || 'python'
    this.sidecarDir = path.join(__dirname, '../../../sidecar')
    const port = options?.port || 9876
    this.wsUrl = `ws://localhost:${port}`
  }

  /**
   * Start the Python sidecar process and connect via WebSocket
   */
  async start(): Promise<void> {
    if (this.isRunning) return

    console.log('[SidecarManager] Starting Python ASR sidecar...')

    // Spawn Python process
    this.process = spawn(this.pythonPath, ['server.py'], {
      cwd: this.sidecarDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    this.process.stdout?.on('data', (data: Buffer) => {
      const message = data.toString().trim()
      console.log(`[Sidecar] ${message}`)

      // Connect WebSocket when server is ready
      if (message.includes('Ready to receive')) {
        this.connectWebSocket()
      }
    })

    this.process.stderr?.on('data', (data: Buffer) => {
      console.error(`[Sidecar Error] ${data.toString().trim()}`)
    })

    this.process.on('exit', (code) => {
      console.log(`[SidecarManager] Process exited with code ${code}`)
      this.isRunning = false
      this.ws = null

      // Auto-restart if it crashed
      if (code !== 0 && code !== null) {
        console.log('[SidecarManager] Attempting restart in 3s...')
        this.reconnectTimer = setTimeout(() => this.start(), 3000)
      }
    })

    this.isRunning = true

    // Give the server a moment to start, then try connecting
    await new Promise(resolve => setTimeout(resolve, 3000))
    if (!this.ws) {
      this.connectWebSocket()
    }
  }

  /**
   * Connect to the sidecar's WebSocket server
   */
  private connectWebSocket() {
    if (this.ws) {
      this.ws.close()
    }

    console.log(`[SidecarManager] Connecting to ${this.wsUrl}`)
    
    const ws = new WebSocket(this.wsUrl)

    ws.on('open', () => {
      console.log('[SidecarManager] WebSocket connected')
      this.ws = ws
      this.emit('connected')
    })

    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())
        if (msg.type === 'transcription' && msg.segments) {
          for (const segment of msg.segments) {
            this.emit('transcription', segment as TranscriptionResult)
          }
        }
      } catch (err) {
        console.error('[SidecarManager] Failed to parse message:', err)
      }
    })

    ws.on('error', (err) => {
      console.error('[SidecarManager] WebSocket error:', err.message)
    })

    ws.on('close', () => {
      console.log('[SidecarManager] WebSocket disconnected')
      this.ws = null

      // Reconnect if still running
      if (this.isRunning) {
        this.reconnectTimer = setTimeout(() => this.connectWebSocket(), 2000)
      }
    })
  }

  /**
   * Send audio chunk to sidecar for transcription
   */
  sendAudio(pcmBuffer: Buffer): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false
    }
    this.ws.send(pcmBuffer)
    return true
  }

  /**
   * Reset the transcriber's audio buffer
   */
  reset() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send('reset')
    }
  }

  /**
   * Stop the sidecar process and WebSocket connection
   */
  async stop(): Promise<void> {
    this.isRunning = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.close()
      this.ws = null
    }

    if (this.process) {
      this.process.kill()
      this.process = null
    }

    console.log('[SidecarManager] Stopped')
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
