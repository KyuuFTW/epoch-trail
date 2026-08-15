export type TacticalTool = 'brush' | 'arrow' | 'halo' | 'rect' | 'text' | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export interface TacticalAnnotation {
  id: string;
  tool: TacticalTool;
  color: string;
  strokeWidth: number;
  points: Point[];
  timestamp: number; // Center timestamp in seconds
  duration: number;
  text?: string;
  fontSize?: number;
}

export interface KeybindConfig {
  toggleBuffer: string;   // Start/Stop Buffer Trail, Default: 'F9'
  toggleOverlay: string;  // Clip to Vault, Default: 'Alt+Shift+T'
  dismissOverlay: string; // Dismiss HUD, Default: 'Escape'
  playPause: string;      // Play/Pause, Default: 'Space'
  stepBackward: string;   // Frame Step Back, Default: 'ArrowLeft'
  stepForward: string;    // Frame Step Forward, Default: 'ArrowRight'
  undo: string;           // Undo, Default: 'Ctrl+Z'
  clearAll: string;       // Clear All, Default: 'Delete'
  toggleDraw: string;     // Toggle Draw, Default: 'D'
}

export interface AudioConfig {
  gameVolume: number; // 0.0 to 1.0
  micVolume: number;  // 0.0 to 1.0
  micDeviceId: string;
  playbackDeviceId: string; // Specific audio output device or 'default'
  audioSourceMode: 'system' | 'window' | 'mute';
  isGameAudioMuted: boolean;
  isMicMuted: boolean;
  micNoiseSuppression: boolean;
  noiseGateEnabled: boolean; // Automatic silence floor when not talking (eliminates hiss)
  noiseGateThresholdDb: number; // in dB, default: -42 dB
  antiStaticFilter: boolean; // Multi-stage 80Hz rumble + high-shelf static hum filter
  audioBitrate: number; // in bps, default: 256000 (256 kbps)
  audioSampleRate: number; // in Hz, default: 48000
  bypassAudioFilters: boolean; // Bypass speech DSP for game audio
}

export interface CaptureSourceConfig {
  mode: 'screen' | 'window';
  sourceId?: string;
  sourceName?: string;
}

export interface BufferConfig {
  durationSeconds: number; // 15 to 600 seconds (up to 10 minutes)
  fps: number; // 30, 60, 120
  resolution: '720p' | '1080p' | '1440p' | 'source';
  outputFormat: 'mp4' | 'webm'; // MP4 or WebM
  storageDirectory: string; // Configured Vault storage folder path
  hotkeys: KeybindConfig;
  autoFreezeOnHotkey: boolean;
  annotationDefaultDuration: 1.0;
}

export interface SessionClip {
  id: string;
  name: string;
  timestamp: number; // Unix timestamp
  timeFormatted: string; // e.g. '19:24:12'
  dateFormatted: string; // e.g. 'Aug 14, 2026'
  videoBlobUrl: string;
  thumbnailUrl?: string;
  blob: Blob;
  duration: number;
  format: 'mp4' | 'webm';
  mimeType?: string;
  frameRate?: number;
  width?: number;
  height?: number;
  droppedFrames?: number;
  annotations: TacticalAnnotation[];
  savedFilePath?: string;
}

export interface DiskClipFile {
  id: string;
  name: string;
  fileName: string;
  fullPath: string;
  sizeBytes: number;
  timestamp: number;
  timeFormatted: string;
  dateFormatted: string;
  mimeType: string;
  mediaUrl: string;
  thumbnailUrl?: string;
  data?: Uint8Array;
  format: 'mp4' | 'webm';
}

export type BufferState = 'inactive' | 'buffering' | 'paused' | 'frozen';
export type AppTab = 'review' | 'gallery';

export interface ExportOptions {
  fileName: string;
  format: 'mp4' | 'webm';
  burnAnnotations: boolean;
  timeRange?: [number, number];
}

export interface DesktopSource {
  id: string;
  name: string;
  thumbnail: string;
  display_id?: string;
  isScreen?: boolean;
}

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export interface ElectronBridge {
  onToggleOverlay: (callback: () => void) => () => void;
  onToggleBuffer: (callback: () => void) => () => void;
  setGlobalShortcuts: (shortcuts: { clipShortcut?: string; bufferShortcut?: string }) => Promise<boolean>;
  showDesktopNotification: (title: string, body: string, desc?: string, clipId?: string) => void;
  onNotificationClipClicked?: (callback: (clipId: string) => void) => () => void;
  hideOverlay: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeApp: () => void;
  getDesktopSources: () => Promise<DesktopSource[]>;
  setCaptureSource: (sourceId: string) => Promise<boolean>;
  saveExportedVideo: (data: Uint8Array, defaultName: string) => Promise<string | null>;
  saveClipToVaultFolder: (data: Uint8Array, fileName: string, targetDir?: string) => Promise<string | null>;
  saveClipThumbnail: (fileName: string, base64Data: string, targetDir?: string) => Promise<string | null>;
  listVaultFiles: (targetDir?: string) => Promise<DiskClipFile[]>;
  deleteVaultFile: (filePath: string) => Promise<boolean>;
  renameVaultFile: (oldFilePath: string, newNameWithoutExt: string) => Promise<string | null>;
  selectDirectory: () => Promise<string | null>;
  getDefaultStoragePath: () => Promise<string>;
  openPath: (filePath: string) => Promise<void>;
  isElectron: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}
