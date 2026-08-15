import { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer, dialog, shell, Tray, Menu, nativeImage, session, Notification, protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

function logToFile(msg: string) {
  try {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    try {
      const exeDirLog = path.join(path.dirname(process.execPath), 'epoch_debug.log');
      fs.appendFileSync(exeDirLog, line);
    } catch {}
    try {
      const userLog = path.join(app.getPath('userData'), 'epoch_debug.log');
      fs.appendFileSync(userLog, line);
    } catch {}
  } catch {}
}

logToFile(`App starting. Electron: ${process.versions.electron}, Node: ${process.versions.node}, Platform: ${process.platform}`);

// Register epoch-media custom streaming protocol for zero-RAM video streaming from disk
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'epoch-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
      bypassCSP: true,
    }
  }
]);

// Log and prevent unhandled process crashes
process.on('uncaughtException', (err) => {
  console.error('Electron uncaughtException:', err);
  logToFile(`uncaughtException: ${err?.stack || err}`);
});
process.on('unhandledRejection', (reason) => {
  console.error('Electron unhandledRejection:', reason);
  logToFile(`unhandledRejection: ${reason}`);
});

// Single instance lock
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  logToFile('Another instance is already running. Quitting duplicate instance.');
  app.quit();
} else {
  app.on('second-instance', () => {
    logToFile('Second instance launched; focusing existing main window.');
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let currentClipShortcut = 'Alt+Shift+T';
let currentBufferShortcut = 'F9';
let activeNotification: Notification | null = null;
let notificationCloseTimer: ReturnType<typeof setTimeout> | null = null;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

function getAppIcon(): Electron.NativeImage {
  const possiblePaths = [
    path.join(__dirname, '../trailmap_icon.png'),
    path.join(__dirname, '../public/icon.png'),
    path.join(__dirname, '../dist/icon.png'),
    path.join(__dirname, '../src/assets/icon.png'),
    path.join(app.getAppPath(), 'trailmap_icon.png'),
    path.join(app.getAppPath(), 'public/icon.png'),
    path.join(app.getAppPath(), 'dist/icon.png'),
    path.join(process.resourcesPath, 'trailmap_icon.png'),
    path.join(process.resourcesPath, 'icon.png'),
    path.join(process.resourcesPath, 'app/public/icon.png'),
    path.join(process.resourcesPath, 'app/dist/icon.png'),
  ];
  for (const iconPath of possiblePaths) {
    try {
      if (fs.existsSync(iconPath)) {
        const img = nativeImage.createFromPath(iconPath);
        if (!img.isEmpty()) {
          return img;
        }
      }
    } catch {}
  }

  // 16x16 cyan tactical fallback icon so new Tray() never receives an empty image
  try {
    const cyanIconBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAUklEQVR42mP8z8AARID4P1VjGBgYGP7//w8X/48GqBoGxv///8PAfygGBgYGBhAbpsYYDbgBYzTAaMAAMBoGQwOG6Zk0DBj/U9WpGAAYmBgY/gMA8sM8YVfK6kQAAAAASUVORK5CYII=';
    const fallback = nativeImage.createFromDataURL(cyanIconBase64);
    if (!fallback.isEmpty()) {
      return fallback;
    }
  } catch {}

  return nativeImage.createEmpty();
}

function getDefaultVaultDirectory(): string {
  try {
    const videosDir = app.getPath('videos');
    const vaultDir = path.join(videosDir, 'EpochClips');
    if (!fs.existsSync(vaultDir)) {
      fs.mkdirSync(vaultDir, { recursive: true });
    }
    return vaultDir;
  } catch (e) {
    const fallback = path.join(app.getPath('userData'), 'EpochClips');
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    return fallback;
  }
}

function createMainWindow() {
  logToFile('Creating Main Window...');
  const appIcon = getAppIcon();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Epoch Trail',
    frame: false,
    transparent: false,
    backgroundColor: '#070a12',
    icon: appIcon.isEmpty() ? undefined : appIcon,
    alwaysOnTop: false,
    show: true,
    center: true,
    hasShadow: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  // Capture all renderer console output in debug log
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    logToFile(`[Renderer Console - Level ${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logToFile(`render-process-gone: ${JSON.stringify(details)}`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    logToFile(`did-fail-load: ${errorCode} - ${errorDescription}`);
  });

  mainWindow.once('ready-to-show', () => {
    logToFile('mainWindow ready-to-show event fired. Showing window.');
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      try {
        mainWindow.moveTop();
      } catch {}
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    logToFile(`Loading file: ${indexPath}`);
    mainWindow.loadFile(indexPath).catch(err => {
      logToFile(`loadFile error: ${err}`);
    });
  }

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      logToFile('Main window close event intercepted; hiding window to system tray.');
      mainWindow?.hide();
      return false;
    }
    logToFile('Main window closing because isQuitting is true.');
  });

  mainWindow.on('closed', () => {
    logToFile('Main window closed event fired.');
    mainWindow = null;
  });
}

function registerGlobalHotkeys(clipShortcut = 'Alt+Shift+T', bufferShortcut = 'F9') {
  try {
    globalShortcut.unregisterAll();
    currentClipShortcut = clipShortcut;
    currentBufferShortcut = bufferShortcut;

    // 1. Register Global Clip to Vault Shortcut
    if (clipShortcut) {
      const registeredClip = globalShortcut.register(clipShortcut, () => {
        logToFile(`Global shortcut triggered: clip (${clipShortcut})`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-clip-to-vault');
        }
      });
      logToFile(`Global Clip Shortcut [${clipShortcut}] registered: ${registeredClip}`);
    }

    // 2. Register Global Start/Stop Buffer Shortcut
    if (bufferShortcut) {
      const registeredBuffer = globalShortcut.register(bufferShortcut, () => {
        logToFile(`Global shortcut triggered: buffer (${bufferShortcut})`);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('global-toggle-buffer');
        }
      });
      logToFile(`Global Buffer Shortcut [${bufferShortcut}] registered: ${registeredBuffer}`);
    }

    updateTrayMenu();
    return true;
  } catch (err) {
    logToFile(`Failed to register global hotkeys: ${err}`);
    return false;
  }
}

function updateTrayMenu() {
  if (!tray) return;
  try {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Epoch Trail',
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      {
        label: `Clip to Vault (${currentClipShortcut})`,
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('global-clip-to-vault');
          }
        }
      },
      {
        label: `Start / Stop Buffer (${currentBufferShortcut})`,
        click: () => {
          if (mainWindow) {
            mainWindow.webContents.send('global-toggle-buffer');
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Open Vault Storage Folder',
        click: () => {
          shell.openPath(getDefaultVaultDirectory());
        }
      },
      { type: 'separator' },
      {
        label: 'Quit Epoch Trail',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  } catch (e) {
    logToFile(`Failed to update tray menu: ${e}`);
  }
}

function createTray() {
  try {
    const appIcon = getAppIcon();
    if (appIcon.isEmpty()) {
      logToFile('App icon is empty, skipping tray creation');
      return;
    }

    let trayIcon = appIcon;
    try {
      trayIcon = appIcon.resize({ width: 16, height: 16 });
    } catch {}

    tray = new Tray(trayIcon);
    tray.setToolTip('Epoch Trail - Tactical Rolling Buffer');
    updateTrayMenu();

    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });

    tray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
    logToFile('Tray created successfully.');
  } catch (e) {
    logToFile(`Failed to initialize Windows Tray: ${e}`);
  }
}

app.whenReady().then(() => {
  logToFile('app.whenReady resolved.');

  // Handle epoch-media:// custom streaming protocol with full HTTP Range streaming support
  try {
    protocol.handle('epoch-media', async (request) => {
      try {
        const url = new URL(request.url);
        let targetPath = url.searchParams.get('path');
        if (!targetPath) {
          const rawUrl = request.url.replace(/^epoch-media:\/\//i, '').replace(/^get\?path=/i, '');
          targetPath = decodeURIComponent(rawUrl);
          if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(targetPath)) {
            targetPath = targetPath.substring(1);
          }
        }
        if (!targetPath || !fs.existsSync(targetPath)) {
          logToFile(`epoch-media: File not found: ${targetPath}`);
          return new Response('Not Found', { status: 404 });
        }

        const stat = await fs.promises.stat(targetPath);
        const fileSize = stat.size;
        const ext = path.extname(targetPath).toLowerCase();
        const mimeType = ext === '.mp4' ? 'video/mp4'
          : ext === '.webm' ? 'video/webm'
          : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.png' ? 'image/png'
          : 'application/octet-stream';

        const rangeHeader = request.headers.get('range');
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10) || 0;
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;

          const stream = fs.createReadStream(targetPath, { start, end });
          const webStream = new ReadableStream({
            start(controller) {
              stream.on('data', chunk => controller.enqueue(chunk));
              stream.on('end', () => controller.close());
              stream.on('error', err => controller.error(err));
            },
            cancel() {
              stream.destroy();
            }
          });

          return new Response(webStream, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Range': `bytes ${start}-${end}/${fileSize}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': `${chunkSize}`,
              'Content-Type': mimeType,
              'Access-Control-Allow-Origin': '*',
            }
          });
        }

        const stream = fs.createReadStream(targetPath);
        const webStream = new ReadableStream({
          start(controller) {
            stream.on('data', chunk => controller.enqueue(chunk));
            stream.on('end', () => controller.close());
            stream.on('error', err => controller.error(err));
          },
          cancel() {
            stream.destroy();
          }
        });

        return new Response(webStream, {
          status: 200,
          headers: {
            'Accept-Ranges': 'bytes',
            'Content-Length': `${fileSize}`,
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
          }
        });
      } catch (e) {
        logToFile(`epoch-media handler error: ${e}`);
        return new Response('Internal Server Error', { status: 500 });
      }
    });
    logToFile('epoch-media streaming protocol handler registered with Range support.');
  } catch (e) {
    logToFile(`Failed to register protocol handler: ${e}`);
  }

  let targetCaptureSourceId: string | null = null;
  ipcMain.handle('set-capture-source', (_event, sourceId: string) => {
    targetCaptureSourceId = sourceId;
    logToFile(`Target capture source updated: ${sourceId}`);
    return true;
  });

  try {
    session.defaultSession.setPermissionCheckHandler(() => true);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(true));
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } }).then((sources) => {
        if (sources && sources.length > 0) {
          let chosen = targetCaptureSourceId
            ? sources.find(s => s.id === targetCaptureSourceId)
            : null;
          if (!chosen && targetCaptureSourceId) {
            const prefix = targetCaptureSourceId.split(':')[0];
            chosen = sources.find(s => s.id.startsWith(prefix));
          }
          if (!chosen) {
            chosen = sources[0];
          }
          logToFile(`setDisplayMediaRequestHandler resolved: ${chosen.name} (${chosen.id}) with loopback audio`);
          callback({ video: chosen, audio: 'loopback' });
        } else {
          logToFile('setDisplayMediaRequestHandler: no sources found');
          callback({});
        }
      }).catch(err => {
        logToFile(`Desktop capturer getSources error: ${err}`);
        callback({});
      });
    });
  } catch (e) {
    logToFile(`setDisplayMediaRequestHandler error: ${e}`);
  }

  if (process.platform === 'win32') {
    try {
      app.setAppUserModelId('com.epoch.trail');
    } catch {}
  }

  createMainWindow();
  registerGlobalHotkeys(currentClipShortcut, currentBufferShortcut);
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('will-quit', () => {
  logToFile('app.will-quit fired.');
  isQuitting = true;
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  logToFile('app.window-all-closed fired. Quitting application.');
  isQuitting = true;
  app.quit();
});

