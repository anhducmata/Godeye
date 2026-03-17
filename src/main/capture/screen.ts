import { desktopCapturer, BrowserWindow, screen, ipcMain } from 'electron'
import { EventEmitter } from 'events'

export interface ScreenSource {
  id: string
  name: string
  thumbnail: string
}

export interface CropRegion {
  x: number
  y: number
  width: number
  height: number
}

export interface CaptureFrame {
  timestamp: number
  dataUrl: string
  width: number
  height: number
}

export class ScreenCapturer extends EventEmitter {
  private captureInterval: ReturnType<typeof setInterval> | null = null
  private sourceId: string | null = null
  private cropRegion: CropRegion | null = null
  private fps: number = 1
  private isCapturing = false

  constructor() {
    super()
  }

  async getSources(): Promise<ScreenSource[]> {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: false
    })
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
  }

  setSource(sourceId: string) {
    this.sourceId = sourceId
  }

  setCropRegion(region: CropRegion | null) {
    this.cropRegion = region
  }

  setFps(fps: number) {
    this.fps = Math.max(0.5, Math.min(fps, 5))
  }

  async startCapture(): Promise<void> {
    if (!this.sourceId) {
      throw new Error('No source selected')
    }
    if (this.isCapturing) return

    this.isCapturing = true
    const intervalMs = Math.round(1000 / this.fps)

    this.captureInterval = setInterval(async () => {
      try {
        await this.captureFrame()
      } catch (err) {
        console.error('[ScreenCapturer] Frame capture error:', err)
      }
    }, intervalMs)

    // Immediately capture first frame
    await this.captureFrame()
  }

  stopCapture() {
    this.isCapturing = false
    if (this.captureInterval) {
      clearInterval(this.captureInterval)
      this.captureInterval = null
    }
  }

  private async captureFrame(): Promise<void> {
    if (!this.sourceId || !this.isCapturing) return

    console.log('[ScreenCapturer] captureFrame() called, sourceId:', this.sourceId)

    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    console.log('[ScreenCapturer] Found', sources.length, 'sources:', sources.map(s => `${s.name}(${s.id})`).join(', '))

    const source = sources.find(s => s.id === this.sourceId)
    if (!source) {
      console.warn('[ScreenCapturer] ❌ Source not found:', this.sourceId, '- available:', sources.map(s => s.id))
      return
    }

    let thumbnail = source.thumbnail
    const thumbSize = thumbnail.getSize()
    console.log(`[ScreenCapturer] Thumbnail size: ${thumbSize.width}×${thumbSize.height}, isEmpty: ${thumbnail.isEmpty()}`)

    // Crop if region is set
    if (this.cropRegion) {
      const { x, y, width, height } = this.cropRegion
      console.log(`[ScreenCapturer] Cropping to: ${x},${y} ${width}×${height}`)
      thumbnail = thumbnail.crop({
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height)
      })
    }

    const dataUrl = thumbnail.toDataURL()
    console.log(`[ScreenCapturer] Frame data URL length: ${dataUrl.length} chars, starts with: ${dataUrl.substring(0, 30)}`)

    const frame: CaptureFrame = {
      timestamp: Date.now(),
      dataUrl,
      width: thumbnail.getSize().width,
      height: thumbnail.getSize().height
    }

    this.emit('frame', frame)
    console.log(`[ScreenCapturer] ✅ Frame emitted: ${frame.width}×${frame.height}`)
  }

  /**
   * Opens a transparent overlay window for the user to draw a crop rectangle
   */
  async selectArea(parentWindow: BrowserWindow): Promise<CropRegion | null> {
    return new Promise((resolve) => {
      const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      )
      const { x, y, width, height } = display.bounds

      const overlayWindow = new BrowserWindow({
        x, y, width, height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        hasShadow: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      overlayWindow.setIgnoreMouseEvents(false)

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              width: 100vw; height: 100vh;
              background: rgba(0,0,0,0.3);
              cursor: crosshair;
              overflow: hidden;
              user-select: none;
            }
            #selection {
              position: absolute;
              border: 2px solid #38bdf8;
              background: rgba(56, 189, 248, 0.08);
              box-shadow: 0 0 0 9999px rgba(0,0,0,0.4);
              display: none;
            }
            #info {
              position: fixed;
              top: 20px;
              left: 50%;
              transform: translateX(-50%);
              background: rgba(0,0,0,0.8);
              color: #e8e8f0;
              padding: 8px 20px;
              border-radius: 8px;
              font-family: 'Inter', system-ui, sans-serif;
              font-size: 14px;
              pointer-events: none;
            }
          </style>
        </head>
        <body>
          <div id="info">Click and drag to select an area. Press ESC to cancel.</div>
          <div id="selection"></div>
          <script>
            const sel = document.getElementById('selection');
            let startX, startY, isDragging = false;

            document.addEventListener('mousedown', (e) => {
              startX = e.clientX;
              startY = e.clientY;
              isDragging = true;
              sel.style.display = 'block';
              sel.style.left = startX + 'px';
              sel.style.top = startY + 'px';
              sel.style.width = '0';
              sel.style.height = '0';
            });

            document.addEventListener('mousemove', (e) => {
              if (!isDragging) return;
              const x = Math.min(e.clientX, startX);
              const y = Math.min(e.clientY, startY);
              const w = Math.abs(e.clientX - startX);
              const h = Math.abs(e.clientY - startY);
              sel.style.left = x + 'px';
              sel.style.top = y + 'px';
              sel.style.width = w + 'px';
              sel.style.height = h + 'px';
            });

            document.addEventListener('mouseup', (e) => {
              if (!isDragging) return;
              isDragging = false;
              const x = Math.min(e.clientX, startX);
              const y = Math.min(e.clientY, startY);
              const w = Math.abs(e.clientX - startX);
              const h = Math.abs(e.clientY - startY);
              if (w > 20 && h > 20) {
                // Send selection back
                document.title = JSON.stringify({ x, y, width: w, height: h });
              } else {
                document.title = 'cancelled';
              }
            });

            document.addEventListener('keydown', (e) => {
              if (e.key === 'Escape') {
                document.title = 'cancelled';
              }
            });
          </script>
        </body>
        </html>
      `

      overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

      // Watch for title change as our IPC mechanism
      const checkTitle = setInterval(() => {
        try {
          const title = overlayWindow.getTitle()
          if (title === 'cancelled') {
            clearInterval(checkTitle)
            overlayWindow.close()
            resolve(null)
          } else if (title.startsWith('{')) {
            clearInterval(checkTitle)
            overlayWindow.close()
            try {
              const region = JSON.parse(title) as CropRegion
              resolve(region)
            } catch {
              resolve(null)
            }
          }
        } catch {
          clearInterval(checkTitle)
          resolve(null)
        }
      }, 100)

      overlayWindow.on('closed', () => {
        clearInterval(checkTitle)
        resolve(null)
      })
    })
  }
}
