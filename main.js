const { app, BrowserWindow, BrowserView, dialog, clipboard } = require('electron')
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
    console.warn('Requested port unavailable:', err && err.code)
    if (err && err.code === 'EADDRINUSE') {
      try {
        // Try an ephemeral port instead
        const fallback = await server.startServer(0, host)
        port = fallback
        // Inform the user which port was selected
        dialog.showMessageBox({ type: 'info', message: `Port ${requestedPort} was in use. Using port ${port} instead.` })
      } catch (err2) {
        console.error('Failed to start fallback server:', err2)
        dialog.showErrorBox('Startup error', `Failed to start local server: ${err2.message || err2}`)
        return
      }
    } else {
      console.error('Failed to start server:', err)
      dialog.showErrorBox('Startup error', `Failed to start local server: ${err.message || err}`)
      return
    }
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

  // Create an in-window BrowserView that displays the local URL and a copy/open/close UI.
  let infoView = null
  let currentPath = '/overlay.html'
  function createInfoView() {
    try {
      infoView = new BrowserView({ webPreferences: { contextIsolation: false, nodeIntegration: true } })
      mainWindow.setBrowserView(infoView)
      // larger banner, centered horizontally and vertically
      const vw = 620, vh = 280
      const [mw, mh] = mainWindow.getSize()
      const x = Math.round((mw - vw) / 2)
      const y = Math.round((mh - vh) / 2)
      infoView.setBounds({ x, y, width: vw, height: vh })
      infoView.setAutoResize({ width: false, height: false })

      const infoHtml = `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial;margin:0;padding:12px;color:#fff;background:rgba(0,0,0,0.72);border-radius:10px;display:flex;align-items:center;justify-content:center;height:100%} .container{display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;width:100%} .block{min-width:260px;max-width:480px;text-align:center} .label{font-weight:600;margin-bottom:6px;font-size:12px;color:#ddd} .url{font-weight:700;word-break:break-all;margin-bottom:8px;font-size:13px;color:#fff} .controls{display:flex;gap:8px;justify-content:center} button{padding:6px 10px;border-radius:6px;border:1px solid #666;background:#111;color:#fff} a{color:#66b8ff;text-decoration:none}</style></head><body>
        <div class="container">
          <div class="block"><div class="label">Overlay</div><div class="url" id="url-overlay">http://localhost:${port}/overlay.html</div><div class="controls"><button id="copy-overlay">Copy</button><a id="open-overlay" href="http://localhost:${port}/overlay.html" target="_blank">Open</a></div></div>
          <div class="block"><div class="label">Control</div><div class="url" id="url-control">http://localhost:${port}/control.html</div><div class="controls"><button id="copy-control">Copy</button><a id="open-control" href="http://localhost:${port}/control.html" target="_blank">Open</a></div></div>
          <div class="block"><div class="label">Announcement</div><div class="url" id="url-ann">http://localhost:${port}/announcement.html</div><div class="controls"><button id="copy-ann">Copy</button><a id="open-ann" href="http://localhost:${port}/announcement.html" target="_blank">Open</a></div></div>
        </div>
        <script>const { clipboard, ipcRenderer } = require('electron');document.getElementById('copy-overlay').addEventListener('click',()=>{try{clipboard.writeText(document.getElementById('url-overlay').textContent);alert('Copied')}catch(e){alert('Copy failed:'+e)}});document.getElementById('copy-control').addEventListener('click',()=>{try{clipboard.writeText(document.getElementById('url-control').textContent);alert('Copied')}catch(e){alert('Copy failed:'+e)}});document.getElementById('copy-ann').addEventListener('click',()=>{try{clipboard.writeText(document.getElementById('url-ann').textContent);alert('Copied')}catch(e){alert('Copy failed:'+e)}});document.getElementById('close').addEventListener('click',()=>{ipcRenderer.send('hide-info')});</script></body></html>`
      infoView.webContents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(infoHtml))
        // Removed duplicated HTML content
      // listen for hide request
      const { ipcMain } = require('electron')
      ipcMain.once('hide-info', () => { try { mainWindow.removeBrowserView(infoView); infoView = null } catch (e) {} })
      // update bounds on resize
      mainWindow.on('resize', () => {
        if (!infoView) return
        const [mw2, mh2] = mainWindow.getSize()
        const x2 = Math.round((mw2 - vw) / 2)
        infoView.setBounds({ x: x2, y: 20, width: vw, height: vh })
      })
    } catch (e) {
      console.warn('Failed to create info view', e)
    }
  }

  function updateInfoViewUrl(pathname) {
    currentPath = pathname || currentPath
    if (!infoView) return
    const script = `(() => { const el = document.getElementById('url'); if (el) el.textContent = 'http://localhost:${port}' + '${currentPath}'; const open = document.querySelector('a'); if (open) open.href = 'http://localhost:${port}' + '${currentPath}'; })()`
    try { infoView.webContents.executeJavaScript(script).catch(()=>{}) } catch (e) {}
  }

  function loadPage(pathname) {
    currentPath = pathname
    const pageUrl = `http://127.0.0.1:${port}${pathname}`
    mainWindow.loadURL(pageUrl).catch(e => console.error('loadURL failed', e))
    updateInfoViewUrl(pathname)
  }

  // Add simple menu to switch between pages
  try {
    const { Menu } = require('electron')
    const template = [
      { label: 'Pages', submenu: [
        { label: 'Overlay', click: () => loadPage('/overlay.html') },
        { label: 'Control', click: () => loadPage('/control.html') },
        { label: 'Announcement', click: () => loadPage('/announcement.html') }
      ]}
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  } catch (e) { /* ignore */ }

  mainWindow = new BrowserWindow({
    width: 700,
    height: 420,
    webPreferences: {
      contextIsolation: true,
      sandbox: false
    }
  })
  // Wait for the server to accept connections before loading the page to avoid ERR_FAILED.
  const url = `http://127.0.0.1:${port}/overlay.html`
  async function waitForServerReady(u, attempts = 20, delayMs = 250) {
    const http = require('http')
    for (let i = 0; i < attempts; i++) {
      try {
        await new Promise((resolve, reject) => {
          const req = http.get(u, res => {
            // any 2xx/3xx/4xx indicates the server responded; consider <500 successful
            if (res.statusCode && res.statusCode < 500) {
              res.resume()
              resolve()
            } else {
              res.resume()
              reject(new Error('bad status ' + res.statusCode))
            }
          })
          req.on('error', reject)
          req.setTimeout(2000, () => { req.destroy(new Error('timeout')) })
        })
        return true
      } catch (e) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
    return false
  }

  waitForServerReady(url).then(ready => {
    if (!ready) console.warn('Server did not respond in time, attempting to load URL anyway')
    mainWindow.loadURL(url).catch(e => console.error('loadURL failed', e))
  })
  mainWindow.once('ready-to-show', () => {
    try { createInfoView() } catch (e) { console.warn('createInfoView failed', e) }
    mainWindow.show()
  })

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
