import { app, shell, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, clipboard } from 'electron'
import { join } from 'path'
import path from 'path'
import fs from 'fs'
import http from 'http'
import https from 'https'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { createLanBus } from './lan'
import { createFileServer } from './file-server'
import os from 'os'

let mainWindow
let lan
let fileServer
let downloadDir
let tray
let trayBlinkTimer
let trayBlinkOn = false
let blankIcon
let messages = []
let messagesPath = ''
let isQuitting = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  // mainWindow.webContents.openDevTools()

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // 初始化托盘和提醒
  try {
    blankIcon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
    )
    tray = new Tray(icon)
    const ctx = Menu.buildFromTemplate([
      {
        label: '显示窗口',
        click: () => {
          try {
            mainWindow.show()
            stopTrayBlink()
            mainWindow.flashFrame(false)
          } catch {
            void 0
          }
        }
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          app.quit()
        }
      }
    ])
    tray.setToolTip('局域网群聊')
    tray.setContextMenu(ctx)
    tray.on('click', () => {
      try {
        mainWindow.show()
        stopTrayBlink()
        mainWindow.flashFrame(false)
      } catch {
        void 0
      }
    })
    tray.on('double-click', () => {
      try {
        mainWindow.show()
        stopTrayBlink()
        mainWindow.flashFrame(false)
      } catch {
        void 0
      }
    })
  } catch {
    void 0
  }

  function startTrayBlink() {
    try {
      if (!tray) return
      if (trayBlinkTimer) return
      trayBlinkOn = false
      trayBlinkTimer = setInterval(() => {
        try {
          trayBlinkOn = !trayBlinkOn
          tray.setImage(trayBlinkOn ? blankIcon : icon)
        } catch {
          void 0
        }
      }, 600)
    } catch {
      void 0
    }
  }

  function stopTrayBlink() {
    try {
      if (!tray) return
      if (trayBlinkTimer) clearInterval(trayBlinkTimer)
      trayBlinkTimer = null
      trayBlinkOn = false
      tray.setImage(icon)
    } catch {
      void 0
    }
  }

  mainWindow.on('focus', () => {
    try {
      stopTrayBlink()
      mainWindow.flashFrame(false)
    } catch {
      void 0
    }
  })
  mainWindow.on('show', () => {
    try {
      stopTrayBlink()
      mainWindow.flashFrame(false)
    } catch {
      void 0
    }
  })

  mainWindow.on('close', (e) => {
    try {
      if (!isQuitting) {
        e.preventDefault()
        mainWindow.hide()
      }
    } catch {
      void 0
    }
  })

  ipcMain.handle('sys:notify-message', () => {
    try {
      startTrayBlink()
      if (mainWindow && !mainWindow.isFocused()) mainWindow.flashFrame(true)
      return true
    } catch {
      return false
    }
  })

  const storagePath = join(app.getPath('userData'), 'file-shares.json')
  const preferredPort = 56480
  fileServer = createFileServer({ storagePath, preferredPort })
  fileServer
    .start()
    .then((info) => {
      try {
        if (lan && info && Number.isFinite(info.port)) lan.setHttpPort(info.port)
      } catch {
        void 0
      }
    })
    .catch(() => {})

  lan = createLanBus({ httpPort: 0 })
  lan.start()
  lan.on('chat', (m) => {
    if (mainWindow) mainWindow.webContents.send('lan:chat', m)
    try {
      const from = m && m.from
      if (from && lan && from.addr !== lan.addr) {
        startTrayBlink()
        if (!mainWindow.isFocused()) mainWindow.flashFrame(true)
      }
    } catch {
      void 0
    }
    try {
      const payload = {
        type: 'text',
        text: String((m && m.text) || ''),
        ts: (m && m.ts) || Date.now(),
        from: (m && m.from) || { ip: lan.addr, nick: lan.nick }
      }
      _appendMessage(payload)
      _persistMessages()
    } catch {
      void 0
    }
  })
  lan.on('file-offer', (p) => {
    if (mainWindow) mainWindow.webContents.send('lan:file-offer', p)
    try {
      const from = (p && p.from) || {}
      const base = (p && p.ts) || Date.now()
      const list = (p && Array.isArray(p.files)) ? p.files : []
      for (let i = 0; i < list.length; i++) {
        const f = list[i]
        const type = classifyFileType(String((f && f.name) || ''))
        const payload = {
          type,
          text: String((f && f.url) || ''),
          name: String((f && f.name) || ''),
          size: Number((f && f.size) || 0),
          ts: base + i,
          from
        }
        _appendMessage(payload)
      }
      _persistMessages()
    } catch { void 0 }
  })
  lan.on('peer-update', (list) => {
    if (mainWindow) mainWindow.webContents.send('lan:peers', list)
    try {
      applyPeerNicknames(list)
      _persistMessages()
    } catch { void 0 }
  })

  ipcMain.on('lan:send-message', (e, text) => {
    if (!lan) return
    lan.broadcast({ type: 'chat', text })
    const from = { id: lan.peerId, nick: lan.nick, addr: lan.addr, port: lan.httpPort }
    const ts = Date.now()
    if (mainWindow) mainWindow.webContents.send('lan:chat', { text, from, ts })
    try {
      const payload = {
        type: 'text',
        text: String(text || ''),
        ts,
        from: { ip: lan.addr, nick: lan.nick }
      }
      _appendMessage(payload)
      _persistMessages()
    } catch {
      void 0
    }
  })

  ipcMain.handle('lan:get-state', () => {
    const self = lan ? { id: lan.peerId, nick: lan.nick, addr: lan.addr, port: lan.httpPort } : null
    const peers = lan ? lan.listPeers() : []
    const files = fileServer ? fileServer.listFiles() : []
    return { self, peers, files }
  })

  ipcMain.handle('lan:set-nickname', (e, nick) => {
    try {
      if (!lan) return false
      const n = String(nick || '').trim()
      if (!n) return false
      lan.nick = n
      lan.broadcast({ type: 'hello' })
      const list = lan.listPeers()
      if (mainWindow) mainWindow.webContents.send('lan:peers', list)
      try {
        applyPeerNicknames(list)
        _persistMessages()
      } catch { void 0 }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('lan:upload-file', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections']
    })
    if (r.canceled) return []
    const shares = []
    for (const p of r.filePaths) {
      const s = fileServer.shareFile(p)
      shares.push(s)
}
    if (lan) lan.broadcast({ type: 'file-offer', files: shares })
    try {
      const from = lan ? { ip: lan.addr, nick: lan.nick } : {}
      const base = Date.now()
      for (let i = 0; i < shares.length; i++) {
        const s = shares[i]
        const type = classifyFileType(String((s && s.name) || ''))
        const payload = {
          type,
          text: String((s && s.url) || ''),
          name: String((s && s.name) || ''),
          size: Number((s && s.size) || 0),
          ts: base + i,
          from
        }
        _appendMessage(payload)
      }
      _persistMessages()
      try {
        if (mainWindow) mainWindow.webContents.send('lan:file-offer', { from, files: shares, ts: base })
      } catch { void 0 }
    } catch { void 0 }
    return shares
  })

  ipcMain.handle('lan:upload-file-paths', async (e, paths) => {
    try {
      const list = Array.isArray(paths) ? paths : []
      const shares = []
      for (const p of list) {
        try {
          if (!p) continue
          let resolved = p
          try {
            const u = new URL(String(p))
            if (u.protocol === 'file:') {
              resolved = decodeURI(u.pathname || '')
              if (process.platform === 'win32' && resolved.startsWith('/')) resolved = resolved.slice(1)
            }
          } catch { void 0 }
          if (!fs.existsSync(resolved)) continue
          try {
            const st = fs.statSync(resolved)
            if (!st.isFile()) continue
          } catch { continue }
          const s = fileServer.shareFile(resolved)
          shares.push(s)
        } catch { void 0 }
      }
      if (shares.length === 0) return []
      if (lan) lan.broadcast({ type: 'file-offer', files: shares })
      try {
        const from = lan ? { ip: lan.addr, nick: lan.nick } : {}
        const base = Date.now()
        for (let i = 0; i < shares.length; i++) {
          const s = shares[i]
          const type = classifyFileType(String((s && s.name) || ''))
          const payload = {
            type,
            text: String((s && s.url) || ''),
            name: String((s && s.name) || ''),
            size: Number((s && s.size) || 0),
            ts: base + i,
            from
          }
          _appendMessage(payload)
        }
      _persistMessages()
      try {
        if (mainWindow) mainWindow.webContents.send('lan:file-offer', { from, files: shares, ts: base })
      } catch { void 0 }
      } catch { void 0 }
      return shares
    } catch {
      return []
    }
  })

  ipcMain.handle('lan:upload-file-blobs', async (e, blobs) => {
    try {
      const list = Array.isArray(blobs) ? blobs : []
      if (list.length === 0) return []
      const dir = path.join(app.getPath('temp'), 'lan-chat-uploads')
      try { fs.mkdirSync(dir, { recursive: true }) } catch { void 0 }
      const shares = []
      for (const it of list) {
        try {
          const name = String((it && it.name) || '')
          const b64 = String((it && it.data) || '')
          if (!name || !b64) continue
          const safe = name.replace(/[^\w\-.()\[\]\u4e00-\u9fa5]/g, '_')
          const target = path.join(dir, safe)
          const buf = Buffer.from(b64, 'base64')
          fs.writeFileSync(target, buf)
          const s = fileServer.shareFile(target)
          shares.push(s)
        } catch { void 0 }
      }
      if (shares.length === 0) return []
      if (lan) lan.broadcast({ type: 'file-offer', files: shares })
      try {
        const from = lan ? { ip: lan.addr, nick: lan.nick } : {}
        const base = Date.now()
        for (let i = 0; i < shares.length; i++) {
          const s = shares[i]
          const type = classifyFileType(String((s && s.name) || ''))
          const payload = {
            type,
            text: String((s && s.url) || ''),
            name: String((s && s.name) || ''),
            size: Number((s && s.size) || 0),
            ts: base + i,
            from
          }
          _appendMessage(payload)
        }
      _persistMessages()
      try {
        if (mainWindow) mainWindow.webContents.send('lan:file-offer', { from, files: shares, ts: base })
      } catch { void 0 }
      } catch { void 0 }
      return shares
    } catch {
      return []
    }
  })

  ipcMain.handle('lan:upload-file-buffers', async (e, files) => {
    try {
      const list = Array.isArray(files) ? files : []
      if (list.length === 0) return []
      const dir = path.join(app.getPath('temp'), 'lan-chat-uploads')
      try { fs.mkdirSync(dir, { recursive: true }) } catch { void 0 }
      const shares = []
      for (const it of list) {
        try {
          const name = String((it && it.name) || '')
          const buf = it && it.data
          if (!name || !buf) continue
          const safe = name.replace(/[^\w\-.()\[\]\u4e00-\u9fa5]/g, '_')
          const target = path.join(dir, safe)
          const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
          fs.writeFileSync(target, b)
          const s = fileServer.shareFile(target)
          shares.push(s)
        } catch { void 0 }
      }
      if (shares.length === 0) return []
      if (lan) lan.broadcast({ type: 'file-offer', files: shares })
      try {
        const from = lan ? { ip: lan.addr, nick: lan.nick } : {}
        const base = Date.now()
        for (let i = 0; i < shares.length; i++) {
          const s = shares[i]
          const type = classifyFileType(String((s && s.name) || ''))
          const payload = {
            type,
            text: String((s && s.url) || ''),
            name: String((s && s.name) || ''),
            size: Number((s && s.size) || 0),
            ts: base + i,
            from
          }
          _appendMessage(payload)
        }
        _persistMessages()
        try { if (mainWindow) mainWindow.webContents.send('lan:file-offer', { from, files: shares, ts: base }) } catch { void 0 }
      } catch { void 0 }
      return shares
    } catch {
      return []
    }
  })

  ipcMain.handle('lan:paste-image', async () => {
    try {
      const img = clipboard.readImage()
      if (!img || img.isEmpty()) return []
      const buf = img.toPNG()
      const dir = path.join(app.getPath('temp'), 'lan-chat-uploads')
      try { fs.mkdirSync(dir, { recursive: true }) } catch { void 0 }
      const name = `screenshot_${Date.now()}.png`
      const safe = name.replace(/[^\w\-.()\[\]\u4e00-\u9fa5]/g, '_')
      const target = path.join(dir, safe)
      try { fs.writeFileSync(target, buf) } catch { return [] }
      const s = fileServer.shareFile(target)
      const shares = s ? [s] : []
      if (shares.length === 0) return []
      if (lan) lan.broadcast({ type: 'file-offer', files: shares })
      try {
        const from = lan ? { ip: lan.addr, nick: lan.nick } : {}
        const base = Date.now()
        for (let i = 0; i < shares.length; i++) {
          const it = shares[i]
          const type = classifyFileType(String((it && it.name) || ''))
          const payload = {
            type,
            text: String((it && it.url) || ''),
            name: String((it && it.name) || ''),
            size: Number((it && it.size) || 0),
            ts: base + i,
            from
          }
          _appendMessage(payload)
        }
        _persistMessages()
        try {
          if (mainWindow) mainWindow.webContents.send('lan:file-offer', { from, files: shares, ts: base })
        } catch { void 0 }
      } catch { void 0 }
      return shares
    } catch {
      return []
    }
  })

  ipcMain.handle('lan:open-external', (e, url) => {
    return shell.openExternal(url)
  })

  downloadDir = app.getPath('downloads')

  ipcMain.handle('sys:get-download-dir', () => {
    return downloadDir
  })

  ipcMain.handle('sys:set-download-dir', (e, dir) => {
    try {
      const d = String(dir || '')
      if (!d) return false
      downloadDir = d
      return true
    } catch {
      return false
    }
  })
  // 打开下载目录
  ipcMain.handle('sys:open-download-dir', async () => {
    try {
      await shell.openPath(downloadDir)
    } catch {
      void 0
    }
  })

  ipcMain.handle('sys:select-download-dir', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    if (r.canceled) return ''
    const p = (r.filePaths && r.filePaths[0]) || ''
    if (p) downloadDir = p
    return p
  })

  ipcMain.handle('download:start', async (e, payload) => {
    try {
      const u = new URL(String(payload.url || ''))
      const name = String(payload.name || path.basename(u.pathname))
      const id = payload.id || name
      const total = Number(payload.size || 0)
      const safe = name.replace(/[^\w\-.\(\)\[\]\u4e00-\u9fa5]/g, '_')
      const target = path.resolve(downloadDir, safe)
      await new Promise((resolve, reject) => {
        try {
          const proto = u.protocol === 'https:' ? https : http
          const req = proto.get(u.toString(), (res) => {
            try {
              const len = Number(res.headers['content-length'] || total || 0)
              const file = fs.createWriteStream(target)
              let received = 0
              res.on('data', (chunk) => {
                received += chunk.length
                const percent =
                  len > 0
                    ? Math.floor((received / len) * 100)
                    : total > 0
                      ? Math.floor((received / total) * 100)
                      : 0
                if (mainWindow)
                  mainWindow.webContents.send('download:progress', {
                    id,
                    url: u.toString(),
                    received,
                    total: len || total || 0,
                    percent: Math.max(0, Math.min(100, percent)),
                    path: target
                  })
              })
              res.pipe(file)
              file.on('finish', () => {
                file.close(() => {
                  if (mainWindow)
                    mainWindow.webContents.send('download:progress', {
                      id,
                      url: u.toString(),
                      received: len || total || 0,
                      total: len || total || 0,
                      percent: 100,
                      path: target
                    })
                  resolve()
                })
              })
              res.on('error', (err) => {
                try {
                  file.close(() => {
                    void 0
                  })
                } catch {
                  void 0
                }
                reject(err)
              })
            } catch (e2) {
              reject(e2)
            }
          })
          req.on('error', (err) => reject(err))
        } catch (e3) {
          reject(e3)
        }
      })
      return { ok: true, id, path: target }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.handle('sys:get-ip', () => {
    const nets = os.networkInterfaces()
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) return net.address
      }
    }
    return '127.0.0.1'
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  app.on('before-quit', () => {
    isQuitting = true
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

function _appendMessage(m) {
  try {
    messages.push({
      type: m.type,
      text: m.text,
      name: m.name,
      size: m.size,
      ts: m.ts,
      from: m.from
    })
    if (messages.length > 1000) messages = messages.slice(-1000)
  } catch {
    void 0
  }
}

function _persistMessages() {
  try {
    if (!messagesPath) return
    const dir = path.dirname(messagesPath)
    try {
      fs.mkdirSync(dir, { recursive: true })
    } catch {
      void 0
    }
    fs.writeFileSync(messagesPath, JSON.stringify(messages))
  } catch {
    void 0
  }
}

function applyPeerNicknames(list) {
  try {
    const map = new Map()
    for (const p of list || []) {
      const ip = (p && (p.addr || p.ip)) || ''
      const nick = (p && p.nick) || ''
      if (ip && nick) map.set(ip, nick)
    }
    if (map.size === 0) return
    messages = messages.map((m) => {
      const from = m && m.from
      const ip = (from && (from.addr || from.ip)) || ''
      const nick = ip ? map.get(ip) : ''
      if (nick && from) return { ...m, from: { ...from, nick } }
      return m
    })
  } catch { void 0 }
}

function classifyFileType(name) {
  try {
    const n = (name || '').toLowerCase()
    const ext = n.split('.').pop() || ''
    const images = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg']
    const videos = ['mp4', 'mkv', 'avi', 'mov', 'flv', 'webm']
    if (images.includes(ext)) return 'image'
    if (videos.includes(ext)) return 'video'
    return 'file'
  } catch {
    return 'file'
  }
}

messagesPath = join(app.getPath('userData'), 'messages.json')
try {
  if (fs.existsSync(messagesPath)) {
    const raw = fs.readFileSync(messagesPath, 'utf-8')
    const arr = JSON.parse(raw || '[]')
    if (Array.isArray(arr)) messages = arr.slice(-1000)
  }
} catch {
  void 0
}
ipcMain.handle('chat:load', () => {
  try {
    return Array.isArray(messages) ? messages : []
  } catch {
    return []
  }
})
