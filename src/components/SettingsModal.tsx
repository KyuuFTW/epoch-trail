import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Clock,
  Sliders,
  Zap,
  Mic,
  Volume2,
  VolumeX,
  Speaker,
  Headphones,
  HardDrive,
  Keyboard,
  Check,
  RotateCcw,
  Folder,
  FolderOpen,
  Tv,
  Gauge,
  Layers,
  Power,
  FileVideo
} from 'lucide-react';
import { BufferConfig, AudioConfig, AudioDevice, CaptureSourceConfig, KeybindConfig } from '../types';
import { audioMixer } from '../services/AudioMixer';
import { KeybindRecorder } from './KeybindRecorder';
import appLogo from '../assets/icon.png';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: BufferConfig;
  currentCaptureSource: CaptureSourceConfig;
  onSaveConfig: (
    newConfig: Partial<BufferConfig>,
    newAudioConfig: Partial<AudioConfig>,
    newCaptureSource: CaptureSourceConfig
  ) => void;
}

type SettingsTab = 'capture' | 'audio' | 'storage' | 'keybinds';

const BUFFER_PRESETS = [
  { label: '15s', seconds: 15, desc: 'Quick reflex clip' },
  { label: '30s', seconds: 30, desc: 'Standard skirmish' },
  { label: '60s (1m)', seconds: 60, desc: 'Default round' },
  { label: '2m', seconds: 120, desc: 'Tactical execution' },
  { label: '5m', seconds: 300, desc: 'Extended play' },
  { label: '10m', seconds: 600, desc: 'Full match engagement' },
];

const RESOLUTION_OPTIONS = [
  { id: '720p', label: '720p (HD)', desc: '1280x720 • Low VRAM' },
  { id: '1080p', label: '1080p (Full HD)', desc: '1920x1080 • Recommended' },
  { id: '1440p', label: '1440p (2K)', desc: '2560x1440 • High Fidelity' },
  { id: 'source', label: 'Native / Source', desc: 'Full Display Resolution' },
];

const FPS_OPTIONS = [
  { value: 30, label: '30 FPS', desc: 'Minimal CPU usage' },
  { value: 60, label: '60 FPS', desc: 'Standard Gaming Rate' },
  { value: 120, label: '120 FPS', desc: 'High Refresh Rate' },
];

