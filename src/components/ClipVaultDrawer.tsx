import React from 'react';
import { SessionClip } from '../types';
import { Film, Trash2, Download, Layers, Clock, X } from 'lucide-react';

interface ClipVaultDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  clips: SessionClip[];
  activeClipId: string | null;
  onSelectClip: (clip: SessionClip) => void;
  onDeleteClip: (clipId: string) => void;
  onExportClip: (clip: SessionClip) => void;
}

export const ClipVaultDrawer: React.FC<ClipVaultDrawerProps> = ({
  isOpen,
  onClose,
  clips,
  activeClipId,
  onSelectClip,
  onDeleteClip,
  onExportClip,
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-full bg-[#0a0f1d]/98 border-b border-white/10 backdrop-blur-md px-4 py-2.5 transition-all shadow-2xl select-none z-10">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-bold text-white font-mono tracking-wider">
            SESSION CLIP VAULT ({clips.length})
          </h3>
          <span className="text-[11px] text-gray-400 font-mono">
            — Clips recorded this session (Click to load & draw)
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {clips.length === 0 ? (
        <div className="py-2.5 text-center text-xs text-gray-500 font-mono">
          No clips in vault yet. Click "Start Rolling Buffer" and press Clip Now to capture.
        </div>
      ) : (
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          {clips.map((clip) => {
            const isActive = clip.id === activeClipId;
            return (
              <div
                key={clip.id}
                onClick={() => onSelectClip(clip)}
                className={`group relative flex-shrink-0 w-64 p-2.5 rounded-xl border transition-all cursor-pointer ${
                  isActive
                    ? 'bg-cyan-950/50 border-cyan-500 shadow-lg shadow-cyan-600/20 ring-1 ring-cyan-400/40'
                    : 'bg-black/40 border-white/10 hover:bg-white/5 hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-bold text-xs text-white truncate max-w-[130px] font-mono">
                    {clip.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportClip(clip);
                      }}
                      title="Export this clip (.mp4)"
                      className="p-1 rounded hover:bg-white/20 text-gray-400 hover:text-white transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteClip(clip.id);
                      }}
                      title="Delete clip"
                      className="p-1 rounded hover:bg-red-600/40 text-gray-400 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3 text-cyan-400" />
                    {clip.duration}s
                  </span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <Layers className="w-3 h-3" />
                    {clip.annotations.length} sketches
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