// IPC Handlers
ipcMain.handle('set-global-shortcuts', (_event, { clipShortcut, bufferShortcut }: { clipShortcut?: string; bufferShortcut?: string }) => {
  const clip = clipShortcut || currentClipShortcut;
  const buffer = bufferShortcut || currentBufferShortcut;
  return registerGlobalHotkeys(clip, buffer);
});

function dismissActiveNotification(): void {
  if (notificationCloseTimer) {
    clearTimeout(notificationCloseTimer);
    notificationCloseTimer = null;
  }
  const notification = activeNotification;
  activeNotification = null;
  notification?.close();
}

// Native Windows notification
ipcMain.on('show-desktop-notification', (_event, { title, body, desc, clipId }: { title: string; body: string; desc?: string; clipId?: string }) => {
  try {
    if (!Notification.isSupported()) return;
    dismissActiveNotification();

    const appIcon = getAppIcon();
    const notification = new Notification({
      title: title || 'Epoch Trail',
      body: desc ? `${body} - ${desc}` : (body || 'Clip saved to vault.'),
      icon: appIcon.isEmpty() ? undefined : appIcon,
      timeoutType: 'default',
    });
    activeNotification = notification;
    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        if (clipId) {
          mainWindow.webContents.send('notification-clip-clicked', clipId);
        }
      }
    });
    notification.on('close', () => {
      if (activeNotification !== notification) return;
      activeNotification = null;
      if (notificationCloseTimer) {
        clearTimeout(notificationCloseTimer);
        notificationCloseTimer = null;
      }
    });
    notification.show();

    const isFailure = /FAIL|ERROR/i.test(title || '');
    notificationCloseTimer = setTimeout(() => {
      if (activeNotification === notification) dismissActiveNotification();
    }, isFailure ? 4_000 : 3_000);
  } catch (notifErr) {
    logToFile(`Native notification failed: ${notifErr}`);
  }
});

