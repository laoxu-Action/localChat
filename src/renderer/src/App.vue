<template>
  <div class="chat">
    <div class="left">
      <div class="left-top">在线列表（{{ online }}）</div>
      <div class="left-list">
        <div v-for="p in peers" :key="p.id" class="peer" :class="{ active: isSelf(p) }">
          <div class="peer-name">{{ displayNameFromPeer(p) }}</div>
          <div v-if="isSelf(p)" class="peer-tip">本机</div>
        </div>
      </div>
    </div>
    <!-- <div class="avatar">
            <img src="@renderer/assets/avatar.png" alt="" />
          </div> -->
    <div class="right">
      <div class="right-top">
        局域网群聊(在线 {{ online }})
        <div class="settings-btn" @click="showConfig = true">设置</div>
        <div class="room-btn" @click="openRoomDialog">房间</div>
      </div>
      <div ref="scrollRef" class="right-main" @scroll="onScroll">
        <div
          v-for="m in messages"
          :key="m.ts + ((m.from && m.from.ip) || '')"
          class="chat-record"
          :class="{ 'chat-recordR': isSelf(m.from || {}) }"
        >
          <div class="chat-record-content-box">
            <div class="nickName">
              {{ displayNameFromPeer(m.from || {}) + '  ' + formatTime(m.ts) }}
            </div>
            <div v-if="m.type === 'text'" class="chat-record-content">
              {{ m.text }}
            </div>
            <div v-else-if="m.type === 'image'" class="chat-record-content">
              <div class="preview-img-wrapper" @contextmenu.prevent.stop="download(m)">
                <a-image :width="250" :src="m.text" class="preview-img" @load="onMediaLoad" />
              </div>
            </div>
            <div v-else-if="m.type === 'video'" class="chat-record-content">
              <video :src="m.text" class="preview-video" controls @loadedmetadata="onMediaLoad" @contextmenu.prevent.stop="download(m)" />
            </div>
            <div v-else class="chat-record-content">
              <div class="download-btn" style="cursor: pointer" @click="download(m)">
                <div>
                  <FileSearchOutlined :style="{ fontSize: '32px', color: '#fff' }" />
                </div>
                <div>
                  <div>{{ m.name }}</div>
                  <div style="font-size: 12px; color: #999">
                    {{ (m.size / (1024 * 1024)).toFixed(2) + ' MB' }}
                  </div>
                </div>
              </div>
            </div>
            <div
              v-if="downloading[m.ts] || ((progress[m.ts] || 0) > 0 && (progress[m.ts] || 0) < 100)"
              class="dl-progress"
            >
              <div class="dl-bar" :style="{ width: (progress[m.ts] || 0) + '%' }"></div>
              <div class="dl-text">{{ '下载 ' + (progress[m.ts] || 0) + '%' }}</div>
            </div>
            <div v-if="(progress[m.ts] || 0) >= 100" class="dl-complete">
              <CheckCircleTwoTone two-tone-color="#52c41a" :style="{ fontSize: '16px' }" />
              <div class="dl-open" @click="openDownloadDir">打开目录</div>
            </div>
          </div>
        </div>
      </div>
      <div class="right-bottom">
        <div class="chat-content">
          <div ref="inputRef" contenteditable class="input" @keydown="onInputKeydown" @paste="onInputPaste"></div>
          <div class="send-btn">
            <div class="send-btn-text" @click="upload">文件</div>
            <div class="send-btn-text" @click="send">发送</div>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showConfig" class="config-mask">
      <div class="config-panel">
        <div class="config-title">配置</div>

        <div class="config-item">
          <div class="label">昵称</div>
          <input v-model="nickname" class="input-text" />
        </div>
        <div class="config-item">
          <div class="label">下载目录</div>
          <input v-model="downloadDir" disabled class="input-text" />
          <div style="display: flex; margin-top: 8px">
            <div class="btn" style="margin-right: 8px" @click="chooseDownloadDir">选择</div>
            <div class="btn" @click="openDownloadDir">打开目录</div>
          </div>
        </div>
        <div class="config-actions">
          <div class="btn" @click="saveConfig">保存</div>
          <!-- <div class="btn" @click="connectWS">连接</div> -->
          <div class="btn" @click="closeConfig">关闭</div>
        </div>
      </div>
    </div>
    <div v-if="dragMask" class="drag-mask">
      <div class="drag-panel">
        <CloudUploadOutlined class="drag-icon" />
      </div>
    </div>
    
  </div>
