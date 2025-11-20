import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import os from 'os'

function getLocalIPv4() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

export class FileServer {
  constructor(opts) {
    this.server = null
    this.port = 0
    this.host = getLocalIPv4()
    this.files = new Map()
    this.storagePath = (opts && opts.storagePath) || ''
    this.preferredPort = (opts && opts.preferredPort) || 0
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this._load()
        this.server = http.createServer((req, res) => this._handle(req, res))
        const desired =
          this.preferredPort && this.preferredPort > 0 ? this.preferredPort : this.port || 0
        const onListening = () => {
          this.port = this.server.address().port
          this._persist()
          resolve({ port: this.port, host: this.host })
        }
        this.server.once('error', (err) => {
          try {
            this.server.removeAllListeners('error')
            this.server.close(() => {
              try {
                if (this.preferredPort && this.preferredPort > 0) {
                  reject(err)
                  return
                }
                this.server = http.createServer((req, res) => this._handle(req, res))
                this.server.listen(0, onListening)
              } catch (e) {
                reject(e)
              }
            })
          } catch (e) {
            reject(e)
          }
        })
        this.server.listen(desired, onListening)
      } catch (e) {
        reject(e)
      }
    })
  }

  stop() {
    try {
      this.server.close()
    } catch (e) {
      void e
    }
  }

  shareFile(filePath) {
    const stat = fs.statSync(filePath)
    const name = path.basename(filePath)
    const token = crypto.randomUUID()
    this.files.set(token, { path: filePath, name, size: stat.size })
    const url = `http://${this.host}:${this.port}/files/${token}`
    this._persist()
    return { token, name, size: stat.size, url }
  }

  listFiles() {
    const arr = []
    for (const [token, v] of this.files.entries())
      arr.push({
        token,
        name: v.name,
        size: v.size,
        url: `http://${this.host}:${this.port}/files/${token}`
      })
    return arr
  }

  _handle(req, res) {
    const u = new URL(req.url, `http://${req.headers.host}`)
    if (u.pathname.startsWith('/files/')) {
      const token = u.pathname.split('/').pop()
      const info = this.files.get(token)
      if (!info) {
        res.statusCode = 404
        res.end('Not Found')
        return
      }
      const range = req.headers.range
      const total = info.size
      const mime = getMime(info.name)
      res.setHeader('Content-Type', mime)
      if (mime === 'application/octet-stream') {
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${encodeURIComponent(info.name)}"`
        )
      } else {
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(info.name)}"`)
      }
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : total - 1
        const chunkSize = end - start + 1
        res.statusCode = 206
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
        res.setHeader('Accept-Ranges', 'bytes')
        res.setHeader('Content-Length', chunkSize)
        const stream = fs.createReadStream(info.path, { start, end })
        stream.pipe(res)
      } else {
        res.statusCode = 200
        res.setHeader('Content-Length', total)
        const stream = fs.createReadStream(info.path)
        stream.pipe(res)
      }
      return
    }
    res.statusCode = 404
    res.end('Not Found')
  }

  _persist() {
    try {
      if (!this.storagePath) return
      const dir = path.dirname(this.storagePath)
      try {
        fs.mkdirSync(dir, { recursive: true })
      } catch (e) {
        void e
      }
      const files = []
      for (const [token, v] of this.files.entries())
        files.push({ token, path: v.path, name: v.name, size: v.size })
      const data = { port: this.port, files }
      fs.writeFileSync(this.storagePath, JSON.stringify(data))
    } catch (e) {
      void e
    }
  }

  _load() {
    try {
      if (!this.storagePath) return
      if (!fs.existsSync(this.storagePath)) return
      const raw = fs.readFileSync(this.storagePath, 'utf-8')
      const obj = JSON.parse(raw || '{}')
      if (obj && obj.port && Number.isFinite(obj.port)) this.port = obj.port
      const list = (obj && obj.files) || []
      for (const it of list) {
        try {
          if (it && it.token && it.path && fs.existsSync(it.path)) {
            const st = fs.statSync(it.path)
            this.files.set(it.token, {
              path: it.path,
              name: it.name || path.basename(it.path),
              size: st.size
            })
          }
        } catch (e) {
          void e
        }
      }
    } catch (e) {
      void e
    }
  }
}

export function createFileServer(opts) {
  return new FileServer(opts || {})
}

function getMime(name) {
  try {
    const n = (name || '').toLowerCase()
    const ext = n.split('.').pop() || ''
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg'
      case 'png':
        return 'image/png'
      case 'gif':
        return 'image/gif'
      case 'webp':
        return 'image/webp'
      case 'bmp':
        return 'image/bmp'
      case 'svg':
        return 'image/svg+xml'
      case 'mp4':
        return 'video/mp4'
      case 'webm':
        return 'video/webm'
      case 'mkv':
        return 'video/x-matroska'
      case 'mov':
        return 'video/quicktime'
      case 'flv':
        return 'video/x-flv'
      case 'avi':
        return 'video/x-msvideo'
      default:
        return 'application/octet-stream'
    }
  } catch {
    return 'application/octet-stream'
  }
}
