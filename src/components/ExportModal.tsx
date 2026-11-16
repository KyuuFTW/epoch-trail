import React, { useState } from 'react';
import { X, CheckCircle2, AlertCircle, FileVideo, FolderOpen, Loader2 } from 'lucide-react';
import { ExportOptions, TacticalAnnotation } from '../types';
import { ExportEngine } from '../services/ExportEngine';
import appLogo from '../assets/icon.png';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoSourceUrl: string | null;
  annotations: TacticalAnnotation[];
  duration: number;
  gameAudioUrl?: string;
  micAudioUrl?: string;
  includeGameAudio?: boolean;
  includeMicAudio?: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  videoSourceUrl,
  annotations,
  duration,
  gameAudioUrl,
  micAudioUrl,
  includeGameAudio = true,
  includeMicAudio = true,
}) => {
  const [fileName, setFileName] = useState(`epoch_tactical_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '_')}`);
  const [burnAnnotations, setBurnAnnotations] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [exportedBlob, setExportedBlob] = useState<Blob | null>(null);
  const [exportedFilePath, setExportedFilePath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    if (!videoSourceUrl) {
      setError('No active tactical buffer video found.');
      return;
    }

    try {
      setIsExporting(true);
      setError(null);
      setExportedBlob(null);
      setExportedFilePath(null);
      setProgress(0);
      setStatusText('Initializing render pipeline...');

      const options: ExportOptions = {
        fileName,
        format: 'mp4',
        burnAnnotations,
        timeRange: [0, duration || 60],
        gameAudioUrl,
        micAudioUrl,
        includeGameAudio,
        includeMicAudio,
      };

      const resultBlob = await ExportEngine.exportFlattenedVideo(
        videoSourceUrl,
        annotations,
        options,
        (pct, status) => {
          setProgress(pct);
          setStatusText(status);
        }
      );

      setExportedBlob(resultBlob);

      // If running inside Electron, save directly via native dialog
      if (window.electronAPI?.saveExportedVideo) {
        const arrayBuffer = await resultBlob.arrayBuffer();
        const savedPath = await window.electronAPI.saveExportedVideo(
          new Uint8Array(arrayBuffer),
          `${fileName}.mp4`
        );
        if (savedPath) {
          setExportedFilePath(savedPath);
        }
      }
    } catch (err: any) {
      console.error('Export failed:', err);
      setError(err.message || 'An error occurred during video rendering.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadInBrowser = () => {
    if (!exportedBlob) return;
    const url = URL.createObjectURL(exportedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleOpenFolder = () => {
    if (exportedFilePath && window.electronAPI?.openPath) {
      window.electronAPI.openPath(exportedFilePath);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-[#0e1320] border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#090d16]">
          <div className="flex items-center gap-2.5">
            <img
              src={appLogo}
              alt="Epoch Logo"
              className="w-5 h-5 object-contain"
            />
            <h2 className="font-bold text-base text-white tracking-wide font-mono">
              EXPORT TACTICAL CLIP (.MP4)
            </h2>
          </div>
          {!isExporting && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 text-sm text-gray-200">
          {/* File Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-gray-300 font-mono">FILE NAME</label>
            <div className="flex items-center bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono">
              <input
                type="text"
                value={fileName}
                disabled={isExporting}
                onChange={e => setFileName(e.target.value)}
                className="bg-transparent text-white outline-none flex-1 font-mono"
              />
              <span className="text-gray-500 font-bold ml-1">.mp4</span>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <label className="flex items-center gap-3 p-3 bg-white/5 border border-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors">
              <input
                type="checkbox"
                checked={burnAnnotations}
                disabled={isExporting}
                onChange={e => setBurnAnnotations(e.target.checked)}
                className="w-4 h-4 rounded text-cyan-600 bg-black/40 border-white/20 focus:ring-0 focus:ring-offset-0 cursor-pointer"
              />
              <div>
                <div className="font-semibold text-white text-xs font-mono">
                  Burn Vector Sketches into Video Stream
                </div>
                <div className="text-[11px] text-gray-400">
                  Flattens arrows, brushes, and halo frames directly into the .mp4 file.
                </div>
              </div>
            </label>
          </div>

          {/* Progress / Status */}
          {isExporting && (
            <div className="p-4 bg-black/60 border border-white/10 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="flex items-center gap-2 text-cyan-400">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {statusText}
                </span>
                <span className="font-bold text-white">{progress}%</span>
              </div>
              <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-cyan-400 transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/60 rounded-xl flex items-center gap-2 text-red-200 text-xs">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Success State */}
          {exportedBlob && (
            <div className="p-4 bg-emerald-950/40 border border-emerald-800/60 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold font-mono">
                <CheckCircle2 className="w-4 h-4" />
                <span>EXPORT READY & FLATTENED!</span>
              </div>
              <p className="text-xs text-gray-300 font-mono">
                File size: {(exportedBlob.size / (1024 * 1024)).toFixed(2)} MB ({annotations.length} annotations burned)
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleDownloadInBrowser}
                  className="flex-1 py-2 px-3 bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white font-bold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-all shadow-md font-mono"
                >
                  <FileVideo className="w-4 h-4" />
                  Download .MP4
                </button>
                {exportedFilePath && (
                  <button
                    onClick={handleOpenFolder}
                    className="py-2 px-3 bg-white/10 hover:bg-white/20 text-white font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors font-mono"
                  >
                    <FolderOpen className="w-4 h-4" />
                    Open Folder
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-end gap-3 bg-[#090d16]">
          <button
            onClick={onClose}
            disabled={isExporting}
            className="px-4 py-2 rounded-lg text-xs font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors font-mono"
          >
            {exportedBlob ? 'Done' : 'Cancel'}
          </button>
          {!exportedBlob && (
            <button
              onClick={handleStartExport}
              disabled={isExporting}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white shadow-lg shadow-cyan-600/30 transition-all flex items-center gap-1.5 disabled:opacity-50 font-mono"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Rendering...
                </>
              ) : (
                <>
                  <FileVideo className="w-3.5 h-3.5" />
                  Start Export
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
