import React from 'react';
import {
  Pencil,
  MoveUpRight,
  Circle,
  Square,
  Type,
  RotateCcw,
  Trash2,
  Layers,
  Download,
  ArrowLeft,
  Clock,
  Sparkles,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { TacticalTool, SessionClip } from '../types';

interface TopAnnotationBarProps {
  selectedTool: TacticalTool;
  onSelectTool: (tool: TacticalTool) => void;
  selectedColor: string;
  onSelectColor: (color: string) => void;
  strokeWidth: number;
  onSelectStrokeWidth: (width: number) => void;
  onUndo: () => void;
  onClearAll: () => void;
  isDrawingEnabled: boolean;
  onToggleDrawing: () => void;
  activeClip: SessionClip;
  onOpenExport: () => void;
  onBackToGallery: () => void;
  isFullscreenPlayer?: boolean;
  onToggleFullscreenPlayer?: () => void;
}

const COOL_TACTICAL_COLORS = [
  { name: 'Neon Cyan', hex: '#00F0FF', bg: 'bg-[#00F0FF]' },
  { name: 'Electric Blue', hex: '#3B82F6', bg: 'bg-[#3B82F6]' },
  { name: 'Emerald Green', hex: '#30D158', bg: 'bg-[#30D158]' },
  { name: 'Cyber Yellow', hex: '#FFD60A', bg: 'bg-[#FFD60A]' },
  { name: 'Crimson Red', hex: '#FF3B30', bg: 'bg-[#FF3B30]' },
  { name: 'Pure White', hex: '#FFFFFF', bg: 'bg-white' },
];

export const TopAnnotationBar: React.FC<TopAnnotationBarProps> = React.memo(({
  selectedTool,
  onSelectTool,
  selectedColor,
  onSelectColor,
  strokeWidth,
  onSelectStrokeWidth,
  onUndo,
  onClearAll,
  isDrawingEnabled,
  onToggleDrawing,
  activeClip,
  onOpenExport,
  onBackToGallery,
  isFullscreenPlayer,
  onToggleFullscreenPlayer,
}) => {
  return (
    <header className="w-full h-14 bg-[#0d121f]/98 backdrop-blur-xl border-b border-white/10 px-4 flex items-center justify-between shadow-xl select-none z-10">
      {/* 1. Left: Back to Gallery & Drawing Tools */}
      <div className="flex items-center gap-2">
        <button
          onClick={onBackToGallery}
          className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white border border-white/10 flex items-center gap-1.5 font-mono text-xs font-bold transition-all mr-1"
        >
          <ArrowLeft className="w-4 h-4 text-cyan-400" />
          <span>BACK TO VAULT</span>
        </button>

        <div className="h-5 w-[1px] bg-white/10 mx-1" />

        {/* Draw Toggle */}
        <button
          onClick={onToggleDrawing}
          title={isDrawingEnabled ? "Disable Drawing Canvas" : "Enable Drawing Canvas"}
          className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 transition-all shadow-sm ${
            isDrawingEnabled
              ? 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white shadow-cyan-500/30 ring-1 ring-cyan-400/40'
              : 'bg-white/5 text-gray-400 hover:text-white border border-white/5'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>DRAW {isDrawingEnabled ? 'ON' : 'OFF'}</span>
        </button>

        {/* Vector Tool Selector */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-xl p-1">
          <button
            onClick={() => onSelectTool('brush')}
            title="Freehand Brush Tool"
            className={`p-1.5 rounded-lg transition-colors ${
              selectedTool === 'brush'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Pencil className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSelectTool('arrow')}
            title="Tactical Directional Arrow"
            className={`p-1.5 rounded-lg transition-colors ${
              selectedTool === 'arrow'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <MoveUpRight className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSelectTool('halo')}
            title="Player Halo Focus Circle"
            className={`p-1.5 rounded-lg transition-colors ${
              selectedTool === 'halo'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Circle className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSelectTool('rect')}
            title="Tactical Zone Rectangle"
            className={`p-1.5 rounded-lg transition-colors ${
              selectedTool === 'rect'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Square className="w-4 h-4" />
          </button>

          <button
            onClick={() => onSelectTool('text')}
            title="Tactical Note Text"
            className={`p-1.5 rounded-lg transition-colors ${
              selectedTool === 'text'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
          >
            <Type className="w-4 h-4" />
          </button>
        </div>

        {/* Cool Color Palette */}
        <div className="flex items-center gap-1.5 bg-black/40 border border-white/10 rounded-xl px-2 py-1.5">
          {COOL_TACTICAL_COLORS.map(c => (
            <button
              key={c.hex}
              onClick={() => onSelectColor(c.hex)}
              title={c.name}
              className={`w-4 h-4 rounded-full transition-all ${c.bg} ${
                selectedColor === c.hex
                  ? 'ring-2 ring-white scale-125 shadow-glow shadow-cyan-400/50'
                  : 'opacity-70 hover:opacity-100'
              }`}
            />
          ))}
        </div>

        {/* Stroke Thickness */}
        <div className="flex items-center gap-1 bg-black/40 border border-white/10 rounded-xl p-1">
          {[2, 4, 8].map(size => (
            <button
              key={size}
              onClick={() => onSelectStrokeWidth(size)}
              title={`${size}px line thickness`}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition-colors ${
                strokeWidth === size
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-white/5 hover:text-white'
              }`}
            >
              {size}px
            </button>
          ))}
        </div>

        {/* Undo & Clear All */}
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            title="Undo Last Sketch (Ctrl+Z)"
            className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClearAll}
            title="Clear All Sketches (Delete)"
            className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-cyan-400 hover:bg-cyan-950 hover:text-cyan-300 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 2. Center: Active Clip Info */}
      <div className="hidden xl:flex items-center gap-2 px-3 py-1 bg-black/40 border border-white/5 rounded-full text-xs font-mono text-gray-400">
        <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        <span>Reviewing Vault Clip:</span>
        <span className="text-cyan-300 font-bold">{activeClip.name}</span>
        <span className="text-gray-600">|</span>
        <span>{activeClip.duration}s</span>
      </div>

      {/* 3. Right: Export MP4 & In-App Fullscreen Video Player Toggle */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenExport}
          title="Export this clip to .mp4 with burned sketches"
          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 shadow-lg shadow-emerald-600/25 transition-all"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export MP4</span>
        </button>

        {onToggleFullscreenPlayer && (
          <button
            onClick={onToggleFullscreenPlayer}
            title={isFullscreenPlayer ? "Exit Theater Mode (F / Esc)" : "In-App Fullscreen Theater Mode (F)"}
            className={`px-3 py-1.5 rounded-xl font-mono text-xs font-bold flex items-center gap-1.5 border transition-all ${
              isFullscreenPlayer
                ? 'bg-cyan-600/30 border-cyan-400 text-cyan-300 shadow-md shadow-cyan-500/20'
                : 'bg-white/5 hover:bg-white/15 border-white/10 text-gray-300 hover:text-white'
            }`}
          >
            {isFullscreenPlayer ? (
              <>
                <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>EXIT FULLSCREEN</span>
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>FULLSCREEN (F)</span>
              </>
            )}
          </button>
        )}
      </div>
    </header>
  );
});
