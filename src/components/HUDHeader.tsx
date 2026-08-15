import React from 'react';
import {
  Download,
  Settings,
  X,
  Minus,
  Pencil,
  MoveUpRight,
  Circle,
  Square,
  Type,
  RotateCcw,
  Trash2,
  Layers,
  Flame,
  Radio,
  Film,
  Crosshair
} from 'lucide-react';
import { TacticalTool, AppTab } from '../types';
import { BufferMetrics } from '../services/RollingBuffer';

interface HUDHeaderProps {
  currentTab: AppTab;
  onSelectTab: (tab: AppTab) => void;
  metrics: BufferMetrics;
  selectedTool: TacticalTool;
  onSelectTool: (tool: TacticalTool) => void;
  selectedColor: string;
  onSelectColor: (color: string) => void;
  strokeWidth: number;
  onSelectStrokeWidth: (width: number) => void;
  onUndo: () => void;
  onClearAll: () => void;
  onOpenSettings: () => void;
  onOpenExport: () => void;
  onToggleFreeze: () => void;
  onClose: () => void;
  onMinimize: () => void;
  isDrawingEnabled: boolean;
  onToggleDrawing: () => void;
  clipCount: number;
  isVaultOpen: boolean;
  onToggleVault: () => void;
}

const TACTICAL_COLORS = [
  { name: 'Red', hex: '#FF3B30', bg: 'bg-[#FF3B30]' },
  { name: 'Yellow', hex: '#FFD60A', bg: 'bg-[#FFD60A]' },
  { name: 'Cyan', hex: '#00F0FF', bg: 'bg-[#00F0FF]' },
  { name: 'Green', hex: '#30D158', bg: 'bg-[#30D158]' },
  { name: 'White', hex: '#FFFFFF', bg: 'bg-white' },
];