const FORMAT_OPTIONS = [
  { id: 'mp4', label: 'MP4 (H.264 / AAC)', desc: 'Seek-safe Windows capture format' },
];

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

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  config,
  currentCaptureSource,
  onSaveConfig,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('capture');

  // Buffer Config State
  const [durationSeconds, setDurationSeconds] = useState(config.durationSeconds);
  const [fps, setFps] = useState(config.fps || 60);
  const [resolution, setResolution] = useState(config.resolution || '1080p');
  const [outputFormat, setOutputFormat] = useState<'mp4' | 'webm'>(config.outputFormat || 'mp4');
  const [storageDirectory, setStorageDirectory] = useState(config.storageDirectory || 'EpochClips');
  const [hotkeys, setHotkeys] = useState<KeybindConfig>(config.hotkeys || DEFAULT_KEYBINDS);

  // Audio Config State
  const [audioConfig, setAudioConfig] = useState<AudioConfig>(audioMixer.getConfig());
  const [availableMics, setAvailableMics] = useState<AudioDevice[]>([]);
  const [availableOutputs, setAvailableOutputs] = useState<AudioDevice[]>([]);
  const [micData, setMicData] = useState<{ level: number; isGateOpen: boolean; db: number }>({
    level: 0,
    isGateOpen: true,
    db: -80,
  });

  useEffect(() => {
    setDurationSeconds(config.durationSeconds);
    setFps(config.fps || 60);
    setResolution(config.resolution || '1080p');
    setOutputFormat(config.outputFormat || 'mp4');
    setStorageDirectory(config.storageDirectory || 'EpochClips');
    setHotkeys(config.hotkeys || DEFAULT_KEYBINDS);
    setAudioConfig(audioMixer.getConfig());
  }, [config, currentCaptureSource, isOpen]);

  // Load Sources & Audio Devices & Default Path
  useEffect(() => {
    if (isOpen) {
      if (window.electronAPI?.getDefaultStoragePath && (!storageDirectory || storageDirectory === 'EpochClips')) {
        window.electronAPI.getDefaultStoragePath().then(p => {
          if (p) setStorageDirectory(p);
        });
      }
      audioMixer.getAvailableMicrophones().then(mics => {
        setAvailableMics(mics);
      });
      audioMixer.getAvailableAudioOutputs().then(outputs => {
        setAvailableOutputs(outputs);
      });

      const unsubLevel = audioMixer.onMicLevelChange(data => {
        setMicData(data);
      });

      return () => unsubLevel();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleBrowseFolder = async () => {
    if (window.electronAPI?.selectDirectory) {
      const selected = await window.electronAPI.selectDirectory();
      if (selected) {
        setStorageDirectory(selected);
      }
    }
  };

  const handleOpenFolder = () => {
    if (window.electronAPI?.openPath) {
      window.electronAPI.openPath(storageDirectory);
    }
  };

  const handleUpdateKeybind = (key: keyof KeybindConfig, value: string) => {
    setHotkeys(prev => ({ ...prev, [key]: value }));
  };

  const handleResetKeybinds = () => {
    setHotkeys(DEFAULT_KEYBINDS);
  };

  const handleSave = () => {
    if (window.electronAPI?.setGlobalShortcuts) {
      window.electronAPI.setGlobalShortcuts({
        clipShortcut: hotkeys.toggleOverlay,
        bufferShortcut: hotkeys.toggleBuffer,
      });
    }

    onSaveConfig(
      { durationSeconds, fps, resolution: resolution as any, outputFormat, hotkeys, storageDirectory },
      audioConfig,
      currentCaptureSource
    );
    onClose();
  };

  const estimatedRamMB = Math.round((durationSeconds * 0.75) * (fps / 60));

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-[#0c121e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#080d16]">
          <div className="flex items-center gap-2.5">
            <img
              src={appLogo}
              alt="Epoch Logo"
              className="w-6 h-6 object-contain"
            />
            <h2 className="font-bold text-sm text-white tracking-wide font-mono">
              EPOCH TRAIL CONFIGURATION
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Structure: Left Section Nav + Right Content Pane */}
        <div className="flex-1 flex overflow-hidden">
          {/* Section Navbar */}
          <nav aria-label="Settings sections" className="w-56 bg-[#080c14] border-r border-white/10 p-3 space-y-1 font-mono text-xs select-none">
            <div className="text-[10px] font-bold text-gray-500 uppercase px-2 mb-2 tracking-wider">
              Settings Sections
            </div>

            <button
              onClick={() => setActiveTab('capture')}
              className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-2.5 font-semibold transition-all ${
                activeTab === 'capture'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Tv className="w-4 h-4" />
              <span>Capture & Quality</span>
            </button>

            <button
              onClick={() => setActiveTab('audio')}
              className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-2.5 font-semibold transition-all ${
                activeTab === 'audio'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>Audio Mixing</span>
            </button>

            <button
              onClick={() => setActiveTab('storage')}
              className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-2.5 font-semibold transition-all ${
                activeTab === 'storage'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Folder className="w-4 h-4" />
              <span>Vault Storage</span>
            </button>

            <button
              onClick={() => setActiveTab('keybinds')}
              className={`w-full py-2.5 px-3 rounded-xl flex items-center gap-2.5 font-semibold transition-all ${
                activeTab === 'keybinds'
                  ? 'bg-cyan-600 text-white shadow-md shadow-cyan-600/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <Keyboard className="w-4 h-4" />
              <span>Custom Keybinds</span>
            </button>
          </nav>

          {/* Tab Content Pane */}
          <div className="flex-1 p-6 overflow-y-auto space-y-6 text-sm text-gray-200">
            {/* 1. CAPTURE & QUALITY */}
            {activeTab === 'capture' && (
              <div className="space-y-6 animate-fadeIn">
                {/* Output Format Selector */}
                <div className="space-y-2">
                  <label className="font-semibold text-white flex items-center gap-2 font-mono text-xs">
                    <FileVideo className="w-4 h-4 text-cyan-400" />
                    Vault Clip Format
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FORMAT_OPTIONS.map(fmt => (
                      <button
                        key={fmt.id}
                        onClick={() => setOutputFormat(fmt.id as any)}
                        className={`p-3 rounded-xl text-left border transition-all font-mono ${
                          outputFormat === fmt.id
                            ? 'bg-cyan-950/80 border-cyan-400 ring-1 ring-cyan-400 text-white shadow-md shadow-cyan-600/20'
                            : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-cyan-300">{fmt.label}</span>
                          {outputFormat === fmt.id && <Check className="w-4 h-4 text-cyan-400" />}
                        </div>
                        <p className="text-[11px] text-gray-400 mt-1">{fmt.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resolution & FPS */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Resolution */}
                  <div className="space-y-2">
                    <label className="font-semibold text-white flex items-center gap-2 font-mono text-xs">
                      <Tv className="w-4 h-4 text-cyan-400" />
                      Buffer Resolution
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {RESOLUTION_OPTIONS.map(res => (
                        <button
                          key={res.id}
                          onClick={() => setResolution(res.id as any)}
                          className={`p-2 rounded-xl text-left border transition-all font-mono ${
                            resolution === res.id
                              ? 'bg-cyan-950/70 border-cyan-500 ring-1 ring-cyan-400 text-white'
                              : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5 hover:text-white'
                          }`}
                        >
                          <div className="text-xs font-bold">{res.label}</div>
                          <div className="text-[10px] text-gray-500 mt-0.5">{res.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* FPS */}
                  <div className="space-y-2">
                    <label className="font-semibold text-white flex items-center gap-2 font-mono text-xs">
                      <Gauge className="w-4 h-4 text-cyan-400" />
                      Frame Rate (FPS)
                    </label>
                    <div className="space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        {FPS_OPTIONS.map(f => (
                          <button
                            key={f.value}
                            onClick={() => setFps(f.value)}
                            className={`p-2 rounded-xl text-center border transition-all font-mono ${
                              fps === f.value
                                ? 'bg-cyan-600 text-white font-bold border-cyan-400 shadow-md shadow-cyan-600/30'
                                : 'bg-black/40 border-white/10 text-gray-400 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            <div className="text-xs font-bold">{f.label}</div>
                            <div className="text-[9px] text-gray-400 mt-0.5">{f.value === 60 ? 'Standard' : f.value === 120 ? 'High Perf' : 'Low CPU'}</div>
                          </button>
                        ))}
                      </div>
                      <div className="text-[11px] font-mono text-gray-400 p-2 bg-black/30 rounded-lg border border-white/5">
                        Selected: <strong className="text-cyan-400">{fps} FPS</strong> (~{(1000 / fps).toFixed(1)}ms per frame step).
                      </div>
                    </div>
                  </div>
                </div>

                {/* Buffer Duration Presets & Slider */}
                <div className="space-y-3 pt-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-cyan-400" />
                      <label className="font-semibold text-white font-mono text-xs">
                        Buffer Trail Duration
                      </label>
                    </div>
                    <span className="font-mono text-cyan-300 font-bold bg-cyan-950/60 px-2 py-0.5 rounded border border-cyan-800/60 text-xs">
                      {durationSeconds >= 60
                        ? `${Math.floor(durationSeconds / 60)}m ${durationSeconds % 60 ? `${durationSeconds % 60}s` : ''}`
                        : `${durationSeconds} seconds`}
                    </span>
                  </div>

                  <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                    {BUFFER_PRESETS.map(preset => (
                      <button
                        key={preset.seconds}
                        onClick={() => setDurationSeconds(preset.seconds)}
                        className={`py-2 px-1 rounded-lg text-xs font-mono font-medium flex flex-col items-center justify-center transition-all ${
                          durationSeconds === preset.seconds
                            ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white font-bold shadow-md shadow-cyan-600/30 ring-1 ring-white/30'
                            : 'bg-white/5 text-gray-300 hover:bg-white/10 hover:text-white border border-white/5'
                        }`}
                      >
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>

                  <input
                    type="range"
                    min="10"
                    max="600"
                    step="5"
                    value={durationSeconds}
                    onChange={e => setDurationSeconds(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-[10px] text-gray-500 font-mono">
                    <span>10s</span>
                    <span>60s (1m)</span>
                    <span>300s (5m)</span>
                    <span>600s (10m Max)</span>
                  </div>

                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/5 text-xs text-gray-300">
                    <HardDrive className="w-4 h-4 text-cyan-400 shrink-0" />
                    <span>
                      Estimated Memory: <strong className="text-white">~{estimatedRamMB} MB RAM</strong> (Circular VRAM/RAM buffer, zero SSD wear).
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 2. AUDIO MIXING & DEVICE SELECTION */}
            {activeTab === 'audio' && (
              <div className="space-y-5 animate-fadeIn font-mono">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-white flex items-center gap-2 text-xs">
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                    Dual Audio Capture Engine (System & Game + Microphone)
                  </label>
                  <span className="text-[11px] text-cyan-400">
                    Unified Multi-Track Audio Mixing for Clips
                  </span>
                </div>

                {/* Master Audio Track Toggles */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* System Audio Toggle */}
                  <button
                    onClick={() => setAudioConfig(prev => ({ ...prev, isGameAudioMuted: !prev.isGameAudioMuted }))}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      !audioConfig.isGameAudioMuted
                        ? 'bg-cyan-950/70 border-cyan-500/60 text-white'
                        : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {!audioConfig.isGameAudioMuted ? (
                          <Volume2 className="w-4 h-4 text-cyan-400" />
                        ) : (
                          <VolumeX className="w-4 h-4 text-gray-400" />
                        )}
                        <span className="text-xs font-bold">System & Game Audio</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        !audioConfig.isGameAudioMuted ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-gray-400'
                      }`}>
                        {!audioConfig.isGameAudioMuted ? 'ACTIVE' : 'MUTED'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {!audioConfig.isGameAudioMuted
                        ? 'Captures game sound, Discord, Chrome, and Windows audio.'
                        : 'System audio is excluded from recorded clips.'}
                    </p>
                  </button>

                  {/* Microphone Toggle */}
                  <button
                    onClick={() => setAudioConfig(prev => ({ ...prev, isMicMuted: !prev.isMicMuted }))}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      !audioConfig.isMicMuted
                        ? 'bg-emerald-950/70 border-emerald-500/60 text-white'
                        : 'bg-black/40 border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Mic className={`w-4 h-4 ${!audioConfig.isMicMuted ? 'text-emerald-400' : 'text-gray-400'}`} />
                        <span className="text-xs font-bold">Record Microphone</span>
                      </div>
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        !audioConfig.isMicMuted ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-400'
                      }`}>
                        {!audioConfig.isMicMuted ? 'ACTIVE' : 'MUTED'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1">
                      {!audioConfig.isMicMuted
                        ? 'Microphone is mixed over gameplay in recorded clips.'
                        : 'Microphone is muted during recording.'}
                    </p>
                  </button>
                </div>

                {/* Device Pickers: Output / Loopback Device + Microphone Input Device */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* System Audio Device / Source */}
                  <div className="space-y-2">
                    <label className="text-xs text-gray-400 flex items-center gap-1.5">
                      <Speaker className="w-3.5 h-3.5 text-cyan-400" />
                      AUDIO PLAYBACK / OUTPUT SELECTION
                    </label>
                    <select
                      value={audioConfig.playbackDeviceId || 'default'}
                      onChange={e => {
                        const newId = e.target.value;
                        setAudioConfig(prev => ({ ...prev, playbackDeviceId: newId }));
                      }}
                      disabled={audioConfig.isGameAudioMuted}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-40"
                    >
                      {availableOutputs.map(output => (
                        <option key={output.deviceId} value={output.deviceId}>
                          {output.label}
                        </option>
                      ))}
                    </select>

                    <div className="p-2.5 rounded-lg bg-black/30 border border-white/5 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span>CAPTURE METHOD</span>
                        <span className="text-cyan-400 font-bold">Windows Loopback WASAPI</span>
                      </div>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        Captures desktop stream audio routed through your default Windows playback device with zero latency.
                      </p>
                    </div>
                  </div>

                  {/* Microphone Input Device & Anti-Static Controls */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs text-gray-400 flex items-center gap-1.5">
                        <Mic className="w-3.5 h-3.5 text-emerald-400" />
                        MICROPHONE INPUT DEVICE
                      </label>
                      <span className="text-[10px] text-emerald-400 font-bold">
                        Studio DSP Active
                      </span>
                    </div>

                    <select
                      value={audioConfig.micDeviceId}
                      onChange={e => {
                        const newId = e.target.value;
                        setAudioConfig(prev => ({ ...prev, micDeviceId: newId }));
                      }}
                      disabled={audioConfig.isMicMuted}
                      className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500 disabled:opacity-40"
                    >
                      {availableMics.map(mic => (
                        <option key={mic.deviceId} value={mic.deviceId}>
                          {mic.label}
                        </option>
                      ))}
                    </select>

                    {/* Live Mic Activity & Noise Gate Threshold Meter */}
                    <div className="space-y-1.5 p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <div className="flex items-center justify-between text-[10px] text-gray-400">
                        <span className="flex items-center gap-1.5">
                          <span>MIC LEVEL:</span>
                          <strong className="text-white font-mono">{micData.db} dB</strong>
                        </span>
                        <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold font-mono ${
                          micData.isGateOpen
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-white/10 text-gray-400'
                        }`}>
                          {micData.isGateOpen ? 'GATE OPEN (VOICE)' : 'GATE CLOSED (SILENCE / NO HISS)'}
                        </span>
                      </div>

                      {/* Visual Meter with Threshold Mark */}
                      <div className="relative w-full h-2.5 bg-black/70 rounded-full overflow-hidden border border-white/10">
                        <div
                          className={`h-full transition-all duration-75 ${
                            micData.isGateOpen ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gray-600'
                          }`}
                          style={{ width: `${micData.level * 100}%` }}
                        />
                        {/* Threshold Line */}
                        {audioConfig.noiseGateEnabled && (
                          <div
                            className="absolute top-0 bottom-0 w-0.5 bg-amber-400 shadow-[0_0_4px_#fbbf24]"
                            title={`Gate Threshold: ${audioConfig.noiseGateThresholdDb ?? -42} dB`}
                            style={{
                              left: `${Math.max(5, Math.min(95, (((audioConfig.noiseGateThresholdDb ?? -42) + 60) / 60) * 100))}%`,
                            }}
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Microphone Anti-Static & Noise Elimination Controls */}
                <div className="p-3.5 rounded-2xl bg-[#090e18] border border-cyan-500/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-cyan-400" />
                      <span className="text-xs font-bold text-white">Microphone Static & Noise Elimination DSP</span>
                    </div>
                    <span className="text-[10px] text-cyan-400 font-mono">Zero Static / Studio Clean</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Anti-Static 80Hz & Hum Filter Toggle */}
                    <button
                      onClick={() => setAudioConfig(prev => ({
                        ...prev,
                        antiStaticFilter: !prev.antiStaticFilter,
                      }))}
                      disabled={audioConfig.isMicMuted}
                      className={`p-2.5 rounded-xl border text-left transition-colors flex items-center justify-between ${
                        audioConfig.antiStaticFilter
                          ? 'bg-cyan-950/60 border-cyan-500/50 text-white'
                          : 'bg-black/40 border-white/10 text-gray-400'
                      } disabled:opacity-40`}
                    >
                      <div>
                        <div className="text-xs font-bold">Anti-Static & Hum Filter</div>
                        <div className="text-[9px] text-gray-400 mt-0.5">80Hz ground-loop cut + high-shelf hiss removal</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        audioConfig.antiStaticFilter ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-gray-400'
                      }`}>
                        {audioConfig.antiStaticFilter ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* AI Noise Cancellation Toggle */}
                    <button
                      onClick={() => setAudioConfig(prev => ({
                        ...prev,
                        micNoiseSuppression: !prev.micNoiseSuppression,
                      }))}
                      disabled={audioConfig.isMicMuted}
                      className={`p-2.5 rounded-xl border text-left transition-colors flex items-center justify-between ${
                        audioConfig.micNoiseSuppression
                          ? 'bg-emerald-950/60 border-emerald-500/50 text-white'
                          : 'bg-black/40 border-white/10 text-gray-400'
                      } disabled:opacity-40`}
                    >
                      <div>
                        <div className="text-xs font-bold">AI Noise Cancellation</div>
                        <div className="text-[9px] text-gray-400 mt-0.5">Filters out background fans, AC, & typing</div>
                      </div>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        audioConfig.micNoiseSuppression ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/10 text-gray-400'
                      }`}>
                        {audioConfig.micNoiseSuppression ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>

                  {/* Adaptive Noise Gate Slider */}
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">Adaptive Noise Gate</span>
                        <button
                          onClick={() => setAudioConfig(prev => ({
                            ...prev,
                            noiseGateEnabled: !prev.noiseGateEnabled,
                          }))}
                          className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            audioConfig.noiseGateEnabled ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-gray-400'
                          }`}
                        >
                          {audioConfig.noiseGateEnabled ? 'ENABLED' : 'DISABLED'}
                        </button>
                      </div>
                      <span className="font-mono text-cyan-400 font-bold">
                        {audioConfig.noiseGateThresholdDb ?? -42} dB Threshold
                      </span>
                    </div>

                    <input
                      type="range"
                      min="-60"
                      max="-20"
                      step="1"
                      value={audioConfig.noiseGateThresholdDb ?? -42}
                      disabled={!audioConfig.noiseGateEnabled || audioConfig.isMicMuted}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setAudioConfig(prev => ({ ...prev, noiseGateThresholdDb: val }));
                      }}
                      className="w-full disabled:opacity-40"
                    />

                    <p className="text-[9px] text-gray-500 leading-relaxed">
                      Mutes static room noise and background hiss completely when you are not speaking. Adjust the slider so the amber threshold mark sits just above your room noise floor.
                    </p>
                  </div>
                </div>

                {/* Volume Sliders */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  {/* System Audio Volume */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span className="flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-cyan-400" />
                        System Audio Volume
                      </span>
                      <span className="font-bold text-cyan-300">
                        {audioConfig.isGameAudioMuted ? '0% (Muted)' : `${Math.round(audioConfig.gameVolume * 100)}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={audioConfig.isGameAudioMuted ? 0 : audioConfig.gameVolume}
                      disabled={audioConfig.isGameAudioMuted}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setAudioConfig(prev => ({ ...prev, gameVolume: val }));
                      }}
                      className="w-full disabled:opacity-40"
                    />
                  </div>

                  {/* Microphone Volume */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs text-gray-300">
                      <span className="flex items-center gap-1.5">
                        <Mic className="w-3.5 h-3.5 text-emerald-400" />
                        Microphone Mix Volume
                      </span>
                      <span className="font-bold text-emerald-300">
                        {audioConfig.isMicMuted ? '0% (Muted)' : `${Math.round(audioConfig.micVolume * 100)}%`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={audioConfig.isMicMuted ? 0 : audioConfig.micVolume}
                      disabled={audioConfig.isMicMuted}
                      onChange={e => {
                        const val = Number(e.target.value);
                        setAudioConfig(prev => ({ ...prev, micVolume: val }));
                      }}
                      className="w-full disabled:opacity-40"
                    />
                  </div>
                </div>

                {/* Audio Quality & Bitrate Settings */}
                <div className="pt-3 border-t border-white/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-gray-300 flex items-center gap-1.5 font-bold">
                      <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                      AUDIO RECORDING QUALITY & BITRATE
                    </label>
                    <span className="text-[10px] text-gray-500">
                      Configures WebCodecs AAC/Opus Audio Stream
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Audio Bitrate Selector */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Audio Encoding Bitrate</span>
                        <span className="text-cyan-400 font-bold">
                          {Math.round((audioConfig.audioBitrate || 256_000) / 1000)} kbps
                        </span>
                      </div>
                      <select
                        value={audioConfig.audioBitrate || 256_000}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setAudioConfig(prev => ({ ...prev, audioBitrate: val }));
                        }}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                      >
                        <option value={128000}>128 kbps (Standard Quality)</option>
                        <option value={192000}>192 kbps (High Quality)</option>
                        <option value={256000}>256 kbps (HQ Studio Broadcast - Recommended)</option>
                        <option value={320000}>320 kbps (Studio Master Quality)</option>
                        <option value={384000}>384 kbps (Ultra Lossless AAC Fidelity)</option>
                      </select>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        Higher bitrates preserve crisp transients, highs, and bass in gameplay clips.
                      </p>
                    </div>

                    {/* Audio Sample Rate Selector */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Audio Sample Rate</span>
                        <span className="text-cyan-400 font-bold">
                          {((audioConfig.audioSampleRate || 48_000) / 1000).toFixed(1)} kHz
                        </span>
                      </div>
                      <select
                        value={audioConfig.audioSampleRate || 48_000}
                        onChange={e => {
                          const val = Number(e.target.value);
                          setAudioConfig(prev => ({ ...prev, audioSampleRate: val }));
                        }}
                        className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-cyan-500"
                      >
                        <option value={44100}>44.1 kHz (CD Audio Standard)</option>
                        <option value={48000}>48.0 kHz (Broadcast Standard - Recommended for Windows)</option>
                        <option value={96000}>96.0 kHz (High-Resolution QA Studio)</option>
                      </select>
                      <p className="text-[9px] text-gray-500 leading-relaxed">
                        Matches your Windows sound card hardware sample rate for zero resampling distortion.
                      </p>
                    </div>
                  </div>

                  {/* Audio Processing & Enhancement Bypass Toggle */}
                  <div className="p-3.5 rounded-xl bg-black/40 border border-white/10 flex items-start justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Zap className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-xs font-bold text-white">Bypass Voice DSP / Studio Raw Audio Mode</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                          audioConfig.bypassAudioFilters ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/10 text-gray-400'
                        }`}>
                          {audioConfig.bypassAudioFilters ? 'ENABLED (RAW STUDIO)' : 'DISABLED'}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 leading-relaxed">
                        Disables aggressive Chromium speech gating, auto-gain compression, and frequency cutoffs so game audio and studio microphones retain 100% of their original frequency spectrum and dynamic range.
                      </p>
                    </div>

                    <button
                      onClick={() => setAudioConfig(prev => ({ ...prev, bypassAudioFilters: !prev.bypassAudioFilters }))}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-colors shrink-0 ${
                        audioConfig.bypassAudioFilters
                          ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-md shadow-cyan-600/30'
                          : 'bg-white/10 hover:bg-white/20 text-gray-300'
                      }`}
                    >
                      {audioConfig.bypassAudioFilters ? 'RAW ON' : 'FILTER ON'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 3. VAULT STORAGE */}
            {activeTab === 'storage' && (
              <div className="space-y-5 animate-fadeIn">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="font-semibold text-white flex items-center gap-2 font-mono">
                      <Folder className="w-4 h-4 text-cyan-400" />
                      Clip Vault Storage Directory
                    </label>
                    <button
                      onClick={handleOpenFolder}
                      className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono hover:underline"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Open in Explorer</span>
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">
                    The local storage folder where all recorded clips, sketches, and exported MP4 files are saved.
                  </p>
                </div>

                <div className="flex items-center gap-2 bg-black/50 border border-white/10 rounded-xl p-2.5">
                  <input
                    type="text"
                    value={storageDirectory}
                    onChange={e => setStorageDirectory(e.target.value)}
                    placeholder="e.g. C:\Users\Username\Videos\EpochClips"
                    className="flex-1 bg-transparent text-xs font-mono text-white outline-none px-2"
                  />
                  <button
                    onClick={handleBrowseFolder}
                    className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-bold transition-colors shadow-sm"
                  >
                    Browse Folder...
                  </button>
                </div>

                <div className="p-3 bg-white/5 border border-white/5 rounded-xl text-xs text-gray-400 font-mono space-y-1">
                  <div>• Default Directory: <span className="text-gray-300">Videos/EpochClips</span></div>
                  <div>• Every clip saved to vault creates an archive file in this directory.</div>
                </div>
              </div>
            )}

            {/* 4. CUSTOM KEYBINDS */}
            {activeTab === 'keybinds' && (
              <div className="space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-white flex items-center gap-2 font-mono">
                    <Keyboard className="w-4 h-4 text-cyan-400" />
                    Custom Keybinds & Shortcuts (Editable)
                  </label>
                  <button
                    onClick={handleResetKeybinds}
                    className="text-xs text-gray-400 hover:text-cyan-400 flex items-center gap-1 font-mono hover:underline"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset All to Defaults</span>
                  </button>
                </div>
                <p className="text-xs text-gray-400">
                  Click any keybind button to press keys interactively, or click the pencil icon to type shortcut text directly.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <KeybindRecorder
                    label="Start / Stop Buffer Trail"
                    description="Toggle recording buffer on/off"
                    value={hotkeys.toggleBuffer}
                    onChange={v => handleUpdateKeybind('toggleBuffer', v)}
                  />
                  <KeybindRecorder
                    label="Clip to Vault"
                    description="Capture rolling buffer snapshot"
                    value={hotkeys.toggleOverlay}
                    onChange={v => handleUpdateKeybind('toggleOverlay', v)}
                  />
                  <KeybindRecorder
                    label="Dismiss / Close HUD"
                    description="Hides tactical HUD overlay"
                    value={hotkeys.dismissOverlay}
                    onChange={v => handleUpdateKeybind('dismissOverlay', v)}
                  />
                  <KeybindRecorder
                    label="Play / Pause Video"
                    description="Toggle media playback in review"
                    value={hotkeys.playPause}
                    onChange={v => handleUpdateKeybind('playPause', v)}
                  />
                  <KeybindRecorder
                    label="Step 1 Frame Backward"
                    description="Precision frame step"
                    value={hotkeys.stepBackward}
                    onChange={v => handleUpdateKeybind('stepBackward', v)}
                  />
                  <KeybindRecorder
                    label="Step 1 Frame Forward"
                    description="Precision frame step"
                    value={hotkeys.stepForward}
                    onChange={v => handleUpdateKeybind('stepForward', v)}
                  />
                  <KeybindRecorder
                    label="Undo Last Sketch"
                    description="Reverts latest stroke"
                    value={hotkeys.undo}
                    onChange={v => handleUpdateKeybind('undo', v)}
                  />
                  <KeybindRecorder
                    label="Clear All Sketches"
                    description="Wipes current annotations"
                    value={hotkeys.clearAll}
                    onChange={v => handleUpdateKeybind('clearAll', v)}
                  />
                  <KeybindRecorder
                    label="Toggle Drawing Mode"
                    description="Enable/disable draw layer"
                    value={hotkeys.toggleDraw}
                    onChange={v => handleUpdateKeybind('toggleDraw', v)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3 bg-[#080d16]">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-600/30 transition-all font-mono"
          >
            Apply & Save Configuration
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
