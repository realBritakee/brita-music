import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BritaApi } from '../shared/types'

function listen<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: BritaApi = {
  loadLibrary: () => ipcRenderer.invoke('library:load'),
  addFolder: () => ipcRenderer.invoke('library:add-folder'),
  removeFolder: (folder) => ipcRenderer.invoke('library:remove-folder', folder),
  createPlaylist: (folder, name) => ipcRenderer.invoke('library:create-playlist', folder, name),
  pathsOf: (files) => files.map((file) => webUtils.getPathForFile(file)).filter((path) => path !== ''),
  dropItems: (paths, playlist) => ipcRenderer.invoke('drop:items', paths, playlist),
  showInFolder: (path) => ipcRenderer.invoke('song:show-in-folder', path),
  copyPath: (path) => ipcRenderer.invoke('song:copy-path', path),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings) => ipcRenderer.send('settings:save', settings),
  loadFavorites: () => ipcRenderer.invoke('favorites:load'),
  saveFavorites: (songs) => ipcRenderer.send('favorites:save', songs),
  loadHistory: () => ipcRenderer.invoke('history:load'),
  saveHistory: (plays) => ipcRenderer.send('history:save', plays),
  dataFolder: () => ipcRenderer.invoke('app:data-folder'),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateState: () => ipcRenderer.invoke('update:state'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdate: (listener) => listen('update:state', listener),
  placeBrowser: (bounds) => ipcRenderer.send('browser:place', bounds),
  hideBrowser: () => ipcRenderer.send('browser:hide'),
  moveBrowser: (move) => ipcRenderer.send('browser:move', move),
  goBrowser: (text) => ipcRenderer.invoke('browser:go', text),
  browserState: () => ipcRenderer.invoke('browser:state'),
  onBrowser: (listener) => listen('browser:state', listener),
  reportPlayback: (report) => ipcRenderer.send('player:state', report),
  openMiniPlayer: () => ipcRenderer.send('mini:open'),
  closeMiniPlayer: () => ipcRenderer.send('mini:close'),
  showMainWindow: () => ipcRenderer.send('mini:show-main'),
  playbackState: () => ipcRenderer.invoke('mini:state'),
  onPlayback: (listener) => listen('mini:state', listener),
  controlPlayer: (key) => ipcRenderer.send('mini:key', key),
  onMediaKey:(listener) => listen('media:key', listener),
  onLibrary: (listener) => listen('library:updated', listener),
  onProgress: (listener) => listen('library:progress', listener),
  songUrl: (path) => `brita-media://song/${encodeURIComponent(path)}`,
  coverUrl: (path) => `brita-media://cover/${encodeURIComponent(path)}`,
}

contextBridge.exposeInMainWorld('brita', api)