export const HUDHeader: React.FC<HUDHeaderProps> = ({
  currentTab,
  onSelectTab,
  metrics,
  selectedTool,
  onSelectTool,
  selectedColor,
  onSelectColor,
  strokeWidth,
  onSelectStrokeWidth,
  onUndo,
  onClearAll,
  onOpenSettings,
  onOpenExport,
  onToggleFreeze,
  onClose,
  onMinimize,
  isDrawingEnabled,
  onToggleDrawing,
  clipCount,
  isVaultOpen,
  onToggleVault,
}) => {
  const isFrozen = metrics.state === 'frozen';

  return (
    <header className="w-full bg-[#0b0e14]/95 backdrop-blur-lg border-b border-white/10 px-4 py-2 flex items-center justify-between shadow-xl app-drag-region">
      {/* 1. Left: Branding & Navigation Tabs */}
      <div className="flex items-center gap-3 app-no-drag">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-red-600 to-orange-500 flex items-center justify-center shadow-lg shadow-red-600/30">
            <Flame className="w-4 h-4 text-white fill-white" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-wide text-white flex items-center gap-1.5 font-mono">
              EPOCH <span className="text-red-500">TRAIL</span>
            </h1>
            <p className="text-[10px] text-gray-400 font-mono">TACTICAL BUFFER OVERLAY</p>
          </div>
        </div>

        <div className="h-5 w-[1px] bg-white/10 mx-1" />

        {/* Tab Switcher: Review vs Gallery */}
        <div className="flex bg-black/50 border border-white/10 rounded-xl p-0.5 font-mono text-xs">
          <button
            onClick={() => onSelectTab('review')}
            className={`px-3 py-1 rounded-lg flex items-center gap-1.5 font-bold transition-all ${
              currentTab === 'review'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span>REVIEW / LIVE</span>
          </button>

          <button
            onClick={() => onSelectTab('gallery')}
            className={`px-3 py-1 rounded-lg flex items-center gap-1.5 font-bold transition-all ${
              currentTab === 'gallery'
                ? 'bg-red-600 text-white shadow-md shadow-red-600/30'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>GALLERY ({clipCount})</span>
          </button>
        </div>

        {/* Buffer Status Badge */}
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-xs font-mono">
          <span
            className={`w-2 h-2 rounded-full ${
              isFrozen
                ? 'bg-amber-400 animate-pulse'
                : metrics.state === 'buffering'
                ? 'bg-green-400 animate-ping'
                : 'bg-gray-500'
            }`}
          />
          <span className="text-gray-300 font-medium uppercase">
            {isFrozen ? 'Review Mode' : 'Live Trail'}
          </span>
          <span className="text-gray-500 font-bold">
            {metrics.currentDurationSeconds}s / {metrics.maxDurationSeconds}s
          </span>
        </div>

        {/* Freeze / Resume Toggle */}
        <button
          onClick={onToggleFreeze}
          title="Toggle Review Mode / Live Game"
          className={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md ${
            isFrozen
              ? 'bg-emerald-600/80 hover:bg-emerald-500 text-white shadow-emerald-600/20'
              : 'bg-red-600 hover:bg-red-500 text-white shadow-red-600/30'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          {isFrozen ? 'Resume Game' : 'Freeze Clip'}
        </button>
      </div>

      {/* 2. Center: Tactical Annotation Tools (Visible in Review tab) */}
      {currentTab === 'review' ? (
        <div className="flex items-center gap-2 bg-black/40 border border-white/10 rounded-xl px-2.5 py-1 app-no-drag">
          <button
            onClick={onToggleDrawing}
            title={isDrawingEnabled ? "Disable Drawing Canvas" : "Enable Drawing Canvas"}
            className={`px-2 py-1 rounded-lg text-xs font-mono font-bold flex items-center gap-1 transition-colors ${
              isDrawingEnabled
                ? 'bg-red-600 text-white shadow-sm'
                : 'bg-white/5 text-gray-400 hover:text-white'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>DRAW</span>
          </button>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Tools */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSelectTool('brush')}
              title="Freehand Brush"
              className={`p-1.5 rounded-lg transition-colors ${
                selectedTool === 'brush'
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              <Pencil className="w-4 h-4" />
            </button>

            <button
              onClick={() => onSelectTool('arrow')}
              title="Directional Arrow"
              className={`p-1.5 rounded-lg transition-colors ${
                selectedTool === 'arrow'
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              <MoveUpRight className="w-4 h-4" />
            </button>

            <button
              onClick={() => onSelectTool('halo')}
              title="Player Halo Circle"
              className={`p-1.5 rounded-lg transition-colors ${
                selectedTool === 'halo'
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              <Circle className="w-4 h-4" />
            </button>

            <button
              onClick={() => onSelectTool('rect')}
              title="Zone Rectangle"
              className={`p-1.5 rounded-lg transition-colors ${
                selectedTool === 'rect'
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              <Square className="w-4 h-4" />
            </button>

            <button
              onClick={() => onSelectTool('text')}
              title="Tactical Note Text"
              className={`p-1.5 rounded-lg transition-colors ${
                selectedTool === 'text'
                  ? 'bg-white/20 text-white border border-white/20'
                  : 'text-gray-400 hover:bg-white/10 hover:text-gray-200'
              }`}
            >
              <Type className="w-4 h-4" />
            </button>
          </div>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Color Palette */}
          <div className="flex items-center gap-1.5 px-1">
            {TACTICAL_COLORS.map(c => (
              <button
                key={c.hex}
                onClick={() => onSelectColor(c.hex)}
                title={c.name}
                className={`w-4 h-4 rounded-full transition-transform ${c.bg} ${
                  selectedColor === c.hex
                    ? 'ring-2 ring-white scale-125 shadow-glow'
                    : 'opacity-70 hover:opacity-100'
                }`}
              />
            ))}
          </div>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Stroke thickness */}
          <div className="flex items-center gap-1">
            {[2, 4, 8].map(size => (
              <button
                key={size}
                onClick={() => onSelectStrokeWidth(size)}
                title={`${size}px line thickness`}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  strokeWidth === size
                    ? 'bg-white/20 text-white font-bold'
                    : 'text-gray-400 hover:bg-white/5'
                }`}
              >
                {size}px
              </button>
            ))}
          </div>

          <div className="h-4 w-[1px] bg-white/10" />

          {/* Undo & Clear */}
          <button
            onClick={onUndo}
            title="Undo Last Sketch"
            className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClearAll}
            title="Clear All Sketches"
            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <div className="text-xs text-gray-400 font-mono">
          Viewing Session Library (Sorted: Latest First)
        </div>
      )}

      {/* 3. Right: Export, Settings & Window Controls */}
      <div className="flex items-center gap-2 app-no-drag">
        <button
          onClick={onOpenExport}
          title="Export Clip with Tactical Annotations (.mp4)"
          className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-red-600 to-amber-600 hover:from-red-500 hover:to-amber-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-red-600/25 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export MP4</span>
        </button>

        <button
          onClick={onOpenSettings}
          title="Custom Keybinds, Buffer & Audio Settings"
          className="p-2 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Settings className="w-4 h-4" />
        </button>

        <div className="h-4 w-[1px] bg-white/10" />

        <button
          onClick={onMinimize}
          title="Minimize HUD"
          className="p-2 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
        >
          <Minus className="w-4 h-4" />
        </button>

        <button
          onClick={onClose}
          title="Close / Hide Overlay"
          className="p-2 rounded-lg text-gray-400 hover:bg-red-600/80 hover:text-white transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
