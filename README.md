# LAN Chat (Electron + Vue)

Lightweight LAN chat application built with Electron and Vue 3. It focuses on fast local file sharing and messaging without any external server.

## Features

- Text chat over local network
- Drag-and-drop file sharing (path-based, supports very large files)
- Multi-file selection via system dialog
- Paste screenshot to share as an image
- Image preview on left-click; download on right-click
- Video preview with right-click to download
- Download progress indicator and "Open Directory" shortcut when finished
- Configurable nickname and download directory
- Smooth drag overlay with flicker-free handling

## Requirements

- Node.js 18+
- Windows/macOS/Linux with Electron support

## Scripts

- `npm run dev` – start app in development
- `npm run start` – preview production build
- `npm run build` – build application
- `npm run lint` – lint source code

## Usage

- Send text: type in the input box, press Enter or click `发送`
- Share files:
  - Drag files from Explorer/Desktop into the window (uses absolute file paths)
  - Or click `文件` and select multiple files via the system dialog
- Paste screenshot:
  - Copy an image to clipboard, focus the input, press Ctrl+V
  - The app reads the clipboard image in the main process, writes it to temp, and shares it by path
- Image/video:
  - Left-click image to preview
  - Right-click image/video to start download
  - When download completes, click `打开目录` next to the check icon to open the folder
- Configuration:
  - Open `设置`, change nickname, choose or open download directory; nickname syncs automatically

## Architecture Notes

- Path-first uploads:
  - Renderer resolves paths with `webUtils.getPathForFile(file)` (Electron 32+)
  - Sends to main via `lan:upload-file-paths`; main validates and shares via an internal HTTP file server
  - Drag handling uses global `drop` with capture + de-duplication to avoid double uploads
- Clipboard image:
  - IPC `lan:paste-image` reads `clipboard.readImage()` in main, writes to temp, shares by path
- Events:
  - `lan:file-offer` broadcasts new file shares and updates chat history
  - `lan:chat` broadcasts text messages
- Nickname:
  - Renderer syncs nickname to main (`lan:set-nickname`), and sending always uses latest `lan.nick`

Code references:

- Renderer drag drop and upload paths: `src/renderer/src/App.vue:499`
- Clipboard paste image (renderer + main): `src/renderer/src/App.vue:300`, `src/main/index.js:500`
- Path-based upload handler (main): `src/main/index.js:341`
- Nickname sync & send: `src/renderer/src/App.vue:120`, `src/renderer/src/App.vue:274`, `src/main/index.js:279`
- Open download directory: `src/main/index.js:511`, `src/renderer/src/App.vue:61`

## Notes & Limitations

- Very large files are supported via path-based sharing; binary uploads are disabled by design
- If a drag source does not provide a file path (e.g., some browsers), use the `文件` button instead
- Directory uploads are not supported (files only)
- LAN-only: peers discover and communicate within the local network group

---

# 局域网聊天（Electron + Vue）

一个用于局域网聊天与文件分享的桌面应用，基于 Electron 与 Vue 3。无需外部服务器，强调本地快速分享与流畅体验。

## 功能

- 局域网文本聊天
- 拖拽文件分享（基于本地路径，支持超大文件）
- 通过系统对话框多选文件
- 粘贴截图自动作为图片发送
- 图片左键预览、右键下载
- 视频预览并支持右键下载
- 下载进度与完成后的“打开目录”快捷入口
- 可配置昵称与下载目录
- 防闪烁的拖拽遮罩与稳定的事件处理

## 环境要求

- Node.js 18+
- Windows/macOS/Linux（支持 Electron）

## 启动与构建

- `npm run dev` – 开发模式运行
- `npm run start` – 预览生产构建
- `npm run build` – 生产构建
- `npm run lint` – 代码检查

## 使用说明

- 发送文本：在输入框输入后按 Enter 或点击 `发送`
- 分享文件：
  - 从资源管理器/桌面拖入窗口（使用本地绝对路径）
  - 或点击 `文件` 使用系统文件选择器（支持多选）
- 粘贴截图：
  - 将图片复制到剪贴板，聚焦输入框后 Ctrl+V
  - 主进程读取剪贴板图片、写入临时目录、按路径分享
- 图片/视频：
  - 图片左键预览，右键下载
  - 视频右键下载
  - 下载完成后，勾选图标旁点击 `打开目录` 直达下载文件夹
- 配置：
  - 通过 `设置` 修改昵称、选择或打开下载目录；昵称会自动同步到主进程

## 架构说明

- 路径优先上传：
  - 渲染层通过 `webUtils.getPathForFile(file)` 获取真实路径（Electron 32+）
  - 通过 IPC `lan:upload-file-paths` 发送到主进程，主进程校验后由内置 HTTP 文件服务分享
  - 全局 `drop` 捕获并去重，避免重复上传
- 剪贴板图片：
  - IPC `lan:paste-image` 在主进程使用 `clipboard.readImage()` 读取图片、写入临时目录，再按路径分享
- 广播事件：
  - `lan:file-offer` 广播文件分享并写入聊天记录
  - `lan:chat` 广播文本消息
- 昵称：
  - 渲染层监听并同步昵称到主进程（`lan:set-nickname`），消息始终使用最新 `lan.nick`

代码位置参考：

- 渲染层拖拽与路径上传：`src/renderer/src/App.vue:499`
- 粘贴图片（渲染层 + 主进程）：`src/renderer/src/App.vue:300`、`src/main/index.js:500`
- 主进程路径上传处理：`src/main/index.js:341`
- 昵称同步与发送：`src/renderer/src/App.vue:120`、`src/renderer/src/App.vue:274`、`src/main/index.js:279`
- 打开下载目录：`src/main/index.js:511`、`src/renderer/src/App.vue:61`

## 注意事项

- 超大文件建议使用路径上传；为避免卡顿，已禁用二进制兜底
- 若拖拽来源不提供路径（如部分浏览器），请使用 `文件` 按钮选择
- 目前不支持目录拖拽上传（仅文件）
- 仅局域网使用：节点通过多播发现并通信

An Electron application with Vue

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) + [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar)

## Project Setup

### Install

```bash
$ yarn
```

### Development

```bash
$ yarn dev
```

### Build

```bash
# For windows
$ yarn build:win

# For macOS
$ yarn build:mac

# For Linux
$ yarn build:linux
```
