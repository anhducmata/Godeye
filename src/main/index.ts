import { app, BrowserWindow } from 'electron'
import path from 'path'
import { initializeHandlers } from './ipc/handlers'

let mainWindow: BrowserWindow | null = null

// Suppress the 'Render frame was disposed' error from crashing the app
process.on('uncaughtException', (err) => {
  if (err.message?.includes('Render frame was disposed')) {
    // Harmless — happens during HMR reload, safe to ignore
    return
  }
  console.error('[Godeye] Uncaught exception:', err)
})

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: 'Godeye — Desktop Observer',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Initialize all IPC handlers
  initializeHandlers(mainWindow)

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
