import React from 'react';
import {
  Film,
  Crosshair,
  Settings,
  Power,
  Activity,
  FolderOpen
} from 'lucide-react';
import { AppTab, CaptureSourceConfig, SessionClip } from '../types';
import { BufferMetrics } from '../services/RollingBuffer';
import appLogo from '../assets/icon.png';
import { CaptureSourcePicker } from './CaptureSourcePicker';

interface LeftSidebarProps {
  currentTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  metrics: BufferMetrics;
  isBuffering: boolean;
  onToggleBuffer: () => void;
  clipCount: number;
  activeClip: SessionClip | null;
  onOpenSettings: () => void;
  onClose: () => void;
  activeSourceLabel: string;
  onQuickClip: () => void;
  clipHotkey: string;
  bufferHotkey?: string;
  onOpenVaultFolder?: () => void;
  captureSource: CaptureSourceConfig;
  onSelectCaptureSource: (source: CaptureSourceConfig) => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = React.memo(({
  currentTab,
  onSelectTab,
  metrics,
  isBuffering,
  onToggleBuffer,
  clipCount,
  activeClip,
  onOpenSettings,
  activeSourceLabel,
  onQuickClip,
  clipHotkey,
  bufferHotkey = 'F9',
  onOpenVaultFolder,
  captureSource,
  onSelectCaptureSource,
}) => {
  return (
    <aside className="w-64 h-full bg-[#0b0f19]/98 border-r border-white/10 flex flex-col justify-between p-4 select-none z-20 backdrop-blur-xl shadow-2xl">
      {/* 1. Top Section: Branding */}
      <div className="space-y-5">
        {/* Brand Header with Designer Icon */}
        <div className="flex items-center gap-3">
          <img
            src={appLogo}
            alt="Epoch Trail Logo"
            className="w-9 h-9 object-contain rounded-xl shadow-lg shadow-cyan-500/25 shrink-0"
          />
          <div>
            <h1 className="font-bold text-sm tracking-wider text-white font-mono flex items-center gap-1">
              EPOCH <span className="text-cyan-400">TRAIL</span>
            </h1>
            <p className="text-[10px] text-gray-400 font-mono tracking-tight">TACTICAL HUD UTILITY</p>
          </div>
        </div>

        {/* 2. Navigation Tabs (Default: Vault Gallery) */}
        <div className="space-y-1.5 font-mono text-xs">
          <div className="text-[10px] font-bold text-gray-500 uppercase px-2 mb-1 tracking-wider">
            Workspace
          </div>

          {/* Primary View: Vault Gallery */}
          <button
            onClick={() => onSelectTab('gallery')}
            className={`w-full py-2.5 px-3 rounded-xl flex items-center justify-between font-semibold transition-all ${
              currentTab === 'gallery'
                ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white shadow-lg shadow-cyan-500/20 border border-cyan-400/30'
                : 'text-gray-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Film className="w-4 h-4" />
              <span>VAULT GALLERY</span>
            </div>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                currentTab === 'gallery'
                  ? 'bg-white/20 text-white'
                  : 'bg-black/40 text-cyan-400 border border-cyan-500/30'
              }`}
            >
              {clipCount}
            </span>
          </button>

          {/* Active Review Tab (Appears when reviewing a clip) */}
          {activeClip && (
            <button
              onClick={() => onSelectTab('review')}
              className={`w-full py-2.5 px-3 rounded-xl flex items-center justify-between font-semibold transition-all ${
                currentTab === 'review'
                  ? 'bg-gradient-to-r from-cyan-600/90 to-blue-600/90 text-white shadow-lg shadow-cyan-500/20 border border-cyan-400/30'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2.5 truncate">
                <Crosshair className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="truncate">{activeClip.name}</span>
              </div>
              <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
            </button>
          )}
        </div>

        {/* 3. Rolling Buffer Controller */}
        <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-xs font-bold text-white font-mono">BUFFER TRAIL</span>
            </div>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                !isBuffering
                  ? 'bg-gray-800 text-gray-400 border border-gray-700'
                  : 'bg-emerald-950 text-emerald-300 border border-emerald-600/50'
              }`}
            >
              {!isBuffering ? 'OFF (STANDBY)' : metrics.state === 'paused' ? 'PAUSED (REVIEW)' : 'RECORDING'}
            </span>
          </div>

          <CaptureSourcePicker
            value={captureSource}
            disabled={isBuffering}
            onChange={onSelectCaptureSource}
          />

          {/* Start / Stop Buffer Button */}
          <button
            onClick={onToggleBuffer}
            title={`Toggle rolling buffer on/off (${bufferHotkey})`}
            className={`w-full py-2 px-3 rounded-xl font-mono text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-md ${
              isBuffering
                ? 'bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-500/40'
                : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-cyan-600/25'
            }`}
          >
            <Power className="w-3.5 h-3.5" />
            <span>{isBuffering ? `Stop Buffer (${bufferHotkey})` : `Start Buffer (${bufferHotkey})`}</span>
          </button>

          {/* Clip to Vault Button */}
          {isBuffering && (
            <button
              onClick={onQuickClip}
              title={`Save current rolling trail to vault (${clipHotkey})`}
              className="w-full py-2 px-3 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-mono text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 transition-all"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>CLIP TO VAULT ({clipHotkey})</span>
            </button>
          )}

          {/* Buffer Capacity & Memory */}
          <div className="space-y-1.5 pt-1 text-[11px] font-mono text-gray-400">
            <div className="flex justify-between">
              <span>Buffered:</span>
              <span className="text-white font-semibold">
                {metrics.currentDurationSeconds}s / {metrics.maxDurationSeconds}s
              </span>
            </div>
            <div className="flex justify-between">
              <span>Memory:</span>
              <span className="text-cyan-400 font-semibold">{metrics.estimatedMemoryMB} MB</span>
            </div>
            <div className="flex justify-between truncate">
              <span>Source:</span>
              <span className="text-gray-300 truncate max-w-[100px]" title={activeSourceLabel}>
                {activeSourceLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Bottom Section: Settings & Open Folder */}
      <div className="space-y-2 pt-4 border-t border-white/10">
        {onOpenVaultFolder && (
          <button
            onClick={onOpenVaultFolder}
            className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 flex items-center gap-2.5 font-mono text-xs font-semibold transition-colors"
          >
            <FolderOpen className="w-4 h-4 text-cyan-400" />
            <span>OPEN VAULT FOLDER</span>
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/5 flex items-center gap-2.5 font-mono text-xs font-semibold transition-colors"
        >
          <Settings className="w-4 h-4 text-cyan-400" />
          <span>SETTINGS & KEYBINDS</span>
        </button>

        <div className="px-2 text-[10px] font-mono text-gray-500 leading-tight space-y-0.5">
          <div>Clip Hotkey: <span className="text-cyan-400 font-semibold">{clipHotkey}</span></div>
          <div>Buffer Hotkey: <span className="text-cyan-400 font-semibold">{bufferHotkey}</span></div>
        </div>
      </div>
    </aside>
  );
});
