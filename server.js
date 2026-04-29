const express = require('express')
const path = require('path')
const fs = require('fs')

let _server = null

function findDistDir() {
  const candidates = []
  // usual development location
  candidates.push(path.join(__dirname, 'dist'))
  // when packaged with electron-builder, resourcesPath may contain the app files
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'dist'))
    candidates.push(path.join(process.resourcesPath, 'app', 'dist'))
  }

  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'index.html'))) return c
    } catch (e) { /* ignore */ }
  }
  return null
}

function startServer(port = 0, host = undefined) {
  return new Promise((resolve, reject) => {
    try {
      const app = express()
      const distDir = findDistDir()
      if (!distDir) return reject(new Error('Could not find dist/ directory to serve'))

      console.log('Serving dist from', distDir)

      // If Vite emitted a manifest.json, use it to map source module requests
      // (e.g. /src/overlay-entry.jsx) to the hashed built asset paths.
      const manifestCandidates = [
        path.join(distDir, 'manifest.json'),
        path.join(distDir, '.vite', 'manifest.json'),
        path.join(distDir, '.vite', 'manifest-prod.json')
      ]
      let manifest = null
      for (const p of manifestCandidates) {
        try {
          if (fs.existsSync(p)) {
            manifest = JSON.parse(fs.readFileSync(p, 'utf-8'))
            console.log('Using manifest:', p)
            break
          }
        } catch (e) { /* ignore */ }
      }

      if (manifest) {
        app.use((req, res, next) => {
          // Only rewrite JS module requests from /src/
          if (!req.path.startsWith('/src/')) return next()
          const key = req.path.replace(/^\//, '')
          const entry = manifest[key]
          if (entry && entry.file) {
            const target = path.join(distDir, entry.file)
            return res.sendFile(target)
          }
          // try fallback: manifest keys may refer to /src/entry.jsx or relative paths
          // Attempt to find a matching manifest key that endsWith the requested filename
          const filename = path.basename(req.path)
          for (const k of Object.keys(manifest)) {
            if (k.endsWith(filename) && manifest[k] && manifest[k].file) {
              return res.sendFile(path.join(distDir, manifest[k].file))
            }
          }
          next()
        })
      }

      app.use(express.static(distDir))
      app.get('*', (req, res) => res.sendFile(path.join(distDir, 'index.html')))

      // Use provided host (e.g. '0.0.0.0') if given so external processes can reach it.
      if (host) {
        _server = app.listen(port, host, () => {
          const p = _server.address().port
          console.log(`Server running on ${host}:${p}`)
          resolve(p)
        })
      } else {
        _server = app.listen(port, () => {
          const p = _server.address().port
          console.log(`Server running on port ${p}`)
          resolve(p)
        })
      }
      _server.on('error', reject)
    } catch (err) {
      reject(err)
    }
  })
}

function stopServer() {
  if (_server && _server.close) {
    _server.close()
    _server = null
  }
}

module.exports = { startServer, stopServer }