ipcMain.on('hide-overlay', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximize-window', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('close-app', () => {
  logToFile('IPC close-app received. Hiding window to system tray.');
  if (mainWindow) {
    mainWindow.hide();
  }
});

ipcMain.handle('get-default-storage-path', async () => {
  return getDefaultVaultDirectory();
});

ipcMain.handle('select-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Clip Vault Storage Folder',
    defaultPath: getDefaultVaultDirectory(),
    properties: ['openDirectory', 'createDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Save a clip file directly to vault folder
ipcMain.handle('save-clip-to-vault-folder', async (_event, data: Uint8Array, fileName: string, targetDir?: string) => {
  try {
    const dir = targetDir || getDefaultVaultDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const fullPath = path.join(dir, fileName);
    await fs.promises.writeFile(fullPath, Buffer.from(data));
    return fullPath;
  } catch (err) {
    logToFile(`Failed to auto-save clip to vault folder: ${err}`);
    return null;
  }
});

// Scan and list all video clip files from the configured storage directory (Zero RAM metadata scan)
ipcMain.handle('list-vault-files', async (_event, targetDir?: string) => {
  try {
    const dir = targetDir || getDefaultVaultDirectory();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      return [];
    }

    const thumbDir = path.join(dir, '.epoch_thumbnails');
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    const files = await fs.promises.readdir(dir);
    const videoFiles = files.filter(f => f.endsWith('.webm') || f.endsWith('.mp4') || f.endsWith('.mkv'));

    const items = await Promise.all(
      videoFiles.map(async (fileName) => {
        const fullPath = path.join(dir, fileName);
        const stats = await fs.promises.stat(fullPath);
        const isMp4 = fileName.endsWith('.mp4');
        const mimeType = isMp4 ? 'video/mp4' : 'video/webm';

        const timeStamp = Math.round(stats.mtimeMs || stats.birthtimeMs || Date.now());
        const d = new Date(timeStamp);
        const timeFormatted = d.toTimeString().split(' ')[0];
        const dateFormatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

        const thumbPath = path.join(thumbDir, `${fileName}.jpg`);
        const hasThumb = fs.existsSync(thumbPath);

        return {
          id: `disk_${fileName.replace(/[^a-zA-Z0-9]/g, '_')}`,
          name: fileName.replace(/\.(webm|mp4|mkv)$/i, '').replace(/_/g, ' '),
          fileName,
          fullPath,
          sizeBytes: stats.size,
          timestamp: timeStamp,
          timeFormatted,
          dateFormatted,
          mimeType,
          mediaUrl: `epoch-media://get?path=${encodeURIComponent(fullPath)}`,
          thumbnailUrl: hasThumb ? `epoch-media://get?path=${encodeURIComponent(thumbPath)}` : undefined,
          format: isMp4 ? 'mp4' : 'webm',
        };
      })
    );

    logToFile(`list-vault-files found ${items.length} clips.`);
    // Sort newest first
    return items.sort((a, b) => b.timestamp - a.timestamp);
  } catch (err) {
    logToFile(`Failed to list vault files: ${err}`);
    return [];
  }
});

// Save a generated thumbnail JPEG to disk cache (.epoch_thumbnails)
ipcMain.handle('save-clip-thumbnail', async (_event, fileName: string, base64Data: string, targetDir?: string) => {
  try {
    const dir = targetDir || getDefaultVaultDirectory();
    const thumbDir = path.join(dir, '.epoch_thumbnails');
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }
    const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    const thumbPath = path.join(thumbDir, `${fileName}.jpg`);
    await fs.promises.writeFile(thumbPath, Buffer.from(cleanBase64, 'base64'));
    return `epoch-media://get?path=${encodeURIComponent(thumbPath)}`;
  } catch (err) {
    logToFile(`Failed to save clip thumbnail: ${err}`);
    return null;
  }
});

