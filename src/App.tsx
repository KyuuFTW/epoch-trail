import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  rollingBuffer,
  BufferMetrics,
} from './services/RollingBuffer';
import {
  TacticalAnnotation,
  TacticalTool,
  BufferConfig,
  SessionClip,
  AudioConfig,
  CaptureSourceConfig,
  AppTab,
} from './types';
import { TacticalCanvas } from './components/TacticalCanvas';
import { TimelineScrubber } from './components/TimelineScrubber';
import { LeftSidebar } from './components/LeftSidebar';
import { TopAnnotationBar } from './components/TopAnnotationBar';
import { SettingsModal } from './components/SettingsModal';
import { ExportModal } from './components/ExportModal';
import { GalleryView } from './components/GalleryView';
import { Minus, Square, X, Scissors, Loader2 } from 'lucide-react';
import { ExportEngine } from './services/ExportEngine';
import { audioMixer } from './services/AudioMixer';
import { StorageManager } from './services/StorageManager';
import { soundEffects } from './services/SoundEffectService';
import appLogo from './assets/icon.png';

function matchesKeybind(e: KeyboardEvent, keybindStr: string): boolean {
  if (!keybindStr) return false;
  const parts = keybindStr.split('+').map(p => p.trim());
  const hasCtrl = parts.includes('Ctrl');
  const hasAlt = parts.includes('Alt');
  const hasShift = parts.includes('Shift');
  const hasMeta = parts.includes('Meta');

  if (e.ctrlKey !== hasCtrl) return false;
  if (e.altKey !== hasAlt) return false;
  if (e.shiftKey !== hasShift) return false;
  if (e.metaKey !== hasMeta) return false;

  const mainKey = parts.filter(p => !['Ctrl', 'Alt', 'Shift', 'Meta'].includes(p))[0];
  if (!mainKey) return false;

  if (mainKey.toLowerCase() === 'space' && e.code === 'Space') return true;
  if (mainKey.toLowerCase() === 'escape' && (e.key === 'Escape' || e.code === 'Escape')) return true;
  if (mainKey.toLowerCase() === 'delete' && (e.key === 'Delete' || e.code === 'Delete')) return true;
  if (mainKey.toLowerCase() === 'arrowleft' && e.code === 'ArrowLeft') return true;
  if (mainKey.toLowerCase() === 'arrowright' && e.code === 'ArrowRight') return true;

  if (e.key.toLowerCase() === mainKey.toLowerCase()) return true;
  if (e.code.replace('Key', '').toLowerCase() === mainKey.toLowerCase()) return true;

  return false;
}

