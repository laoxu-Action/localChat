import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  sendMessage(text) {
    ipcRenderer.send('lan:send-message', text)
  },
  onMessage(handler) {
    ipcRenderer.on('lan:chat', (_, payload) => handler(payload))
  },
  onPeers(handler) {
    ipcRenderer.on('lan:peers', (_, payload) => handler(payload))
  },
  onFileOffer(handler) {
    ipcRenderer.on('lan:file-offer', (_, payload) => handler(payload))
  },
  uploadFile() {
    return ipcRenderer.invoke('lan:upload-file')
  },
  uploadFilePaths(paths) {
    return ipcRenderer.invoke('lan:upload-file-paths', Array.isArray(paths) ? paths : [])
  },
  uploadFileBlobs(blobs) {
    return ipcRenderer.invoke('lan:upload-file-blobs', Array.isArray(blobs) ? blobs : [])
  },
  uploadFileBuffers(files) {
    return ipcRenderer.invoke('lan:upload-file-buffers', Array.isArray(files) ? files : [])
  },
  pasteImageFromClipboard() {
    return ipcRenderer.invoke('lan:paste-image')
  },
  getFilePath(file) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  getState() {
    return ipcRenderer.invoke('lan:get-state')
  },
  openExternal(url) {
    return ipcRenderer.invoke('lan:open-external', url)
  },
  getLocalIp() {
    return ipcRenderer.invoke('sys:get-ip')
  },
  setLanNickname(nick) {
    return ipcRenderer.invoke('lan:set-nickname', nick)
  },
  getDownloadDir() {
    return ipcRenderer.invoke('sys:get-download-dir')
  },
  setDownloadDir(dir) {
    return ipcRenderer.invoke('sys:set-download-dir', dir)
  },
  selectDownloadDir() {
    return ipcRenderer.invoke('sys:select-download-dir')
  },
  chatLoad() {
    return ipcRenderer.invoke('chat:load')
  },
  downloadFile(payload) {
    return ipcRenderer.invoke('download:start', payload)
  },
  onDownloadProgress(handler) {
    ipcRenderer.on('download:progress', (_, payload) => handler(payload))
  },
  // 打开下载目录
  openDownloadDir() {
    return ipcRenderer.invoke('sys:open-download-dir')
  },
  notifyMessage() {
    return ipcRenderer.invoke('sys:notify-message')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
