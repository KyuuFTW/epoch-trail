import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Monitor,
  AppWindow,
  Check,
  RefreshCw,
  Loader2,
  Tv,
  Search,
  Sliders,
  Layers,
  Sparkles,
  Maximize2
} from 'lucide-react';
import { CaptureSourceConfig, DesktopSource } from '../types';
import appLogo from '../assets/icon.png';

interface CaptureSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  value: CaptureSourceConfig;
  onChange: (source: CaptureSourceConfig) => void;
  disabled?: boolean;
}

export const CaptureSourceModal: React.FC<CaptureSourceModalProps> = ({
  isOpen,
  onClose,
  value,
  onChange,
  disabled = false,
}) => {
  const [mode, setMode] = useState<'screen' | 'window'>(value.mode || 'screen');
  const [sources, setSources] = useState<DesktopSource[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(value.sourceId || '');
  const [selectedName, setSelectedName] = useState<string>(value.sourceName || '');

  const loadSources = useCallback(async () => {
    if (!window.electronAPI?.getDesktopSources) return;
    setIsLoading(true);
    try {
      const result = await window.electronAPI.getDesktopSources();
      setSources(result || []);
    } catch (err) {
      console.warn('Failed to load desktop sources:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setMode(value.mode || 'screen');
    setSelectedId(value.sourceId || '');
    setSelectedName(value.sourceName || '');
    setSearchQuery('');
  }, [value, isOpen]);

  useEffect(() => {
    if (isOpen) {
      void loadSources();
    }
  }, [isOpen, loadSources]);

  // Keyboard shortcut listener (Escape to close)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const screens = sources.filter(s => s.id.startsWith('screen:'));
  const windows = sources.filter(s => s.id.startsWith('window:'));
  const baseList = mode === 'screen' ? (screens.length > 0 ? screens : sources) : windows;

  const filteredList = baseList.filter(s =>
    searchQuery.trim() === '' || s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectSource = (source: DesktopSource) => {
    setSelectedId(source.id);
    setSelectedName(source.name);
    onChange({
      mode,
      sourceId: source.id,
      sourceName: source.name,
    });
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-3 sm:p-6 md:p-8 select-none animate-fadeIn">
      <div className="w-full max-w-6xl h-[92vh] max-h-[92vh] bg-[#080d16] border border-cyan-500/40 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between bg-[#05080f] shrink-0">
          <div className="flex items-center gap-3">
            <img src={appLogo} alt="Logo" className="w-7 h-7 object-contain" />
            <div>
              <h2 className="font-bold text-base text-white tracking-wide font-mono flex items-center gap-2.5">
                <span>SELECT CAPTURE TARGET</span>
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-500/40 text-xs font-semibold">
                  {mode === 'screen' ? `${screens.length} Display Monitors` : `${windows.length} Open Windows`}
                </span>
              </h2>
              <p className="text-xs text-gray-400 font-mono">
                Choose the display screen or application window Epoch Trail captures into the circular memory buffer.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            title="Close (Escape)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selector, Search, & Refresh Controls */}
        <div className="px-6 py-3.5 border-b border-white/5 flex flex-wrap items-center justify-between gap-3 bg-black/40 font-mono shrink-0">
          {/* Mode Switcher Tabs */}
          <div className="flex bg-black/70 border border-white/10 rounded-2xl p-1 gap-1">
            <button
              onClick={() => setMode('screen')}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                mode === 'screen'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 ring-1 ring-white/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Monitor className="w-4 h-4" />
              <span>Full Displays ({screens.length || sources.length})</span>
            </button>

            <button
              onClick={() => setMode('window')}
              className={`px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all ${
                mode === 'window'
                  ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-600/30 ring-1 ring-white/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <AppWindow className="w-4 h-4" />
              <span>Game & App Windows ({windows.length})</span>
            </button>
          </div>

          {/* Search Filter & Refresh Button */}
          <div className="flex items-center gap-2.5 flex-1 max-w-md justify-end">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={mode === 'screen' ? 'Filter displays...' : 'Search windows by title (e.g. Chrome, Game, Discord)...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-black/50 border border-white/10 rounded-xl text-xs text-white placeholder-gray-500 outline-none focus:border-cyan-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            <button
              onClick={() => void loadSources()}
              disabled={isLoading}
              className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-semibold flex items-center gap-2 transition-colors disabled:opacity-50 shrink-0"
              title="Refresh Sources List"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Source Cards Grid with Full Visibility */}
        <div className="flex-1 p-6 overflow-y-auto">
          {isLoading && filteredList.length === 0 ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 text-gray-400 font-mono">
              <Loader2 className="w-10 h-10 animate-spin text-cyan-400" />
              <span className="text-sm font-semibold">Capturing high-definition window previews...</span>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="h-full min-h-[320px] flex flex-col items-center justify-center gap-3 text-center text-gray-500 font-mono">
              <Tv className="w-12 h-12 opacity-30 text-cyan-400" />
              <p className="text-base font-bold text-gray-300">
                {searchQuery ? `No matching targets found for "${searchQuery}"` : `No ${mode === 'screen' ? 'Displays' : 'Windows'} Detected`}
              </p>
              <p className="text-xs text-gray-500 max-w-md">
                {searchQuery ? 'Try clearing your search query or switching to another category.' : 'Make sure your target application or game window is open on screen and not minimized.'}
              </p>
              <div className="flex gap-2 mt-2">
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-bold hover:bg-white/20 transition-all"
                  >
                    Clear Search
                  </button>
                )}
                <button
                  onClick={() => void loadSources()}
                  className="px-4 py-2 rounded-xl bg-cyan-600 text-white text-xs font-bold shadow-md hover:bg-cyan-500 transition-all"
                >
                  Scan Again
                </button>
              </div>
            </div>
          ) : (
            <div className={
              mode === 'screen'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-6'
                : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-5'
            }>
              {filteredList.map((source, index) => {
                const isSelected = selectedId === source.id || (selectedName && selectedName === source.name);
                return (
                  <div
                    key={source.id}
                    onClick={() => handleSelectSource(source)}
                    className={`group relative rounded-2xl border p-3.5 flex flex-col gap-3 cursor-pointer transition-all duration-200 ${
                      isSelected
                        ? 'bg-cyan-950/80 border-cyan-400 ring-2 ring-cyan-500/60 shadow-2xl shadow-cyan-600/30 scale-[1.01]'
                        : 'bg-[#090e18] border-white/10 hover:border-cyan-500/70 hover:bg-white/[0.05] shadow-lg hover:shadow-cyan-950/30'
                    }`}
                  >
                    {/* Big Thumbnail Preview Container */}
                    <div className="relative w-full aspect-video rounded-xl bg-black overflow-hidden border border-white/10 flex items-center justify-center shadow-inner">
                      {source.thumbnail ? (
                        <img
                          src={source.thumbnail}
                          alt={source.name}
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-black/70 text-gray-600">
                          {mode === 'screen' ? (
                            <Monitor className="w-10 h-10 text-cyan-500/40" />
                          ) : (
                            <AppWindow className="w-10 h-10 text-cyan-500/40" />
                          )}
                          <span className="text-[10px] font-mono">No Preview Available</span>
                        </div>
                      )}

                      {/* Display Index Pill for Screens */}
                      {source.isScreen && (
                        <div className="absolute top-2.5 left-2.5 px-2.5 py-1 rounded-lg bg-black/80 backdrop-blur-md border border-white/20 text-white font-mono font-bold text-[11px] flex items-center gap-1.5 shadow-lg">
                          <Monitor className="w-3.5 h-3.5 text-cyan-400" />
                          <span>Display {index + 1}</span>
                        </div>
                      )}

                      {/* Active Recording Target Badge */}
                      {isSelected && (
                        <div className="absolute top-2.5 right-2.5 px-3 py-1 rounded-lg bg-cyan-400 text-black font-mono font-extrabold text-[11px] flex items-center gap-1.5 shadow-xl">
                          <Check className="w-4 h-4 stroke-[3]" />
                          <span>ACTIVE TARGET</span>
                        </div>
                      )}

                      {/* Interactive Hover Overlay Action */}
                      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="px-4 py-2 rounded-xl bg-cyan-600 text-white font-mono text-xs font-bold shadow-2xl flex items-center gap-2 transform group-hover:scale-105 transition-transform">
                          <Check className="w-4 h-4" />
                          <span>Select {source.isScreen ? 'This Display' : 'This Window'}</span>
                        </span>
                      </div>
                    </div>

                    {/* Source Name & Label */}
                    <div className="flex items-center justify-between gap-2 px-1">
                      <div className="min-w-0 flex-1">
                        <h3 className="text-xs sm:text-sm font-bold text-white font-mono truncate group-hover:text-cyan-300 transition-colors" title={source.name}>
                          {source.name}
                        </h3>
                        <p className="text-[11px] text-gray-400 font-mono mt-0.5 flex items-center gap-1.5">
                          {source.isScreen ? (
                            <>
                              <Monitor className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span>Full Display Monitor (System Audio Loopback)</span>
                            </>
                          ) : (
                            <>
                              <AppWindow className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <span>Application Window Target</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between bg-[#05080f] font-mono text-xs shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Selected Recording Target:</span>
            <span className="px-3 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 font-bold">
              {selectedName || 'Primary Display'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-500 hidden sm:inline">Press Esc to cancel</span>
            <button
              onClick={onClose}
              className="px-6 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold transition-all border border-white/10"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
