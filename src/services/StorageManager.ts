import { BufferConfig, AudioConfig, CaptureSourceConfig, KeybindConfig } from '../types';

const STORAGE_KEYS = {
  CONFIG: 'epoch_buffer_config',
  AUDIO: 'epoch_audio_config',
  SOURCE: 'epoch_capture_source',
};

const DEFAULT_KEYBINDS: KeybindConfig = {
  toggleBuffer: 'F9',
  toggleOverlay: 'Alt+Shift+T',
  dismissOverlay: 'Escape',
  playPause: 'Space',
  stepBackward: 'ArrowLeft',
  stepForward: 'ArrowRight',
  undo: 'Ctrl+Z',
  clearAll: 'Delete',
  toggleDraw: 'D',
};

const DEFAULT_CONFIG: BufferConfig = {
  durationSeconds: 60,
  fps: 60,
  resolution: '1080p',
  outputFormat: 'mp4',
  storageDirectory: 'EpochClips',
  hotkeys: DEFAULT_KEYBINDS,
  autoFreezeOnHotkey: true,
  annotationDefaultDuration: 1.0,
};

const DEFAULT_AUDIO: AudioConfig = {
  gameVolume: 1.0,
  micVolume: 1.0,
  micDeviceId: 'default',
  playbackDeviceId: 'default',
  audioSourceMode: 'system',
  isGameAudioMuted: false,
  isMicMuted: false,
  micNoiseSuppression: true, // Chromium WebRTC AI noise suppression for microphone
  noiseGateEnabled: true, // Smooth noise gate to eliminate room hiss and static when silent
  noiseGateThresholdDb: -42, // -42 dB threshold
  antiStaticFilter: true, // 80Hz rumble cut + anti-hiss shaping
  audioBitrate: 256_000, // 256 kbps studio broadcast quality
  audioSampleRate: 48_000,
  bypassAudioFilters: false, // Apply noise suppression & gate to mic
};

const DEFAULT_SOURCE: CaptureSourceConfig = {
  mode: 'screen',
};

export class StorageManager {
  public static loadConfig(): BufferConfig {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CONFIG);
      if (data) {
        const parsed = JSON.parse(data);
        return {
          ...DEFAULT_CONFIG,
          ...parsed,
          // Migrate legacy WebM capture settings to the seek-safe MP4 pipeline.
          // Existing WebM files remain supported by the vault reader.
          outputFormat: 'mp4',
          hotkeys: { ...DEFAULT_KEYBINDS, ...(parsed.hotkeys || {}) },
        };
      }
    } catch (e) {
      console.warn('Failed to load buffer config from localStorage:', e);
    }
    return DEFAULT_CONFIG;
  }

  public static saveConfig(config: BufferConfig): void {
    try {
      localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(config));
    } catch (e) {
      console.warn('Failed to save buffer config to localStorage:', e);
    }
  }

  public static loadAudioConfig(): AudioConfig {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.AUDIO);
      if (data) {
        return { ...DEFAULT_AUDIO, ...JSON.parse(data) };
      }
    } catch (e) {
      console.warn('Failed to load audio config from localStorage:', e);
    }
    return DEFAULT_AUDIO;
  }

  public static saveAudioConfig(audio: AudioConfig): void {
    try {
      localStorage.setItem(STORAGE_KEYS.AUDIO, JSON.stringify(audio));
    } catch (e) {
      console.warn('Failed to save audio config to localStorage:', e);
    }
  }

  public static loadCaptureSource(): CaptureSourceConfig {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.SOURCE);
      if (data) {
        return { ...DEFAULT_SOURCE, ...JSON.parse(data) };
      }
    } catch (e) {
      console.warn('Failed to load capture source from localStorage:', e);
    }
    return DEFAULT_SOURCE;
  }

  public static saveCaptureSource(source: CaptureSourceConfig): void {
    try {
      localStorage.setItem(STORAGE_KEYS.SOURCE, JSON.stringify(source));
    } catch (e) {
      console.warn('Failed to save capture source to localStorage:', e);
    }
  }
}