// Delete a clip file from disk (and move to Recycle Bin)
ipcMain.handle('delete-vault-file', async (_event, filePath: string) => {
  try {
    if (!filePath) return false;
    if (fs.existsSync(filePath)) {
      await shell.trashItem(filePath);
      return true;
    }
    return false;
  } catch (err) {
    logToFile(`Failed to delete vault file: ${err}`);
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        return true;
      }
    } catch (unlinkErr) {
      logToFile(`Hard unlink failed: ${unlinkErr}`);
    }
    return false;
  }
});

// Rename a clip file on disk
ipcMain.handle('rename-vault-file', async (_event, oldFilePath: string, newNameWithoutExt: string) => {
  try {
    if (!oldFilePath || !fs.existsSync(oldFilePath)) return null;

    const dir = path.dirname(oldFilePath);
    const ext = path.extname(oldFilePath);
    const safeBaseName = newNameWithoutExt.replace(/[^a-zA-Z0-9_\- ]/g, '_').trim();
    const newFullPath = path.join(dir, `${safeBaseName}${ext}`);

    if (oldFilePath !== newFullPath) {
      await fs.promises.rename(oldFilePath, newFullPath);
    }
    return newFullPath;
  } catch (err) {
    logToFile(`Failed to rename vault file on disk: ${err}`);
    return null;
  }
});

