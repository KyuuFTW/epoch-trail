import { BufferConfig, BufferState, SessionClip, CaptureSourceConfig, KeybindConfig } from '../types';
import { audioMixer } from './AudioMixer';
import fixWebmDuration from 'fix-webm-duration';
import { Mp4RollingEncoder } from './Mp4RollingEncoder';

export interface BufferSegment {
  blob: Blob;
  durationMs: number;
  timestamp: number;
}

export interface BufferMetrics {
  currentDurationSeconds: number;
  maxDurationSeconds: number;
  segmentCount: number;
  estimatedMemoryMB: number;
  state: BufferState;
  activeSourceLabel: string;
}

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

export class RollingBufferService {
  private config: BufferConfig = DEFAULT_CONFIG;
  private state: BufferState = 'inactive';
  private mediaStream: MediaStream | null = null;
  private rawVideoStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private mp4Encoder: Mp4RollingEncoder | null = null;
  private segments: BufferSegment[] = [];
  private headerChunk: Blob | null = null;
  private lastSegmentTime: number = 0;
  private listeners: ((metrics: BufferMetrics) => void)[] = [];
  private metricsTimer: number | null = null;
  private clipCounter: number = 0;
  private activeSourceLabel: string = 'Full Screen';
  private actualMimeType: string = 'video/webm';
  private actualFormat: 'mp4' | 'webm' = 'webm';
  private captureSource: CaptureSourceConfig = { mode: 'screen' };
  private loopbackAudioStream: MediaStream | null = null;
  private pendingDataResolvers: Array<() => void> = [];
  private actualFrameRate: number = 60;
  private actualWidth: number = 1920;
  private actualHeight: number = 1080;
  private lastCaptureError: string | null = null;

  constructor() {
    this.detectSupportedMimeType();
  }

