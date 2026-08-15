import React, { useState, useEffect } from 'react';
import { SessionClip } from '../types';
import {
  Play,
  Download,
  Trash2,
  Edit2,
  Check,
  Clock,
  Layers,
  Search,
  Calendar,
  Sparkles,
  ArrowUpDown,
  FileVideo,
  Power,
  Zap,
  Crosshair,
  FolderOpen,
  RotateCcw
} from 'lucide-react';
import appLogo from '../assets/icon.png';

const ClipCardThumbnail: React.FC<{ clip: SessionClip }> = ({ clip }) => {
  const [thumbUrl, setThumbUrl] = useState<string | undefined>(clip.thumbnailUrl);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    if (clip.thumbnailUrl) {
      setThumbUrl(clip.thumbnailUrl);
      return;
    }

    if (!clip.videoBlobUrl || isGenerating) return;

    let isMounted = true;
    setIsGenerating(true);

    const video = document.createElement('video');
    video.src = clip.videoBlobUrl;
    video.muted = true;
    video.preload = 'metadata';
    video.currentTime = 0.5;

    const handleSeeked = async () => {
      try {
        if (!isMounted) return;
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, 320, 180);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          setThumbUrl(dataUrl);
          clip.thumbnailUrl = dataUrl;

          if (window.electronAPI?.saveClipThumbnail) {
            const fileName = clip.savedFilePath ? clip.savedFilePath.split(/[/\\]/).pop()! : `${clip.name}.mp4`;
            const savedPath = await window.electronAPI.saveClipThumbnail(fileName, dataUrl);
            if (savedPath && isMounted) {
              setThumbUrl(savedPath);
              clip.thumbnailUrl = savedPath;
            }
          }
        }
      } catch (err) {
        console.warn('Could not generate thumbnail for clip:', err);
      } finally {
        video.src = '';
        video.load();
      }
    };

    video.onseeked = handleSeeked;
    video.onerror = () => {
      video.src = '';
      video.load();
    };

    return () => {
      isMounted = false;
      video.onseeked = null;
      video.onerror = null;
      video.src = '';
      video.load();
    };
  }, [clip.id, clip.thumbnailUrl, clip.videoBlobUrl]);

  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt={clip.name}
        loading="lazy"
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 pointer-events-none"
      />
    );
  }

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-black/80 to-[#0c121e] text-gray-600 group-hover:text-cyan-400 transition-colors">
      <FileVideo className="w-8 h-8 opacity-40 mb-1" />
      <span className="text-[10px] font-mono opacity-50">Loading Preview...</span>
    </div>
  );
};

interface GalleryViewProps {
  clips: SessionClip[];
  onOpenClipInReview: (clip: SessionClip) => void;
  onExportClip: (clip: SessionClip) => void;
  onDeleteClip: (clipId: string) => void;
  onRenameClip: (clipId: string, newName: string) => void;
  isBuffering: boolean;
  onToggleBuffer: () => void;
  onClipNow: () => void;
  clipHotkey: string;
  bufferHotkey?: string;
  onOpenVaultFolder: () => void;
  onRefreshVault?: () => void;
}