</template>
<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { FileSearchOutlined, CheckCircleTwoTone, CloudUploadOutlined } from '@ant-design/icons-vue'
const messages = ref([])
const online = ref(1)
const inputRef = ref(null)
const peers = ref([])
const showConfig = ref(false)

const selfIp = ref('')
const nickname = ref('')

let nickSyncTimer = null
watch(nickname, (n) => {
  try {
    const v = String(n || '').trim()
    if (!v) return
    if (nickSyncTimer) clearTimeout(nickSyncTimer)
    nickSyncTimer = setTimeout(() => {
      ;(async () => {
        try { await window.api.setLanNickname(v) } catch { void 0 }
        try { refreshPeersDebounced() } catch { void 0 }
      })()
    }, 200)
  } catch {
    void 0
  }
})

const scrollRef = ref(null)
const loading = ref(false)
const hasMore = ref(false)

let refreshTimer = null
const downloadDir = ref('')
const progress = ref({})
const downloading = ref({})
const dragMask = ref(false)
let dragDepth = 0
let dragHideTimer = null
let lastDropTs = 0

function showMask() {
  try {
    dragMask.value = true
  } catch {
    void 0
  }
}
function hideMaskSoon() {
  try {
    if (dragHideTimer) clearTimeout(dragHideTimer)
    dragHideTimer = setTimeout(() => {
      try {
        if (dragDepth <= 0) dragMask.value = false
      } catch {
        void 0
      }
    }, 150)
  } catch {
    void 0
  }
}

  

const autoStick = ref(true)

function isSelf(p) {
  const key = (p && (p.ip || p.addr)) || ''
  return key && key === selfIp.value
}

function hashString(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return Math.abs(h)
}

const adjectives = [
  '软萌',
  '可爱',
  '活泼',
  '温柔',
  '机灵',
  '安静',
  '调皮',
  '甜甜',
  '暖暖',
  '元气',
  '小巧',
  '明亮',
  '轻盈',
  '乖巧',
  '闪亮',
  '俏皮',
  '香香',
  '蓬松',
  '圆圆',
  '糯糯',
  '开朗',
  '阳光',
  '灵动',
  '可口',
  '活力',
  '梦幻',
  '清新',
  '酷酷',
  '呆萌',
  '奶油',
  '晴朗',
  '浪漫'
]
const animals = [
  '小猫',
  '小狗',
  '小熊猫',
  '兔子',
  '小鹿',
  '考拉',
  '松鼠',
  '小刺猬',
  '小狐狸',
  '小仓鼠',
  '企鹅',
  '海豹',
  '熊熊',
  '羊驼',
  '小海豚',
  '向日葵',
  '星星',
  '月亮',
  '果冻',
  '糖糖',
  '可乐',
  '奶茶',
  '布丁',
  '果酱',
  '蜂蜜',
  '可颂',
  '曲奇',
  '棉花糖',
  '雪球',
  '云朵',
  '花卷',
  '甜甜圈'
]

function cuteName(addr) {
  const h = hashString(addr || '')
  const a = adjectives[h % adjectives.length]
  const b = animals[(h >> 8) % animals.length]
  return a + b
}

function displayNameFromPeer(p) {
  const ip = (p && (p.ip || p.addr)) || ''
  return (p && p.nick) || cuteName(ip)
}

