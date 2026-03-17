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

  private frameCounter = 0

  private async captureFrame(): Promise<void> {
    if (!this.sourceId || !this.isCapturing) return

    this.frameCounter++
    const logThis = this.frameCounter <= 3 || this.frameCounter % 10 === 0

    if (logThis) {
      console.log(`[ScreenCapturer] captureFrame #${this.frameCounter}, sourceId:`, this.sourceId)
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 800, height: 450 }  // downscaled for performance
      })

      const source = sources.find(s => s.id === this.sourceId)
      if (!source) {
        if (logThis) console.warn('[ScreenCapturer] Source not found:', this.sourceId)
        return
      }

      let thumbnail = source.thumbnail
      if (thumbnail.isEmpty()) {
        if (logThis) console.warn('[ScreenCapturer] Empty thumbnail, skipping')
        return
      }

      // Crop if region is set (scale crop coordinates to match thumbnail size)
      if (this.cropRegion) {
        const thumbSize = thumbnail.getSize()
        // The display coords may be larger than the thumbnail — scale proportionally
        const displayBounds = require('electron').screen.getPrimaryDisplay().bounds
        const scaleX = thumbSize.width / displayBounds.width
        const scaleY = thumbSize.height / displayBounds.height

        const cx = Math.round(this.cropRegion.x * scaleX)
        const cy = Math.round(this.cropRegion.y * scaleY)
        const cw = Math.round(this.cropRegion.width * scaleX)
        const ch = Math.round(this.cropRegion.height * scaleY)

        // Clamp to valid bounds
        const finalX = Math.max(0, Math.min(cx, thumbSize.width - 1))
        const finalY = Math.max(0, Math.min(cy, thumbSize.height - 1))
        const finalW = Math.min(cw, thumbSize.width - finalX)
        const finalH = Math.min(ch, thumbSize.height - finalY)

        if (finalW > 10 && finalH > 10) {
          thumbnail = thumbnail.crop({ x: finalX, y: finalY, width: finalW, height: finalH })
        }
      }

      // Use JPEG for smaller IPC payload (~50KB instead of ~2MB)
      const jpegBuffer = thumbnail.toJPEG(60)
      const dataUrl = `data:image/jpeg;base64,${jpegBuffer.toString('base64')}`

      if (logThis) {
        console.log(`[ScreenCapturer] Frame #${this.frameCounter}: ${thumbnail.getSize().width}×${thumbnail.getSize().height}, ${Math.round(dataUrl.length / 1024)}KB`)
      }

      const frame: CaptureFrame = {
        timestamp: Date.now(),
        dataUrl,
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height
      }

      this.emit('frame', frame)
    } catch (err) {
      console.error('[ScreenCapturer] captureFrame error:', err)
    }
  }

  /**
   * Opens a fullscreen overlay window for the user to draw a crop rectangle.
   * Uses a temp HTML file + IPC (more reliable on Windows than data: URLs + transparent windows).
   */
  async selectArea(parentWindow: BrowserWindow): Promise<CropRegion | null> {
    const { writeFileSync, unlinkSync } = await import('fs')
    const { join } = await import('path')
    const { app } = await import('electron')

    return new Promise((resolve) => {
      const display = screen.getDisplayNearestPoint(
        screen.getCursorScreenPoint()
      )
      const { x, y, width, height } = display.bounds

      console.log(`[ScreenCapturer] selectArea: display bounds ${width}×${height} at (${x},${y})`)

      // Write HTML to a temp file (data: URLs can be blocked on Windows)
      const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      width: 100vw; height: 100vh;
      background: rgba(10, 10, 20, 0.75);
      cursor: crosshair;
      overflow: hidden;
      user-select: none;
    }
    #selection {
      position: absolute;
      border: 2px solid #38bdf8;
      background: rgba(56, 189, 248, 0.1);
      box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
      display: none;
      z-index: 10;
    }
    #size-label {
      position: absolute;
      background: rgba(0,0,0,0.85);
      color: #38bdf8;
      padding: 2px 8px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
      pointer-events: none;
      display: none;
      z-index: 20;
    }
    #info {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.9);
      color: #e8e8f0;
      padding: 10px 24px;
      border-radius: 10px;
      font-family: system-ui, sans-serif;
      font-size: 15px;
      pointer-events: none;
      z-index: 100;
      border: 1px solid rgba(56, 189, 248, 0.3);
    }
  </style>
</head>
<body>
  <div id="info">Click and drag to select an area · Press ESC to cancel</div>
  <div id="selection"></div>
  <div id="size-label"></div>
  <script>
    const sel = document.getElementById('selection');
    const label = document.getElementById('size-label');
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

      label.style.display = 'block';
      label.style.left = (x + w + 8) + 'px';
      label.style.top = (y + h + 8) + 'px';
      label.textContent = w + ' × ' + h;
    });

    document.addEventListener('mouseup', (e) => {
      if (!isDragging) return;
      isDragging = false;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      if (w > 20 && h > 20) {
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

    // Signal we're ready
    document.title = 'overlay-ready';
  </script>
</body>
</html>`

      const tmpPath = join(app.getPath('temp'), 'meetsense-overlay.html')
      writeFileSync(tmpPath, htmlContent, 'utf-8')
      console.log('[ScreenCapturer] Wrote overlay HTML to:', tmpPath)

      const overlayWindow = new BrowserWindow({
        x, y, width, height,
        fullscreen: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        backgroundColor: '#0a0a14',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false
        }
      })

      overlayWindow.setIgnoreMouseEvents(false)

      overlayWindow.loadFile(tmpPath)
        .then(() => console.log('[ScreenCapturer] Overlay loaded successfully'))
        .catch(err => {
          console.error('[ScreenCapturer] Failed to load overlay:', err)
          resolve(null)
        })

      // Watch for title changes as our IPC mechanism
      const checkTitle = setInterval(() => {
        try {
          if (overlayWindow.isDestroyed()) {
            clearInterval(checkTitle)
            return
          }
          const title = overlayWindow.getTitle()
          if (title === 'cancelled') {
            clearInterval(checkTitle)
            overlayWindow.close()
            console.log('[ScreenCapturer] Area selection cancelled')
            resolve(null)
          } else if (title.startsWith('{')) {
            clearInterval(checkTitle)
            overlayWindow.close()
            try {
              const region = JSON.parse(title) as CropRegion
              console.log(`[ScreenCapturer] Area selected: ${JSON.stringify(region)}`)
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
        try { unlinkSync(tmpPath) } catch {}
        resolve(null)
      })
    })
  }
}
