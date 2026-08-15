import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  onToggleOverlay: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-overlay', handler);
    ipcRenderer.on('global-clip-to-vault', handler);
    return () => {
      ipcRenderer.removeListener('toggle-overlay', handler);
      ipcRenderer.removeListener('global-clip-to-vault', handler);
    };
  },
  onToggleBuffer: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('global-toggle-buffer', handler);
    return () => {
      ipcRenderer.removeListener('global-toggle-buffer', handler);
    };
  },
  setGlobalShortcuts: async (shortcuts: { clipShortcut?: string; bufferShortcut?: string }) => {
    return await ipcRenderer.invoke('set-global-shortcuts', shortcuts);
  },
  showDesktopNotification: (title: string, body: string, desc?: string, clipId?: string) => {
    ipcRenderer.send('show-desktop-notification', { title, body, desc, clipId });
  },
  onNotificationClipClicked: (callback: (clipId: string) => void) => {
    const handler = (_event: any, clipId: string) => callback(clipId);
    ipcRenderer.on('notification-clip-clicked', handler);
    return () => {
      ipcRenderer.removeListener('notification-clip-clicked', handler);
    };
  },
  hideOverlay: () => {
    ipcRenderer.send('hide-overlay');
  },
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  maximizeWindow: () => {
    ipcRenderer.send('maximize-window');
  },
  closeApp: () => {
    ipcRenderer.send('close-app');
  },
  getDesktopSources: async () => {
    return await ipcRenderer.invoke('get-desktop-sources');
  },
  setCaptureSource: async (sourceId: string) => {
    return await ipcRenderer.invoke('set-capture-source', sourceId);
  },
  saveExportedVideo: async (data: Uint8Array, defaultName: string) => {
    return await ipcRenderer.invoke('save-exported-video', data, defaultName);
  },
  saveClipToVaultFolder: async (data: Uint8Array, fileName: string, targetDir?: string) => {
    return await ipcRenderer.invoke('save-clip-to-vault-folder', data, fileName, targetDir);
  },
  saveClipThumbnail: async (fileName: string, base64Data: string, targetDir?: string) => {
    return await ipcRenderer.invoke('save-clip-thumbnail', fileName, base64Data, targetDir);
  },
  listVaultFiles: async (targetDir?: string) => {
    return await ipcRenderer.invoke('list-vault-files', targetDir);
  },
  deleteVaultFile: async (filePath: string) => {
    return await ipcRenderer.invoke('delete-vault-file', filePath);
  },
  renameVaultFile: async (oldFilePath: string, newNameWithoutExt: string) => {
    return await ipcRenderer.invoke('rename-vault-file', oldFilePath, newNameWithoutExt);
  },
  selectDirectory: async () => {
    return await ipcRenderer.invoke('select-directory');
  },
  getDefaultStoragePath: async () => {
    return await ipcRenderer.invoke('get-default-storage-path');
  },
  openPath: async (filePath: string) => {
    return await ipcRenderer.invoke('open-path', filePath);
  },
  isElectron: true,
});