  private detectSupportedMimeType(): string {
    const supportedTypes = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    this.actualMimeType = supportedTypes.find(t => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    return this.actualMimeType;
  }

  public setConfig(newConfig: Partial<BufferConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.notifyMetrics();
  }

  public getConfig(): BufferConfig {
    return { ...this.config };
  }

  public getState(): BufferState {
    return this.state;
  }

  public getLastError(): string | null {
    return this.lastCaptureError || this.mp4Encoder?.getLastError() || null;
  }

  public onMetricsChange(callback: (metrics: BufferMetrics) => void): () => void {
    this.listeners.push(callback);
    callback(this.getMetrics());
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  public getMetrics(): BufferMetrics {
    const mp4Metrics = this.mp4Encoder?.getBufferMetrics();
    const totalBytes = mp4Metrics?.bytes ?? this.segments.reduce((acc, s) => acc + s.blob.size, 0);
    const totalDuration = mp4Metrics?.durationSeconds
      ?? this.segments.reduce((acc, s) => acc + s.durationMs, 0) / 1000;

    return {
      currentDurationSeconds: Math.round(totalDuration * 10) / 10,
      maxDurationSeconds: this.config.durationSeconds,
      segmentCount: mp4Metrics?.chunkCount ?? this.segments.length,
      estimatedMemoryMB: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      state: this.state,
      activeSourceLabel: this.activeSourceLabel,
    };
  }

  private notifyMetrics(): void {
    const metrics = this.getMetrics();
    this.listeners.forEach(fn => fn(metrics));
  }

  /**
   * Start screen capture and rolling memory buffer
   */
  public async startCapture(sourceConfig?: CaptureSourceConfig): Promise<boolean> {
    try {
      this.cleanup();
      this.lastCaptureError = null;

      if (sourceConfig) {
        this.captureSource = sourceConfig;
      }

      await this.refreshSelectedElectronSource();

      this.detectSupportedMimeType();

      // Determine resolution limits based on user configuration
      const res = this.config.resolution || '1080p';
      let maxWidth = 1920;
      let maxHeight = 1080;
      if (res === '720p') {
        maxWidth = 1280;
        maxHeight = 720;
      } else if (res === '1440p') {
        maxWidth = 2560;
        maxHeight = 1440;
      } else if (res === 'source') {
        maxWidth = 3840;
        maxHeight = 2160;
      }
      const targetFps = this.config.fps || 60;

      let videoTrack: MediaStreamTrack | null = null;
      let rawAudioTrack: MediaStreamTrack | null = null;

      // 1. Acquire Desktop Stream in Electron or Web with System Loopback Audio
      if (this.captureSource.sourceId && (window as any).electronAPI?.isElectron) {
        if ((window as any).electronAPI.setCaptureSource) {
          await (window as any).electronAPI.setCaptureSource(this.captureSource.sourceId);
        }

        try {
          this.rawVideoStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: maxWidth },
              height: { ideal: maxHeight },
              frameRate: { ideal: targetFps, max: targetFps },
            },
            audio: true,
          });
          this.activeSourceLabel = this.captureSource.sourceName || (this.captureSource.mode === 'window' ? 'Selected Window' : 'Selected Display');
          const aTracks = this.rawVideoStream ? this.rawVideoStream.getAudioTracks() : [];
          if (aTracks.length > 0) {
            rawAudioTrack = aTracks[0];
          }
        } catch (displayErr) {
          console.warn('getDisplayMedia with loopback audio failed; falling back to getUserMedia desktop capture:', displayErr);
          const desktopVideoConstraints = {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: this.captureSource.sourceId,
              maxWidth,
              maxHeight,
              maxFrameRate: targetFps,
            },
          };

          try {
            this.rawVideoStream = await (navigator.mediaDevices as any).getUserMedia({
              audio: false,
              video: desktopVideoConstraints,
            });
            this.activeSourceLabel = this.captureSource.sourceName || 'Selected Display';
          } catch (gumErr) {
            throw new Error(`Desktop video capture failed: ${String(gumErr)}`);
          }
        }
      } else {
        try {
          this.rawVideoStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              width: { ideal: maxWidth },
              height: { ideal: maxHeight },
              frameRate: { ideal: targetFps, max: targetFps },
              displaySurface: this.captureSource.mode === 'window' ? 'window' : 'monitor',
            },
            audio: true,
          });
          this.activeSourceLabel = 'Screen / Desktop';
          const aTracks = this.rawVideoStream ? this.rawVideoStream.getAudioTracks() : [];
          if (aTracks.length > 0) {
            rawAudioTrack = aTracks[0];
          }
        } catch (displayErr) {
          console.warn('DisplayMedia fallback to simulated game stream:', displayErr);
          this.rawVideoStream = this.createSimulatedGameStream();
          this.activeSourceLabel = `Tactical Engine (${targetFps}FPS)`;
        }
      }

      if (!this.rawVideoStream || this.rawVideoStream.getVideoTracks().length === 0) {
        throw new Error('No valid video track acquired.');
      }

      videoTrack = this.rawVideoStream.getVideoTracks()[0];
      const trackSettings = videoTrack.getSettings();
      this.actualFrameRate = Math.max(1, Math.round(trackSettings.frameRate || targetFps));
      this.actualWidth = trackSettings.width || maxWidth;
      this.actualHeight = trackSettings.height || maxHeight;
      videoTrack.contentHint = 'motion';

      if (!rawAudioTrack && this.rawVideoStream) {
        const audioTracks = this.rawVideoStream.getAudioTracks();
        if (audioTracks.length > 0) {
          rawAudioTrack = audioTracks[0];
        }
      }

      // Acquire separated Window/System Audio (unfiltered) and Microphone Audio (isolated DSP)
      const separatedAudio = await audioMixer.prepareAudioTracks(rawAudioTrack);
      const activeGameForWebm = audioMixer.getConfig().isGameAudioMuted ? null : separatedAudio.gameAudioTrack;
      const fallbackSingleAudio = activeGameForWebm || separatedAudio.micAudioTrack;

      const compositeTracks: MediaStreamTrack[] = [videoTrack];
      if (fallbackSingleAudio) {
        compositeTracks.push(fallbackSingleAudio);
      }
      this.mediaStream = new MediaStream(compositeTracks);

      videoTrack.onended = () => {
        this.stopCapture();
      };

      this.lastSegmentTime = performance.now();
      this.headerChunk = null;
      this.segments = [];

      if (this.config.outputFormat === 'mp4') {
        if (!Mp4RollingEncoder.isAvailable()) {
          throw new Error('This Windows system does not expose the WebCodecs MP4 encoder.');
        }
        try {
          this.mp4Encoder = new Mp4RollingEncoder(this.config.durationSeconds, targetFps);
          await this.mp4Encoder.start(videoTrack, separatedAudio);
          this.actualFormat = 'mp4';
          this.actualMimeType = 'video/mp4';
        } catch (mp4Error) {
          this.mp4Encoder?.stop();
          this.mp4Encoder = null;
          throw new Error(`MP4 capture could not start: ${String(mp4Error)}`);
        }
      } else {
        this.startWebmRecorder();
      }

      this.state = 'buffering';
      this.notifyMetrics();

      this.metricsTimer = window.setInterval(() => {
        this.notifyMetrics();
      }, 1000);

      return true;
    } catch (err) {
      console.error('Failed to start capture:', err);
      this.lastCaptureError = err instanceof Error ? err.message : String(err);
      this.cleanup();
      this.state = 'inactive';
      this.notifyMetrics();
      return false;
    }
  }

  private async refreshSelectedElectronSource(): Promise<void> {
    if (!this.captureSource.sourceId || !window.electronAPI?.isElectron || !window.electronAPI.getDesktopSources) {
      return;
    }

    const sources = await window.electronAPI.getDesktopSources();
    const prefix = this.captureSource.mode === 'window' ? 'window:' : 'screen:';
    const sameType = sources.filter(source => source.id.startsWith(prefix));
    const match = sameType.find(source => source.id === this.captureSource.sourceId)
      || sameType.find(source => source.name === this.captureSource.sourceName);

    if (!match) {
      throw new Error(`Selected ${this.captureSource.mode} is no longer available: ${this.captureSource.sourceName || this.captureSource.sourceId}`);
    }

    this.captureSource = {
      ...this.captureSource,
      sourceId: match.id,
      sourceName: match.name,
    };
  }

  private startWebmRecorder(): void {
    if (!this.mediaStream) throw new Error('Cannot start WebM recording without a media stream.');
    this.detectSupportedMimeType();
    this.actualFormat = 'webm';

    const recorderOptions = {
      mimeType: this.actualMimeType,
      videoBitsPerSecond: this.calculateVideoBitrate(),
      // Chromium supports this option even though older TypeScript DOM types do not.
      videoKeyFrameIntervalDuration: 1000,
    } as MediaRecorderOptions;
    this.mediaRecorder = new MediaRecorder(this.mediaStream, recorderOptions);
    this.actualMimeType = this.mediaRecorder.mimeType || this.actualMimeType;

    this.mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        const now = performance.now();
        const durationMs = Math.max(1, now - this.lastSegmentTime);
        this.lastSegmentTime = now;

        if (!this.headerChunk) this.headerChunk = event.data;
        this.segments.push({ blob: event.data, durationMs, timestamp: Date.now() });
        this.pruneOldSegments();
        this.notifyMetrics();
      }
      const resolvers = this.pendingDataResolvers.splice(0);
      resolvers.forEach(resolve => resolve());
    };

    this.mediaRecorder.start(1000);
  }

  private calculateVideoBitrate(): number {
    const pixelsPerSecond = this.actualWidth * this.actualHeight * this.actualFrameRate;
    return Math.round(Math.max(6_000_000, Math.min(50_000_000, pixelsPerSecond * 0.1)));
  }

  private pruneOldSegments(): void {
    const maxMs = this.config.durationSeconds * 1000;
    let totalMs = this.segments.reduce((acc, s) => acc + s.durationMs, 0);

    // Keep at least 3 segments
    while (this.segments.length > 3 && totalMs > maxMs) {
      const removed = this.segments.shift();
      if (removed) {
        totalMs -= removed.durationMs;
      }
    }
  }

  /**
   * Freezes current buffer and generates a valid, clean SessionClip with matching MIME type
   */
  public async freezeToSessionClip(): Promise<SessionClip | null> {
    this.lastCaptureError = null;
    this.clipCounter++;
    const now = new Date();
    const timeFormatted = now.toTimeString().split(' ')[0];
    const dateFormatted = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

    if (this.mp4Encoder) {
      try {
        const snapshot = await this.mp4Encoder.snapshot();
        const videoBlobUrl = URL.createObjectURL(snapshot.blob);
        const gameAudioUrl = snapshot.gameAudioBlob ? URL.createObjectURL(snapshot.gameAudioBlob) : undefined;
        const micAudioUrl = snapshot.micAudioBlob ? URL.createObjectURL(snapshot.micAudioBlob) : undefined;
        return {
          id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: `Clip #${this.clipCounter} (${timeFormatted.replace(/:/g, '-')})`,
          timestamp: Date.now(),
          timeFormatted,
          dateFormatted,
          videoBlobUrl,
          blob: snapshot.blob,
          gameAudioUrl,
          micAudioUrl,
          gameAudioBlob: snapshot.gameAudioBlob,
          micAudioBlob: snapshot.micAudioBlob,
          duration: Math.round(snapshot.durationSeconds * 10) / 10,
          format: 'mp4',
          mimeType: 'video/mp4',
          frameRate: snapshot.frameRate,
          width: snapshot.width,
          height: snapshot.height,
          droppedFrames: snapshot.droppedFrames,
          annotations: [],
        };
      } catch (error) {
        console.error('Unable to finalize MP4 rolling buffer:', error);
        this.lastCaptureError = error instanceof Error ? error.message : String(error);
        return null;
      }
    }

    await this.flushWebmData();
    if (this.segments.length === 0) {
      console.warn('No buffered chunks to freeze.');
      return null;
    }

    const totalDurationMs = this.segments.reduce((acc, s) => acc + s.durationMs, 0);
    const durationSeconds = Math.max(1, Math.round(totalDurationMs / 100) / 10);

    // Collect blobs ensuring initialization header is prepended to avoid green screen decoder fault
    const blobsToMerge: Blob[] = [];
    if (this.headerChunk && this.segments[0]?.blob !== this.headerChunk) {
      blobsToMerge.push(this.headerChunk);
    }
    this.segments.forEach(s => blobsToMerge.push(s.blob));

    // CRITICAL: Always use the exact MIME type that MediaRecorder recorded to prevent decoder fault
    const rawMergedBlob = new Blob(blobsToMerge, { type: this.actualMimeType });
    let finalizedBlob = rawMergedBlob;
    try {
      finalizedBlob = await fixWebmDuration(rawMergedBlob, totalDurationMs);
    } catch (error) {
      console.warn('Unable to repair WebM duration metadata:', error);
    }
    const videoBlobUrl = URL.createObjectURL(finalizedBlob);

    const newClip: SessionClip = {
      id: `clip_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: `Clip #${this.clipCounter} (${timeFormatted.replace(/:/g, '-')})`,
      timestamp: Date.now(),
      timeFormatted,
      dateFormatted,
      videoBlobUrl,
      blob: finalizedBlob,
      duration: durationSeconds,
      format: this.actualFormat,
      mimeType: this.actualMimeType,
      frameRate: this.actualFrameRate,
      width: this.actualWidth,
      height: this.actualHeight,
      annotations: [],
    };

    return newClip;
  }

  private async flushWebmData(): Promise<void> {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    await new Promise<void>(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      this.pendingDataResolvers.push(finish);
      this.mediaRecorder?.requestData();
      window.setTimeout(finish, 750);
    });
  }

  public pause(): void {
    if (this.state !== 'buffering') return;
    this.mp4Encoder?.pause();
    if (this.mediaRecorder?.state === 'recording') {
      this.mediaRecorder.pause();
    }
    this.state = 'paused';
    this.notifyMetrics();
  }

  public resume(): void {
    if (this.state === 'frozen' || this.state === 'paused') {
      this.mp4Encoder?.resume();
      if (this.mediaRecorder?.state === 'paused') {
        this.lastSegmentTime = performance.now();
        this.mediaRecorder.resume();
      }
      this.state = 'buffering';
      this.notifyMetrics();
    }
  }

  public stopCapture(): void {
    this.cleanup();
    this.state = 'inactive';
    this.notifyMetrics();
  }

  private cleanup(): void {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
      } catch (e) {}
    }
    this.mediaRecorder = null;
    this.mp4Encoder?.stop();
    this.mp4Encoder = null;
    this.pendingDataResolvers.splice(0).forEach(resolve => resolve());

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    if (this.rawVideoStream) {
      this.rawVideoStream.getTracks().forEach(track => track.stop());
      this.rawVideoStream = null;
    }
    if (this.loopbackAudioStream) {
      this.loopbackAudioStream.getTracks().forEach(track => track.stop());
      this.loopbackAudioStream = null;
    }

    audioMixer.cleanup();
    this.segments = [];
    this.headerChunk = null;
  }

  private createSimulatedGameStream(): MediaStream {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d');

    let frame = 0;
    const targetFps = this.config.fps || 60;
    const intervalMs = 1000 / targetFps;

    window.setInterval(() => {
      if (!ctx) return;
      frame++;
      ctx.fillStyle = '#060910';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.strokeStyle = '#00F0FF';
      ctx.lineWidth = 4;
      const x = 960 + Math.sin(frame * 0.05) * 400;
      const y = 540 + Math.cos(frame * 0.05) * 200;

      ctx.beginPath();
      ctx.arc(x, y, 40, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '24px monospace';
      ctx.fillText(`EPOCH TACTICAL ENGINE - ${targetFps} FPS (SIMULATED)`, 100, 100);
      ctx.fillText(`Frame: ${frame}`, 100, 140);
    }, intervalMs);

    return canvas.captureStream(targetFps);
  }
}

export const rollingBuffer = new RollingBufferService();