export const App: React.FC = () => {
  // Navigation State: DEFAULT TO VAULT GALLERY
  const [currentTab, setCurrentTab] = useState<AppTab>('gallery');

  // Buffer & Recording State (DEFAULT TO NOT BUFFERING ON LAUNCH)
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [config, setConfig] = useState<BufferConfig>(StorageManager.loadConfig());
  const [captureSource, setCaptureSource] = useState<CaptureSourceConfig>(StorageManager.loadCaptureSource());
  const [metrics, setMetrics] = useState<BufferMetrics>({
    ...rollingBuffer.getMetrics(),
    state: 'inactive',
  });

  // Session Clip Vault State (Synchronized with disk directory)
  const [clips, setClips] = useState<SessionClip[]>([]);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);

  // Active Video Player State (Used during Vault Clip Review)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(60);
  const [trimRange, setTrimRange] = useState<[number, number]>([0, 60]);
  const [isTrimmingSaving, setIsTrimmingSaving] = useState<boolean>(false);
  const [trimProgress, setTrimProgress] = useState<number>(0);
  const [trimStatusText, setTrimStatusText] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [playbackVolume, setPlaybackVolume] = useState<number>(1.0);
  const [isPlaybackMuted, setIsPlaybackMuted] = useState<boolean>(false);
  const animFrameRef = useRef<number | null>(null);

  // Tactical Annotation Engine State
  const [annotations, setAnnotations] = useState<TacticalAnnotation[]>([]);
  const [undoStack, setUndoStack] = useState<TacticalAnnotation[][]>([]);
  const [selectedTool, setSelectedTool] = useState<TacticalTool>('brush');
  const [selectedColor, setSelectedColor] = useState<string>('#00F0FF');
  const [strokeWidth, setStrokeWidth] = useState<number>(4);
  const [isDrawingEnabled, setIsDrawingEnabled] = useState<boolean>(true);
  const [isFullscreenPlayer, setIsFullscreenPlayer] = useState<boolean>(false);

  // Modals
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [clipToExport, setClipToExport] = useState<SessionClip | null>(null);

  // Find active clip
  const activeClip = clips.find(c => c.id === activeClipId) || null;

  // Scan and load all clip files from disk directory into Vault Gallery
  const refreshVaultFromDisk = useCallback(async (targetDir?: string) => {
    const dir = targetDir || config.storageDirectory;
    if (window.electronAPI?.listVaultFiles) {
      try {
        const diskFiles = await window.electronAPI.listVaultFiles(dir);
        if (diskFiles && diskFiles.length > 0) {
          const mappedClips: SessionClip[] = diskFiles.map(df => {
            const videoUrl = df.mediaUrl || (df.data ? URL.createObjectURL(new Blob([df.data as any], { type: df.mimeType })) : '');
            return {
              id: df.id,
              name: df.name,
              timestamp: df.timestamp,
              timeFormatted: df.timeFormatted,
              dateFormatted: df.dateFormatted,
              videoBlobUrl: videoUrl,
              thumbnailUrl: df.thumbnailUrl,
              blob: new Blob([], { type: df.mimeType }),
              duration: 60, // Refreshed dynamically on metadata load
              format: df.format,
              annotations: [],
              savedFilePath: df.fullPath,
            };
          });
          setClips(mappedClips);
        } else {
          setClips([]);
        }
      } catch (err) {
        console.warn('Failed to load vault from disk:', err);
      }
    }
  }, [config.storageDirectory]);

  // Initialize config, register global shortcuts, and load existing vault clips from disk
  useEffect(() => {
    rollingBuffer.setConfig(config);
    audioMixer.setConfig(StorageManager.loadAudioConfig());
    const unsub = rollingBuffer.onMetricsChange((newMetrics) => {
      setMetrics(newMetrics);
      setIsBuffering(newMetrics.state !== 'inactive');
    });

    // Register initial global shortcuts in Electron
    if (window.electronAPI?.setGlobalShortcuts) {
      window.electronAPI.setGlobalShortcuts({
        clipShortcut: config.hotkeys.toggleOverlay || 'Alt+Shift+T',
        bufferShortcut: config.hotkeys.toggleBuffer || 'F9',
      });
    }

    // Resolve default storage directory and load clips
    if (window.electronAPI?.getDefaultStoragePath) {
      window.electronAPI.getDefaultStoragePath().then(defaultDir => {
        let activeDir = config.storageDirectory;
        if (!activeDir || activeDir === 'EpochClips') {
          activeDir = defaultDir;
          const updated = { ...config, storageDirectory: defaultDir };
          setConfig(updated);
          StorageManager.saveConfig(updated);
        }
        refreshVaultFromDisk(activeDir);
      });
    }

    return () => {
      unsub();
      rollingBuffer.stopCapture();
    };
  }, []);

  // Reload video and ensure audio is active when activeClip changes
  useEffect(() => {
    if (activeClip && videoRef.current) {
      videoRef.current.load();
      videoRef.current.currentTime = 0;
      videoRef.current.muted = isPlaybackMuted;
      videoRef.current.volume = playbackVolume;
      setCurrentTime(0);
      setDuration(activeClip.duration || 60);
    }
  }, [activeClipId]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = isPlaybackMuted;
    videoRef.current.volume = playbackVolume;
  }, [isPlaybackMuted, playbackVolume]);

  // High-performance time tracking loop using requestAnimationFrame
  useEffect(() => {
    if (!isPlaying) {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      return;
    }

    let lastUpdate = 0;
    const trackPlayhead = (now: number) => {
      if (videoRef.current && !videoRef.current.paused) {
        if (now - lastUpdate > 33) {
          setCurrentTime(videoRef.current.currentTime);
          lastUpdate = now;
        }
        animFrameRef.current = requestAnimationFrame(trackPlayhead);
      }
    };

    animFrameRef.current = requestAnimationFrame(trackPlayhead);
    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isPlaying]);

  // Use the operating system notification center so capture feedback remains
  // visible while a game or another selected window owns the foreground.
  const showNotification = useCallback((title: string, message: string, clip?: SessionClip) => {
    if (window.electronAPI?.showDesktopNotification) {
      window.electronAPI.showDesktopNotification(title, message, undefined, clip?.id);
    }
  }, []);

  // Open Vault Storage Folder in File Explorer
  const handleOpenVaultFolder = useCallback(() => {
    if (window.electronAPI?.openPath) {
      window.electronAPI.openPath(config.storageDirectory);
    }
  }, [config.storageDirectory]);

  // Toggle Buffer Start / Stop
  const handleToggleBuffer = useCallback(async () => {
    if (isBuffering) {
      rollingBuffer.stopCapture();
      setIsBuffering(false);
      soundEffects.playClipCapturedSound();
    } else {
      if (!captureSource.sourceId) {
        showNotification('SELECT CAPTURE SOURCE', 'Choose a monitor or window beside the Start Buffer control first.');
        return;
      }
      const started = await rollingBuffer.startCapture(captureSource);
      setIsBuffering(started);
      if (started) {
        soundEffects.playClipCapturedSound();
        showNotification('BUFFER TRAIL ACTIVE', `Maintaining last ${config.durationSeconds}s memory trail`);
      } else {
        showNotification(
          'CAPTURE FAILED',
          rollingBuffer.getLastError()
            || `Could not capture ${captureSource.sourceName || 'the selected source'}. Refresh the source and try again.`,
        );
      }
    }
  }, [isBuffering, captureSource, config.durationSeconds, showNotification]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const vidDur = videoRef.current.duration;
      if (vidDur && !isNaN(vidDur) && isFinite(vidDur) && vidDur > 0) {
        setDuration(vidDur);
        setTrimRange([0, vidDur]);
        if (activeClip && activeClip.duration !== vidDur) {
          activeClip.duration = Math.round(vidDur * 10) / 10;
        }
      } else if (activeClip?.duration) {
        setDuration(activeClip.duration);
        setTrimRange([0, activeClip.duration]);
      }
      videoRef.current.currentTime = 0;
      videoRef.current.muted = isPlaybackMuted;
      videoRef.current.volume = playbackVolume;
      setCurrentTime(0);
    }
  };

  // Play / Pause
  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn('Video play error:', err);
      });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
      if (videoRef.current) {
        setCurrentTime(videoRef.current.currentTime);
      }
    }
  }, []);

  // Seek
  const handleSeek = useCallback((time: number) => {
    if (!videoRef.current) return;
    const clampedTime = Math.max(0, Math.min(duration, time));
    videoRef.current.currentTime = clampedTime;
    setCurrentTime(clampedTime);
  }, [duration]);

  // Frame Stepping
  const handleStepFrame = useCallback((direction: 'prev' | 'next') => {
    if (!videoRef.current) return;
    videoRef.current.pause();
    setIsPlaying(false);

    const frameDelta = 1 / (activeClip?.frameRate || config.fps || 60);
    const target = direction === 'next'
      ? Math.min(duration, videoRef.current.currentTime + frameDelta)
      : Math.max(0, videoRef.current.currentTime - frameDelta);

    videoRef.current.currentTime = target;
    setCurrentTime(target);
  }, [duration, config.fps, activeClip?.frameRate]);

  // Playback Rate
  const handleChangePlaybackRate = useCallback((rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) {
      videoRef.current.playbackRate = rate;
    }
  }, []);

  const handleChangePlaybackVolume = useCallback((volume: number) => {
    const normalized = Math.max(0, Math.min(1, volume));
    setPlaybackVolume(normalized);
    if (normalized > 0) setIsPlaybackMuted(false);
    if (videoRef.current) {
      videoRef.current.volume = normalized;
      if (normalized > 0) videoRef.current.muted = false;
    }
  }, []);

  const handleTogglePlaybackMute = useCallback(() => {
    setIsPlaybackMuted(currentMuted => {
      const nextMuted = !currentMuted;
      if (videoRef.current) videoRef.current.muted = nextMuted;
      return nextMuted;
    });
  }, []);

  // Sync annotations to active clip
  const syncClipAnnotations = useCallback((newAnnotations: TacticalAnnotation[]) => {
    setAnnotations(newAnnotations);
    if (activeClipId) {
      setClips(prev => prev.map(c => c.id === activeClipId ? { ...c, annotations: newAnnotations } : c));
    }
  }, [activeClipId]);

  // Add Annotation
  const handleAddAnnotation = useCallback((newAnnotation: TacticalAnnotation) => {
    setUndoStack(prev => [...prev, annotations]);
    const updated = [...annotations, newAnnotation];
    syncClipAnnotations(updated);
  }, [annotations, syncClipAnnotations]);

  // Undo
  const handleUndo = useCallback(() => {
    if (undoStack.length > 0) {
      const previous = undoStack[undoStack.length - 1];
      syncClipAnnotations(previous);
      setUndoStack(prev => prev.slice(0, prev.length - 1));
    } else if (annotations.length > 0) {
      const updated = annotations.slice(0, annotations.length - 1);
      syncClipAnnotations(updated);
    }
  }, [undoStack, annotations, syncClipAnnotations]);

  // Clear All
  const handleClearAll = useCallback(() => {
    if (annotations.length === 0) return;
    setUndoStack(prev => [...prev, annotations]);
    syncClipAnnotations([]);
  }, [annotations, syncClipAnnotations]);

  // Save new captures as seek-safe MP4 files in the configured local vault folder.
  const autoSaveClipToDisk = async (newClip: SessionClip): Promise<boolean> => {
    if (window.electronAPI?.saveClipToVaultFolder) {
      try {
        const buffer = await newClip.blob.arrayBuffer();
        const ext = newClip.format || 'mp4';
        const safeName = `${newClip.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`;
        const savedPath = await window.electronAPI.saveClipToVaultFolder(
          new Uint8Array(buffer),
          safeName,
          config.storageDirectory
        );
        if (savedPath) {
          newClip.savedFilePath = savedPath;

          // Auto-generate and cache companion thumbnail to disk
          try {
            const video = document.createElement('video');
            video.src = newClip.videoBlobUrl;
            video.muted = true;
            await new Promise<void>((res) => {
              video.onloadeddata = () => { video.currentTime = 0.1; };
              video.onseeked = () => res();
              video.onerror = () => res();
              setTimeout(() => res(), 1200);
            });
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 180;
            const ctx = canvas.getContext('2d');
            if (ctx && video.videoWidth > 0) {
              ctx.drawImage(video, 0, 0, 320, 180);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              if (window.electronAPI?.saveClipThumbnail) {
                const thumbSaved = await window.electronAPI.saveClipThumbnail(safeName, dataUrl, config.storageDirectory);
                if (thumbSaved) {
                  newClip.thumbnailUrl = thumbSaved;
                }
              }
            }
            video.src = '';
            video.load();
          } catch (thumbErr) {
            console.warn('Could not auto-generate thumbnail for clip:', thumbErr);
          }

          return true;
        }
      } catch (e) {
        console.warn('Auto-save to vault folder failed:', e);
      }
    }
    return false;
  };

  // Clip Action: Saves directly to vault, plays audio chime, and triggers SteelSeries Moments overlay
  const handleSaveClipToVault = useCallback(async () => {
    if (metrics.state === 'inactive') {
      if (!captureSource.sourceId) {
        showNotification('SELECT CAPTURE SOURCE', 'Choose a monitor or window beside the capture controls before clipping.');
        return;
      }
      const started = await rollingBuffer.startCapture(captureSource);
      setIsBuffering(started);
      if (!started) {
        showNotification(
          'CAPTURE FAILED',
          rollingBuffer.getLastError()
            || `Could not capture ${captureSource.sourceName || 'the selected source'}. Refresh the source and try again.`,
        );
        return;
      }
      showNotification('BUFFER TRAIL STARTED', 'Capturing gameplay memory buffer...');
      setTimeout(async () => {
        const newClip = await rollingBuffer.freezeToSessionClip();
        if (newClip) {
          const saved = await autoSaveClipToDisk(newClip);
          if (!saved) {
            URL.revokeObjectURL(newClip.videoBlobUrl);
            showNotification('CLIP SAVE FAILED', 'The clip was encoded but could not be written to the vault folder.');
            return;
          }
          soundEffects.playClipCapturedSound();
          setClips(prev => [newClip, ...prev]);
          showNotification('MOMENT CAPTURED', `${newClip.name} • ${newClip.duration}s Clip`, newClip);
        } else {
          showNotification(
            'CLIP FAILED',
            rollingBuffer.getLastError() || 'The selected source did not provide enough valid video frames.',
          );
        }
      }, 1500);
      return;
    }

    const newClip = await rollingBuffer.freezeToSessionClip();
    if (newClip) {
      const saved = await autoSaveClipToDisk(newClip);
      if (!saved) {
        URL.revokeObjectURL(newClip.videoBlobUrl);
        showNotification('CLIP SAVE FAILED', 'The clip was encoded but could not be written to the vault folder.');
        return;
      }
      soundEffects.playClipCapturedSound();
      setClips(prev => [newClip, ...prev]);
      showNotification('MOMENT CAPTURED', `${newClip.name} • ${newClip.duration}s Clip`, newClip);
    } else {
      showNotification(
        'CLIP FAILED',
        rollingBuffer.getLastError() || 'No valid keyframed video was available in the rolling buffer.',
      );
    }
  }, [metrics.state, captureSource, config.storageDirectory, showNotification]);

  const handleSelectCaptureSource = useCallback((source: CaptureSourceConfig) => {
    setCaptureSource(source);
    StorageManager.saveCaptureSource(source);
  }, []);

  // Dismiss overlay (Esc)
  const handleDismiss = useCallback(() => {
    if (window.electronAPI?.hideOverlay) {
      window.electronAPI.hideOverlay();
    }
    if (currentTab === 'review') {
      setCurrentTab('gallery');
      setActiveClipId(null);
      setIsPlaying(false);
    }
  }, [currentTab]);

  // Open a specific clip for review and annotation
  const handleOpenClipInReview = useCallback((clip: SessionClip) => {
    setActiveClipId(clip.id);
    setAnnotations(clip.annotations || []);
    setUndoStack([]);
    setIsPlaying(false);
    setIsFullscreenPlayer(false);
    setTrimRange([0, clip.duration || 60]);
    setCurrentTab('review');
  }, []);

  // Redirect to review when a desktop notification is clicked
  useEffect(() => {
    if (!window.electronAPI?.onNotificationClipClicked) return;
    const unsub = window.electronAPI.onNotificationClipClicked((clipId: string) => {
      const found = clips.find(c => c.id === clipId);
      if (found) {
        handleOpenClipInReview(found);
      }
    });
    return () => {
      unsub();
    };
  }, [clips, handleOpenClipInReview]);

  // Exit review mode and return to Vault Gallery
  const handleBackToGallery = useCallback(() => {
    setCurrentTab('gallery');
    setActiveClipId(null);
    setIsPlaying(false);
    setIsFullscreenPlayer(false);
  }, []);

  // Generate and save a new trimmed clip from [start, end]
  const handleSaveTrimmedClip = useCallback(async (range: [number, number]) => {
    if (!activeClip) return;
    const [start, end] = range;
    const clipDuration = Math.max(0.1, Math.round((end - start) * 10) / 10);
    if (clipDuration < 0.2) {
      showNotification('INVALID TRIM RANGE', 'The trimmed clip must be at least 0.2 seconds long.');
      return;
    }

    setIsTrimmingSaving(true);
    setTrimProgress(5);
    setTrimStatusText(`Initializing render for ${clipDuration.toFixed(1)}s sub-clip...`);

    try {
      const baseName = activeClip.name.replace(/_Trimmed.*$/, '').replace(/_Trim_.*$/, '');
      const timeTag = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
      const newName = `${baseName}_Trim_${timeTag}`;

      const trimmedBlob = await ExportEngine.exportFlattenedVideo(
        activeClip.videoBlobUrl,
        activeClip.annotations || [],
        {
          fileName: newName,
          format: 'mp4',
          burnAnnotations: true,
          timeRange: [start, end],
        },
        (pct, status) => {
          setTrimProgress(pct);
          setTrimStatusText(status);
        }
      );

      setTrimProgress(95);
      setTrimStatusText('Writing trimmed MP4 to Vault storage folder...');

      const dateNow = new Date();
      const newClip: SessionClip = {
        id: `clip-${Date.now()}`,
        name: newName,
        timestamp: dateNow.getTime(),
        timeFormatted: dateNow.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        dateFormatted: dateNow.toLocaleDateString([], { month: 'short', day: 'numeric' }),
        videoBlobUrl: URL.createObjectURL(trimmedBlob),
        blob: trimmedBlob,
        duration: clipDuration,
        format: 'mp4',
        annotations: [],
      };

      const saved = await autoSaveClipToDisk(newClip);
      if (saved) {
        setTrimProgress(100);
        setTrimStatusText('Trim complete! Saved to Clip Vault.');
        soundEffects.playClipCapturedSound();
        setClips(prev => [newClip, ...prev]);
        showNotification('TRIMMED CLIP CREATED', `${newName} (${clipDuration}s) saved to Vault!`, newClip);
        handleOpenClipInReview(newClip);
      } else {
        showNotification('TRIM SAVE FAILED', 'The clip was rendered but could not be written to disk.');
      }
    } catch (err: any) {
      console.error('Trim export failed:', err);
      showNotification('TRIM FAILED', err.message || 'Failed to render trimmed clip segment.');
    } finally {
      setIsTrimmingSaving(false);
      setTrimProgress(0);
      setTrimStatusText('');
    }
  }, [activeClip, autoSaveClipToDisk, showNotification, soundEffects, handleOpenClipInReview]);

  // Delete Clip from both State AND Physical Disk
  const handleDeleteClip = useCallback(async (clipId: string) => {
    const clipToDelete = clips.find(c => c.id === clipId);
    if (clipToDelete?.savedFilePath && window.electronAPI?.deleteVaultFile) {
      await window.electronAPI.deleteVaultFile(clipToDelete.savedFilePath);
    }
    setClips(prev => {
      const filtered = prev.filter(c => c.id !== clipId);
      if (activeClipId === clipId) {
        handleBackToGallery();
      }
      return filtered;
    });
  }, [clips, activeClipId, handleBackToGallery]);

  // Rename Clip on both State AND Physical Disk
  const handleRenameClip = useCallback(async (clipId: string, newName: string) => {
    const targetClip = clips.find(c => c.id === clipId);
    let newPath = targetClip?.savedFilePath;
    if (targetClip?.savedFilePath && window.electronAPI?.renameVaultFile) {
      const renamed = await window.electronAPI.renameVaultFile(targetClip.savedFilePath, newName);
      if (renamed) newPath = renamed;
    }
    setClips(prev => prev.map(c => c.id === clipId ? { ...c, name: newName, savedFilePath: newPath } : c));
  }, [clips]);

  // Open Export Modal
  const handleOpenExportForClip = useCallback((clip: SessionClip) => {
    setClipToExport(clip);
    setIsExportOpen(true);
  }, []);

  // Keyboard Shortcuts: includes toggleBuffer, toggleOverlay, and playback keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      const hotkeys = config.hotkeys;

      if (matchesKeybind(e, hotkeys.toggleBuffer || 'F9')) {
        e.preventDefault();
        handleToggleBuffer();
      } else if (currentTab === 'review' && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsFullscreenPlayer(prev => !prev);
      } else if (currentTab === 'review' && e.key === 'Escape' && isFullscreenPlayer) {
        e.preventDefault();
        setIsFullscreenPlayer(false);
      } else if (matchesKeybind(e, hotkeys.dismissOverlay)) {
        e.preventDefault();
        handleDismiss();
      } else if (matchesKeybind(e, hotkeys.toggleOverlay)) {
        e.preventDefault();
        handleSaveClipToVault();
      } else if (currentTab === 'review') {
        if (matchesKeybind(e, hotkeys.playPause)) {
          e.preventDefault();
          handlePlayPause();
        } else if (matchesKeybind(e, hotkeys.stepBackward) || e.key === 'j' || e.key === 'J') {
          e.preventDefault();
          handleStepFrame('prev');
        } else if (matchesKeybind(e, hotkeys.stepForward) || e.key === 'l' || e.key === 'L') {
          e.preventDefault();
          handleStepFrame('next');
        } else if (matchesKeybind(e, hotkeys.undo)) {
          e.preventDefault();
          handleUndo();
        } else if (matchesKeybind(e, hotkeys.clearAll)) {
          e.preventDefault();
          handleClearAll();
        } else if (matchesKeybind(e, hotkeys.toggleDraw)) {
          e.preventDefault();
          setIsDrawingEnabled(prev => !prev);
        } else if (e.key === 'i' || e.key === 'I') {
          e.preventDefault();
          setTrimRange(prev => [Math.max(0, Math.min(currentTime, prev[1] - 0.2)), prev[1]]);
        } else if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          setTrimRange(prev => [prev[0], Math.max(prev[0] + 0.2, Math.min(duration, currentTime))]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [config.hotkeys, handleToggleBuffer, handleDismiss, handleSaveClipToVault, handlePlayPause, handleStepFrame, handleUndo, handleClearAll, currentTab, currentTime, duration, isFullscreenPlayer]);

  // IPC Global Hotkey Listeners (responds globally system-wide even while games are in foreground)
  useEffect(() => {
    if (window.electronAPI?.onToggleOverlay) {
      const cleanClip = window.electronAPI.onToggleOverlay(() => {
        handleSaveClipToVault();
      });
      const cleanBuffer = window.electronAPI.onToggleBuffer
        ? window.electronAPI.onToggleBuffer(() => {
            handleToggleBuffer();
          })
        : () => {};

      return () => {
        cleanClip();
        cleanBuffer();
      };
    }
  }, [handleSaveClipToVault, handleToggleBuffer]);

  // Save Settings & update vault scan if folder changed
  const handleSaveConfig = useCallback((
    newConfig: Partial<BufferConfig>,
    newAudioConfig: Partial<AudioConfig>,
    newCaptureSource: CaptureSourceConfig
  ) => {
    const mergedConfig = { ...config, ...newConfig };
    const previousAudioConfig = StorageManager.loadAudioConfig();
    const mergedAudioConfig: AudioConfig = { ...previousAudioConfig, ...newAudioConfig };
    const encodingChanged = mergedConfig.fps !== config.fps
      || mergedConfig.resolution !== config.resolution
      || mergedConfig.outputFormat !== config.outputFormat
      || mergedConfig.durationSeconds !== config.durationSeconds;
    const sourceChanged = newCaptureSource.sourceId !== captureSource.sourceId
      || newCaptureSource.mode !== captureSource.mode;
    const audioGraphChanged = mergedAudioConfig.micDeviceId !== previousAudioConfig.micDeviceId
      || mergedAudioConfig.isMicMuted !== previousAudioConfig.isMicMuted
      || mergedAudioConfig.micNoiseSuppression !== previousAudioConfig.micNoiseSuppression;
    rollingBuffer.setConfig(mergedConfig);
    setConfig(mergedConfig);
    StorageManager.saveConfig(mergedConfig);

    // Update global OS hotkeys in Electron
    if (window.electronAPI?.setGlobalShortcuts) {
      window.electronAPI.setGlobalShortcuts({
        clipShortcut: mergedConfig.hotkeys.toggleOverlay || 'Alt+Shift+T',
        bufferShortcut: mergedConfig.hotkeys.toggleBuffer || 'F9',
      });
    }

    audioMixer.setConfig(mergedAudioConfig);
    StorageManager.saveAudioConfig(mergedAudioConfig);

    if (sourceChanged) {
      setCaptureSource(newCaptureSource);
      StorageManager.saveCaptureSource(newCaptureSource);
    }
    if (isBuffering && (sourceChanged || encodingChanged || audioGraphChanged)) {
      void rollingBuffer.startCapture(newCaptureSource).then(started => {
        setIsBuffering(started);
        if (!started) {
          showNotification(
            'CAPTURE FAILED',
            rollingBuffer.getLastError() || 'The buffer could not restart with the updated capture settings.',
          );
        }
      });
    }

    if (newConfig.storageDirectory && newConfig.storageDirectory !== config.storageDirectory) {
      refreshVaultFromDisk(newConfig.storageDirectory);
    }

  }, [config, captureSource, isBuffering, showNotification, refreshVaultFromDisk]);

  return (
    <div className="relative w-screen h-screen flex flex-col bg-[#070a12] text-white overflow-hidden select-none">
      {/* 1. Dedicated Native Windows Titlebar Strip (Prevents button collisions) */}
      <header
        className="w-full h-8 bg-[#060910] border-b border-white/10 flex items-center justify-between px-3 select-none z-50 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {/* Left: App Branding */}
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <img src={appLogo} alt="Logo" className="w-4 h-4 object-contain" />
          <span className="text-[11px] font-mono font-bold text-gray-300 tracking-wider">
            EPOCH <span className="text-cyan-400">TRAIL</span>
          </span>
          {isBuffering && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-mono ml-2 px-2 py-0.5 bg-emerald-950/80 rounded border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              BUFFERING ({config.durationSeconds}s)
            </span>
          )}
        </div>

        {/* Center: Draggable Area */}
        <div className="flex-1 h-full" />

        {/* Right: Window Controls (Minimize, Maximize, Close) */}
        <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={() => window.electronAPI?.minimizeWindow?.()}
            title="Minimize Window"
            className="h-8 px-3 text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => window.electronAPI?.maximizeWindow?.()}
            title="Maximize / Restore Window"
            className="h-8 px-3 text-gray-400 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => (window.electronAPI?.closeApp ? window.electronAPI.closeApp() : handleDismiss())}
            title="Hide to System Tray"
            className="h-8 px-3 text-gray-400 hover:text-white hover:bg-red-600 flex items-center justify-center transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* In-App Notification Snackbar */}
      {/* 2. Main Workspace Layout */}
      <div className="flex-1 w-full flex overflow-hidden">
        {/* Left Navigation Sidebar (Hidden in Fullscreen Theater Mode) */}
        {!isFullscreenPlayer && (
          <LeftSidebar
            currentTab={currentTab}
            onSelectTab={setCurrentTab}
            metrics={metrics}
            isBuffering={isBuffering}
            onToggleBuffer={handleToggleBuffer}
            clipCount={clips.length}
            activeClip={activeClip}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onClose={handleDismiss}
            activeSourceLabel={metrics.activeSourceLabel}
            onQuickClip={handleSaveClipToVault}
            clipHotkey={config.hotkeys.toggleOverlay}
            bufferHotkey={config.hotkeys.toggleBuffer}
            onOpenVaultFolder={handleOpenVaultFolder}
            captureSource={captureSource}
            onSelectCaptureSource={handleSelectCaptureSource}
          />
        )}

        {/* Main Content Stage */}
        <div className="flex-1 h-full flex flex-col overflow-hidden">
          {/* Top Annotation Bar (Visible ONLY during active review of a vault recording) */}
          {currentTab === 'review' && activeClip && (
            <TopAnnotationBar
              selectedTool={selectedTool}
              onSelectTool={setSelectedTool}
              selectedColor={selectedColor}
              onSelectColor={setSelectedColor}
              strokeWidth={strokeWidth}
              onSelectStrokeWidth={setStrokeWidth}
              onUndo={handleUndo}
              onClearAll={handleClearAll}
              isDrawingEnabled={isDrawingEnabled}
              onToggleDrawing={() => setIsDrawingEnabled(prev => !prev)}
              activeClip={activeClip}
              onOpenExport={() => handleOpenExportForClip(activeClip)}
              onBackToGallery={handleBackToGallery}
              isFullscreenPlayer={isFullscreenPlayer}
              onToggleFullscreenPlayer={() => setIsFullscreenPlayer(prev => !prev)}
            />
          )}

          {/* Main Stage: DEFAULT IS VAULT GALLERY VIEW */}
          {currentTab === 'gallery' ? (
            <GalleryView
              clips={clips}
              onOpenClipInReview={handleOpenClipInReview}
              onExportClip={handleOpenExportForClip}
              onDeleteClip={handleDeleteClip}
              onRenameClip={handleRenameClip}
              isBuffering={isBuffering}
              onToggleBuffer={handleToggleBuffer}
              onClipNow={handleSaveClipToVault}
              clipHotkey={config.hotkeys.toggleOverlay}
              bufferHotkey={config.hotkeys.toggleBuffer}
              onOpenVaultFolder={handleOpenVaultFolder}
              onRefreshVault={() => refreshVaultFromDisk()}
            />
          ) : (
            /* Tactical Review Stage (Active Clip Review) */
            activeClip && (
              <main className={`relative flex-1 flex items-center justify-center overflow-hidden transition-all duration-150 ${
                isFullscreenPlayer ? 'p-0 bg-black' : 'p-3 bg-[#070a12]'
              }`}>
                <div className={`relative w-full h-full bg-black overflow-hidden flex items-center justify-center transition-all duration-150 ${
                  isFullscreenPlayer
                    ? 'max-w-none max-h-none rounded-none border-none shadow-none'
                    : 'max-w-7xl max-h-[84vh] aspect-video rounded-2xl border border-white/10 shadow-2xl'
                }`}>
                  <video
                    ref={videoRef}
                    key={activeClip.id}
                    src={activeClip.videoBlobUrl}
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => {
                      setIsPlaying(false);
                      setCurrentTime(videoRef.current?.duration || duration);
                    }}
                    onSeeked={event => setCurrentTime(event.currentTarget.currentTime)}
                    onError={event => {
                      setIsPlaying(false);
                      console.error('Video playback error:', event.currentTarget.error);
                    }}
                    playsInline
                    muted={isPlaybackMuted}
                    disablePictureInPicture
                    autoPlay={false}
                    preload="auto"
                    className="w-full h-full object-contain pointer-events-none"
                  />

                  {/* Tactical Vector Drawing Canvas Overlay */}
                  <TacticalCanvas
                    currentTime={currentTime}
                    duration={duration}
                    annotations={annotations}
                    onAddAnnotation={handleAddAnnotation}
                    selectedTool={selectedTool}
                    selectedColor={selectedColor}
                    strokeWidth={strokeWidth}
                    isDrawingEnabled={isDrawingEnabled}
                  />

                </div>
              </main>
            )
          )}

          {/* Bottom Timeline Scrubber (Visible during active Clip Review) */}
          {currentTab === 'review' && activeClip && (
            <TimelineScrubber
              currentTime={currentTime}
              duration={duration}
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              onSeek={handleSeek}
              onStepFrame={handleStepFrame}
              playbackRate={playbackRate}
              onChangePlaybackRate={handleChangePlaybackRate}
              playbackVolume={playbackVolume}
              isMuted={isPlaybackMuted}
              onChangeVolume={handleChangePlaybackVolume}
              onToggleMute={handleTogglePlaybackMute}
              annotations={annotations}
              onSelectAnnotation={(ann) => handleSeek(ann.timestamp)}
              trimRange={trimRange}
              onChangeTrimRange={setTrimRange}
              onSaveTrimmedClip={handleSaveTrimmedClip}
              isTrimmingSaving={isTrimmingSaving}
              isFullscreenPlayer={isFullscreenPlayer}
              onToggleFullscreenPlayer={() => setIsFullscreenPlayer(prev => !prev)}
            />
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        config={config}
        currentCaptureSource={captureSource}
        onSaveConfig={handleSaveConfig}
      />

      {/* Export Modal */}
      <ExportModal
        isOpen={isExportOpen}
        onClose={() => {
          setIsExportOpen(false);
          setClipToExport(null);
        }}
        videoSourceUrl={clipToExport?.videoBlobUrl || activeClip?.videoBlobUrl || null}
        annotations={clipToExport?.annotations || annotations}
        duration={clipToExport?.duration || duration}
      />

      {/* View-Blocking Trim Processing Modal */}
      {isTrimmingSaving && createPortal(
        <div className="fixed inset-0 z-[999999] bg-black/85 backdrop-blur-xl flex items-center justify-center p-4 select-none pointer-events-auto cursor-wait">
          <div className="w-full max-w-md bg-[#080d16] border border-cyan-500/50 rounded-3xl p-8 shadow-2xl flex flex-col items-center text-center gap-5 ring-1 ring-cyan-500/30">
            {/* Animated Glow Icon */}
            <div className="relative">
              <div className="w-16 h-16 rounded-2xl bg-cyan-950/80 border border-cyan-500/50 flex items-center justify-center text-cyan-400 shadow-xl shadow-cyan-500/20">
                <Scissors className="w-8 h-8 animate-pulse" />
              </div>
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-cyan-500 to-blue-500 opacity-30 blur animate-pulse pointer-events-none" />
            </div>

            {/* Title & Storage Target info */}
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-white font-mono tracking-wide flex items-center justify-center gap-2">
                <span>CREATING TRIMMED CLIP</span>
              </h3>
              <p className="text-xs text-gray-400 font-mono">
                Extracting high-fidelity video & audio frames into Vault storage
              </p>
            </div>

            {/* Progress Bar & Percentage */}
            <div className="w-full space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-400">Rendering Progress</span>
                <span className="text-cyan-400 font-bold">{trimProgress}%</span>
              </div>
              <div className="w-full h-2.5 bg-black/80 rounded-full overflow-hidden border border-white/10 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-150 shadow-sm"
                  style={{ width: `${Math.max(4, trimProgress)}%` }}
                />
              </div>
            </div>

            {/* Real-Time Status Message */}
            <div className="px-4 py-2.5 rounded-xl bg-black/60 border border-white/5 text-[11px] font-mono text-cyan-300 w-full truncate flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-cyan-400" />
              <span className="truncate">{trimStatusText || 'Encoding frames...'}</span>
            </div>

            <p className="text-[10px] text-gray-500 font-mono">
              Please wait while the trimmed clip is saved to disk. User input is temporarily locked.
            </p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
