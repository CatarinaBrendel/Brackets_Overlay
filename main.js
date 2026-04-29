const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const server = require('./server')

let mainWindow = null

async function createWindow() {
  // Use PORT env or default to 3000 so OBS can point to a stable URL.
  const requestedPort = process.env.PORT ? Number(process.env.PORT) : 3000
  const host = process.env.PORT_HOST || '0.0.0.0'

  let port
  try {
    port = await server.startServer(requestedPort, host)
  } catch (err) {
    console.error('Failed to start server:', err)
    dialog.showErrorBox('Startup error', `Failed to start local server: ${err.message || err}`)
    return
  }

  // write the active port to a small file in userData so external tools can read it
  try {
    const userDataPath = app.getPath('userData')
    const portFile = path.join(userDataPath, 'startgg-port.txt')
    require('fs').writeFileSync(portFile, String(port), 'utf-8')
    console.log('Wrote port to', portFile)
  } catch (e) {
    console.warn('Failed to write port file', e)
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    webPreferences: {
      contextIsolation: true,
      sandbox: false
    }
  })

  const url = `http://127.0.0.1:${port}/overlay.html`
  mainWindow.loadURL(url).catch(e => console.error('loadURL failed', e))
  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (mainWindow === null) createWindow() })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  try { server.stopServer() } catch (e) { /* ignore */ }
})
