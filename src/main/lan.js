import dgram from 'dgram'
import os from 'os'
import crypto from 'crypto'

function getLocalIPv4() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return '127.0.0.1'
}

export class LanBus {
  constructor({ group = '239.255.232.81', port = 48221, nick, httpPort }) {
    this.group = group
    this.port = port
    this.peerId = crypto.randomUUID()
    this.nick = nick || os.userInfo().username || 'user'
    this.httpPort = httpPort || 0
    this.addr = getLocalIPv4()
    this.socket = null
    this.peers = new Map()
    this.handlers = new Map()
    this.heartbeatTimer = null
  }

  on(event, handler) {
    const list = this.handlers.get(event) || []
    list.push(handler)
    this.handlers.set(event, list)
  }

  emit(event, payload) {
    const list = this.handlers.get(event) || []
    for (const h of list) h(payload)
  }

  start() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
        this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))
        this.socket.on('error', (err) => this.emit('error', err))
        this.socket.bind(this.port, () => {
          try {
            this.socket.addMembership(this.group)
          } catch (e) {
            void e
          }
          try {
            this.socket.setMulticastTTL(1)
          } catch (e) {
            void e
          }
          try {
            this.socket.setBroadcast(true)
          } catch (e) {
            void e
          }
          this._hello()
          this.heartbeatTimer = setInterval(() => this._heartbeat(), 3000)
          resolve()
        })
      } catch (e) {
        reject(e)
      }
    })
  }

  stop() {
    clearInterval(this.heartbeatTimer)
    this.broadcast({ type: 'leave' })
    try {
      this.socket.close()
    } catch (e) {
      void e
    }
  }

  setHttpPort(port) {
    this.httpPort = port
  }

  broadcast(body) {
    const payload = {
      ...body,
      from: { id: this.peerId, nick: this.nick, addr: this.addr, port: this.httpPort },
      ts: Date.now()
    }
    const buf = Buffer.from(JSON.stringify(payload))
    try {
      this.socket.send(buf, 0, buf.length, this.port, this.group)
    } catch (e) {
      void e
    }
  }

  _hello() {
    this.broadcast({ type: 'hello' })
  }

  _heartbeat() {
    this.broadcast({ type: 'ping' })
    const now = Date.now()
    let changed = false
    for (const [id, peer] of this.peers.entries()) {
      if (now - peer.lastSeen > 15000) {
        this.peers.delete(id)
        changed = true
      }
    }
    if (changed) this.emit('peer-update', this.listPeers())
  }

  _onMessage(msg) {
    let data
    try {
      data = JSON.parse(msg.toString())
    } catch (e) {
      void e
      return
    }
    const from = data.from || {}
    if (!from.id) return
    if (from.id === this.peerId) return
    const now = Date.now()
    const prev = this.peers.get(from.id)
    this.peers.set(from.id, {
      id: from.id,
      nick: from.nick,
      addr: from.addr,
      port: from.port,
      lastSeen: now
    })
    if (!prev || data.type === 'hello') this.emit('peer-update', this.listPeers())
    if (data.type === 'leave') {
      this.peers.delete(from.id)
      this.emit('peer-update', this.listPeers())
      return
    }
    if (data.type === 'chat') this.emit('chat', { text: data.text, from, ts: data.ts })
    if (data.type === 'file-offer')
      this.emit('file-offer', { files: data.files, from, ts: data.ts })
  }

  listPeers() {
    const arr = Array.from(this.peers.values()).map((p) => ({
      id: p.id,
      nick: p.nick,
      addr: p.addr,
      port: p.port
    }))
    arr.push({ id: this.peerId, nick: this.nick, addr: this.addr, port: this.httpPort })
    return arr
  }
}

export function createLanBus(opts) {
  return new LanBus(opts || {})
}