ipcMain.handle('get-desktop-sources', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 640, height: 360 },
      fetchWindowIcons: true,
    });
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      display_id: s.display_id,
      isScreen: s.id.startsWith('screen:'),
    }));
  } catch (e) {
    logToFile(`Failed to get desktop sources: ${e}`);
    return [];
  }
});

ipcMain.handle('save-exported-video', async (_event, data: Uint8Array, defaultName: string) => {
  if (!mainWindow) return null;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Tactical Review Clip',
    defaultPath: path.join(getDefaultVaultDirectory(), defaultName),
    filters: [
      { name: 'MP4 Video', extensions: ['mp4'] },
    ],
  });

  if (filePath) {
    await fs.promises.writeFile(filePath, Buffer.from(data));
    return filePath;
  }
  return null;
});

ipcMain.handle('open-path', async (_event, targetPath: string) => {
  if (!targetPath) return;
  try {
    if (fs.existsSync(targetPath)) {
      const stat = fs.statSync(targetPath);
      if (stat.isDirectory()) {
        await shell.openPath(targetPath);
      } else {
        shell.showItemInFolder(targetPath);
      }
    } else {
      await shell.openPath(getDefaultVaultDirectory());
    }
  } catch (e) {
    logToFile(`Failed to open path in file explorer: ${e}`);
  }
});