function formatTime(ts) {
  const d = new Date(ts || 0)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
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

async function send() {
  const el = inputRef.value
  if (!el) return
  const text = el.innerText.trim()
  if (!text) return
  try {
    try {
      const v = String(nickname.value || '').trim()
      if (v) await window.api.setLanNickname(v)
    } catch {
      void 0
    }
    window.api.sendMessage(text)
  } catch (e) {
    void e
  }
  el.innerText = ''
  try {
    scrollBottom()
  } catch {
    void 0
  }
}

function onInputKeydown(e) {
  if (!e) return
  if (e.key !== 'Enter') return
  if (e.isComposing) return
  e.preventDefault()
  send()
}

function onInputPaste(e) {
  try {
    const items = (e && e.clipboardData && e.clipboardData.items) || []
    const hasImage = Array.from(items).some((it) => {
      try { return typeof it.type === 'string' && /(^|\/)image\//.test(it.type) } catch { return false }
    })
    if (!hasImage) return
    e.preventDefault()
    ;(async () => {
      try { await window.api.pasteImageFromClipboard() } catch { void 0 }
    })()
  } catch {
    void 0
  }
}

onMounted(async () => {
  const ip = await window.api.getLocalIp()
  selfIp.value = ip || ''

  const savedNick = localStorage.getItem('nickname')
  nickname.value = savedNick || cuteName(selfIp.value || '')
  try {
    const v = String(nickname.value || '').trim()
    if (v) await window.api.setLanNickname(v)
  } catch {
    void 0
  }
  const savedDir = localStorage.getItem('downloadDir')
  if (savedDir) {
    downloadDir.value = savedDir
  } else {
    try {
      const dir = await window.api.getDownloadDir()
      downloadDir.value = dir || ''
    } catch {
      void 0
    }
  }
  try {
    const arr = await window.api.chatLoad()
    if (Array.isArray(arr)) messages.value = arr
  } catch {
    void 0
  }
  try {
    await refreshPeers()
  } catch {
    void 0
  }
  try {
    if (window.api && window.api.onFileOffer) {
      window.api.onFileOffer((p) => {
        try {
          const from = (p && p.from) || {}
          const base = (p && p.ts) || Date.now()
          const list = Array.isArray(p.files) ? p.files : []
          let stick = false
          try {
            const el = scrollRef.value
            if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight <= 10
            autoStick.value = stick
          } catch {
            stick = false
          }
          for (let i = 0; i < list.length; i++) {
            const f = list[i]
            const type = classifyFileType(String((f && f.name) || ''))
            const data = {
              type,
              text: String((f && f.url) || ''),
              name: String((f && f.name) || ''),
              size: Number((f && f.size) || 0),
              from,
              ts: base + i
            }
            messages.value.push(data)
          }
          try {
            if (stick || isSelf(from)) {
              nextTick(() => {
                try {
                  scrollBottom()
                } catch {
                  void 0
                }
                try {
                  setTimeout(() => {
                    try {
                      if (autoStick.value) scrollBottom()
                    } catch {
                      void 0
                    }
                  }, 50)
                  setTimeout(() => {
                    try {
                      if (autoStick.value) scrollBottom()
                    } catch {
                      void 0
                    }
                  }, 200)
                  setTimeout(() => {
                    try {
                      if (autoStick.value) scrollBottom()
                    } catch {
                      void 0
                    }
                  }, 400)
                } catch {
                  void 0
                }
              })
            }
          } catch {
            void 0
          }
        } catch {
          void 0
        }
      })
    }
  } catch {
    void 0
  }
  try {
    if (window.api && window.api.onMessage) {
      window.api.onMessage((m) => {
        let stick = false
        try {
          const el = scrollRef.value
          if (el) stick = el.scrollHeight - el.scrollTop - el.clientHeight <= 10
          autoStick.value = stick
        } catch {
          stick = false
        }
        const data = {
          type: 'text',
          text: String(m.text || ''),
          from: m.from || {},
          ts: m.ts || Date.now()
        }
        messages.value.push(data)
        try {
          if (!isSelf(data.from || {})) {
            window.api.notifyMessage()
          }
        } catch {
          void 0
        }
        try {
          if (stick || isSelf(data.from || {})) {
            nextTick(() => {
              try {
                scrollBottom()
              } catch {
                void 0
              }
              try {
                setTimeout(() => {
                  try {
                    if (autoStick.value) scrollBottom()
                  } catch {
                    void 0
                  }
                }, 50)
                setTimeout(() => {
                  try {
                    if (autoStick.value) scrollBottom()
                  } catch {
                    void 0
                  }
                }, 200)
                setTimeout(() => {
                  try {
                    if (autoStick.value) scrollBottom()
                  } catch {
                    void 0
                  }
                }, 400)
              } catch {
                void 0
              }
            })
          }
        } catch {
          void 0
        }
      })
    }
  } catch {
    void 0
  }
  try {
    if (window.api && window.api.onPeers) {
      window.api.onPeers((list) => {
        if (Array.isArray(list)) {
          const unique = normalizePeers(list)
          peers.value = unique
          online.value = unique.length

          applyPeerNicknames(unique)
        }
      })
    }
  } catch {
    void 0
  }
  try {
    if (window.api && window.api.onDownloadProgress) {
      window.api.onDownloadProgress((info) => {
        const id = info && info.id
        if (!id) return
        const pct = Number(info.percent || 0)
        progress.value[id] = Math.max(0, Math.min(100, Math.floor(pct)))
        downloading.value[id] = pct < 100
      })
    }
  } catch {
    void 0
  }
  try {
    const el = scrollRef.value
    if (el) el.scrollTop = el.scrollHeight
  } catch {
    void 0
  }
  try {
    const el = scrollRef.value
    if (el) {
      const ro = new ResizeObserver(() => {
        try {
          if (autoStick.value) scrollBottom()
        } catch {
          void 0
        }
      })
      ro.observe(el)
      onUnmounted(() => {
        try {
          ro.disconnect()
        } catch {
          void 0
        }
      })
    }
  } catch {
    void 0
  }
  try {
    const onWinDragOver = (e) => {
      try {
        e.preventDefault()
        if (e && e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
        showMask()
      } catch {
        void 0
      }
    }
    const onWinDragEnter = (e) => {
      try {
        void e
        dragDepth += 1
        showMask()
      } catch {
        void 0
      }
    }
    const onWinDrop = async (e) => {
      try {
        try {
          e && e.preventDefault && e.preventDefault()
          e && e.stopPropagation && e.stopPropagation()
          e && e.stopImmediatePropagation && e.stopImmediatePropagation()
        } catch {
          void 0
        }
        const ts = Number(e && e.timeStamp)
        if (ts && ts === lastDropTs) return
        lastDropTs = ts || Date.now()
        const files = Array.from((e && e.dataTransfer && e.dataTransfer.files) || [])
        const paths = []
        for (const f of files) {
          try {
            const p = window.api && window.api.getFilePath ? window.api.getFilePath(f) : ''
            if (p) paths.push(p)
          } catch {
            void 0
          }
        }
        if (paths.length > 0) {
          try {
            await window.api.uploadFilePaths(paths)
          } catch {
            void 0
          }
        }
      } catch {
        void 0
      } finally {
        try {
          dragDepth = 0
          hideMaskSoon()
        } catch {
          void 0
        }
      }
    }
    const onWinDragLeave = (e) => {
      try {
        void e
        dragDepth = Math.max(0, dragDepth - 1)
        hideMaskSoon()
      } catch {
        void 0
      }
    }
    window.addEventListener('dragover', onWinDragOver, { passive: false })
    window.addEventListener('dragenter', onWinDragEnter, { capture: true })
    window.addEventListener('drop', onWinDrop, { capture: true })
    window.addEventListener('dragleave', onWinDragLeave, { capture: true })
    document.addEventListener('dragover', onWinDragOver, { passive: false })
    document.addEventListener('dragenter', onWinDragEnter, { capture: true })
    document.addEventListener('drop', onWinDrop, { capture: true })
    document.addEventListener('dragleave', onWinDragLeave, { capture: true })
    onUnmounted(() => {
      try {
        window.removeEventListener('dragover', onWinDragOver)
        window.removeEventListener('dragenter', onWinDragEnter)
        window.removeEventListener('drop', onWinDrop)
        window.removeEventListener('dragleave', onWinDragLeave)
        document.removeEventListener('dragover', onWinDragOver)
        document.removeEventListener('dragenter', onWinDragEnter)
        document.removeEventListener('drop', onWinDrop)
        document.removeEventListener('dragleave', onWinDragLeave)
      } catch {
        void 0
      }
    })
  } catch {
    void 0
  }
})

async function saveConfig() {
  const n = String(nickname.value || '').trim()
  const finalNick = n || cuteName(selfIp.value || '')
  nickname.value = finalNick
  localStorage.setItem('nickname', finalNick)
  localStorage.setItem('downloadDir', downloadDir.value)
  try {
    await window.api.setLanNickname(finalNick)
  } catch {
    void 0
  }
  try {
    if (downloadDir.value) await window.api.setDownloadDir(downloadDir.value)
  } catch {
    void 0
  }
  refreshPeersDebounced()
  try {
    const ip = selfIp.value
    const list = peers.value.map((p) => (p && p.addr === ip ? { ...p, nick: finalNick } : p))
    peers.value = list
  } catch {
    void 0
  }
  showConfig.value = false
}

async function chooseDownloadDir() {
  try {
    const dir = await window.api.selectDownloadDir()
    if (dir) {
      downloadDir.value = dir
      localStorage.setItem('downloadDir', dir)
    }
  } catch {
    void 0
  }
}

function closeConfig() {
  showConfig.value = false
}

async function refreshPeers() {
  try {
    const st = await window.api.getState()
    const rows = (st && st.peers) || []
    if (Array.isArray(rows)) {
      const unique = normalizePeers(rows)
      peers.value = unique
      online.value = unique.length
      applyPeerNicknames(unique)
    }
  } catch {
    void 0
  }
}

function refreshPeersDebounced() {
  try {
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = setTimeout(() => refreshPeers(), 300)
  } catch {
    void 0
  }
}

function dedupePeers(list) {
  try {
    const map = new Map()
    for (const p of list || []) {
      const key = (p && (p.ip || p.addr)) || ''
      if (!key) continue
      map.set(key, p)
    }
    return Array.from(map.values())
  } catch {
    return Array.isArray(list) ? list : []
  }
}

function normalizePeers(list) {
  try {
    const unique = dedupePeers(list)
    const ip = selfIp.value
    const nick = String(nickname.value || '')
    if (ip && nick) {
      for (let i = 0; i < unique.length; i++) {
        const u = unique[i]
        const key = (u && (u.ip || u.addr)) || ''
        if (key && key === ip) unique[i] = { ...u, nick }
      }
    }
    return unique
  } catch {
    return Array.isArray(list) ? list : []
  }
}

function applyPeerNicknames(list) {
  try {
    const map = new Map()
    for (const p of list || []) {
      const ip = (p && (p.ip || p.addr)) || ''
      const nick = (p && p.nick) || ''
      if (ip && nick) map.set(ip, nick)
    }
    if (map.size === 0) return
    const updated = messages.value.map((m) => {
      const from = m && m.from
      const ip = (from && (from.ip || from.addr)) || ''
      const nick = ip ? map.get(ip) : ''
      if (nick && from) return { ...m, from: { ...from, nick } }
      return m
    })
    messages.value = updated
  } catch {
    void 0
  }
}

async function loadMore() {
  loading.value = false
}

function onScroll() {
  try {
    const el = scrollRef.value
    if (!el) return
    if (el.scrollTop <= 10 && hasMore.value && !loading.value) {
      const prevHeight = el.scrollHeight
      ;(async () => {
        await loadMore()
        try {
          const newHeight = el.scrollHeight
          el.scrollTop = newHeight - prevHeight
        } catch {
          void 0
        }
      })()
    }
    try {
      autoStick.value = el.scrollHeight - el.scrollTop - el.clientHeight <= 10
    } catch {
      void 0
    }
  } catch {
    void 0
  }
}

function scrollBottom() {
  const el = scrollRef.value
  if (el) el.scrollTop = el.scrollHeight
}
function onMediaLoad() {
  try {
    if (autoStick.value) scrollBottom()
  } catch {
    void 0
  }
}

async function upload() {
  try {
    await window.api.uploadFile()
  } catch {
    void 0
  }
}

void upload

async function download(m) {
  try {
    const url = String(m.text || '')
    if (!url) return
    const id = m.ts
    let name = String(m.name || '')
    if (!name) {
      try {
        const u = new URL(url)
        name = u.pathname.split('/').pop() || 'file'
      } catch {
        name = 'file'
      }
    }
    const size = Number(m.size || 0)
    downloading.value[id] = true
    void window.api.downloadFile({ url, name, size, id }).catch(() => {})
  } catch {
    void 0
  }
}
// 打开下载目录
async function openDownloadDir() {
  try {
    await window.api.openDownloadDir()
  } catch {
    void 0
  }
}
</script>
<style lang="scss" scoped>
.chat {
  width: 100vw;
  height: 100vh;
  display: flex;
}
.left {
  width: 25vw;
  height: 100%;
  background-color: #181819;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #323335;
  .left-top {
    height: 60px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid #323335;
  }
  .left-list {
    flex: 1;
    overflow-y: auto;
  }
  .peer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
  }
  .peer-name {
    color: #fff;
  }
  .peer-tip {
    color: #b2b2b2;
    font-size: 12px;
  }
  .peer.active .peer-name {
    color: #4db6ff;
  }
}
.right {
  width: 75vw;
  height: 100%;
  background-color: #202021;
  display: flex;
  flex-direction: column;
  .right-top {
    width: 100%;
    height: 70px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-bottom: 1px solid #323335;
    position: relative;
    .settings-btn {
      position: absolute;
      right: 12px;
      cursor: pointer;
    }
    .room-btn {
      position: absolute;
      left: 12px;
      cursor: pointer;
    }
  }
  .right-main {
    width: 100%;
    height: calc(100% - 205px);
    overflow-y: scroll;
    &::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    &::-webkit-scrollbar-thumb {
      background: linear-gradient(to bottom right, #b2b2b2 0%, #b2b2b2 100%);
      border-radius: 8px;
    }
    &::-webkit-scrollbar-button {
      opacity: 0;
    }
    .section-title {
      padding: 10px;
      color: #b2b2b2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      .pager {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .page-input {
        width: 60px;
        height: 28px;
        border-radius: 6px;
        border: 1px solid #323335;
        background: #202021;
        color: #fff;
        padding: 0 6px;
      }
      .btn {
        padding: 6px 10px;
        border-radius: 6px;
        background: #323335;
        cursor: pointer;
      }
    }
    .file-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
    }
    .file-name {
      color: #fff;
    }
    .download {
      cursor: pointer;
    }
    .chat-record {
      margin: 8px;
      display: flex;
      .chat-record-content-box {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        margin-left: 8px;
        .download-btn {
          min-width: 170px;
          height: 70px;
          display: flex;
          align-items: center;
          justify-content: space-around;
        }
      }
      .avatar {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        margin-right: 8px;
        img {
          width: 100%;
          height: 100%;
          border-radius: 50%;
        }
      }
      .nickName {
        font-size: 12px;
        color: #b2b2b2;
        text-align: left;
        user-select: text;
      }
      .chat-record-content {
        background: #323335;
        border-radius: 10px;
        color: #fff;
        padding: 4px 10px;
        display: inline-block;
        word-break: break-word;
        user-select: text;
        cursor: text;
        .preview-img {
          max-width: 360px;
          max-height: 240px;
          border-radius: 8px;
          cursor: pointer;
          display: block;
        }
        .preview-video {
          max-width: 360px;
          max-height: 240px;
          border-radius: 8px;
          display: block;
        }
      }
    }
    .chat-recordR {
      flex-direction: row-reverse;
      .chat-record-content-box {
        margin-left: 0;
        align-items: flex-end;
      }
      .avatar {
        margin-left: 8px;
        margin-right: 0;
      }
      .nickName {
        text-align: right;
      }
    }
  }
  .right-bottom {
    width: 100%;
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    .chat-content {
      height: 100%;
      width: 96%;
      background: #2c2c2d;
      border-radius: 10px;
      padding: 8px;
      overflow: auto;
    }
    .input {
      height: calc(100% - 20px);
      width: 100%;
      background: #2c2c2d;
      border-radius: 10px;
      padding: 8px;
      overflow: auto;
      &::-webkit-scrollbar {
        width: 5px;
        height: 10px;
      }
      &::-webkit-scrollbar-thumb {
        background: linear-gradient(to bottom right, #b2b2b2 0%, #b2b2b2 100%);
        border-radius: 8px;
      }
      &::-webkit-scrollbar-button {
        opacity: 0;
      }
    }
    .send-btn {
      height: 20px;
      width: 100%;
      display: flex;
      justify-content: flex-end;
      .send-btn-text {
        width: 50px;
        height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        &:hover {
          color: #fff;
        }
      }
    }
    /* 去掉input聚焦时候的外边框 */
    [contenteditable]:focus {
      outline: none;
    }
  }
}
.config-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}
.drag-mask {
  position: fixed;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  pointer-events: none;
}
.drag-panel {
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.drag-panel::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 140px;
  height: 140px;
  border-radius: 50%;
  border: 2px solid #4db6ff;
  opacity: 0.4;
  transform: translate(-50%, -50%) scale(0.9);
  animation: pulse 2.2s ease-out infinite;
}
.drag-icon {
  font-size: 64px;
  color: #4db6ff;
  animation: breathe 1.8s ease-in-out infinite;
}
@keyframes breathe {
  0% {
    transform: scale(0.95);
    filter: drop-shadow(0 0 0 rgba(77, 182, 255, 0));
  }
  50% {
    transform: scale(1.08);
    filter: drop-shadow(0 0 12px rgba(77, 182, 255, 0.6));
  }
  100% {
    transform: scale(0.95);
    filter: drop-shadow(0 0 0 rgba(77, 182, 255, 0));
  }
}
@keyframes pulse {
  0% {
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0.4;
  }
  50% {
    transform: translate(-50%, -50%) scale(1.1);
    opacity: 0.1;
  }
  100% {
    transform: translate(-50%, -50%) scale(0.9);
    opacity: 0.4;
  }
}
.drag-title {
  font-size: 18px;
  color: #4db6ff;
}
.config-panel {
  width: 420px;
  background: #2c2c2d;
  border-radius: 10px;
  padding: 16px;
}
.config-title {
  font-size: 16px;
  margin-bottom: 10px;
}
.config-item {
  margin-bottom: 12px;
}
.label {
  margin-bottom: 6px;
  color: #b2b2b2;
}
.input-text {
  width: 100%;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #323335;
  background: #202021;
  color: #fff;
  padding: 0 10px;
}
.config-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}
.btn {
  padding: 6px 12px;
  border-radius: 6px;
  background: #323335;
  cursor: pointer;
}
.dl-progress {
  margin-top: 4px;
  width: 100%;
}
.dl-bar {
  height: 6px;
  border-radius: 4px;
  background: #4db6ff;
}
.dl-text {
  font-size: 12px;
  color: #b2b2b2;
  margin-top: 2px;
}
.dl-complete {
  margin-top: 2px;
}
.dl-open {
  display: inline-block;
  margin-left: 8px;
  font-size: 12px;
  color: #4db6ff;
  cursor: pointer;
}
</style>