export const GalleryView: React.FC<GalleryViewProps> = React.memo(({
  clips,
  onOpenClipInReview,
  onExportClip,
  onDeleteClip,
  onRenameClip,
  isBuffering,
  onToggleBuffer,
  onClipNow,
  clipHotkey,
  bufferHotkey = 'F9',
  onOpenVaultFolder,
  onRefreshVault,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');

  // Order strictly by date taken, latest first (descending timestamp)
  const sortedClips = [...clips].sort((a, b) => b.timestamp - a.timestamp);

  const filteredClips = sortedClips.filter(clip =>
    clip.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    clip.timeFormatted.includes(searchQuery) ||
    clip.dateFormatted.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalDuration = clips.reduce((acc, c) => acc + c.duration, 0);
  const totalAnnotations = clips.reduce((acc, c) => acc + c.annotations.length, 0);

  const handleStartRename = (clip: SessionClip, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingClipId(clip.id);
    setEditNameValue(clip.name);
  };

  const handleSaveRename = (clipId: string, e: React.FormEvent | React.MouseEvent) => {
    e.stopPropagation();
    if (editNameValue.trim()) {
      onRenameClip(clipId, editNameValue.trim());
    }
    setEditingClipId(null);
  };

  return (
    <div className="flex-1 h-full flex flex-col p-6 overflow-y-auto bg-[#070a12] select-none">
      {/* 1. Header & Live Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <div className="flex items-center gap-3">
            <img
              src={appLogo}
              alt="Epoch Trail Logo"
              className="w-9 h-9 object-contain rounded-xl shadow-lg shadow-cyan-500/25 shrink-0"
            />
            <div>
              <h2 className="text-xl font-bold text-white tracking-wide font-mono">
                CLIP VAULT GALLERY
              </h2>
              <p className="text-xs text-gray-400 font-mono">
                Synchronized with local storage directory. Click any clip to review, draw, and export.
              </p>
            </div>
          </div>
        </div>

        {/* Live Actions & Stats */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs font-mono">
            <span className="text-gray-400">Vault:</span>
            <strong className="text-white font-bold">{clips.length} Clips</strong>
            <span className="text-gray-600">•</span>
            <span className="text-cyan-400">{Math.round(totalDuration)}s Total</span>
            <span className="text-gray-600">•</span>
            <span className="text-emerald-400">{totalAnnotations} Sketches</span>
          </div>

          {/* Refresh vault from disk button */}
          {onRefreshVault && (
            <button
              onClick={onRefreshVault}
              title="Scan & Refresh Vault from Directory"
              className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white border border-white/10 transition-all shadow-sm"
            >
              <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            </button>
          )}

          {/* Button to open the configured folder in file explorer */}
          <button
            onClick={onOpenVaultFolder}
            title="Open Clip Vault Folder in File Explorer"
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/15 text-gray-300 hover:text-white border border-white/10 flex items-center gap-1.5 text-xs font-mono font-bold transition-all shadow-sm"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Folder</span>
          </button>

          {!isBuffering ? (
            <button
              onClick={onToggleBuffer}
              title={`Start rolling buffer (${bufferHotkey})`}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/25 transition-all flex items-center gap-1.5 font-mono"
            >
              <Power className="w-3.5 h-3.5" />
              <span>Start Buffer ({bufferHotkey})</span>
            </button>
          ) : (
            <button
              onClick={onClipNow}
              title={`Save current buffer to vault (${clipHotkey})`}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-xs shadow-lg shadow-emerald-600/25 transition-all flex items-center gap-1.5 font-mono"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Clip to Vault ({clipHotkey})</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="flex items-center justify-between gap-4 py-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search vault clips by name or date..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-black/50 border border-white/10 text-xs font-mono text-white placeholder-gray-500 outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        <div className="flex items-center gap-1.5 text-xs text-gray-400 font-mono">
          <ArrowUpDown className="w-3.5 h-3.5 text-cyan-400" />
          <span>Sorted: Latest First</span>
        </div>
      </div>

      {/* 3. Grid of Vault Clips */}
      {filteredClips.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-gray-500 space-y-4">
          <img
            src={appLogo}
            alt="Epoch Logo"
            className="w-16 h-16 object-contain opacity-40 shrink-0"
          />
          <div>
            <h4 className="text-base font-bold text-gray-200 font-mono">
              {searchQuery ? 'No matching clips found' : 'Your Clip Vault is Empty'}
            </h4>
            <p className="text-xs text-gray-400 mt-1 max-w-md font-mono">
              {searchQuery
                ? 'Try searching with different keywords.'
                : `Start the rolling buffer (${bufferHotkey}) and press ${clipHotkey} during gameplay to save clips automatically to your directory.`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!isBuffering && (
              <button
                onClick={onToggleBuffer}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-cyan-600/30 transition-all font-mono flex items-center gap-2"
              >
                <Power className="w-4 h-4" />
                <span>START ROLLING BUFFER ({bufferHotkey})</span>
              </button>
            )}
            <button
              onClick={onOpenVaultFolder}
              className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-mono font-semibold transition-colors flex items-center gap-1.5"
            >
              <FolderOpen className="w-4 h-4 text-cyan-400" />
              <span>Open Vault Folder</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 pb-8">
          {filteredClips.map((clip) => (
            <div
              key={clip.id}
              onClick={() => onOpenClipInReview(clip)}
              className="group relative bg-[#0e1320] border border-white/10 hover:border-cyan-500/60 rounded-2xl overflow-hidden shadow-xl hover:shadow-cyan-500/10 transition-all cursor-pointer flex flex-col"
            >
              {/* Thumbnail / Video Preview */}
              <div className="relative w-full aspect-video bg-black/80 overflow-hidden flex items-center justify-center">
                <ClipCardThumbnail clip={clip} />

                {/* Play / Review overlay cue */}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <div className="px-3 py-1.5 rounded-xl bg-cyan-600 text-white font-mono text-xs font-bold flex items-center gap-1.5 shadow-lg shadow-cyan-600/50 transform scale-90 group-hover:scale-100 transition-transform">
                    <Crosshair className="w-3.5 h-3.5" />
                    <span>Review & Draw</span>
                  </div>
                </div>

                {/* Format & Duration Badges */}
                <span className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-cyan-950/80 backdrop-blur-sm border border-cyan-500/40 text-[10px] font-mono font-bold text-cyan-300 uppercase">
                  {clip.format || 'WEBM'}
                </span>

                {/* Duration Badge */}
                <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-sm border border-white/10 text-[11px] font-mono font-bold text-white">
                  {clip.duration}s
                </span>

                {/* Annotation Count Badge */}
                {clip.annotations && clip.annotations.length > 0 && (
                  <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-cyan-600/90 text-white text-[10px] font-mono font-bold flex items-center gap-1 shadow">
                    <Sparkles className="w-3 h-3" />
                    {clip.annotations.length}
                  </span>
                )}
              </div>

              {/* Card Meta & Actions */}
              <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                <div className="space-y-1.5">
                  {/* Title or Rename Input */}
                  {editingClipId === clip.id ? (
                    <form onSubmit={(e) => handleSaveRename(clip.id, e)} className="flex items-center gap-1">
                      <input
                        autoFocus
                        type="text"
                        value={editNameValue}
                        onChange={(e) => setEditNameValue(e.target.value)}
                        onBlur={(e) => handleSaveRename(clip.id, e)}
                        className="w-full bg-black/80 text-white font-mono text-xs px-2 py-1 rounded border border-cyan-400 outline-none"
                      />
                      <button
                        type="submit"
                        className="p-1 rounded bg-cyan-600 text-white hover:bg-cyan-500"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-mono font-bold text-xs text-white truncate hover:text-cyan-400 transition-colors flex-1" title={clip.name}>
                        {clip.name}
                      </h3>
                      <button
                        onClick={(e) => handleStartRename(clip, e)}
                        title="Rename clip"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-opacity"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Time & Date Stamp */}
                  <div className="flex items-center gap-3 text-[11px] font-mono text-gray-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-cyan-400" />
                      {clip.timeFormatted}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-gray-500" />
                      {clip.dateFormatted}
                    </span>
                  </div>
                </div>

                {/* Card Footer Actions */}
                <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">
                    {clip.annotations.length} sketches
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onExportClip(clip);
                      }}
                      title="Export clip as MP4"
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-cyan-950 hover:text-cyan-400 text-gray-400 border border-white/5 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete "${clip.name}" from disk?`)) {
                          onDeleteClip(clip.id);
                        }
                      }}
                      title="Delete clip from disk"
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-red-950 hover:text-red-400 text-gray-400 border border-white/5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
