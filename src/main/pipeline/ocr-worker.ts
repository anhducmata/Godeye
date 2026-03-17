import Tesseract from 'tesseract.js'
import { EventEmitter } from 'events'
import { hasSignificantChange } from './change-detect'

/**
 * OCR pipeline that processes captured frames using Tesseract.js.
 * Includes change detection to skip frames that haven't changed.
 */

export interface OcrResult {
  id: string
  timestamp: number
  text: string
  confidence: number
  thumbnail?: string
}

export class OcrPipeline extends EventEmitter {
  private worker: Tesseract.Worker | null = null
  private previousFrameData: Buffer | null = null
  private isProcessing = false
  private isInitialized = false
  private frameCount = 0

  constructor() {
    super()
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return

    console.log('[OCR] Initializing Tesseract.js worker...')
    this.worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // Suppress noisy progress logs
        } else {
          console.log(`[OCR] ${m.status}: ${m.progress}`)
        }
      }
    })
    this.isInitialized = true
    console.log('[OCR] Worker initialized')
  }

  /**
   * Process a frame — only run OCR if the content has changed.
   * @param imageDataUrl - base64 data URL of the frame
   * @param timestamp - capture timestamp
   */
  async processFrame(imageDataUrl: string, timestamp: number): Promise<OcrResult | null> {
    if (!this.isInitialized || !this.worker) {
      await this.initialize()
    }
    if (this.isProcessing) return null // Skip if previous OCR still running

    this.frameCount++

    // Convert data URL to buffer for change detection
    const base64Data = imageDataUrl.replace(/^data:image\/\w+;base64,/, '')
    const imageBuffer = Buffer.from(base64Data, 'base64')

    // Simple size-based change detection (fast check)
    if (this.previousFrameData && 
        Math.abs(imageBuffer.length - this.previousFrameData.length) < 100 &&
        this.frameCount % 5 !== 0) { // Force OCR every 5th frame regardless
      return null
    }

    this.previousFrameData = imageBuffer
    this.isProcessing = true

    try {
      const result = await this.worker!.recognize(imageDataUrl)
      const text = result.data.text.trim()
      const confidence = result.data.confidence

      this.isProcessing = false

      if (!text || confidence < 30) {
        return null // Too low confidence or empty
      }

      const ocrResult: OcrResult = {
        id: `ocr-${timestamp}-${this.frameCount}`,
        timestamp,
        text,
        confidence,
        thumbnail: imageDataUrl
      }

      this.emit('result', ocrResult)
      return ocrResult

    } catch (err) {
      console.error('[OCR] Error:', err)
      this.isProcessing = false
      return null
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate()
      this.worker = null
      this.isInitialized = false
    }
    this.previousFrameData = null
    this.frameCount = 0
  }
}
